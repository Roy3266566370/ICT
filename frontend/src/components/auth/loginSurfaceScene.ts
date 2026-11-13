/**
 * 登录页右侧三维曲面场景（契约 `C-SURFACESCENE@1`）。
 *
 * 本模块是整个登录页**唯一**持有 `WebGLRenderer` 与 `requestAnimationFrame` 的地方；
 * `LoginSurface.tsx` 只负责 DOM、观察器与播放门控，不自起帧循环。
 *
 * 坐标约定：数学 `x/y` 为底面、`z` 向上；`camera.up = (0, 0, 1)`，与 `surfaceMath.ts` 一致。
 *
 * 渲染要点：
 * - 曲面法线由闭式公式逐顶点解析求出，与位置写在同一循环里，不调用 `computeVertexNormals()`；
 * - 光照（Lambert 主光 + 弱补光 + Fresnel 边缘 + 高度渐变）与等高线全部在片元着色器中完成，
 *   等高线宽度用 `fwidth` 做屏幕空间抗锯齿，不再生成经纬线几何；
 * - 珊瑚橙只属于轨迹与观察点；观察点是加色混合的柔光精灵，外圈光晕环循环扩散并衰减；
 * - 相机做 40s ±3° 轨道与 29s ±2.5% 推拉，指针视差仍只作用于内容组。
 *
 * 帧内分配约束：
 * - 所有 `THREE.*` 对象（geometry / material / texture / typed buffer）只在**初始化路径**或
 *   `setQuality()`（窗口外的质量切换路径）创建；
 * - 帧循环只写预分配的 `Float32Array`、累加 `activeTime`、设置已有对象的属性，不新建对象；
 * - 曲面、轨迹、观察点每帧共享同一个 `phase`（`phaseAt(activeTime)`）。
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import {
  CURVE_SAMPLE_COUNT,
  REFERENCE_S,
  SURFACE_X_RANGE,
  SURFACE_Y_RANGE,
  evaluateSurface,
  movingObservationS,
  phaseAt,
  pointOnSurfacePath,
  pulseStateAt,
  sampleSurfaceGrid,
  surfaceNormal,
} from './surfaceMath';
import { POINTER_TILT_LIMIT_DEG, dampingFactor, type MotionPoint } from './motionPolicy';

export type SurfaceQuality = 'standard' | 'low';

export interface SurfaceSceneOptions {
  quality: SurfaceQuality;
  /** 首帧渲染完成后调用一次；调用方据此隐藏海报。 */
  onFirstFrame?: () => void;
  /** WebGL 上下文丢失（无法恢复）时调用；调用方据此回到海报。 */
  onContextLost?: () => void;
  /** 仅一次受控恢复尝试成功后调用。 */
  onContextRestored?: () => void;
  /**
   * 帧间隔采样（毫秒），每个实际渲染帧调用一次。
   *
   * 这是 `C-SURFACESCENE@1` 之外**向后兼容的可选扩展**：容器用有界环形缓冲统计 P95，
   * 再调用 `nextQualityOnStutter` 决定降档，使「是否降档」的判定仍然只有一处真源
   * （`motionPolicy.ts`），场景本身不持有质量策略。
   */
  onFrameSample?: (frameIntervalMs: number) => void;
}

export interface SurfaceSceneController {
  setPlaying(playing: boolean): void;
  setPointer(pointer: MotionPoint | null): void;
  setQuality(quality: SurfaceQuality): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** 曲面高度渐变：深青（谷底）→ 靛蓝（中段）→ 紫（峰顶）。 */
const SURFACE_LOW_HEX = 0x04222c;
const SURFACE_MID_HEX = 0x123e6b;
const SURFACE_HIGH_HEX = 0x8b63ff;
/** 等高线与边缘冷光。 */
const CONTOUR_HEX = 0x9fdcff;
/** 珊瑚橙只用于轨迹与观察点，是暗场里唯一的暖强调色。 */
const CORAL_HEX = 0xff7a59;

/** 单步 `dt` 上限（秒）：后台恢复时不跳变，与 `dampingFactor` 的截断一致。 */
const MAX_FRAME_DELTA_SECONDS = 0.05;
/** 标准档目标帧率 60fps；留 1ms 余量，避免 60Hz 刷新率的抖动把帧误判成“未到时间”。 */
const STANDARD_FRAME_INTERVAL_MS = 1000 / 60 - 1;
/** 低档目标帧率 30fps，同样留出刷新抖动余量。 */
const LOW_FRAME_INTERVAL_MS = 1000 / 30 - 1;
/** 标准档 DPR 上限：高分屏下等高线仍保持锐利。 */
const MAX_PIXEL_RATIO_STANDARD = 2;
/** 低档 DPR 上限。 */
const MAX_PIXEL_RATIO_LOW = 1.25;
/** 轨迹视觉线宽（CSS 像素）与围绕它的弱光晕线宽。 */
const CURVE_LINE_WIDTH_PX = 2.8;
const CURVE_GLOW_WIDTH_PX = 7;
/** 相机 40s 轨道 ±3°。 */
const CAMERA_ORBIT_PERIOD_SECONDS = 40;
const CAMERA_ORBIT_DEGREES = 3;
/** 相机 29s 推拉 ±2.5%。 */
const CAMERA_DOLLY_PERIOD_SECONDS = 29;
const CAMERA_DOLLY_AMPLITUDE = 0.025;
/** 观察点光晕环扩散周期（秒）与起止尺寸（世界单位）。 */
const HALO_PERIOD_SECONDS = 2.8;
const HALO_SCALE_START = 0.32;
const HALO_SCALE_END = 1.05;

/** 相机基准朝向：目标点向画面左下偏，使曲面整体落在右上三分之二。 */
const CAMERA_TARGET = new THREE.Vector3(-0.35, -0.55, 0.35);
const CAMERA_OFFSET = new THREE.Vector3(5.55, -7.25, 5.25);
/** 内容整体缩到约 2/3，并向屏幕右上轻移。 */
const CONTENT_SCALE = 0.98;
const CONTENT_OFFSET = new THREE.Vector3(0.4, 0.7, 0.37);

/** 同一容器同时只允许一个活动控制器（React 严格模式重复挂载的保护网）。 */
const ACTIVE_CONTROLLERS = new WeakMap<HTMLElement, SurfaceSceneController>();

/** 读取 `Float32Array` 元素：`noUncheckedIndexedAccess` 下索引访问是 `number | undefined`。 */
function at(array: Float32Array, index: number): number {
  return array[index] ?? 0;
}

/** 十六进制 sRGB → `[0,1]` 向量；着色器直接输出 sRGB，不做二次转换。 */
function srgbVector(hex: number): THREE.Vector3 {
  return new THREE.Vector3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  );
}

interface SurfaceBuffers {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  positionAttribute: THREE.BufferAttribute;
  normalAttribute: THREE.BufferAttribute;
  positions: Float32Array;
  normals: Float32Array;
  xByColumn: Float32Array;
  yByRow: Float32Array;
  vertexColumns: number;
  vertexRows: number;
}

interface SurfaceUniforms {
  [uniform: string]: {value: unknown};
  uLowColor: {value: THREE.Vector3};
  uMidColor: {value: THREE.Vector3};
  uHighColor: {value: THREE.Vector3};
  uRimColor: {value: THREE.Vector3};
  uContourColor: {value: THREE.Vector3};
  uPulseColor: {value: THREE.Vector3};
  uHeightMin: {value: number};
  uHeightMax: {value: number};
  uPulseCenter: {value: number};
  uPulseEnvelope: {value: number};
  uDomainX: {value: THREE.Vector2};
  uDomainY: {value: THREE.Vector2};
}

const SURFACE_VERTEX_SHADER = /* glsl */ `
  uniform vec2 uDomainX;
  uniform vec2 uDomainY;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vHeight;
  varying float vSurfaceX;
  varying vec2 vDomainUv;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vHeight = position.z;
    vSurfaceX = position.x;
    vDomainUv = vec2(
      (position.x - uDomainX.x) / max(uDomainX.y - uDomainX.x, 1e-4),
      (position.y - uDomainY.x) / max(uDomainY.y - uDomainY.x, 1e-4)
    );
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURFACE_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uLowColor;
  uniform vec3 uMidColor;
  uniform vec3 uHighColor;
  uniform vec3 uRimColor;
  uniform vec3 uContourColor;
  uniform vec3 uPulseColor;
  uniform float uHeightMin;
  uniform float uHeightMax;
  uniform float uPulseCenter;
  uniform float uPulseEnvelope;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vHeight;
  varying float vSurfaceX;
  varying vec2 vDomainUv;

  /** 以 value 的整数等值线为中心、用屏幕空间导数控制宽度的抗锯齿线。 */
  float contourLine(float value) {
    float distanceToLine = abs(fract(value + 0.5) - 0.5);
    float width = max(fwidth(value) * 1.15, 1e-4);
    return 1.0 - smoothstep(0.0, width, distanceToLine);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // 主光来自左上，补光是低强度冷光；环境项保持较低，让起伏有明暗层次。
    vec3 keyDir = normalize(vec3(-0.35, 0.62, 0.70));
    vec3 fillDir = normalize(vec3(0.72, -0.28, 0.34));
    float key = max(dot(normal, keyDir), 0.0);
    float fill = max(dot(normal, fillDir), 0.0);

    float heightT = clamp(
      (vHeight - uHeightMin) / max(uHeightMax - uHeightMin, 1e-4),
      0.0,
      1.0
    );
    vec3 base = mix(uLowColor, uMidColor, smoothstep(0.0, 0.55, heightT));
    base = mix(base, uHighColor, smoothstep(0.35, 0.92, heightT));

    float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 2.8);
    float specular = pow(max(dot(reflect(-keyDir, normal), viewDir), 0.0), 42.0);

    vec3 color = base * (0.38 + 0.52 * key + 0.08 * fill);
    // 峰顶保留一点自发光，避免背光的高处被压成黑色，丢掉紫端。
    color += uHighColor * smoothstep(0.45, 1.0, heightT) * 0.32;
    color += uRimColor * fresnel * 0.26;
    color += vec3(specular * 0.1);

    // 行波经过的位置有一层很薄的冷色高光，强调“脉冲正在扫过”。
    float band = exp(-pow((vSurfaceX - uPulseCenter) / 0.9, 2.0)) * uPulseEnvelope;
    color += uPulseColor * band * 0.18;

    // 细等高线每 1/7 高度一条，主等高线每 5 条加粗一格。
    float minorLine = contourLine(vHeight * 7.0);
    float majorLine = contourLine(vHeight * 1.4);
    float contour = max(minorLine * 0.2, majorLine * 0.38);
    color = mix(color, uContourColor, clamp(contour, 0.0, 1.0) * 0.9);

    // 域边缘柔化，避免曲面像一块硬切的矩形板。
    vec2 edgeDistance = min(vDomainUv, 1.0 - vDomainUv);
    vec2 edge = smoothstep(vec2(0.0), vec2(0.045), edgeDistance);
    float alpha = edge.x * edge.y * 0.97;

    gl_FragColor = vec4(color, alpha);
  }
`;

/** 生成柔光 / 光晕环贴图（初始化路径；256px 足够在 DPR 2 下保持平滑）。 */
function createSpriteTexture(kind: 'glow' | 'ring'): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas unavailable');

  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);

  if (kind === 'glow') {
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.16, 'rgba(255, 231, 219, 0.92)');
    gradient.addColorStop(0.34, 'rgba(255, 164, 132, 0.44)');
    gradient.addColorStop(0.62, 'rgba(255, 122, 89, 0.12)');
    gradient.addColorStop(1, 'rgba(255, 122, 89, 0)');
  } else {
    gradient.addColorStop(0, 'rgba(255, 122, 89, 0)');
    gradient.addColorStop(0.56, 'rgba(255, 122, 89, 0)');
    gradient.addColorStop(0.72, 'rgba(255, 205, 186, 0.85)');
    gradient.addColorStop(0.8, 'rgba(255, 122, 89, 0.42)');
    gradient.addColorStop(0.92, 'rgba(255, 122, 89, 0)');
    gradient.addColorStop(1, 'rgba(255, 122, 89, 0)');
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 等距定义域上的均匀采样坐标（初始化路径）。 */
function buildAxis(start: number, end: number, count: number): Float32Array {
  const axis = new Float32Array(count);
  const span = end - start;
  const denominator = Math.max(1, count - 1);
  for (let index = 0; index < count; index += 1) {
    axis[index] = start + (span * index) / denominator;
  }
  return axis;
}

/**
 * 构建曲面资源（初始化 / 质量切换路径，允许分配）。
 * 位置与解析法线共享同一顶点循环，帧内只写预分配 typed array。
 */
function createSurfaceBuffers(
  quality: SurfaceQuality,
  surfaceMaterial: THREE.ShaderMaterial,
): SurfaceBuffers {
  const grid = sampleSurfaceGrid(quality);
  const segmentsX = grid.columns;
  const segmentsY = grid.rows;
  const vertexColumns = segmentsX + 1;
  const vertexRows = segmentsY + 1;

  const positions = new Float32Array(vertexColumns * vertexRows * 3);
  const normals = new Float32Array(vertexColumns * vertexRows * 3);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const normalAttribute = new THREE.BufferAttribute(normals, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('normal', normalAttribute);

  const indexCount = segmentsX * segmentsY * 6;
  const indices = new Uint32Array(indexCount);
  let indexOffset = 0;
  for (let iy = 0; iy < segmentsY; iy += 1) {
    for (let ix = 0; ix < segmentsX; ix += 1) {
      const topLeft = iy * vertexColumns + ix;
      const bottomLeft = (iy + 1) * vertexColumns + ix;
      indices[indexOffset] = topLeft;
      indices[indexOffset + 1] = bottomLeft;
      indices[indexOffset + 2] = topLeft + 1;
      indices[indexOffset + 3] = topLeft + 1;
      indices[indexOffset + 4] = bottomLeft;
      indices[indexOffset + 5] = bottomLeft + 1;
      indexOffset += 6;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const mesh = new THREE.Mesh(geometry, surfaceMaterial);
  // 位置每帧变化但包围球只在初始化时计算一次，禁用剔除避免曲面被误裁。
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  return {
    mesh,
    geometry,
    positionAttribute,
    normalAttribute,
    positions,
    normals,
    xByColumn: buildAxis(SURFACE_X_RANGE[0], SURFACE_X_RANGE[1], vertexColumns),
    yByRow: buildAxis(SURFACE_Y_RANGE[0], SURFACE_Y_RANGE[1], vertexRows),
    vertexColumns,
    vertexRows,
  };
}

/** 释放曲面 GPU 资源（幂等，由 `dispose()` 与质量切换共用）。 */
function disposeSurfaceBuffers(buffers: SurfaceBuffers): void {
  buffers.geometry.dispose();
}

/** 写入曲面顶点与解析法线（帧内：只写预分配数组）。 */
function writeSurfacePositions(buffers: SurfaceBuffers, phase: number): void {
  const { positions, normals, xByColumn, yByRow, vertexColumns, vertexRows } = buffers;
  let offset = 0;
  for (let iy = 0; iy < vertexRows; iy += 1) {
    const y = at(yByRow, iy);
    for (let ix = 0; ix < vertexColumns; ix += 1) {
      const x = at(xByColumn, ix);
      const normal = surfaceNormal(x, y, phase);
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = evaluateSurface(x, y, phase);
      normals[offset] = normal.x;
      normals[offset + 1] = normal.y;
      normals[offset + 2] = normal.z;
      offset += 3;
    }
  }
  buffers.positionAttribute.needsUpdate = true;
  buffers.normalAttribute.needsUpdate = true;
}

/**
 * 写入轨迹实例缓冲（帧内）。
 *
 * `LineGeometry.setPositions` 的内部布局是每段 `[start.xyz, end.xyz]`（stride 6）。
 */
function writeCurvePositions(curveArray: Float32Array, phase: number): void {
  const segmentCount = CURVE_SAMPLE_COUNT - 1;
  let previous = pointOnSurfacePath(0, phase);
  for (let index = 0; index < segmentCount; index += 1) {
    const next = pointOnSurfacePath((index + 1) / segmentCount, phase);
    const offset = index * 6;
    curveArray[offset] = previous.x;
    curveArray[offset + 1] = previous.y;
    curveArray[offset + 2] = previous.z;
    curveArray[offset + 3] = next.x;
    curveArray[offset + 4] = next.y;
    curveArray[offset + 5] = next.z;
    previous = next;
  }
}

interface SceneResources {
  placementGroup: THREE.Group;
  contentGroup: THREE.Group;
  surfaceMaterial: THREE.ShaderMaterial;
  surfaceUniforms: SurfaceUniforms;
  surfaceBuffers: SurfaceBuffers;
  curveGeometry: LineGeometry;
  curveMaterial: LineMaterial;
  curveGlowMaterial: LineMaterial;
  curveLine: Line2;
  curveGlowLine: Line2;
  curveArray: Float32Array;
  glowTexture: THREE.CanvasTexture;
  ringTexture: THREE.CanvasTexture;
  pointMaterial: THREE.SpriteMaterial;
  ringMaterial: THREE.SpriteMaterial;
  referenceLowPoint: THREE.Sprite;
  referenceHighPoint: THREE.Sprite;
  activePoint: THREE.Sprite;
  haloRing: THREE.Sprite;
  disposables: readonly {dispose(): void}[];
}

/** 构建全部场景资源；任何一步失败都回滚已创建对象并返回 `null`。 */
function createSceneResources(
  quality: SurfaceQuality,
  width: number,
  height: number,
): SceneResources | null {
  const disposables: {dispose(): void}[] = [];
  try {
    const placementGroup = new THREE.Group();
    placementGroup.scale.setScalar(CONTENT_SCALE);
    placementGroup.position.copy(CONTENT_OFFSET);
    const contentGroup = new THREE.Group();
    placementGroup.add(contentGroup);

    const surfaceUniforms: SurfaceUniforms = {
      uLowColor: {value: srgbVector(SURFACE_LOW_HEX)},
      uMidColor: {value: srgbVector(SURFACE_MID_HEX)},
      uHighColor: {value: srgbVector(SURFACE_HIGH_HEX)},
      uRimColor: {value: srgbVector(CONTOUR_HEX)},
      uContourColor: {value: srgbVector(CONTOUR_HEX)},
      uPulseColor: {value: srgbVector(0x58b9ff)},
      uHeightMin: {value: -0.5},
      uHeightMax: {value: 2.15},
      uPulseCenter: {value: 0},
      uPulseEnvelope: {value: 0},
      uDomainX: {value: new THREE.Vector2(SURFACE_X_RANGE[0], SURFACE_X_RANGE[1])},
      uDomainY: {value: new THREE.Vector2(SURFACE_Y_RANGE[0], SURFACE_Y_RANGE[1])},
    };

    const surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: surfaceUniforms,
      vertexShader: SURFACE_VERTEX_SHADER,
      fragmentShader: SURFACE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    disposables.push(surfaceMaterial);

    const surfaceBuffers = createSurfaceBuffers(quality, surfaceMaterial);
    disposables.push(surfaceBuffers.geometry);

    // 轨迹：Line2 + LineMaterial，屏幕空间线宽；不使用 LineBasicMaterial.linewidth。
    const curveGeometry = new LineGeometry();
    disposables.push(curveGeometry);
    const initialCurve = new Float32Array(CURVE_SAMPLE_COUNT * 3);
    curveGeometry.setPositions(initialCurve);
    const instanceStart = curveGeometry.getAttribute('instanceStart');
    let instanceBuffer: THREE.InterleavedBuffer | null = null;
    if (instanceStart instanceof THREE.InterleavedBufferAttribute) {
      instanceBuffer = instanceStart.data;
    }
    if (instanceBuffer === null) {
      throw new Error('Line2 instance buffer unavailable');
    }
    let curveArray: Float32Array;
    if (instanceBuffer.array instanceof Float32Array) {
      curveArray = instanceBuffer.array;
    } else {
      // 极少数构建下内部数组不是 Float32Array：初始化路径内转成可写缓冲。
      curveArray = Float32Array.from(instanceBuffer.array);
      const ownedBuffer = new THREE.InstancedInterleavedBuffer(curveArray, 6, 1);
      curveGeometry.setAttribute(
        'instanceStart',
        new THREE.InterleavedBufferAttribute(ownedBuffer, 3, 0),
      );
      curveGeometry.setAttribute(
        'instanceEnd',
        new THREE.InterleavedBufferAttribute(ownedBuffer, 3, 3),
      );
    }

    const curveMaterial = new LineMaterial({
      color: CORAL_HEX,
      linewidth: CURVE_LINE_WIDTH_PX,
      worldUnits: false,
      transparent: true,
      depthWrite: false,
      resolution: new THREE.Vector2(width, height),
    });
    disposables.push(curveMaterial);
    const curveGlowMaterial = new LineMaterial({
      color: CORAL_HEX,
      linewidth: CURVE_GLOW_WIDTH_PX,
      worldUnits: false,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      resolution: new THREE.Vector2(width, height),
    });
    disposables.push(curveGlowMaterial);

    const curveGlowLine = new Line2(curveGeometry, curveGlowMaterial);
    curveGlowLine.frustumCulled = false;
    curveGlowLine.renderOrder = 1;
    const curveLine = new Line2(curveGeometry, curveMaterial);
    curveLine.frustumCulled = false;
    curveLine.renderOrder = 2;

    // 观察点：加色柔光精灵 + 活动点外圈循环扩散的衰减光晕环。
    const glowTexture = createSpriteTexture('glow');
    disposables.push(glowTexture);
    const ringTexture = createSpriteTexture('ring');
    disposables.push(ringTexture);

    const pointMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: CORAL_HEX,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // 观察点是注释层：不被曲面起伏遮挡，始终可见。
      depthTest: false,
    });
    disposables.push(pointMaterial);
    const ringMaterial = new THREE.SpriteMaterial({
      map: ringTexture,
      color: CORAL_HEX,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    disposables.push(ringMaterial);

    const makeSprite = (material: THREE.SpriteMaterial, scale: number): THREE.Sprite => {
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(scale);
      sprite.frustumCulled = false;
      sprite.renderOrder = 3;
      return sprite;
    };
    const referenceLowPoint = makeSprite(pointMaterial, 0.26);
    const referenceHighPoint = makeSprite(pointMaterial, 0.26);
    const activePoint = makeSprite(pointMaterial, 0.42);
    const haloRing = makeSprite(ringMaterial, HALO_SCALE_START);

    contentGroup.add(
      surfaceBuffers.mesh,
      curveGlowLine,
      curveLine,
      referenceLowPoint,
      referenceHighPoint,
      activePoint,
      haloRing,
    );

    return {
      placementGroup,
      contentGroup,
      surfaceMaterial,
      surfaceUniforms,
      surfaceBuffers,
      curveGeometry,
      curveMaterial,
      curveGlowMaterial,
      curveLine,
      curveGlowLine,
      curveArray,
      glowTexture,
      ringTexture,
      pointMaterial,
      ringMaterial,
      referenceLowPoint,
      referenceHighPoint,
      activePoint,
      haloRing,
      disposables,
    };
  } catch {
    for (const disposable of disposables) disposable.dispose();
    return null;
  }
}

/**
 * 在 `container` 内创建场景。
 *
 * WebGL2 不可用、容器尺寸非正或创建失败时返回 `null`（调用方保持海报），不抛异常。
 */
export function createSurfaceScene(
  container: HTMLElement,
  options: SurfaceSceneOptions,
): SurfaceSceneController | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  const bounds = container.getBoundingClientRect();
  if (!(bounds.width > 0) || !(bounds.height > 0)) return null;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (renderer.capabilities.isWebGL2 !== true) {
    renderer.dispose();
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, bounds.width / bounds.height, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.copy(CAMERA_TARGET).add(CAMERA_OFFSET);
  camera.lookAt(CAMERA_TARGET);

  const resources = createSceneResources(options.quality, bounds.width, bounds.height);
  if (resources === null) {
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* 释放失败无需向用户暴露 */
    }
    return null;
  }

  scene.add(resources.placementGroup);

  // ---------------- 可变形状态 ----------------
  let disposed = false;
  let playing = false;
  let contextLost = false;
  let restoreAttempted = false;
  let currentQuality: SurfaceQuality = options.quality;
  let viewWidth = bounds.width;
  let viewHeight = bounds.height;
  let frameHandle = 0;
  let lastRenderAtMs = 0;
  let lastActiveTickMs = 0;
  let activeTimeSeconds = 0;
  let targetPointerX = 0;
  let targetPointerY = 0;
  let dampedPointerX = 0;
  let dampedPointerY = 0;

  const tiltLimitZ = THREE.MathUtils.degToRad(POINTER_TILT_LIMIT_DEG.zAxis);
  const tiltLimitX = THREE.MathUtils.degToRad(POINTER_TILT_LIMIT_DEG.xAxis);
  const orbitLimit = THREE.MathUtils.degToRad(CAMERA_ORBIT_DEGREES);

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';

  renderer.setClearColor(0x000000, 0);

  // ---------------- 内部函数 ----------------
  const applyViewport = (width: number, height: number): void => {
    viewWidth = width;
    viewHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const pixelRatioCap =
      currentQuality === 'standard' ? MAX_PIXEL_RATIO_STANDARD : MAX_PIXEL_RATIO_LOW;
    const devicePixelRatio =
      typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatioCap));
    // updateStyle = false：canvas 的 CSS 尺寸由容器与样式表控制。
    renderer.setSize(width, height, false);
    resources.curveMaterial.resolution.set(width, height);
    resources.curveGlowMaterial.resolution.set(width, height);
  };

  /** 轨道 + 推拉：只设置已有相机的属性，不创建新对象。 */
  const updateCamera = (activeTime: number): void => {
    const orbit =
      Math.sin((Math.PI * 2 * activeTime) / CAMERA_ORBIT_PERIOD_SECONDS) * orbitLimit;
    const dolly =
      1 +
      Math.sin((Math.PI * 2 * activeTime) / CAMERA_DOLLY_PERIOD_SECONDS) *
        CAMERA_DOLLY_AMPLITUDE;
    const cosine = Math.cos(orbit);
    const sine = Math.sin(orbit);
    const offsetX = CAMERA_OFFSET.x * cosine - CAMERA_OFFSET.y * sine;
    const offsetY = CAMERA_OFFSET.x * sine + CAMERA_OFFSET.y * cosine;
    camera.position.set(
      CAMERA_TARGET.x + offsetX * dolly,
      CAMERA_TARGET.y + offsetY * dolly,
      CAMERA_TARGET.z + CAMERA_OFFSET.z * dolly,
    );
    camera.lookAt(CAMERA_TARGET);
  };

  /** 更新所有与相位相关的缓冲（帧内只写数组与已有对象属性）。 */
  const updateSceneBuffers = (activeTime: number): void => {
    const phase = phaseAt(activeTime);
    writeSurfacePositions(resources.surfaceBuffers, phase);
    writeCurvePositions(resources.curveArray, phase);

    const pulse = pulseStateAt(phase);
    resources.surfaceUniforms.uPulseCenter.value = pulse.center;
    resources.surfaceUniforms.uPulseEnvelope.value = pulse.envelope;

    const sLow = pointOnSurfacePath(REFERENCE_S[0], phase);
    resources.referenceLowPoint.position.set(sLow.x, sLow.y, sLow.z);
    const sHigh = pointOnSurfacePath(REFERENCE_S[1], phase);
    resources.referenceHighPoint.position.set(sHigh.x, sHigh.y, sHigh.z);
    const activeS = movingObservationS(activeTime);
    const active = pointOnSurfacePath(activeS, phase);
    resources.activePoint.position.set(active.x, active.y, active.z);
    resources.haloRing.position.set(active.x, active.y, active.z);

    const haloProgress = (activeTime % HALO_PERIOD_SECONDS) / HALO_PERIOD_SECONDS;
    resources.haloRing.scale.setScalar(
      HALO_SCALE_START + (HALO_SCALE_END - HALO_SCALE_START) * haloProgress,
    );
    resources.ringMaterial.opacity = Math.pow(1 - haloProgress, 1.5) * 0.9;
    const breath = 1 + 0.07 * Math.sin((Math.PI * 2 * activeTime) / 3.2);
    resources.activePoint.scale.setScalar(0.42 * breath);
  };

  /** 视差阻尼：`setPointer` 只写目标值，帧循环用 `dampingFactor(dt)` 逼近。 */
  const updateParallax = (dtSeconds: number): void => {
    const factor = dampingFactor(dtSeconds);
    dampedPointerX += (targetPointerX - dampedPointerX) * factor;
    dampedPointerY += (targetPointerY - dampedPointerY) * factor;
    resources.contentGroup.rotation.z = dampedPointerX * tiltLimitZ;
    resources.contentGroup.rotation.x = -dampedPointerY * tiltLimitX;
  };

  const renderCurrent = (): void => {
    updateCamera(activeTimeSeconds);
    updateSceneBuffers(activeTimeSeconds);
    renderer.render(scene, camera);
  };

  const renderFrame = (dtSeconds: number): void => {
    activeTimeSeconds += dtSeconds;
    updateCamera(activeTimeSeconds);
    updateSceneBuffers(activeTimeSeconds);
    updateParallax(dtSeconds);
    renderer.render(scene, camera);
  };

  const stopLoop = (): void => {
    playing = false;
    if (frameHandle !== 0) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };

  const handleRenderFailure = (): void => {
    stopLoop();
    if (!contextLost) {
      contextLost = true;
      try {
        options.onContextLost?.();
      } catch {
        /* 回调异常不向用户暴露 */
      }
    }
  };

  const tick = (now: number): void => {
    frameHandle = 0;
    if (disposed || !playing || contextLost) return;
    frameHandle = window.requestAnimationFrame(tick);

    const frameInterval =
      currentQuality === 'low' ? LOW_FRAME_INTERVAL_MS : STANDARD_FRAME_INTERVAL_MS;
    const elapsedSinceRender = lastRenderAtMs === 0 ? 0 : now - lastRenderAtMs;
    if (lastRenderAtMs !== 0 && elapsedSinceRender < frameInterval) return;

    const dtSeconds =
      lastActiveTickMs === 0
        ? 0
        : Math.min((now - lastActiveTickMs) / 1000, MAX_FRAME_DELTA_SECONDS);
    lastActiveTickMs = now;

    if (lastRenderAtMs !== 0) {
      try {
        options.onFrameSample?.(elapsedSinceRender);
      } catch {
        /* 采样回调异常不影响渲染 */
      }
    }
    lastRenderAtMs = now;

    try {
      renderFrame(dtSeconds);
    } catch {
      handleRenderFailure();
    }
  };

  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (disposed) return;
    contextLost = true;
    stopLoop();
    try {
      options.onContextLost?.();
    } catch {
      /* 回调异常不向用户暴露 */
    }
  };

  /** 只允许一次受控恢复尝试；失败后保持静态，不再创建新上下文。 */
  const handleContextRestored = (): void => {
    if (disposed || !contextLost || restoreAttempted) return;
    restoreAttempted = true;
    try {
      contextLost = false;
      renderCurrent();
      try {
        options.onContextRestored?.();
      } catch {
        /* 回调异常不向用户暴露 */
      }
    } catch {
      contextLost = true;
      try {
        options.onContextLost?.();
      } catch {
        /* 回调异常不向用户暴露 */
      }
    }
  };

  canvas.addEventListener('webglcontextlost', handleContextLost, false);
  canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

  // ---------------- 控制器 ----------------
  const controller: SurfaceSceneController = {
    setPlaying(next: boolean): void {
      if (disposed || contextLost) return;
      if (next) {
        if (playing) return;
        playing = true;
        // 恢复时立即补一帧，首帧 dt = 0，不按墙钟跳变相位。
        lastRenderAtMs = 0;
        lastActiveTickMs = 0;
        frameHandle = window.requestAnimationFrame(tick);
        return;
      }
      stopLoop();
      // 保留最后一帧（不 clear，不清空 canvas）。
    },
    setPointer(pointer: MotionPoint | null): void {
      if (disposed) return;
      const nextX = pointer === null ? 0 : pointer.x;
      const nextY = pointer === null ? 0 : pointer.y;
      targetPointerX = Number.isFinite(nextX) ? Math.min(1, Math.max(-1, nextX)) : 0;
      targetPointerY = Number.isFinite(nextY) ? Math.min(1, Math.max(-1, nextY)) : 0;
    },
    setQuality(quality: SurfaceQuality): void {
      if (disposed || quality === currentQuality) return;
      currentQuality = quality;
      // 质量切换路径（窗口外）：允许重建几何，帧循环不参与。
      const previous = resources.surfaceBuffers;
      disposeSurfaceBuffers(previous);
      resources.contentGroup.remove(previous.mesh);
      resources.surfaceBuffers = createSurfaceBuffers(quality, resources.surfaceMaterial);
      resources.contentGroup.add(resources.surfaceBuffers.mesh);
      applyViewport(viewWidth, viewHeight);
      if (!playing) renderCurrent();
    },
    resize(width: number, height: number): void {
      if (disposed) return;
      if (!(width > 0) || !(height > 0)) return;
      applyViewport(width, height);
      // 暂停时允许补画一帧，但不重启循环。
      if (!playing) renderCurrent();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopLoop();
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);

      disposeSurfaceBuffers(resources.surfaceBuffers);
      for (const disposable of resources.disposables) {
        if (disposable === resources.surfaceBuffers.geometry) continue;
        disposable.dispose();
      }

      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {
        /* 释放失败无需向用户暴露 */
      }
      while (container.firstChild !== null) {
        container.removeChild(container.firstChild);
      }
      if (ACTIVE_CONTROLLERS.get(container) === controller) {
        ACTIVE_CONTROLLERS.delete(container);
      }
    },
  };

  // 同一容器只保留一个活动控制器：先释放旧实例（其 dispose 会清空容器），
  // 再挂载新 canvas，避免旧实例的清理把新 canvas 一并移除（严格模式双挂载保护）。
  const existing = ACTIVE_CONTROLLERS.get(container);
  if (existing !== undefined) existing.dispose();
  container.appendChild(canvas);
  ACTIVE_CONTROLLERS.set(container, controller);

  try {
    applyViewport(viewWidth, viewHeight);
    renderCurrent();
  } catch {
    controller.dispose();
    return null;
  }

  try {
    options.onFirstFrame?.();
  } catch {
    /* 首帧回调异常不影响场景 */
  }

  return controller;
}
