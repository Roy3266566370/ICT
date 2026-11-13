/**
 * CanvasPage.tsx —— 万象工坊·画布（/canvas）
 *
 * 万象的主功能形态：一张自由画布，活对象可摆可连线，空白处可手写。
 * 持久化双轨：localStorage 兜底（离线不丢）+ 工坊后端（?work=wk_id 已存作品）。
 * 撤销/重做按编辑突发合并（400ms 内连续改动算一步）；发布后走 work-shares 快照。
 * 对象端口协议、多级求值（engine）、命名端口连线、动画源见 `canvas/` 目录。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SiteNav } from '@/components/home/SiteNav';
import { CanvasBoard } from '@/canvas/CanvasBoard.tsx';
import { PALETTE_GROUPS, NODE_DEFS, defaultParams } from '@/canvas/nodes.tsx';
import { nextId, clamp } from '@/canvas/math.ts';
import type { CanvasDoc, CanvasTool, NodeType } from '@/canvas/types.ts';
import { worksApi } from '@/api/works';
import styles from './CanvasPage.module.css';

const STORAGE_KEY = 'wanxiang.canvas.v1';
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const HISTORY_MAX = 60;
const HISTORY_COALESCE_MS = 400;

/** 种子画布：上行 = 手动链（矩阵源→四视图+预测闸门+记录仪），中行 = 自动链（时间源→旋转器→向量场），下行 = 力学实验台。 */
function seedDoc(): CanvasDoc {
  const A = nextId('n');
  const T = nextId('n');
  const R = nextId('n');
  const P = nextId('n');
  return {
    version: 1,
    title: '我的工坊画布',
    zoom: 1,
    nodes: [
      { id: nextId('n'), type: 'textNote', x: 70, y: 40, params: {}, text: '上面是数学链：改矩阵源，六个连着的对象同变。\n中间是自动链：时间源推着旋转器跑。\n下面是力学实验台：抛体自己跑，轨迹仪和能量表跟着动。' },
      { id: A, type: 'matrixSource', x: 70, y: 240, params: { a: 1.6, b: 0.4, c: 0.2, d: 1.2 } },
      { id: 'view_transform', type: 'transformView', x: 400, y: 100, params: {} },
      { id: 'view_det', type: 'detGauge', x: 910, y: 100, params: {} },
      { id: 'view_eig', type: 'eigRead', x: 910, y: 340, params: {} },
      { id: 'view_sq', type: 'squareView', x: 1150, y: 110, params: {} },
      { id: 'view_quiz', type: 'quiz', x: 1150, y: 350, params: {} },
      { id: 'view_spark', type: 'spark', x: 1150, y: 600, params: {} },
      { id: T, type: 'ticker', x: 90, y: 640, params: { period: 6, running: 1 } },
      { id: R, type: 'rotor', x: 340, y: 640, params: { theta: 0 } },
      { id: 'view_field', type: 'fieldView', x: 590, y: 600, params: {} },
      { id: nextId('n'), type: 'textNote', x: 70, y: 920, params: {}, text: '力学实验台：抛体源闭式解驱动，轨迹仪记下运动，能量表看着动能⇌势能守恒。' },
      { id: P, type: 'projectile', x: 70, y: 1060, params: { v0: 8, angle: 55, g: 9.8, m: 1, running: 1 } },
      { id: 'phys_trail', type: 'trailView', x: 400, y: 1060, params: {} },
      { id: 'phys_energy', type: 'energyMeter', x: 660, y: 1060, params: {} },
    ],
    wires: [
      { id: nextId('w'), from: A, to: 'view_transform' },
      { id: nextId('w'), from: A, to: 'view_det' },
      { id: nextId('w'), from: A, to: 'view_eig' },
      { id: nextId('w'), from: A, to: 'view_sq' },
      { id: nextId('w'), from: A, to: 'view_quiz' },
      { id: nextId('w'), from: A, to: 'view_spark' },
      { id: nextId('w'), from: T, to: R },
      { id: nextId('w'), from: R, to: 'view_field' },
      { id: nextId('w'), from: P, to: 'phys_trail' },
      { id: nextId('w'), from: P, to: 'phys_energy' },
    ],
    strokes: [],
  };
}

/** 递归过滤未知节点类型 + 悬空线（含 composite 子图内部） */
function sanitizeNodes(nodes: CanvasDoc['nodes'], wires: CanvasDoc['wires']): CanvasDoc['nodes'] {
  return nodes.filter((n) => NODE_DEFS[n.type] !== undefined).map((n) => {
    if (!n.sub) return n;
    const inner = sanitizeNodes(n.sub.nodes, n.sub.wires);
    const innerIds = new Set(inner.map((x) => x.id));
    return {
      ...n,
      sub: {
        nodes: inner,
        wires: n.sub.wires.filter((w) => innerIds.has(w.from) && innerIds.has(w.to)),
        ports: n.sub.ports.filter((p) => innerIds.has(p.id)),
      },
    };
  });
}

function loadDoc(): CanvasDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as CanvasDoc;
    if (doc.version !== 1 || !Array.isArray(doc.nodes) || !Array.isArray(doc.wires)) return null;
    // 未知类型/端口结构的防御性过滤
    doc.nodes = sanitizeNodes(doc.nodes, doc.wires);
    const ids = new Set(doc.nodes.map((n) => n.id));
    doc.wires = doc.wires.filter((w) => ids.has(w.from) && ids.has(w.to));
    return doc;
  } catch {
    return null;
  }
}

export function CanvasPage(): JSX.Element {
  const [params] = useSearchParams();
  const workIdParam = params.get('work');
  const [doc, setDocRaw] = useState<CanvasDoc>(() => loadDoc() ?? seedDoc());
  const [tool, setTool] = useState<CanvasTool>('select');
  const [inkColor, setInkColor] = useState('#2F3A49');
  const [savedFlash, setSavedFlash] = useState(false);
  const [workId, setWorkId] = useState<string | null>(null);
  const [cloudState, setCloudState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [histInfo, setHistInfo] = useState({ undo: 0, redo: 0 });
  const spawn = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const cloudTimer = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const skipCloud = useRef(true);
  const hist = useRef<{ past: CanvasDoc[]; future: CanvasDoc[]; lastPush: number }>({ past: [], future: [], lastPush: 0 });

  /* 带撤销历史的 setDoc：把"改动前"的快照压栈，400ms 内的连续改动合并为一步 */
  const setDoc = useCallback<React.Dispatch<React.SetStateAction<CanvasDoc>>>((update) => {
    setDocRaw((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (next === prev) return prev;
      const now = performance.now();
      if (now - hist.current.lastPush > HISTORY_COALESCE_MS) {
        hist.current.past.push(prev);
        if (hist.current.past.length > HISTORY_MAX) hist.current.past.shift();
        hist.current.future = [];
        hist.current.lastPush = now;
        setHistInfo({ undo: hist.current.past.length, redo: 0 });
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const h = hist.current;
    setDocRaw((prev) => {
      const p = h.past.pop();
      if (!p) return prev;
      h.future.push(prev);
      h.lastPush = performance.now();
      setHistInfo({ undo: h.past.length, redo: h.future.length });
      return p;
    });
  }, []);

  const redo = useCallback(() => {
    const h = hist.current;
    setDocRaw((prev) => {
      const f = h.future.pop();
      if (!f) return prev;
      h.past.push(prev);
      h.lastPush = performance.now();
      setHistInfo({ undo: h.past.length, redo: h.future.length });
      return f;
    });
  }, []);

  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y */
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,[contenteditable]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      else if (k === 'z') { e.preventDefault(); undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo, redo]);

  /* 指定作品（?work=wk_id / fork 后跳转）：从后端装载 */
  useEffect(() => {
    if (!workIdParam) return;
    let dead = false;
    worksApi.get(workIdParam).then((res) => {
      if (dead) return;
      const d = res.document;
      d.nodes = sanitizeNodes(d.nodes, d.wires);
      setWorkId(res.work_id);
      revisionRef.current = res.revision;
      skipCloud.current = true;
      hist.current = { past: [], future: [], lastPush: 0 };
      setDocRaw(d);
    }).catch(() => {
      if (!dead) window.alert('工坊作品加载失败（可能已删除或不属于你），已保留本地画布。');
    });
    return () => { dead = true; };
  }, [workIdParam]);

  /* 防抖持久化：localStorage 永远兜底 */
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 900);
      } catch {
        /* 存储满/隐私模式下静默失败 */
      }
    }, 450);
    return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); };
  }, [doc]);

  /* 云端同步：作品已建档后，改动静默回写（乐观锁；冲突只提示不覆盖） */
  useEffect(() => {
    if (!workId) return;
    if (skipCloud.current) { skipCloud.current = false; return; }
    if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current);
    cloudTimer.current = window.setTimeout(() => {
      setCloudState('saving');
      worksApi.save(workId, revisionRef.current, doc, doc.title)
        .then((res) => { revisionRef.current = res.revision; setCloudState('saved'); })
        .catch(() => setCloudState('error'));
    }, 800);
    return () => { if (cloudTimer.current !== null) window.clearTimeout(cloudTimer.current); };
  }, [doc, workId]);

  const addNode = useCallback((type: NodeType, x?: number, y?: number) => {
    spawn.current += 1;
    const offset = spawn.current * 34;
    setDoc((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id: nextId('n'), type,
          x: x ?? 110 + offset, y: y ?? 120 + offset,
          params: defaultParams(type),
          ...(type === 'textNote' ? { text: '' } : {}),
          ...(type === 'latexNote' ? { text: 'e^{i\\pi}+1=0' } : {}),
          ...(type === 'functionSource' ? { text: 'a*x^2+b*x+c' } : {}),
        },
      ],
    }));
  }, [setDoc]);

  const setZoom = useCallback((z: number) => {
    setDoc((d) => ({ ...d, zoom: clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX) }));
  }, [setDoc]);

  const clearInk = useCallback(() => {
    setDoc((d) => ({ ...d, strokes: [] }));
  }, [setDoc]);

  const newCanvas = useCallback(() => {
    if (!window.confirm('新建演示画布？当前画布已保存在浏览器本地，会被覆盖。')) return;
    spawn.current = 0;
    setWorkId(null);
    setShareUrl(null);
    hist.current = { past: [], future: [], lastPush: 0 };
    setDoc(seedDoc());
  }, [setDoc]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title || 'wanxiang-canvas'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  /* 保存到工坊：未建档 → create；已建档 → 立即 PATCH 一次 */
  const saveToWorkshop = useCallback(async () => {
    try {
      setCloudState('saving');
      if (!workId) {
        const res = await worksApi.create(doc);
        setWorkId(res.work_id);
        revisionRef.current = res.revision;
      } else {
        const res = await worksApi.save(workId, revisionRef.current, doc, doc.title);
        revisionRef.current = res.revision;
      }
      skipCloud.current = true;
      setCloudState('saved');
    } catch {
      setCloudState('error');
      window.alert('保存到工坊失败：请确认后端已启动（画布仍保存在本地）。');
    }
  }, [doc, workId]);

  /* 发布：先确保已建档，再生成快照分享链接 */
  const publish = useCallback(async () => {
    try {
      let wid = workId;
      if (!wid) {
        const res = await worksApi.create(doc);
        wid = res.work_id;
        setWorkId(wid);
        revisionRef.current = res.revision;
        skipCloud.current = true;
      }
      const pub = await worksApi.publish(wid);
      const url = `${window.location.origin}${pub.share_url}`;
      setShareUrl(url);
      try { await navigator.clipboard.writeText(url); } catch { /* 剪贴板不可用时展示链接即可 */ }
    } catch {
      window.alert('发布失败：请确认后端已启动。');
    }
  }, [doc, workId]);

  return (
    <div className={styles.page}>
      <SiteNav current="canvas" appearance="studio" />

      <div className={styles.toolbar}>
        <input
          className={styles.title}
          value={doc.title}
          spellCheck={false}
          aria-label="画布标题"
          onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
        />
        <span className={`${styles.savepill} ${savedFlash ? styles.savepillOn : ''}`}>
          {workId
            ? cloudState === 'saving' ? '云端同步中…'
              : cloudState === 'error' ? '云端同步失败（本地仍在）'
              : savedFlash ? '✓ 已保存' : '工坊+本地自动保存'
            : savedFlash ? '✓ 已保存' : '本地自动保存'}
        </span>
        <button
          type="button" className={styles.tbtn} disabled={histInfo.undo === 0}
          aria-label="撤销" title="撤销 (Ctrl+Z)" onClick={undo}
        >↩ 撤销</button>
        <button
          type="button" className={styles.tbtn} disabled={histInfo.redo === 0}
          aria-label="重做" title="重做 (Ctrl+Shift+Z)" onClick={redo}
        >↪ 重做</button>
        <div className={styles.spacer} />

        <details className={styles.palette}>
          <summary className={styles.tbtn}>＋ 添加对象</summary>
          <div className={styles.paletteMenu}>
            {PALETTE_GROUPS.map((g) => (
              <div key={g.label} className={styles.paletteGroup}>
                <div className={styles.paletteLabel}>{g.label}</div>
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={styles.paletteItem}
                    onClick={() => addNode(t)}
                  >
                    {NODE_DEFS[t].title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </details>

        <span className={styles.groupLabel}>笔</span>
        <button
          type="button"
          className={`${styles.tbtn} ${tool === 'pen' ? styles.tbtnOn : ''}`}
          aria-pressed={tool === 'pen'}
          onClick={() => setTool((t) => (t === 'pen' ? 'select' : 'pen'))}
        >
          ✒️ 手写
        </button>
        <span className={styles.swatches}>
          {(['#2F3A49', '#B8431F'] as const).map((c) => (
            <i
              key={c}
              className={`${styles.swatch} ${inkColor === c ? styles.swatchOn : ''}`}
              style={{ background: c }}
              role="button"
              tabIndex={0}
              aria-label={`墨迹颜色 ${c}`}
              onClick={() => { setInkColor(c); if (tool !== 'pen') setTool('pen'); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setInkColor(c); setTool('pen'); } }}
            />
          ))}
        </span>
        <button
          type="button"
          className={`${styles.tbtn} ${tool === 'erase' ? styles.tbtnOn : ''}`}
          aria-pressed={tool === 'erase'}
          onClick={() => setTool((t) => (t === 'erase' ? 'select' : 'erase'))}
        >
          橡皮
        </button>
        <button type="button" className={styles.tbtn} onClick={clearInk}>清屏</button>

        <span className={styles.czoom}>
          <button type="button" aria-label="缩小" onClick={() => setZoom(doc.zoom - 0.15)}>−</button>
          <b aria-live="polite">{Math.round(doc.zoom * 100)}%</b>
          <button type="button" aria-label="放大" onClick={() => setZoom(doc.zoom + 0.15)}>＋</button>
        </span>

        <button type="button" className={styles.tbtn} onClick={exportJson}>导出</button>
        <button type="button" className={styles.tbtn} onClick={newCanvas}>新建</button>
        {!workId ? (
          <button type="button" className={styles.tbtn} onClick={() => void saveToWorkshop()}>
            存到工坊
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.tbtn} ${styles.primary}`}
          onClick={() => void publish()}
        >
          发布画布
        </button>
      </div>

      {shareUrl ? (
        <div className={styles.sharebar} role="status">
          已发布到工坊画廊：<a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          <span className={styles.dim}>（链接已复制，任何人打开即玩，可 fork 改造）</span>
          <button type="button" className={styles.tbtn} onClick={() => setShareUrl(null)}>知道了</button>
        </div>
      ) : null}

      <div className={styles.hint}>
        「高数」组：函数源 → 图像 / 极限 / 导数 / 积分 / 泰勒；滑杆可接 x₀，泰勒输出可再接函数图像。<b>框选多个对象 → 封装成积木</b>。拖<span className={styles.hintOut}>红点</span>→<span className={styles.hintIn}>蓝圈</span>连线；Ctrl+滚轮缩放、空格/中键平移、Del 删除、Ctrl+Z 撤销、双击空白加便签。
      </div>

      <CanvasBoard doc={doc} setDoc={setDoc} tool={tool} inkColor={inkColor} onAddNode={addNode} />
    </div>
  );
}

export default CanvasPage;
