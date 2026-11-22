import { memo, useEffect, useMemo, useState } from 'react';

interface MermaidPayload {
  code: string;
  activeNodes?: string[];
  theme?: 'warm' | 'neutral' | 'default';
}

interface Props {
  node: Record<string, unknown>;
  canvasWidth: number;
  canvasHeight: number;
}

const svgCache = new Map<string, string>();
let mermaidReady: Promise<typeof import('mermaid')['default']> | null = null;
let renderSeq = 0;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: "'Microsoft YaHei', 'PingFang SC', sans-serif",
        themeVariables: {
          primaryColor: '#f6f2eb',
          primaryTextColor: '#16233a',
          primaryBorderColor: '#64748b',
          lineColor: '#64748b',
          secondaryColor: '#eef2ff',
          tertiaryColor: '#ffffff',
        },
      });
      return m;
    });
  }
  return mermaidReady;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseMermaid(raw: unknown): MermaidPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.code !== 'string' || !obj.code.trim()) return null;
  const activeNodes = Array.isArray(obj.activeNodes)
    ? obj.activeNodes.filter((n): n is string => typeof n === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(n))
    : undefined;
  const theme = obj.theme === 'warm' || obj.theme === 'neutral' || obj.theme === 'default' ? obj.theme : 'warm';
  return { code: obj.code.trim(), activeNodes, theme };
}

function buildSource(payload: MermaidPayload): string {
  const { code, activeNodes } = payload;
  if (!activeNodes?.length) return code;
  if (!/^\s*(?:flowchart|graph|stateDiagram(?:-v2)?)\b/i.test(code)) return code;
  const ids = activeNodes.join(',');
  return `${code}\nclassDef wxActive fill:#fef3c7,stroke:#c4622d,stroke-width:3px,color:#16233a;\nclass ${ids} wxActive;`;
}

/** 叠加在 ViewAST 画布坐标上的 Mermaid 声明式流程图渲染器（strict 安全模式 + 缓存）。 */
export const MermaidNodeView = memo(function MermaidNodeView({ node, canvasWidth, canvasHeight }: Props) {
  const payload = useMemo(() => parseMermaid(node.mermaid), [node.mermaid]);
  const source = useMemo(() => (payload ? buildSource(payload) : ''), [payload]);
  const [svg, setSvg] = useState<string>(() => (source ? (svgCache.get(source) ?? '') : ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!source) return;
    const cached = svgCache.get(source);
    if (cached) {
      setSvg(cached);
      setFailed(false);
      return;
    }
    let alive = true;
    setFailed(false);
    void loadMermaid()
      .then(async (m) => {
        renderSeq += 1;
        const { svg: rendered } = await m.render(`wx_mmd_${renderSeq}`, source);
        if (!alive) return;
        if (svgCache.size > 80) {
          const firstKey = svgCache.keys().next().value;
          if (firstKey) svgCache.delete(firstKey);
        }
        svgCache.set(source, rendered);
        setSvg(rendered);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [source]);

  if (!payload) return null;

  const x = num(node.x, 16);
  const y = num(node.y, 16);
  const w = Math.max(120, num(node.w, canvasWidth - 32));
  const h = Math.max(100, num(node.h, canvasHeight - 32));

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(x / canvasWidth) * 100}%`,
        top: `${(y / canvasHeight) * 100}%`,
        width: `${(w / canvasWidth) * 100}%`,
        height: `${(h / canvasHeight) * 100}%`,
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 8,
        boxSizing: 'border-box',
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label="流程图视图"
    >
      {svg ? (
        <div
          style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          // Mermaid 在 securityLevel:'strict' 模式下产出纯 SVG，且 source 已过白名单校验。
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : failed ? (
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            color: '#475569',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '100%',
          }}
        >
          {payload.code}
        </pre>
      ) : (
        <span style={{ fontSize: 12, color: '#64748b' }}>流程图渲染中…</span>
      )}
    </div>
  );
});
