import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  angularMomentumOf,
  axisOf,
  type GyroConstants,
  type GyroState,
  type Vec3,
  torqueOf,
} from './gyroMath';
import styles from './gyroscope.module.css';

export type GyroView = 'free' | 'top' | 'side';

export interface GyroVisibility {
  labels: boolean;
  vectors: boolean;
  r: boolean;
  mg: boolean;
  torque: boolean;
  angularMomentum: boolean;
  step: boolean;
  precession: boolean;
  nutation: boolean;
}

export interface GyroStepVectors {
  before: Vec3;
  after: Vec3;
}

export interface GyroFrame {
  state: GyroState;
  constants: GyroConstants;
  comDistance: number;
  visibility: GyroVisibility;
  highlight: 'r' | 'mg' | null;
  step: GyroStepVectors | null;
  playing: boolean;
  traceKey: number;
}

export interface GyroSceneApi {
  update(frame: GyroFrame): void;
  setView(view: GyroView): void;
}

interface GyroCanvasProps {
  onOrbitStart?: () => void;
}

interface LabelHandle {
  element: HTMLSpanElement;
  tone: string;
}

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TRACE_CAPACITY = 1200;
const TIP_OFFSET = 0.06;

function vec3(values: Vec3): THREE.Vector3 {
  return new THREE.Vector3(values.x, values.y, values.z);
}

function normalize(values: Vec3): THREE.Vector3 {
  const vector = vec3(values);
  const length = vector.length();
  return length > 1e-8 ? vector.multiplyScalar(1 / length) : new THREE.Vector3(0, 0, 1);
}

/** 轻量 3D 箭头：圆柱杆 + 圆锥头，适合持续更新方向和长度。 */
class Arrow3D {
  readonly group: THREE.Group;
  private readonly shaft: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly shaftGeometry: THREE.CylinderGeometry;
  private readonly headGeometry: THREE.ConeGeometry;
  readonly material: THREE.MeshBasicMaterial;
  private readonly headLength = 0.038;

  constructor(color: number, opacity = 1) {
    this.material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.shaftGeometry = new THREE.CylinderGeometry(0.0038, 0.0038, 1, 10);
    this.shaftGeometry.translate(0, 0.5, 0);
    this.shaft = new THREE.Mesh(this.shaftGeometry, this.material);
    this.headGeometry = new THREE.ConeGeometry(0.013, this.headLength, 16);
    this.head = new THREE.Mesh(this.headGeometry, this.material);
    this.group = new THREE.Group();
    this.group.renderOrder = 30;
    this.shaft.renderOrder = 30;
    this.head.renderOrder = 30;
    this.group.add(this.shaft, this.head);
    this.group.visible = false;
  }

  set(origin: THREE.Vector3, direction: THREE.Vector3, length: number): void {
    const safeLength = Math.max(0.001, length);
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(UP, normalizeDirection(direction));
    this.shaft.scale.set(1, Math.max(0.002, safeLength - this.headLength), 1);
    this.head.position.y = safeLength - this.headLength / 2;
    this.group.visible = true;
  }

  dispose(): void {
    this.shaftGeometry.dispose();
    this.headGeometry.dispose();
    this.material.dispose();
  }
}

function normalizeDirection(direction: THREE.Vector3): THREE.Vector3 {
  const length = direction.length();
  return length > 1e-8 ? direction.clone().multiplyScalar(1 / length) : new THREE.Vector3(0, 0, 1);
}

interface Projector {
  (world: THREE.Vector3): {x: number; y: number; visible: boolean};
}

function createProjector(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): Projector {
  const temp = new THREE.Vector3();
  return (world: THREE.Vector3) => {
    temp.copy(world).project(camera);
    return {
      x: (temp.x * 0.5 + 0.5) * width,
      y: (-temp.y * 0.5 + 0.5) * height,
      visible: temp.z > -1 && temp.z < 1,
    };
  };
}

interface Controller {
  update(frame: GyroFrame): void;
  setView(view: GyroView): void;
  dispose(): void;
}

function GyroCanvasInner(
  { onOrbitStart }: GyroCanvasProps,
  ref: ForwardedRef<GyroSceneApi>,
): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const orbitStartRef = useRef(onOrbitStart);
  const [failed, setFailed] = useState(false);

  orbitStartRef.current = onOrbitStart;

  useImperativeHandle(
    ref,
    () => ({
      update: (frame: GyroFrame): void => controllerRef.current?.update(frame),
      setView: (view: GyroView): void => controllerRef.current?.setView(view),
    }),
    [],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvasHost = canvasHostRef.current;
    const labelLayer = labelLayerRef.current;
    if (wrap === null || canvasHost === null || labelLayer === null) return undefined;

    // 不移交 React 托管的 canvas：StrictMode 会卸载/重挂一次，旧上下文被 forceContextLoss 后
    // 同一个 canvas 无法再次 getContext；每次挂载创建独立 canvas，卸载时整体移除。
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas ?? '';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '单支点重陀螺三维实验');
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
      setFailed(true);
      return undefined;
    }
    if (renderer.capabilities.isWebGL2 !== true) {
      renderer.dispose();
      canvas.remove();
      setFailed(true);
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, wrap.clientWidth), Math.max(1, wrap.clientHeight), false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      30,
      Math.max(0.2, wrap.clientWidth / Math.max(1, wrap.clientHeight)),
      0.02,
      10,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(0.62, -0.5, 0.34);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0.0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 0.4;
    controls.maxDistance = 1.5;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = 1.5;
    controls.addEventListener('start', () => orbitStartRef.current?.());

    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();

    const hemi = new THREE.HemisphereLight(0xfff4e5, 0x14171b, 0.52);
    const key = new THREE.DirectionalLight(0xffe7c8, 2.5);
    key.position.set(0.42, -0.5, 0.72);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.08;
    key.shadow.camera.far = 2.2;
    key.shadow.camera.left = -0.5;
    key.shadow.camera.right = 0.5;
    key.shadow.camera.top = 0.5;
    key.shadow.camera.bottom = -0.5;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.004;
    const rim = new THREE.DirectionalLight(0x9ed7ff, 1.15);
    rim.position.set(-0.55, 0.35, 0.38);
    const fill = new THREE.DirectionalLight(0xbcd5e5, 0.55);
    fill.position.set(0.05, -0.85, 0.42);
    scene.add(hemi, key, rim, fill);

    // 接触阴影：只保留器材底部的一小片暗影，避免大块地面抢走黄铜转子的焦点。
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const shadowContext = shadowCanvas.getContext('2d');
    let shadowTexture: THREE.CanvasTexture | null = null;
    if (shadowContext !== null) {
      const shadowGradient = shadowContext.createRadialGradient(128, 128, 8, 128, 128, 128);
      shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
      shadowGradient.addColorStop(0.48, 'rgba(0, 0, 0, 0.32)');
      shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      shadowContext.fillStyle = shadowGradient;
      shadowContext.fillRect(0, 0, 256, 256);
      shadowTexture = new THREE.CanvasTexture(shadowCanvas);
      shadowTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 64),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    contactShadow.position.set(0, 0, -0.166);
    contactShadow.renderOrder = 2;
    scene.add(contactShadow);

    const brass = new THREE.MeshPhysicalMaterial({
      color: 0xb98b4c,
      metalness: 1,
      roughness: 0.27,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
    });
    const brassDark = new THREE.MeshPhysicalMaterial({
      color: 0x8a6334,
      metalness: 1,
      roughness: 0.34,
      envMapIntensity: 1.1,
    });
    const steel = new THREE.MeshPhysicalMaterial({
      color: 0xc3cbd2,
      metalness: 0.95,
      roughness: 0.22,
      envMapIntensity: 1.25,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x4a545d,
      metalness: 0.8,
      roughness: 0.32,
      envMapIntensity: 0.95,
    });
    const stone = new THREE.MeshStandardMaterial({
      color: 0x343b42,
      metalness: 0.5,
      roughness: 0.5,
      envMapIntensity: 0.65,
      side: THREE.DoubleSide,
    });
    const seam = new THREE.MeshStandardMaterial({
      color: 0x4b3420,
      metalness: 0.7,
      roughness: 0.35,
    });
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4ead7,
      emissive: 0x4a351d,
      emissiveIntensity: 0.24,
      metalness: 0.15,
      roughness: 0.32,
    });

    // ---------------- 静态支架 ----------------
    const support = new THREE.Group();
    scene.add(support);

    const baseProfile = [
      new THREE.Vector2(0.0, 0.008),
      new THREE.Vector2(0.061, 0.008),
      new THREE.Vector2(0.07, 0.004),
      new THREE.Vector2(0.074, 0.0),
      new THREE.Vector2(0.07, -0.004),
      new THREE.Vector2(0.061, -0.006),
      new THREE.Vector2(0.0, -0.006),
    ];
    const baseGeometry = new THREE.LatheGeometry(baseProfile, 72);
    baseGeometry.rotateX(Math.PI / 2);
    const base = new THREE.Mesh(baseGeometry, stone);
    base.position.z = -0.158;
    base.castShadow = true;
    base.receiveShadow = true;
    support.add(base);

    const basePlateGeometry = new THREE.CylinderGeometry(0.06, 0.064, 0.004, 64);
    basePlateGeometry.rotateX(Math.PI / 2);
    const basePlate = new THREE.Mesh(basePlateGeometry, darkSteel);
    basePlate.position.z = -0.149;
    basePlate.receiveShadow = true;
    support.add(basePlate);

    const baseInsetGeometry = new THREE.TorusGeometry(0.047, 0.0009, 6, 96);
    const baseInset = new THREE.Mesh(baseInsetGeometry, steel);
    baseInset.position.z = -0.1465;
    support.add(baseInset);

    const baseEdgeGeometry = new THREE.TorusGeometry(0.071, 0.0011, 6, 96);
    const baseEdge = new THREE.Mesh(baseEdgeGeometry, steel);
    baseEdge.position.z = -0.1468;
    support.add(baseEdge);

    const baseScrewGeometry = new THREE.CylinderGeometry(0.0021, 0.0025, 0.0025, 12);
    baseScrewGeometry.rotateX(Math.PI / 2);
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + Math.PI / 6;
      const screw = new THREE.Mesh(baseScrewGeometry, brassDark);
      screw.position.set(Math.cos(angle) * 0.035, Math.sin(angle) * 0.035, -0.1463);
      support.add(screw);
    }

    const columnFootGeometry = new THREE.CylinderGeometry(0.018, 0.022, 0.009, 24);
    columnFootGeometry.rotateX(Math.PI / 2);
    const columnFoot = new THREE.Mesh(columnFootGeometry, darkSteel);
    columnFoot.position.set(-0.045, 0, -0.147);
    columnFoot.castShadow = true;
    support.add(columnFoot);

    const columnGeometry = new THREE.CylinderGeometry(0.013, 0.018, 0.145, 24);
    columnGeometry.rotateX(Math.PI / 2);
    const column = new THREE.Mesh(columnGeometry, darkSteel);
    column.position.set(-0.045, 0, -0.078);
    column.castShadow = true;
    column.receiveShadow = true;
    support.add(column);

    const columnCollarGeometry = new THREE.TorusGeometry(0.0155, 0.0024, 8, 48);
    for (const z of [-0.145, 0.0]) {
      const collar = new THREE.Mesh(columnCollarGeometry, brassDark);
      collar.position.set(-0.045, 0, z);
      support.add(collar);
    }

    const armGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.052, 18);
    const arm = new THREE.Mesh(armGeometry, steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-0.0225, 0, 0.0);
    arm.castShadow = true;
    support.add(arm);

    const armJointGeometry = new THREE.SphereGeometry(0.0135, 18, 12);
    const armJoint = new THREE.Mesh(armJointGeometry, brassDark);
    armJoint.position.set(-0.045, 0, 0.0);
    support.add(armJoint);

    const cupGeometry = new THREE.CylinderGeometry(0.013, 0.009, 0.014, 24);
    cupGeometry.rotateX(Math.PI / 2);
    const cup = new THREE.Mesh(cupGeometry, darkSteel);
    cup.position.set(0, 0, -0.008);
    cup.castShadow = true;
    support.add(cup);

    const cupRimGeometry = new THREE.TorusGeometry(0.0105, 0.002, 8, 32);
    const cupRim = new THREE.Mesh(cupRimGeometry, steel);
    cupRim.position.set(0, 0, -0.001);
    support.add(cupRim);

    const jewelGeometry = new THREE.SphereGeometry(0.0032, 12, 8);
    const jewel = new THREE.Mesh(jewelGeometry, new THREE.MeshBasicMaterial({color: 0x9b4a2f}));
    jewel.position.set(0, 0, 0.0015);
    support.add(jewel);

    // ---------------- 旋转的陀螺 ----------------
    const topGroup = new THREE.Group();
    scene.add(topGroup);
    const spinGroup = new THREE.Group();
    topGroup.add(spinGroup);

    const shaftGeometry = new THREE.CylinderGeometry(0.005, 0.0054, 1, 24);
    shaftGeometry.rotateX(Math.PI / 2);
    const shaft = new THREE.Mesh(shaftGeometry, steel);
    shaft.castShadow = true;
    spinGroup.add(shaft);

    const shaftCapGeometry = new THREE.CylinderGeometry(0.0052, 0.0042, 0.008, 20);
    shaftCapGeometry.rotateX(Math.PI / 2);
    const shaftCap = new THREE.Mesh(shaftCapGeometry, brassDark);
    spinGroup.add(shaftCap);

    const rotorRig = new THREE.Group();
    spinGroup.add(rotorRig);

    const radius = 0.105;
    const thickness = 0.028;
    const half = thickness / 2;
    const hubRadius = 0.008;
    const rotorProfile = [
      new THREE.Vector2(hubRadius, half),
      new THREE.Vector2(radius * 0.55, half),
      new THREE.Vector2(radius * 0.82, half * 0.78),
      new THREE.Vector2(radius, half * 0.45),
      new THREE.Vector2(radius, -half * 0.45),
      new THREE.Vector2(radius * 0.82, -half * 0.78),
      new THREE.Vector2(radius * 0.55, -half),
      new THREE.Vector2(hubRadius, -half),
    ];
    const rotorGeometry = new THREE.LatheGeometry(rotorProfile, 96);
    rotorGeometry.rotateX(Math.PI / 2);
    const rotor = new THREE.Mesh(rotorGeometry, brass);
    rotor.castShadow = true;
    rotor.receiveShadow = true;
    rotorRig.add(rotor);

    const hubGeometry = new THREE.CylinderGeometry(0.0135, 0.0155, 0.04, 32);
    hubGeometry.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeometry, darkSteel);
    hub.castShadow = true;
    rotorRig.add(hub);

    const hubRingGeometry = new THREE.TorusGeometry(0.0145, 0.0016, 8, 40);
    for (const z of [-half - 0.006, half + 0.006]) {
      const ring = new THREE.Mesh(hubRingGeometry, steel);
      ring.position.z = z;
      rotorRig.add(ring);
    }

    const faceSeamGeometry = new THREE.TorusGeometry(radius * 0.43, 0.0008, 6, 96);
    const faceSeamTop = new THREE.Mesh(faceSeamGeometry, seam);
    faceSeamTop.position.z = half + 0.0007;
    rotorRig.add(faceSeamTop);
    const faceSeamBottom = new THREE.Mesh(faceSeamGeometry, seam);
    faceSeamBottom.position.z = -half - 0.0007;
    rotorRig.add(faceSeamBottom);

    const boltGeometry = new THREE.CylinderGeometry(0.0022, 0.0022, 0.0032, 10);
    boltGeometry.rotateX(Math.PI / 2);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(boltGeometry, seam);
      bolt.position.set(Math.cos(angle) * radius * 0.7, Math.sin(angle) * radius * 0.7, half + 0.001);
      rotorRig.add(bolt);
    }

    const markerGeometry = new THREE.BoxGeometry(0.052, 0.009, 0.0032);
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(radius * 0.77, 0, half + 0.0016);
    rotorRig.add(marker);

    const tipMarkerGeometry = new THREE.SphereGeometry(0.0042, 16, 10);
    const tipMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0x8fe3d0,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      toneMapped: false,
    });
    const tipMarker = new THREE.Mesh(tipMarkerGeometry, tipMarkerMaterial);
    tipMarker.renderOrder = 15;
    tipMarker.visible = false;
    scene.add(tipMarker);

    // ---------------- 注释向量 ----------------
    const arrowR = new Arrow3D(0x8fc9ff, 0.92);
    const arrowMg = new Arrow3D(0xff9478, 0.92);
    const arrowTorque = new Arrow3D(0xf2d18b, 0.92);
    const arrowL = new Arrow3D(0x8fe3d0, 0.94);
    const arrowLBefore = new Arrow3D(0x7ba9b8, 0.55);
    const arrowLAfter = new Arrow3D(0xb8f4e8, 0.95);
    const arrowDelta = new Arrow3D(0xffa07d, 0.98);
    for (const arrow of [
      arrowR,
      arrowMg,
      arrowTorque,
      arrowL,
      arrowLBefore,
      arrowLAfter,
      arrowDelta,
    ]) {
      scene.add(arrow.group);
    }

    // ---------------- 进动圆锥 + 章动弧线 ----------------
    const coneGeometry = new THREE.ConeGeometry(1, 1, 64, 1, true);
    coneGeometry.rotateX(-Math.PI / 2);
    coneGeometry.translate(0, 0, 0.5);
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0x79d8c9,
      transparent: true,
      opacity: 0.075,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const precessionCone = new THREE.Mesh(coneGeometry, coneMaterial);
    precessionCone.renderOrder = 5;
    scene.add(precessionCone);

    const circlePoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 96; index += 1) {
      const angle = (index / 96) * Math.PI * 2;
      circlePoints.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 1));
    }
    const coneRimGeometry = new THREE.BufferGeometry().setFromPoints(circlePoints);
    const coneRim = new THREE.LineLoop(
      coneRimGeometry,
      new THREE.LineBasicMaterial({
        color: 0x8fe3d0,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    coneRim.renderOrder = 6;
    scene.add(coneRim);

    const precessionArcGeometry = new THREE.TorusGeometry(0.145, 0.0022, 8, 96, Math.PI * 1.6);
    const precessionArc = new THREE.Mesh(
      precessionArcGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x8fe3d0,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        toneMapped: false,
      }),
    );
    precessionArc.position.z = 0.018;
    precessionArc.renderOrder = 12;
    const precessionHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.008, 0.022, 12),
      new THREE.MeshBasicMaterial({
        color: 0x8fe3d0,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        toneMapped: false,
      }),
    );
    const arcEnd = Math.PI * 1.6;
    precessionHead.position.set(
      Math.cos(arcEnd) * 0.145,
      Math.sin(arcEnd) * 0.145,
      0.018,
    );
    precessionHead.rotation.z = arcEnd - Math.PI / 2;
    precessionHead.renderOrder = 13;
    scene.add(precessionArc, precessionHead);

    const arcPointCount = 49;
    const nutationPositions = new Float32Array(arcPointCount * 3);
    const nutationGeometry = new THREE.BufferGeometry();
    const nutationAttribute = new THREE.BufferAttribute(nutationPositions, 3);
    nutationGeometry.setAttribute('position', nutationAttribute);
    const nutationArc = new THREE.Line(
      nutationGeometry,
      new THREE.LineBasicMaterial({
        color: 0xffa07d,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        toneMapped: false,
      }),
    );
    nutationArc.renderOrder = 14;
    nutationArc.visible = false;
    scene.add(nutationArc);

    // ---------------- 轴端轨迹 ----------------
    const tracePositions = new Float32Array(TRACE_CAPACITY * 3);
    const traceGeometry = new THREE.BufferGeometry();
    const traceAttribute = new THREE.BufferAttribute(tracePositions, 3);
    traceGeometry.setAttribute('position', traceAttribute);
    traceGeometry.setDrawRange(0, 0);
    const traceLine = new THREE.Line(
      traceGeometry,
      new THREE.LineBasicMaterial({
        color: 0x9ff2e2,
        transparent: true,
        opacity: 0.94,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    traceLine.frustumCulled = false;
    traceLine.renderOrder = 16;
    scene.add(traceLine);

    const axisHighlightPositions = new Float32Array(6);
    const axisHighlightGeometry = new THREE.BufferGeometry();
    const axisHighlightAttribute = new THREE.BufferAttribute(axisHighlightPositions, 3);
    axisHighlightGeometry.setAttribute('position', axisHighlightAttribute);
    const axisHighlight = new THREE.Line(
      axisHighlightGeometry,
      new THREE.LineBasicMaterial({
        color: 0x9ff2e2,
        transparent: true,
        opacity: 0.58,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    axisHighlight.renderOrder = 17;
    axisHighlight.visible = false;
    scene.add(axisHighlight);
    let traceCount = 0;
    let traceKey = -1;
    let lastTraceTime = -1;

    // ---------------- 标签层 ----------------
    const createLabel = (text: string, tone: string): LabelHandle => {
      const element = document.createElement('span');
      element.className = `${styles.sceneLabel} ${styles[tone] ?? ''}`;
      element.textContent = text;
      element.setAttribute('aria-hidden', 'true');
      labelLayer.appendChild(element);
      return {element, tone};
    };
    const labelO = createLabel('O', 'labelPoint');
    const labelC = createLabel('C', 'labelPoint');
    const labelL = createLabel('ℓ', 'labelMeasure');
    const labelR = createLabel('r', 'labelVectorR');
    const labelMg = createLabel('mg', 'labelVectorMg');
    const labelTorque = createLabel('τ', 'labelVectorTau');
    const labelMomentum = createLabel('L', 'labelVectorL');
    const labelDelta = createLabel('ΔL', 'labelVectorDelta');
    const labelTheta = createLabel('θ', 'labelTheta');
    const labelOmega = createLabel('Ω', 'labelOmega');

    const tempCenter = new THREE.Vector3();
    const tempAxis = new THREE.Vector3();
    const tempTip = new THREE.Vector3();
    const tempDirection = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempQuaternionTilt = new THREE.Quaternion();

    const placeLabel = (
      label: LabelHandle,
      world: THREE.Vector3,
      dx: number,
      dy: number,
      visible: boolean,
      projector: Projector,
    ): void => {
      if (!visible) {
        label.element.style.display = 'none';
        return;
      }
      const projected = projector(world);
      if (!projected.visible) {
        label.element.style.display = 'none';
        return;
      }
      label.element.style.display = 'block';
      label.element.style.transform = `translate(${projected.x + dx}px, ${projected.y + dy}px) translate(-50%, -50%)`;
    };

    let lastComDistance = -1;
    let cameraWidth = Math.max(1, wrap.clientWidth);
    let cameraHeight = Math.max(1, wrap.clientHeight);

    const applyGeometry = (comDistance: number): void => {
      if (Math.abs(comDistance - lastComDistance) < 1e-6) return;
      lastComDistance = comDistance;
      rotorRig.position.z = comDistance;
      const shaftStart = -0.022;
      const shaftEnd = comDistance + 0.036;
      shaft.scale.z = shaftEnd - shaftStart;
      shaft.position.z = (shaftStart + shaftEnd) / 2;
      shaftCap.position.z = shaftEnd + 0.003;
    };

    const updateNutationArc = (
      state: GyroState,
      comDistance: number,
      visible: boolean,
    ): void => {
      nutationArc.visible = visible;
      if (!visible) return;
      const horizontalX = Math.cos(state.phi);
      const horizontalY = Math.sin(state.phi);
      const radiusArc = Math.max(0.035, Math.min(0.055, comDistance * 0.55));
      for (let index = 0; index < arcPointCount; index += 1) {
        const angle = (state.theta * index) / (arcPointCount - 1);
        const offset = index * 3;
        nutationPositions[offset] = radiusArc * Math.sin(angle) * horizontalX;
        nutationPositions[offset + 1] = radiusArc * Math.sin(angle) * horizontalY;
        nutationPositions[offset + 2] = radiusArc * Math.cos(angle);
      }
      nutationAttribute.needsUpdate = true;
    };

    const appendTrace = (tip: THREE.Vector3, state: GyroState): void => {
      if (state.time - lastTraceTime < 0.018) return;
      lastTraceTime = state.time;
      if (traceCount >= TRACE_CAPACITY) {
        traceCount = 0;
      }
      const offset = traceCount * 3;
      tracePositions[offset] = tip.x;
      tracePositions[offset + 1] = tip.y;
      tracePositions[offset + 2] = tip.z;
      traceCount += 1;
      traceAttribute.needsUpdate = true;
      traceGeometry.setDrawRange(0, traceCount);
    };

    const controller: Controller = {
      update(frame: GyroFrame): void {
        const {state, constants, comDistance, visibility} = frame;
        applyGeometry(comDistance);
        tempAxis.copy(vec3(axisOf(state.theta, state.phi)));
        tempCenter.copy(tempAxis).multiplyScalar(comDistance);
        tempTip.copy(tempAxis).multiplyScalar(comDistance + TIP_OFFSET);

        topGroup.quaternion
          .copy(tempQuaternion.setFromAxisAngle(Z_AXIS, state.phi))
          .multiply(tempQuaternionTilt.setFromAxisAngle(Y_AXIS, state.theta));
        spinGroup.rotation.z = state.psi % (Math.PI * 2);

        const momentum = angularMomentumOf(state, constants);
        const torque = torqueOf(state, constants);
        const centerVector = tempCenter.clone();
        const tipVector = tempTip.clone();

        const showBaseLabels = visibility.labels;
        const showVectors = visibility.vectors;
        const showR = showVectors && visibility.r;
        const showMg = showVectors && visibility.mg;
        const showTorque = showVectors && visibility.torque;
        const showL = showVectors && visibility.angularMomentum && frame.step === null;
        const showStep = showVectors && visibility.step && frame.step !== null;
        const showPrecession = visibility.precession;
        const showNutation = visibility.nutation;

        arrowR.group.visible = showR;
        arrowMg.group.visible = showMg;
        arrowTorque.group.visible = showTorque;
        arrowL.group.visible = showL;
        arrowLBefore.group.visible = showStep;
        arrowLAfter.group.visible = showStep;
        arrowDelta.group.visible = showStep;

        if (showR) {
          arrowR.set(new THREE.Vector3(0, 0, 0), tempAxis, Math.max(comDistance, 0.02));
          arrowR.group.scale.setScalar(frame.highlight === 'r' ? 1.18 : 1);
          arrowR.material.color.setHex(frame.highlight === 'r' ? 0xffffff : 0x8fc9ff);
        }
        if (showMg) {
          tempDirection.set(0, 0, -1);
          arrowMg.set(centerVector, tempDirection, 0.075);
          arrowMg.group.scale.setScalar(frame.highlight === 'mg' ? 1.18 : 1);
          arrowMg.material.color.setHex(frame.highlight === 'mg' ? 0xffffff : 0xff9478);
        }
        if (showTorque) {
          const torqueVector = vec3(torque);
          arrowTorque.set(new THREE.Vector3(0, 0, 0), torqueVector, 0.075);
          arrowTorque.group.scale.setScalar(frame.highlight === 'r' || frame.highlight === 'mg' ? 0.96 : 1);
        }
        if (showL) {
          arrowL.set(centerVector, vec3(momentum), 0.125);
        }
        if (showStep && frame.step !== null) {
          const before = vec3(frame.step.before);
          const after = vec3(frame.step.after);
          const delta = after.clone().sub(before);
          const beforeDirection = normalizeDirection(before);
          arrowLBefore.set(centerVector, before, 0.105);
          arrowLAfter.set(centerVector, after, 0.125);
          const beforeTip = centerVector.clone().addScaledVector(beforeDirection, 0.105);
          const deltaLength = Math.max(0.045, Math.min(0.11, delta.length() * 6));
          arrowDelta.set(beforeTip, delta, deltaLength);
        }

        precessionCone.visible = showPrecession;
        coneRim.visible = showPrecession;
        precessionArc.visible = showPrecession;
        precessionHead.visible = showPrecession;
        axisHighlight.visible = showPrecession;
        if (showPrecession) {
          axisHighlightPositions[0] = 0;
          axisHighlightPositions[1] = 0;
          axisHighlightPositions[2] = 0;
          axisHighlightPositions[3] = tipVector.x;
          axisHighlightPositions[4] = tipVector.y;
          axisHighlightPositions[5] = tipVector.z;
          axisHighlightAttribute.needsUpdate = true;
        }
        if (showPrecession) {
          const height = 0.19;
          const coneRadius = Math.max(0.025, Math.tan(state.theta) * height);
          precessionCone.scale.set(coneRadius, coneRadius, height);
          coneRim.scale.set(coneRadius, coneRadius, height);
        }

        updateNutationArc(state, comDistance, showNutation);
        tipMarker.visible = showNutation;
        if (showNutation) {
          tipMarker.position.copy(tipVector);
        }

        traceLine.visible = showNutation || showPrecession;
        if (frame.traceKey !== traceKey) {
          traceKey = frame.traceKey;
          traceCount = 0;
          lastTraceTime = -1;
          traceGeometry.setDrawRange(0, 0);
        }
        if ((showNutation || showPrecession) && frame.playing) {
          appendTrace(tipVector, state);
        }

        controls.update();
        camera.updateMatrixWorld();
        const projector = createProjector(camera, cameraWidth, cameraHeight);

        placeLabel(labelO, new THREE.Vector3(0, 0, 0), -17, 16, showBaseLabels, projector);
        placeLabel(labelC, centerVector, 14, -12, showBaseLabels, projector);
        labelL.element.textContent = `ℓ ${(comDistance * 100).toFixed(1)} cm`;
        const lengthPoint = centerVector.clone().multiplyScalar(0.52);
        placeLabel(labelL, lengthPoint, 24, 12, showBaseLabels, projector);

        const rMid = centerVector.clone().multiplyScalar(0.36);
        placeLabel(labelR, rMid, -14, -12, showR, projector);
        const mgTip = centerVector.clone().add(new THREE.Vector3(0, 0, -0.075));
        placeLabel(labelMg, mgTip, 14, 10, showMg, projector);
        const torqueTip = normalize(vec3(torque)).multiplyScalar(0.075);
        placeLabel(labelTorque, torqueTip, 12, -10, showTorque, projector);
        const lTip = centerVector.clone().add(normalizeDirection(vec3(momentum)).multiplyScalar(0.125));
        placeLabel(labelMomentum, lTip, 14, -10, showL, projector);

        if (showStep && frame.step !== null) {
          const before = vec3(frame.step.before);
          const after = vec3(frame.step.after);
          const delta = after.clone().sub(before);
          const beforeTip = centerVector.clone().add(normalizeDirection(before).multiplyScalar(0.105));
          const deltaLength = Math.max(0.045, Math.min(0.11, delta.length() * 6));
          const deltaTip = beforeTip.clone().add(normalizeDirection(delta).multiplyScalar(deltaLength));
          placeLabel(labelDelta, deltaTip, 14, 10, showStep, projector);
        } else {
          labelDelta.element.style.display = 'none';
        }

        const arcAngle = state.theta / 2;
        const arcRadius = Math.max(0.035, Math.min(0.055, comDistance * 0.55));
        const arcMid = new THREE.Vector3(
          arcRadius * Math.sin(arcAngle) * Math.cos(state.phi),
          arcRadius * Math.sin(arcAngle) * Math.sin(state.phi),
          arcRadius * Math.cos(arcAngle),
        );
        labelTheta.element.textContent = `θ ${(state.theta * 180 / Math.PI).toFixed(1)}°`;
        placeLabel(labelTheta, arcMid, 16, -14, showNutation, projector);
        placeLabel(labelOmega, new THREE.Vector3(0.145, 0, 0.02), 16, -12, showPrecession, projector);

        // 防止相机指向模型背面时标签仍停在画布内。
        if (!showBaseLabels) {
          labelO.element.style.display = 'none';
          labelC.element.style.display = 'none';
          labelL.element.style.display = 'none';
        }
        if (!showR) labelR.element.style.display = 'none';
        if (!showMg) labelMg.element.style.display = 'none';
        if (!showTorque) labelTorque.element.style.display = 'none';
        if (!showL) labelMomentum.element.style.display = 'none';
        if (!showNutation) labelTheta.element.style.display = 'none';
        if (!showPrecession) labelOmega.element.style.display = 'none';

        renderer.render(scene, camera);
      },
      setView(view: GyroView): void {
        if (view === 'top') {
          camera.position.set(0.001, -0.001, 0.8);
          controls.target.set(0, 0, 0.0);
        } else if (view === 'side') {
          camera.position.set(0.8, 0, 0.16);
          controls.target.set(0, 0, 0.0);
        } else {
          camera.position.set(0.62, -0.5, 0.34);
          controls.target.set(0, 0, 0.0);
        }
        controls.update();
        camera.updateMatrixWorld();
        renderer.render(scene, camera);
      },
      dispose(): void {
        controls.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost, false);
        labelLayer.replaceChildren();
        scene.traverse((object) => {
          const withGeometry = object as THREE.Mesh & {geometry?: THREE.BufferGeometry};
          withGeometry.geometry?.dispose();
          const withMaterial = object as THREE.Mesh & {
            material?: THREE.Material | THREE.Material[];
          };
          if (Array.isArray(withMaterial.material)) {
            for (const material of withMaterial.material) material.dispose();
          } else {
            withMaterial.material?.dispose();
          }
        });
        arrowR.dispose();
        arrowMg.dispose();
        arrowTorque.dispose();
        arrowL.dispose();
        arrowLBefore.dispose();
        arrowLAfter.dispose();
        arrowDelta.dispose();
        shadowTexture?.dispose();
        environment.dispose();
        pmrem.dispose();
        renderer.dispose();
        try {
          renderer.forceContextLoss();
        } catch {
          /* 上下文可能已经丢失 */
        }
        canvas.remove();
      },
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const {width, height} = entry.contentRect;
      if (!(width > 0) || !(height > 0)) return;
      cameraWidth = width;
      cameraHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    observer.observe(wrap);
    controllerRef.current = controller;

    return () => {
      observer.disconnect();
      controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  return (
    <div className={styles.canvasWrap} ref={wrapRef}>
      <div className={styles.canvasHost} ref={canvasHostRef} />
      <div className={styles.labelLayer} ref={labelLayerRef} aria-hidden="true" />
      {failed ? (
        <div className={styles.canvasFallback} role="status">
          <strong>当前环境未启用 WebGL 2</strong>
          <p>三维器材无法显示；右侧参数、倾角曲线与公式仍可使用。</p>
        </div>
      ) : null}
    </div>
  );
}

export const GyroCanvas = forwardRef<GyroSceneApi, GyroCanvasProps>(GyroCanvasInner);
export default GyroCanvas;
