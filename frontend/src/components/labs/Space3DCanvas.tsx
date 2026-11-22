/**
 * Space3DCanvas —— 基于 Three.js + OrbitControls 的真 3D 空间几何与三重积分画布。
 *
 * 直接消费后端确定性内核生成的 `CalculusResult['space']` 三维原语（曲面网格、
 * 空间曲线、边界棱线、直线与几何点），支持鼠标拖拽旋转、滚轮缩放、视角切换与
 * 曲面着色开关；WebGL 不可用时自动降级为 2D 等轴测 SVG 投影。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CalculusResult } from '@/labs/types';
import styles from './Space3DCanvas.module.css';

type Vec3 = { x: number; y: number; z: number };
type ViewPreset = 'iso' | 'top' | 'front' | 'side';

interface Props {
  result: CalculusResult;
}

const WIDTH = 760;
const HEIGHT = 420;
const MARGIN = { left: 58, top: 24 };

function isFinitePoint<T extends Vec3>(point: T | undefined): point is T {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z),
  );
}

/** 构造曲面三角网格 BufferGeometry；自动跳过含非有限值的退化单元。 */
function buildSurfaceGeometry(
  grid: Vec3[][],
  toScene: (point: Vec3) => THREE.Vector3,
): THREE.BufferGeometry | null {
  const rows = grid.length;
  if (rows < 2) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIndex: (number | null)[][] = [];

  for (let r = 0; r < rows; r += 1) {
    const row = grid[r] ?? [];
    const mapped: (number | null)[] = [];
    for (let c = 0; c < row.length; c += 1) {
      const point = row[c];
      if (!isFinitePoint(point)) {
        mapped.push(null);
        continue;
      }
      const v = toScene(point);
      mapped.push(positions.length / 3);
      positions.push(v.x, v.y, v.z);
    }
    vertexIndex.push(mapped);
  }

  for (let r = 0; r < rows - 1; r += 1) {
    const rowA = vertexIndex[r] ?? [];
    const rowB = vertexIndex[r + 1] ?? [];
    const cols = Math.min(rowA.length, rowB.length);
    for (let c = 0; c < cols - 1; c += 1) {
      const a = rowA[c];
      const b = rowA[c + 1];
      const d = rowB[c];
      const e = rowB[c + 1];
      if (
        a !== null && a !== undefined &&
        b !== null && b !== undefined &&
        d !== null && d !== undefined &&
        e !== null && e !== undefined
      ) {
        indices.push(a, b, d);
        indices.push(b, e, d);
      }
    }
  }

  if (indices.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 构造曲面网格线（按行与列连接），增强曲面曲率可读性。 */
function buildWireframeGeometry(
  grid: Vec3[][],
  toScene: (point: Vec3) => THREE.Vector3,
): THREE.BufferGeometry | null {
  const segments: number[] = [];
  const pushSegment = (p1: Vec3 | undefined, p2: Vec3 | undefined): void => {
    if (!isFinitePoint(p1) || !isFinitePoint(p2)) return;
    const v1 = toScene(p1);
    const v2 = toScene(p2);
    segments.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  };

  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length - 1; c += 1) {
      pushSegment(row[c], row[c + 1]);
    }
  }
  const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
  for (let c = 0; c < maxCols; c += 1) {
    for (let r = 0; r < grid.length - 1; r += 1) {
      pushSegment(grid[r]?.[c], grid[r + 1]?.[c]);
    }
  }

  if (segments.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  return geometry;
}

/** 构造三维折线（用于空间曲线、边界棱线或直线），过滤重复相邻点。 */
function buildPolylineObject(
  points: Vec3[],
  toScene: (point: Vec3) => THREE.Vector3,
  color: number,
  radius: number,
): { object: THREE.Object3D; geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null {
  const vectors: THREE.Vector3[] = [];
  for (const point of points) {
    if (!isFinitePoint(point)) continue;
    const v = toScene(point);
    const prev = vectors[vectors.length - 1];
    if (!prev || prev.distanceToSquared(v) > 1e-8) {
      vectors.push(v);
    }
  }
  if (vectors.length < 2) return null;

  if (radius > 0 && vectors.length >= 2) {
    try {
      const curve = new THREE.CatmullRomCurve3(vectors, false, 'centripetal', 0.15);
      const tubularSegments = Math.min(240, Math.max(16, vectors.length * 3));
      const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: 0.08,
      });
      return {
        object: new THREE.Mesh(geometry, material),
        geometries: [geometry],
        materials: [material],
      };
    } catch {
      /* 退化折线降级为 Line */
    }
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  const material = new THREE.LineBasicMaterial({ color });
  return {
    object: new THREE.Line(geometry, material),
    geometries: [geometry],
    materials: [material],
  };
}

/** WebGL 不可用时的 2D 等轴测 SVG 降级视图。 */
function SpaceSvgFallback({ result }: Props): ReactNode {
  const space = result.space;
  const triple = result.task === 'triple_integral';
  const curves = space?.curves ?? [];
  const grid = space?.grid ?? [];
  const edges = space?.edges ?? [];
  const points = space?.points ?? [];
  const line = space?.line ?? [];
  const all = [
    ...curves.flatMap((item) => item.points),
    ...grid.flatMap((row) => row),
    ...edges.flatMap((item) => item),
    ...points,
    ...line,
  ].filter(isFinitePoint);

  if (!all.length) {
    return (
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svgFallback}
        role="img"
        aria-label={triple ? '三重积分区域' : '空间对象'}
      >
        <text x="380" y="200" textAnchor="middle">
          {result.answerText || (triple ? '三重积分区域待核对' : '空间对象待核对')}
        </text>
      </svg>
    );
  }

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const zs = all.map((p) => p.z);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
    1,
  );
  const scale = (145 / span) * (space?.view_zoom ?? 1);
  const angle = ((space?.view_yaw ?? 0) * Math.PI) / 180;
  const project = (p: Vec3) => {
    const rx = centerX + (p.x - centerX) * Math.cos(angle) - (p.y - centerY) * Math.sin(angle);
    const ry = centerY + (p.x - centerX) * Math.sin(angle) + (p.y - centerY) * Math.cos(angle);
    return {
      x: 380 + (rx - centerX - (ry - centerY)) * 0.866 * scale,
      y: 205 + ((rx - centerX + (ry - centerY)) * 0.5 - (p.z - centerZ)) * scale,
    };
  };
  const pathOf = (items: Vec3[]) =>
    items
      .filter(isFinitePoint)
      .map((p, index) => {
        const q = project(p);
        return `${index === 0 ? 'M' : 'L'}${q.x},${q.y}`;
      })
      .join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={styles.svgFallback}
      role="img"
      aria-label={triple ? '三重积分区域、曲面网格与边界曲线' : '空间曲线、曲面与空间对象'}
    >
      <text x={MARGIN.left + 16} y={MARGIN.top + 20} fontSize="13" fontWeight="600" fill="#1e293b">
        {triple ? '三重积分区域' : '空间对象'}（2D 降级视图）
      </text>
      {grid.map((row, index) => (
        <path key={`row${index}`} d={pathOf(row)} fill="none" stroke="#94a3b8" strokeWidth="0.8" opacity="0.55" />
      ))}
      {grid.length
        ? Array.from({ length: grid[0]?.length ?? 0 }, (_, column) => (
            <path
              key={`col${column}`}
              d={pathOf(grid.map((row) => row[column]).filter(isFinitePoint))}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="0.8"
              opacity="0.35"
            />
          ))
        : null}
      {edges.map((edge, index) => (
        <path key={`edge${index}`} d={pathOf(edge)} fill="none" stroke="#6366f1" strokeWidth="1.2" />
      ))}
      {line.length ? <path d={pathOf(line)} fill="none" stroke="#f59e0b" strokeWidth="1.5" /> : null}
      {curves.map((item) => (
        <path key={item.id} d={pathOf(item.points)} fill="none" stroke="#4f46e5" strokeWidth="2" />
      ))}
      {points.filter(isFinitePoint).map((point, index) => {
        const q = project(point);
        return (
          <g key={index}>
            <circle cx={q.x} cy={q.y} r="5" fill="#b8431f" stroke="#fff" strokeWidth="2" />
            <text x={q.x + 8} y={q.y - 8} fontSize="11" fill="#334155">
              {point.id ?? `P${index + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Space3DCanvas({ result }: Props): ReactNode {
  const space = result.space;
  const triple = result.task === 'triple_integral';
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const cameraControlRef = useRef<{
    setPreset: (preset: ViewPreset) => void;
    applyYawZoom: (yawDeg: number, zoom: number) => void;
    setVisibility: (surface: boolean, wire: boolean) => void;
  } | null>(null);

  const [webglFailed, setWebglFailed] = useState(false);
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const [showSurface, setShowSurface] = useState(true);
  const [showWire, setShowWire] = useState(true);

  const sceneData = useMemo(() => {
    const curves = space?.curves ?? [];
    const grid = space?.grid ?? [];
    const edges = space?.edges ?? [];
    const points = (space?.points ?? []).filter(isFinitePoint);
    const line = (space?.line ?? []).filter(isFinitePoint);
    const all = [
      ...curves.flatMap((item) => item.points),
      ...grid.flatMap((row) => row),
      ...edges.flatMap((item) => item),
      ...points,
      ...line,
    ].filter(isFinitePoint);
    return { curves, grid, edges, points, line, all };
  }, [space?.curves, space?.grid, space?.edges, space?.points, space?.line]);

  const hasGeometry = sceneData.all.length > 0;
  const viewYaw = space?.view_yaw ?? 0;
  const viewZoom = space?.view_zoom ?? 1;

  useEffect(() => {
    if (!hasGeometry || webglFailed) return undefined;
    const wrap = wrapRef.current;
    const canvasHost = canvasHostRef.current;
    const labelLayer = labelLayerRef.current;
    if (!wrap || !canvasHost || !labelLayer) return undefined;

    // 每次挂载创建独立 canvas，避免 React StrictMode 卸载重挂时上下文失效
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas ?? '';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      triple ? '三重积分区域三维交互画布' : '空间几何与曲面三维交互画布',
    );
    canvasHost.appendChild(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      canvas.remove();
      setWebglFailed(true);
      return undefined;
    }

    const width = Math.max(1, wrap.clientWidth);
    const height = Math.max(1, wrap.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();

    // 数学坐标系约定：Z 轴朝上
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 100);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controls.target.set(0, 0, 0);

    // 光照：柔和的环境光 + 主/背方向光，让半透明曲面层次清晰
    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(4, 3, 6);
    const fillLight = new THREE.DirectionalLight(0xc7d2fe, 0.45);
    fillLight.position.set(-4, -3, -2);
    scene.add(ambient, keyLight, fillLight);

    // 归一化包围盒，保证不同量级的空间题目都有舒适的视觉比例
    const xs = sceneData.all.map((p) => p.x);
    const ys = sceneData.all.map((p) => p.y);
    const zs = sceneData.all.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
      1e-3,
    );
    const normScale = 2.0 / span;
    const toScene = (p: Vec3) =>
      new THREE.Vector3((p.x - cx) * normScale, (p.y - cy) * normScale, (p.z - cz) * normScale);

    const disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = {
      geometries: [],
      materials: [],
    };

    // 1) XY 参考底网格（位于最低 z 处，方便感知高度）
    const minZScene = (Math.min(...zs) - cz) * normScale;
    const floorGrid = new THREE.GridHelper(3.0, 10, 0xcbd5e1, 0xe2e8f0);
    floorGrid.rotation.x = Math.PI / 2;
    floorGrid.position.z = minZScene - 0.04;
    scene.add(floorGrid);

    // 2) 三维坐标轴（X 珊瑚红 / Y 青绿 / Z 靛蓝）
    const axisLen = 1.45;
    const axesGroup = new THREE.Group();
    const axisSpecs: { dir: THREE.Vector3; color: number; label: string }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xb8431f, label: 'x' },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x0d9488, label: 'y' },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x4f46e5, label: 'z' },
    ];
    const projectedLabels: { world: THREE.Vector3; element: HTMLSpanElement }[] = [];

    for (const axis of axisSpecs) {
      const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(0, 0, 0), axisLen, axis.color, 0.14, 0.07);
      axesGroup.add(arrow);
      const tag = document.createElement('span');
      tag.className = styles.axisTag ?? '';
      tag.textContent = axis.label;
      tag.style.color = `#${axis.color.toString(16).padStart(6, '0')}`;
      labelLayer.appendChild(tag);
      projectedLabels.push({
        world: axis.dir.clone().multiplyScalar(axisLen + 0.14),
        element: tag,
      });
    }
    scene.add(axesGroup);

    // 3) 曲面着色 + 网格线
    let surfaceMesh: THREE.Mesh | null = null;
    let wireframeLines: THREE.LineSegments | null = null;

    const surfaceGeo = buildSurfaceGeometry(sceneData.grid, toScene);
    if (surfaceGeo) {
      const surfaceMat = new THREE.MeshStandardMaterial({
        color: triple ? 0x6366f1 : 0x4f46e5,
        transparent: true,
        opacity: 0.32,
        roughness: 0.42,
        metalness: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      surfaceMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
      surfaceMesh.visible = showSurface;
      scene.add(surfaceMesh);
      disposables.geometries.push(surfaceGeo);
      disposables.materials.push(surfaceMat);
    }

    const wireGeo = buildWireframeGeometry(sceneData.grid, toScene);
    if (wireGeo) {
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.42,
      });
      wireframeLines = new THREE.LineSegments(wireGeo, wireMat);
      wireframeLines.visible = showWire;
      scene.add(wireframeLines);
      disposables.geometries.push(wireGeo);
      disposables.materials.push(wireMat);
    }

    // 4) 边界棱线（如长方体、积分体边界）
    for (const edge of sceneData.edges) {
      const built = buildPolylineObject(edge, toScene, 0x6366f1, 0.012);
      if (built) {
        scene.add(built.object);
        disposables.geometries.push(...built.geometries);
        disposables.materials.push(...built.materials);
      }
    }

    // 5) 空间直线 / 法线
    if (sceneData.line.length >= 2) {
      const built = buildPolylineObject(sceneData.line, toScene, 0xd97706, 0.018);
      if (built) {
        scene.add(built.object);
        disposables.geometries.push(...built.geometries);
        disposables.materials.push(...built.materials);
      }
    }

    // 6) 空间曲线（如参数曲线、边界曲线、交线）
    for (const item of sceneData.curves) {
      const built = buildPolylineObject(item.points, toScene, 0x4338ca, 0.022);
      if (built) {
        scene.add(built.object);
        disposables.geometries.push(...built.geometries);
        disposables.materials.push(...built.materials);
      }
    }

    // 7) 关键几何点与屏幕标签
    if (sceneData.points.length) {
      const sphereGeo = new THREE.SphereGeometry(0.052, 18, 18);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0xb8431f,
        roughness: 0.3,
        metalness: 0.1,
      });
      disposables.geometries.push(sphereGeo);
      disposables.materials.push(sphereMat);

      sceneData.points.forEach((point, index) => {
        const pos = toScene(point);
        const mesh = new THREE.Mesh(sphereGeo, sphereMat);
        mesh.position.copy(pos);
        scene.add(mesh);

        const el = document.createElement('span');
        el.className = styles.pointLabel ?? '';
        el.textContent = point.id ?? `P${index + 1}`;
        labelLayer.appendChild(el);
        projectedLabels.push({ world: pos, element: el });
      });
    }

    // 视角控制函数
    const applyYawZoom = (yawDeg: number, zoom: number): void => {
      const baseDist = 4.3 / Math.max(0.35, Math.min(3.5, zoom || 1));
      const az = ((yawDeg + 38) * Math.PI) / 180;
      const el = (28 * Math.PI) / 180;
      camera.position.set(
        baseDist * Math.cos(el) * Math.cos(az),
        baseDist * Math.cos(el) * Math.sin(az),
        baseDist * Math.sin(el),
      );
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const setPreset = (targetPreset: ViewPreset): void => {
      const dist = 4.3 / Math.max(0.35, Math.min(3.5, viewZoom || 1));
      controls.target.set(0, 0, 0);
      if (targetPreset === 'top') {
        camera.position.set(0.001, -0.001, dist);
      } else if (targetPreset === 'front') {
        camera.position.set(0, -dist, 0.25);
      } else if (targetPreset === 'side') {
        camera.position.set(dist, 0, 0.25);
      } else {
        applyYawZoom(viewYaw, viewZoom);
        return;
      }
      controls.update();
    };

    applyYawZoom(viewYaw, viewZoom);

    cameraControlRef.current = {
      setPreset,
      applyYawZoom,
      setVisibility: (surface: boolean, wire: boolean) => {
        if (surfaceMesh) surfaceMesh.visible = surface;
        if (wireframeLines) wireframeLines.visible = wire;
      },
    };

    // 标签投影与渲染循环
    const temp = new THREE.Vector3();
    let rafId = 0;
    let currentW = width;
    let currentH = height;

    const renderFrame = (): void => {
      rafId = window.requestAnimationFrame(renderFrame);
      controls.update();
      renderer.render(scene, camera);

      for (const item of projectedLabels) {
        temp.copy(item.world).project(camera);
        const visible = temp.z > -1 && temp.z < 1;
        item.element.style.display = visible ? 'block' : 'none';
        if (visible) {
          const px = (temp.x * 0.5 + 0.5) * currentW;
          const py = (-temp.y * 0.5 + 0.5) * currentH;
          item.element.style.left = `${px.toFixed(1)}px`;
          item.element.style.top = `${py.toFixed(1)}px`;
        }
      }
    };
    renderFrame();

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 1 || rect.height < 1) return;
      currentW = rect.width;
      currentH = rect.height;
      camera.aspect = currentW / currentH;
      camera.updateProjectionMatrix();
      renderer.setSize(currentW, currentH, false);
    });
    resizeObserver.observe(wrap);

    return () => {
      cameraControlRef.current = null;
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      floorGrid.dispose();
      disposables.geometries.forEach((g) => g.dispose());
      disposables.materials.forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
      labelLayer.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGeometry, sceneData, triple, webglFailed]);

  // 滑杆调节 view_yaw / view_zoom 时平滑同步 3D 相机
  useEffect(() => {
    cameraControlRef.current?.applyYawZoom(viewYaw, viewZoom);
  }, [viewYaw, viewZoom]);

  // 切换曲面着色与网格线显示
  useEffect(() => {
    cameraControlRef.current?.setVisibility(showSurface, showWire);
  }, [showSurface, showWire]);

  if (!hasGeometry || webglFailed) {
    return <SpaceSvgFallback result={result} />;
  }

  const handlePreset = (next: ViewPreset): void => {
    setPreset(next);
    cameraControlRef.current?.setPreset(next);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div ref={canvasHostRef} className={styles.canvasHost} />
      <div ref={labelLayerRef} className={styles.labelLayer} aria-hidden="true" />

      <div className={styles.headerOverlay}>
        <span className={styles.title}>{triple ? '三重积分区域 · 3D 视图' : '空间对象 · 3D 视图'}</span>
        <span className={styles.subtitle}>
          {triple
            ? '曲面网格与边界曲线来自已核验积分区域'
            : '曲线、曲面与几何点来自同一确定性空间模型'}
        </span>
      </div>

      <div className={styles.toolbar} role="toolbar" aria-label="三维视角与图层控制">
        {(
          [
            ['iso', '默认'],
            ['top', '俯视 XY'],
            ['front', '正视 XZ'],
            ['side', '侧视 YZ'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={styles.toolBtn}
            data-active={preset === id}
            onClick={() => handlePreset(id)}
          >
            {label}
          </button>
        ))}
        {sceneData.grid.length > 1 ? (
          <>
            <button
              type="button"
              className={styles.toolBtn}
              data-active={showSurface}
              onClick={() => setShowSurface((v) => !v)}
            >
              曲面着色
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              data-active={showWire}
              onClick={() => setShowWire((v) => !v)}
            >
              网格线
            </button>
          </>
        ) : null}
      </div>

      <span className={styles.footerHint}>左键拖拽旋转 · 滚轮缩放 · 右键平移</span>
    </div>
  );
}

export default Space3DCanvas;
