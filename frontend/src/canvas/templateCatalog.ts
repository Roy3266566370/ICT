/**
 * templateCatalog.ts —— 定象坊模板统一构造入口
 *
 * 供 WorkshopPage 与 CanvasPage（?template=<kind>）共用：
 * 打开内置模板直接在客户端组装 CanvasDoc，不再自动向「我的作品」写入副本。
 */
import type { CanvasDoc } from './types.ts';
import type { WorkshopPluginConfig } from '../document/types.ts';
import { deepWorkshopDoc } from './deepWorkshop.ts';
import { DEEP_TEMPLATES, isDeepTemplateKind } from './deepTemplates.ts';
import { DEEP_PANORAMA_TEMPLATES, VISIBLE_DEEP_TEMPLATES, isDeepPanoramaTemplateKind } from './deepPanoramaTemplates.ts';
import { LAB408_TEMPLATES, VISIBLE_LAB408_TEMPLATES, isLab408Kind, lab408TemplateDoc } from './lab408Templates.ts';
import { PHYSICS_TEMPLATES, VISIBLE_PHYSICS_TEMPLATES, physicsTemplateDoc, type PhysicsTemplateKind } from './physicsTemplates.ts';
import { CALCULUS_TEMPLATES, VISIBLE_CALCULUS_TEMPLATES, calculusTemplateDoc } from './calculusTemplates.ts';
import { BUSINESS_TEMPLATES, VISIBLE_BUSINESS_TEMPLATES, businessTemplateDoc, isBusinessTemplateKind } from './businessTemplates.ts';
import { LINALG_TEMPLATES, VISIBLE_LINALG_TEMPLATES, linalgTemplateDoc, isLinalgTemplateKind } from './linalgTemplates.ts';

const PHYSICS_KINDS: ReadonlySet<string> = new Set(PHYSICS_TEMPLATES.map((t) => t.kind));

export function isPhysicsTemplateKind(kind: string): kind is PhysicsTemplateKind {
  return PHYSICS_KINDS.has(kind);
}

export function buildTemplateDoc(kind: string): CanvasDoc {
  if (isDeepTemplateKind(kind) || isDeepPanoramaTemplateKind(kind)) return deepWorkshopDoc(kind);
  if (isLab408Kind(kind)) return lab408TemplateDoc(kind);
  if (isPhysicsTemplateKind(kind)) return physicsTemplateDoc(kind);
  if (isBusinessTemplateKind(kind)) return businessTemplateDoc(kind);
  if (isLinalgTemplateKind(kind)) return linalgTemplateDoc(kind);
  return calculusTemplateDoc(kind);
}

const workshopTemplates = [...CALCULUS_TEMPLATES, ...LINALG_TEMPLATES, ...PHYSICS_TEMPLATES, ...LAB408_TEMPLATES, ...DEEP_TEMPLATES, ...DEEP_PANORAMA_TEMPLATES, ...BUSINESS_TEMPLATES];

export function findWorkshopTemplate(kind: string | undefined, title: string) {
  return workshopTemplates.find((template) => template.kind === kind)
    ?? workshopTemplates.find((template) => template.name === title);
}

const workshopFormulas: Record<string, string> = {
  ...Object.fromEntries(BUSINESS_TEMPLATES.map(({ kind, formula }) => [kind, formula])),
  ...Object.fromEntries(LINALG_TEMPLATES.map(({ kind, formula }) => [kind, formula])),
  'projectile-drag': 'm·dv/dt = mg − kv',
  'incline-friction': 'tan α = μ',
  'collision-momentum': 'Σp初 = Σp末',
  'oscillation-wave': 'ω₀ = √(g/ℓ)',
  'charged-particle': 'F = q(E + v × B)',
  'rc-circuit': 'τ = RC',
  'motional-emf': 'ℰ = Bℓv',
  'double-slit': 'd sin θ = mλ',
  'refraction-fiber': 'n₁ sin θ₁ = n₂ sin θ₂',
  'thin-lens': '1/f = 1/u + 1/v',
  'carnot-cycle': 'η = 1 − T꜀/Tₕ',
  'photoelectric': 'Kₘₐₓ = hν − W',
  dsTraversal: '前序 · 中序 · 后序 · 层序',
  avl: 'BF = h(L) − h(R)',
  kmpSort: 'next / nextval',
  graphAlgo: 'd[v] ← min(d[v], d[u]+w)',
  cacheSimLab: 'AMAT = 命中时间 + 缺失率 × 罚时',
  pipelineLab: 'CPI = 周期数 / 指令数',
  ieee754Lab: 'x = (−1)ˢ × M × 2ᴱ',
  cpuScheduleLab: '周转 = 完成 − 到达',
  bankerLab: 'Need = Max − Allocation',
  pageReplace: 'FIFO / LRU / OPT',
  tcpCongestionLab: 'cwnd ← cwnd + 1/cwnd',
  slidingWindowLab: 'GBN / SR',
  ipSubnet: '地址数 = 2⁽³² ⁻ ᵖ⁾',
  btreeLab: '⌈m/2⌉ − 1 ≤ k ≤ m − 1',
  hashTableLab: 'H(key) = key mod p · α = n / m',
  cpuDatapathLab: '取指 IF → 译码 ID → 执行 EX → 访存 MEM → 写回 WB',
  aluBoothLab: '[X+Y]补 = [X]补 + [Y]补 (mod 2ⁿ)',
  diskScheduleLab: '平均寻道长度 = Σ|trackᵢ − trackᵢ₋₁| / n',
  pvSyncLab: 'P(S): S←S−1 · V(S): S←S+1',
  csmaCdLab: 'L_min = 2τ · R',
  routingLab: 'Dₓ(y) = minᵥ { c(x,v) + Dᵥ(y) }',
  'dl-mlp-backprop': 'h=σ(Wx+b) · δ⁽ˡ⁾=(W⁽ˡ⁺¹⁾)ᵀδ⁽ˡ⁺¹⁾⊙σ′',
  'dl-cnn-resnet': 'yᵢⱼ=Σxᵢ₊ᵤ,ⱼ₊ᵥKᵤᵥ · y=x+F(x)',
  'dl-transformer-attention': 'Attention=softmax(QKᵀ/√dₖ)V',
  'dl-llm-inference-lora': 'p=softmax(z/T) · W′=W+BA',
  'dl-diffusion-latent': 'xₜ=√ᾱx₀+√(1−ᾱ)ε',
  'dl-rl-agent': 'Q←Q+α[r+γmaxQ(s′)−Q]',
  dlSvm: '间隔宽度 = 2/‖w‖',
  dlActivation: '∂hₗ/∂h₀ = ∏ f′(zᵢ)',
  dlOptimizer: 'θₜ₊₁ = θₜ − η · update(∇L)',
  dlRegularization: 'L + λ‖θ‖²',
  dlManifold: 'hₗ = σ(Wₗhₗ₋₁ + bₗ)',
  dlCnn: 'yᵢⱼ = Σᵤᵥ xᵢ₊ᵤ,ⱼ₊ᵥ kᵤᵥ',
  dlResnet: 'y = x + F(x)',
  dlSequence: 'hₜ = f(hₜ₋₁, xₜ)',
  dlAttention: 'softmax(QKᵀ/√dₖ)V',
  dlMultihead: 'Concat(head₁, …, headₕ)Wᴼ',
  dlKv: 'p = softmax(logits / T)',
  dlAutoencoder: 'x̂ = Dec(Enc(x))',
  dlDiffusion: 'score = ∇ₓ log pₜ(x)',
  dlQlearning: 'Q ← Q + α(r + γ max Q′ − Q)',
};

export interface WorkshopPluginEntry {
  kind: string;
  name: string;
  desc: string;
  category: '高等数学' | '线性代数' | '大学物理' | '408 专题' | '深度学习' | '办公决策';
  formula?: string;
  keywords?: readonly string[];
}

export function workshopPluginConfigForTemplate(
  { kind, name, category }: Pick<WorkshopPluginEntry, 'kind' | 'name' | 'category'>,
): WorkshopPluginConfig {
  const config = { template_kind: kind, title: name, category };
  // Older offline runtimes can run the shipped rule nodes without a new catalog entry.
  if (isLinalgTemplateKind(kind)) return { ...config, display_mode: 'full', doc: linalgTemplateDoc(kind) };
  if (isDeepPanoramaTemplateKind(kind)) return { ...config, display_mode: 'full', doc: deepWorkshopDoc(kind) };
  return config;
}

export const WORKSHOP_PLUGIN_CATALOG: readonly WorkshopPluginEntry[] = [
  ...VISIBLE_CALCULUS_TEMPLATES.map(({ kind, name, desc, formula, keywords }) =>
    ({ kind, name, desc, category: '高等数学' as const, formula, keywords })),
  ...VISIBLE_LINALG_TEMPLATES.map(({ kind, name, desc, formula, keywords }) =>
    ({ kind, name, desc, category: '线性代数' as const, formula, keywords })),
  ...VISIBLE_PHYSICS_TEMPLATES.map((t) => ({ kind: t.kind, name: t.name, desc: t.desc, category: '大学物理' as const, formula: t.formula ?? workshopFormulas[t.kind], keywords: t.keywords })),
  ...VISIBLE_LAB408_TEMPLATES.map((t) => ({ kind: t.kind, name: t.name, desc: t.desc, category: '408 专题' as const, formula: t.formula ?? workshopFormulas[t.kind], keywords: t.keywords })),
  ...VISIBLE_DEEP_TEMPLATES.map((t) => ({ kind: t.kind, name: t.name, desc: t.desc, category: '深度学习' as const, formula: t.formula, keywords: t.keywords })),
  ...VISIBLE_BUSINESS_TEMPLATES.map(({ kind, name, desc, formula, keywords }) =>
    ({ kind, name, desc, category: '办公决策' as const, formula, keywords })),
];

const categoryGroups: ReadonlyArray<readonly [WorkshopPluginEntry['category'], readonly { kind: string }[]]> = [
  ['高等数学', CALCULUS_TEMPLATES], ['线性代数', LINALG_TEMPLATES], ['大学物理', PHYSICS_TEMPLATES],
  ['408 专题', LAB408_TEMPLATES], ['深度学习', DEEP_PANORAMA_TEMPLATES], ['办公决策', BUSINESS_TEMPLATES],
];

export function workshopCategory(...kinds: (string | undefined)[]): WorkshopPluginEntry['category'] | undefined {
  for (const kind of kinds) {
    const group = kind ? categoryGroups.find(([, templates]) => templates.some((t) => t.kind === kind)) : undefined;
    if (group) return group[0];
  }
  return undefined;
}

export function workshopFormula(kind: string | undefined): string | undefined {
  return kind && Object.hasOwn(workshopFormulas, kind) ? workshopFormulas[kind] : undefined;
}
