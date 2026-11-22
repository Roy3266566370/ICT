import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface Scene3dPayload {
  renderer?: string;
  kind: string;
  params?: Record<string, unknown>;
}

interface Props {
  node: Record<string, unknown>;
  canvasWidth: number;
  canvasHeight: number;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 基于已安装的 three 渲染 ViewAST 的 scene3d 节点（支持 3D 向量空间、曲面与拖拽旋转视角）。 */
export const Scene3dNodeView = memo(function Scene3dNodeView({ node, canvasWidth, canvasHeight }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const payload = (node.scene3d && typeof node.scene3d === 'object' ? node.scene3d : null) as Scene3dPayload | null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !payload) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFallbackText('当前浏览器环境不支持 WebGL，无法渲染三维视图。');
      return;
    }
    setFallbackText(null);
    const width = Math.max(160, host.clientWidth || 640);
    const height = Math.max(120, host.clientHeight || 360);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8fafc');
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);

    let yaw = 0.72;
    let pitch = 0.48;
    const radius = 6.2;
    const updateCamera = () => {
      camera.position.set(
        radius * Math.cos(pitch) * Math.cos(yaw),
        radius * Math.sin(pitch),
        radius * Math.cos(pitch) * Math.sin(yaw),
      );
      camera.lookAt(0, 0, 0);
    };
    updateCamera();

    // 灯光与参考网格/坐标轴
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(5, 8, 6);
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(6, 12, 0x94a3b8, 0xe2e8f0));
    scene.add(new THREE.AxesHelper(2.6));

    const params = payload.params ?? {};
    const kind = String(payload.kind || 'vectors').toLowerCase();

    if (kind.includes('surface') || kind.includes('saddle') || kind.includes('paraboloid')) {
      const a = num(params.a, 0.45);
      const b = num(params.b, kind.includes('saddle') ? -0.45 : 0.45);
      const segs = 28;
      const geo = new THREE.PlaneGeometry(4, 4, segs, segs);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position!;
      for (let i = 0; i < pos.count; i += 1) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const py = Math.max(-2.2, Math.min(2.2, a * px * px + b * pz * pz));
        pos.setY(i, py);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc4622d,
        roughness: 0.45,
        metalness: 0.08,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.82,
      });
      scene.add(new THREE.Mesh(geo, mat));
      scene.add(
        new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: 0x16233a, wireframe: true, transparent: true, opacity: 0.18 }),
        ),
      );
    } else {
      // 默认：3D 向量空间 / 线性变换基向量
      const rawVectors = Array.isArray(params.vectors)
        ? (params.vectors as unknown[])
        : [
            [num(params.vx, 1.8), num(params.vy, 1.2), num(params.vz, 0.9)],
            [num(params.ux, -1.0), num(params.uy, 1.5), num(params.uz, 0.6)],
          ];
      const colors = [0xc4622d, 0x2563eb, 0x0f766e, 0x7c3aed];
      rawVectors.slice(0, 8).forEach((item, idx) => {
        if (!Array.isArray(item) || item.length < 3) return;
        const v = new THREE.Vector3(num(item[0], 0), num(item[1], 0), num(item[2], 0));
        const len = v.length();
        if (len < 1e-4) return;
        const arrow = new THREE.ArrowHelper(v.clone().normalize(), new THREE.Vector3(0, 0, 0), len, colors[idx % colors.length]!, 0.28, 0.16);
        scene.add(arrow);
      });
    }

    let raf = 0;
    const draw = () => {
      renderer.render(scene, camera);
    };
    draw();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.01;
      pitch = Math.max(-1.35, Math.min(1.35, pitch + (e.clientY - lastY) * 0.01));
      lastX = e.clientX;
      lastY = e.clientY;
      updateCamera();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    const onUp = () => {
      dragging = false;
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      renderer.dispose();
    };
  }, [payload]);

  if (!payload) return null;
  const x = num(node.x, 16);
  const y = num(node.y, 16);
  const w = Math.max(160, num(node.w, canvasWidth - 32));
  const h = Math.max(120, num(node.h, canvasHeight - 32));

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(x / canvasWidth) * 100}%`,
        top: `${(y / canvasHeight) * 100}%`,
        width: `${(w / canvasWidth) * 100}%`,
        height: `${(h / canvasHeight) * 100}%`,
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        background: '#f8fafc',
        cursor: 'grab',
      }}
      title="拖动旋转 3D 视角"
      aria-label="三维交互视图"
    >
      {fallbackText ? (
        <p style={{ margin: 16, fontSize: 12, color: '#64748b' }}>{fallbackText}</p>
      ) : (
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      )}
    </div>
  );
});
