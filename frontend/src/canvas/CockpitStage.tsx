/**
 * CockpitStage.tsx —— 宏观「驾驶舱 / 总控台」模式
 *
 * 当画布积木变多时，隐藏所有连线与中间计算过程：
 *  - 左侧控制栏集中排布钉选的全局参数（或自动发现的源/外露参数），以及全局时钟步进控制；
 *  - 主视区将钉选的 1~4+ 个宏观视图（2D 场景、热力图、折线图、AI 积木、复合积木等）放大平铺，实时联动。
 */
import { panelParamRange, simParamMeta } from '@/living/sim';
import { NODE_DEFS, type NodeBodyProps } from './nodes.tsx';
import { parseAiRulePayload } from './aiRuleBlock.ts';
import { inferCockpitWeight, planCockpitLayout } from './cockpitLayout.ts';
import { updateSubNodeParams } from './compositeUtils.ts';
import type { CanvasDoc, CanvasNode } from './types.ts';
import styles from './cockpitStage.module.css';

export interface SimClockControl {
  tick: number;
  playing: boolean;
  hasDelayRegister: boolean;
  onTogglePlay: () => void;
  onStep: () => void;
  onReset: () => void;
}

interface CockpitStageProps {
  doc: CanvasDoc;
  readOnly?: boolean;
  getBodyProps: (node: CanvasNode) => NodeBodyProps;
  nodeTitle: (node: CanvasNode) => string;
  onUpdateParam: (nodeId: string, patch: Record<string, number>) => void;
  onUpdateCompositeSub?: (compId: string, sub: NonNullable<CanvasNode['sub']>) => void;
  onBackToEdit?: () => void;
  simClock?: SimClockControl;
}

interface CockpitParamItem {
  key: string;
  label: string;
  sourceTitle: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

export function CockpitStage({
  doc,
  readOnly,
  getBodyProps,
  nodeTitle,
  onUpdateParam,
  onUpdateCompositeSub,
  onBackToEdit,
  simClock,
}: CockpitStageProps): JSX.Element {
  // 1) 组装钉选视图；若未显式钉选，自动挑选画布中的视图/AI/复合积木作为默认宏观视图
  const pinnedViewIds = doc.panel?.view_node_ids ?? [];
  const explicitViews = pinnedViewIds
    .map((id) => doc.nodes.find((n) => n.id === id))
    .filter((n): n is CanvasNode => Boolean(n && NODE_DEFS[n.type]));
  const autoViews = explicitViews.length > 0
    ? []
    : doc.nodes
      .filter((n) => {
        const badge = NODE_DEFS[n.type]?.badge;
        return badge === '视图' || n.type === 'aiRuleBlock' || n.type === 'universalStageView' || n.type === 'composite' || badge === '实验';
      })
      .slice(0, 4);
  const views = explicitViews.length > 0 ? explicitViews : autoViews;
  const visibleObservers = new Set(views.filter(({ type }) => NODE_DEFS[type]?.badge === '视图' || type === 'spark')
    .map(({ id }) => id));
  const cards = views.map((node) => {
    const def = NODE_DEFS[node.type]!;
    const bodyProps = getBodyProps(node);
    // A wire to an unpinned view must not remove the only visible copy of a plot.
    const wiredOutputs = new Set(doc.wires.filter(({ from, to }) => from === node.id && visibleObservers.has(to))
      .map(({ fromPort }) => fromPort ?? 'out'));
    const props = { ...bodyProps, wiredOutputs };
    const chart = node.type === 'aiRuleBlock' && parseAiRulePayload(node.payload)?.preferredView === 'chart';
    return { id: node.id, type: node.type, chart, node, def, props, weight: inferCockpitWeight(node, props, def) };
  });
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const layout = planCockpitLayout(cards, doc.panel?.cockpit_layout);
  const layoutClass = {
    single: styles.gridSingle,
    'hero-stack': styles.bentoHeroStack,
    pair: styles.bentoPair,
    'bento-3': layout.variant === 'left-hero' ? styles.bentoThreeLeftHero
      : layout.variant === 'wide-bottom' ? styles.bentoThreeWideBottom : styles.bentoThreeCols,
    quad: layout.variant === 'wide-top' ? styles.bentoQuadStrip : styles.bentoQuad,
    grid: '',
  }[layout.mode];

  function renderCard(id: string, slotClass = '') {
    const { chart, def, node, props, weight } = cardsById.get(id)!;
    const Body = def.Body;
    const weightClass = weight === 'hero' ? styles.viewCardHero : weight === 'compact' ? styles.viewCardCompact : '';
    return <article key={id} className={`${styles.viewCard} ${weightClass} ${slotClass}`} data-cockpit-chart={chart || undefined}>
      <header className={styles.viewHead}>
        <h3 title={nodeTitle(node)}>{nodeTitle(node)}</h3>
        <span className={styles.badge}>{def.badge}</span>
      </header>
      <div className={styles.viewBody}>
        <Body {...props} inCard displayContext="cockpit" />
      </div>
    </article>;
  }

  // 2) 组装钉选参数；同时把复合积木外壳透出参数与未钉选时的顶层滑杆/寄存器参数纳入控制栏
  const paramItems: CockpitParamItem[] = [];
  const explicitParams = doc.panel?.exposed_params ?? [];
  for (const entry of explicitParams) {
    const node = doc.nodes.find((n) => n.id === entry.node_id);
    if (!node) continue;
    const current = node.params[entry.param_key] ?? entry.min ?? 0;
    const range = panelParamRange(entry, current);
    const label = entry.label || simParamMeta(node, entry.param_key).label || entry.param_key;
    const source = nodeTitle(node);
    const sourceType = NODE_DEFS[node.type]?.title;
    const sourceTitle = node.type === 'slider' ? '滑杆源'
      : source.trim() !== label.trim() ? source
      : sourceType && sourceType.trim() !== label.trim() ? sourceType : '积木';
    paramItems.push({
      key: `${node.id}:${entry.param_key}`,
      label,
      sourceTitle,
      value: current,
      ...range,
      onChange: (val) => onUpdateParam(node.id, { [entry.param_key]: val }),
    });
  }

  // 自动补齐顶层复合积木透出的关键参数
  for (const node of doc.nodes) {
    const sub = node.type === 'composite' ? node.sub : undefined;
    const exposedList = sub?.exposedParams;
    if (!sub || !exposedList?.length || !onUpdateCompositeSub) continue;
    for (const ep of exposedList) {
      const inner = sub.nodes.find((item) => item.id === ep.nodeId);
      if (!inner) continue;
      const current = inner.params[ep.paramKey] ?? ep.min ?? 0;
      const range = panelParamRange(ep, current);
      paramItems.push({
        key: `${node.id}:${ep.nodeId}:${ep.paramKey}`,
        label: ep.label,
        sourceTitle: `${nodeTitle(node)}（封装模块）`,
        value: current,
        ...range,
        onChange: (val) => onUpdateCompositeSub(node.id, updateSubNodeParams(sub, ep.nodeId, { [ep.paramKey]: val })),
      });
    }
  }

  // 若还没有任何参数项，自动提取画布上的滑杆与延迟寄存器初值
  if (paramItems.length === 0) {
    for (const node of doc.nodes) {
      if (node.type === 'slider') {
        const current = node.params.v ?? 0;
        const range = panelParamRange({ min: node.params.min, max: node.params.max, step: node.params.step }, current);
        paramItems.push({
          key: `${node.id}:v`,
          label: nodeTitle(node),
          sourceTitle: '滑杆源',
          value: current,
          ...range,
          onChange: (val) => onUpdateParam(node.id, { v: val }),
        });
      } else if (node.type === 'delayRegister') {
        const current = node.params.init ?? 0;
        const range = panelParamRange({}, current);
        paramItems.push({
          key: `${node.id}:init`,
          label: `${nodeTitle(node)} · 初值`,
          sourceTitle: '延迟寄存器',
          value: current,
          ...range,
          onChange: (val) => onUpdateParam(node.id, { init: val }),
        });
      }
    }
  }

  return (
    <div className={styles.cockpit} data-cockpit-stage>
      <aside className={styles.sidebar} aria-label="宏观总控参数栏">
        <div className={styles.sideHead}>
          <h2>🎛 宏观总控台</h2>
          <span className={styles.badge}>驾驶舱态</span>
        </div>

        {simClock && (simClock.hasDelayRegister || simClock.tick > 0) ? (
          <section className={styles.clockBar} aria-label="全局仿真时钟">
            <div className={styles.clockRow}>
              <span>全局仿真步进</span>
              <span className={styles.clockStep}>t = {simClock.tick}</span>
            </div>
            <div className={styles.clockBtns}>
              <button
                type="button"
                className={`${styles.btn} ${simClock.playing ? styles.btnPrimary : ''}`}
                onClick={simClock.onTogglePlay}
              >
                {simClock.playing ? '⏸ 暂停' : '▶ 播放'}
              </button>
              <button type="button" className={styles.btn} onClick={simClock.onStep}>
                ⏭ 单步 +1
              </button>
              <button type="button" className={styles.btn} onClick={simClock.onReset}>
                ↺ 重置 t = 0
              </button>
            </div>
          </section>
        ) : null}

        {paramItems.length > 0 ? (
          <div className={styles.paramList}>
            {paramItems.map((item) => (
              <label key={item.key} className={styles.paramCard}>
                <span className={styles.paramTop}>
                  <span>{item.label}</span>
                  <output className={styles.paramVal}>{Number(item.value.toPrecision(4))}</output>
                </span>
                <span className={styles.paramSource}>{item.sourceTitle}</span>
                <input
                  type="range"
                  className={styles.range}
                  aria-label={item.label}
                  disabled={readOnly}
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={Math.max(item.min, Math.min(item.max, item.value))}
                  onChange={(e) => item.onChange(e.currentTarget.valueAsNumber)}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className={styles.hint}>
            暂无钉选参数。在「编辑态」点击任意积木标题栏的 <b>◉ 外露参数</b> 即可把关键滑杆钉选到此处集中操控。
          </p>
        )}

        {onBackToEdit ? (
          <button type="button" className={styles.btn} onClick={onBackToEdit}>
            ▦ 返回积木连线编辑
          </button>
        ) : null}
      </aside>

      <main className={styles.main} aria-label="宏观总览主视区">
        <header className={styles.mainHead}>
          <div className={styles.mainTitle}>
            <h1>{doc.title || '宏观系统总览'}</h1>
            <span className={styles.badge}>
              {explicitViews.length > 0 ? `已钉选 ${explicitViews.length} 个视图` : `自动展示 ${views.length} 个视图`}
            </span>
          </div>
        </header>

        {views.length > 0 ? (
          <div className={`${styles.grid} ${layoutClass}`} data-cockpit-layout={layout.mode}>
            {layout.hero && layout.stack ? <>
              {renderCard(layout.hero, styles.heroSlot)}
              <div className={styles.sideStack}>{layout.stack.map(id => renderCard(id))}</div>
            </> : layout.slots.map(id => renderCard(id))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p>当前画布还没有可展示的视图积木。</p>
            {onBackToEdit ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onBackToEdit}>
                去编辑态添加积木并点击 📌 钉选
              </button>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
