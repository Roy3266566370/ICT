import type { DeepPanoramaKind } from './deepPanoramaTypes';

export interface DeepPanoramaTemplate {
  kind: DeepPanoramaKind;
  topic: string;
  name: string;
  desc: string;
  tag: string;
  question: string;
  steps: string;
  observation: string;
  keywords: readonly string[];
  preview: DeepPanoramaKind;
  formula: string;
  panorama: true;
}

export const DEEP_PANORAMA_TEMPLATES: readonly DeepPanoramaTemplate[] = [
  {
    kind: 'dl-mlp-backprop', topic: 'dl01', name: 'MLP 流形折叠与反传沙盘',
    desc: '二维概率场、样本前向拓扑、优化器竞速与梯度瀑布共处一面；播放训练过程，观察平面怎样被连续折叠成可分表示。',
    tag: '深度学习 · 全景沙盘 · 训练动力学',
    question: '为什么同一个 XOR 平面，在 GELU 与 Sigmoid 下会呈现完全不同的折叠速度和梯度衰减？',
    steps: '1. 先播放前 50 轮，观察决策场从近似线性到弯曲折叠。\n2. 切换 Sigmoid 预设，锁定第 4 阶段看输入端梯度瀑布。\n3. 打开优化器竞速预设，比较四种更新规则在狭长谷地中的振荡。',
    observation: '概率场每一点都由当前权重实时前向计算；优化器竞速是独立二维玩具地形，用来解释更新 rule，不宣称与 MLP 参数空间一一对应。',
    keywords: ['MLP', '反向传播', '流形折叠', 'XOR', '优化器', '梯度消失', 'GELU'], preview: 'dl-mlp-backprop',
    formula: 'h=σ(Wx+b) · ∂L/∂h=δW⊙σ′(z)', panorama: true,
  },
  {
    kind: 'dl-cnn-resnet', topic: 'dl02', name: 'CNN 卷积扫描与感受野沙盘',
    desc: '12×12 可涂写画板、逐格乘加账本、双层感受野光束与 ResNet 退化对照串联成一条视觉证据链。',
    tag: '深度学习 · 全景沙盘 · 视觉架构',
    question: '两层 3×3 卷积为什么能回看原图 5×5？残差通路究竟保住了什么信号？',
    steps: '1. 在画板点击涂写，播放扫描过程并核对当前 3×3 乘加。\n2. 点击输出特征图任一像素，跳到对应扫描窗口。\n3. 锁定感受野阶段，观察两层窗口如何把光束汇回原输入。',
    observation: '卷积按教学惯例实现为互相关；残差对照是归一化信号/梯度尺度示意，用来解释恒等支路的抗衰减作用。',
    keywords: ['CNN', '卷积核', '感受野', '手绘数字', 'ResNet', '残差', 'stride'], preview: 'dl-cnn-resnet',
    formula: 'y[i,j]=Σ x[i+u,j+v]K[u,v] · y=x+F(x)', panorama: true,
  },
  {
    kind: 'dl-transformer-attention', topic: 'dl03', name: 'Transformer 注意力全景沙盘',
    desc: '可点击词元、注意力弧线、RoPE 旋转、缩放 A/B 热图与多头长程对照在同一条流水线中联动。',
    tag: '深度学习 · 全景沙盘 · 注意力机制',
    question: '除以 √dₖ 是数值技巧还是梯度救援？注意力凭什么跨距离直连，而不像 RNN 逐步遗忘？',
    steps: '1. 点击「它」，观察指向「毛线球」的长程弧线。\n2. 调大 dₖ 并切换未缩放路径，比较熵和矩阵饱和。\n3. 锁定多头阶段，对照局部头、长程头与 RNN 衰减曲线。',
    observation: '语义亲和力矩阵为手写教学样例；位置内积与缩放关系严格计算，旨在解释机制而非复现真实大模型语义。',
    keywords: ['Transformer', 'Attention', 'RoPE', '位置编码', 'scaled dot-product', '多头注意力', 'RNN'], preview: 'dl-transformer-attention',
    formula: 'Attention(Q,K,V)=softmax(QKᵀ/√dₖ)V', panorama: true,
  },
  {
    kind: 'dl-llm-inference-lora', topic: 'dl03', name: 'LLM 推理、KV-cache 与 LoRA 沙盘',
    desc: '逐 token 流水线、缓存复用 MAC 账本、温度/top-k/top-p 采样漏斗、LoRA 低秩和量化误差一体化演示。',
    tag: '深度学习 · 全景沙盘 · 推理部署',
    question: 'KV-cache 省掉的是哪一部分计算？LoRA 的低秩旁路和 INT8 量化分别付出什么近似代价？',
    steps: '1. 播放 8 个生成步，比较无 cache 与启用 cache 的重算块。\n2. 锁定采样漏斗，调温度和 top-p 看候选池收窄。\n3. 在 LoRA 阶段调 rank 与量化精度，核对参数占比和误差。',
    observation: 'MAC 账本只统计教学维度的 K/V 投影与注意力点积；采样词表固定，LoRA/量化矩阵为可审计小矩阵。',
    keywords: ['LLM', 'KV cache', 'temperature', 'top-k', 'top-p', 'LoRA', '量化', 'INT8'], preview: 'dl-llm-inference-lora',
    formula: 'p=softmax(z/T) · W′=W+BA', panorama: true,
  },
  {
    kind: 'dl-diffusion-latent', topic: 'dl04', name: '扩散轨迹与潜空间沙盘',
    desc: '高分辨率密度云、180 个粒子拖尾、解析 score 矢量场与 InfoNCE anchor 力场共同解释生成过程。',
    tag: '深度学习 · 全景沙盘 · 生成模型',
    question: '逆扩散为什么不是简单倒放视频？score 矢量场如何把噪声推回数据流形？',
    steps: '1. 播放完整过程，先看前向加噪再看反向去噪。\n2. 切换到瑞士卷预设，锁定 score 阶段观察矢量场随 t 变形。\n3. 在潜空间阶段拖动 anchor 参数，比较正负样本拉力。',
    observation: 'score 来自二维 Gaussian mixture 的解析解；反向过程使用 probability-flow ODE 的教学 Euler 积分，不是训练好的真实 denoiser。',
    keywords: ['Diffusion', 'score matching', '瑞士卷', '潜空间', 'InfoNCE', '粒子轨迹'], preview: 'dl-diffusion-latent',
    formula: 'xₜ=√ᾱx₀+√(1−ᾱ)ε · dx/dt=1.5[x+∇logp]', panorama: true,
  },
  {
    kind: 'dl-rl-agent', topic: 'dl04', name: '强化学习智能体进化沙盘',
    desc: '6×6 悬崖迷宫中播放 Q-learning/REINFORCE 训练，策略指南针、回报曲线与贝尔曼数值更新同步呈现。',
    tag: '深度学习 · 全景沙盘 · 强化学习',
    question: '为什么高探索能避免早熟却拖慢收敛？γ 改变时，远处奖励怎样影响起点策略？',
    steps: '1. 播放训练回合，观察智能体从乱撞逐步绕开悬崖。\n2. 点击任意格子，底部公式显示该状态的贝尔曼更新。\n3. 切换 REINFORCE 预设，比较值函数表格与策略梯度的行为差异。',
    observation: ' cliff world 的奖励、状态转移和折扣回报完全确定；REINFORCE 使用固定尺度的 episodic score-function gradient。',
    keywords: ['Q-learning', 'REINFORCE', '强化学习', '悬崖迷宫', 'Bellman', 'epsilon-greedy', '策略指南针'], preview: 'dl-rl-agent',
    formula: 'Q←Q+α[r+γmaxQ(s′)−Q]', panorama: true,
  },
];

export const VISIBLE_DEEP_TEMPLATES = DEEP_PANORAMA_TEMPLATES;

export function isDeepPanoramaTemplateKind(kind: string): kind is DeepPanoramaKind {
  return DEEP_PANORAMA_TEMPLATES.some((template) => template.kind === kind);
}
