/**
 * § 01 新人引导式动态剧场（四步手动递进 + 共享实时正弦波内核）
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const TOUR_STEPS = [
  {
    title: '起点：手里只有一份静态课件',
    desc: '传统 PPT 或讲义里的图都是写死的截图，讲到关键处学生问“把频率调大点会怎样”，只能干讲。',
    winTitle: '01 · 传统静态讲义（第 03 页 · 简谐波）',
    winTag: 'BEFORE',
    nextLabel: '下一步：用定象坊让它活起来 →',
  },
  {
    title: '用定象坊把公式连成实验',
    desc: '拖两块积木接上线，数学公式立刻变成可调参、真内核实时重算的交互波形——你现在就能拖右边的滑杆试试。',
    winTitle: '02 · 定象坊：积木连线与实时重算',
    winTag: 'WORKSHOP',
    nextLabel: '下一步：一键装进刚才的 PPT →',
  },
  {
    title: '装进通文册，原地升级你的 PPT',
    desc: '不用推翻原稿。把定象坊插件嵌进刚才那页课件，讲台一键切情景预设，不用切出 PPT 找别的软件。',
    winTitle: '03 · 通文册：原稿原地升级为动态课件',
    winTag: 'LIVING PAGES',
    nextLabel: '下一步：看课后如何分享与沉淀 →',
  },
  {
    title: '发出去或存离线包，课后还能反钻探究',
    desc: '导成单文件 HTML 断网也能演播；发给学生后，他们不仅能动手试，还能一键点回定象坊改公式，沉淀为长期资产。',
    winTitle: '04 · 分享、离线包与课后反钻闭环',
    winTag: 'ECOSYSTEM',
    nextLabel: '重头再看一遍 ↺',
  },
] as const;

const WAVE_PRESETS = [
  { label: '低频 ω=1', value: 1.0 },
  { label: '标准 ω=2', value: 2.0 },
  { label: '高频 ω=4.2', value: 4.2 },
] as const;

export function GuidedWalkthrough(): JSX.Element {
  const [step, setStep] = useState(0);
  const [omega, setOmega] = useState(2.0);

  const wavePath = useMemo(() => {
    let d = '';
    for (let i = 0; i <= 120; i += 1) {
      const t = i / 120;
      const x = 14 + t * 272;
      const y = 64 - Math.sin(omega * (t * 2 * Math.PI)) * 44;
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return d;
  }, [omega]);

  const currentMeta = TOUR_STEPS[step]!;

  return (
    <section className="section loop-section" id="loop">
      <div className="container">
        <header className="section-head">
          <div>
            <p className="eyebrow"><span className="sec-no">§ 01</span> GUIDED WALKTHROUGH / 30 秒看懂万象能干什么</p>
            <h2 className="tour-heading">跟着这四步，看一份死课件如何一步步<span>活起来。</span></h2>
          </div>
          <p>
            第一次来不用背概念。像过新手引导一样点「下一步」，在右侧的模拟工作台里亲眼看万象怎么帮你把公式变仪器、把 PPT 变活页、再沉淀成可复用的资产。
          </p>
        </header>

        <div className="tour-shell">
          <div className="tour-rail">
            <div className="tour-rail__top">
              <span>新人引导 · 第 {step + 1} / 4 步</span>
              <span className="mono tour-rail__hint">手动逐步探索</span>
            </div>
            <div className="tour-progress">
              <div className="tour-progress__fill" style={{ width: `${((step + 1) / 4) * 100}%` }} />
            </div>

            <div className="tour-steps" role="tablist" aria-label="新人引导步骤">
              {TOUR_STEPS.map((item, idx) => {
                const isDone = idx < step;
                const isActive = idx === step;
                return (
                  <button
                    key={item.title}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`tour-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`}
                    onClick={() => setStep(idx)}
                  >
                    <span className="tour-step__head">
                      <span className="tour-step__badge">{isDone ? '✓' : idx + 1}</span>
                      {item.title}
                    </span>
                    <p className="tour-step__desc">{item.desc}</p>
                  </button>
                );
              })}
            </div>

            <div className="tour-nav">
              <button
                type="button"
                className="tour-prev"
                disabled={step === 0}
                onClick={() => setStep((prev) => Math.max(0, prev - 1))}
              >
                ← 上一步
              </button>
              <button
                type="button"
                className="tour-next"
                onClick={() => setStep((prev) => (prev + 1) % TOUR_STEPS.length)}
              >
                {currentMeta.nextLabel}
              </button>
            </div>
          </div>

          <div className="tour-stage" aria-live="polite">
            <div className="tour-window-bar">
              <div className="window-dots">
                <i /><i /><i />
                <span>{currentMeta.winTitle}</span>
              </div>
              <span className="mono tour-window-bar__tag">{currentMeta.winTag}</span>
            </div>

            <div className="tour-stage-body">
              {step === 0 ? (
                <div className="tour-scene is-active" key="scene-0">
                  <div className="mock-paper">
                    <div>
                      <div className="mono mock-paper__meta">SLIDE 03 · 物理与微积分</div>
                      <h4 className="mock-paper__title">简谐波与角频率 ω</h4>
                      <p className="mock-paper__copy">公式：y = sin(ω·x)<br />当 ω 增大时，波形周期缩短、振荡变密。</p>
                    </div>
                    <div className="mock-dead-box spotlight-box">
                      <span className="mono mock-dead-box__lock">🔒 静态截图 · 无法拖动参数</span>
                      <svg viewBox="0 0 240 84" className="mock-dead-box__svg">
                        <line x1="8" y1="42" x2="232" y2="42" stroke="#857f70" />
                        <path d="M10 42 Q38 8 66 42 T122 42 T178 42 T232 42" fill="none" stroke="#444" strokeWidth="2" />
                      </svg>
                      <span className="mock-dead-box__note">ω = 2 写死在图片里</span>
                    </div>
                  </div>
                  <div className="guide-callout">
                    <span><strong>引导提示：</strong> 平时我们手里大多是这样的静态页——公式和图是割裂的、死的。点击「下一步」，看看定象坊怎么把它变活。</span>
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="tour-scene is-active" key="scene-1">
                  <div className="mock-workshop-grid">
                    <div>
                      <div className="mini-node">
                        <strong>① 函数源积木</strong>
                        <code className="mini-node__code">y = sin(ω · x)</code>
                        <div className="mini-node__sub">已勾选外露参数：ω</div>
                      </div>
                      <div className="mini-wire">↓ 实时数据流连接 ↓</div>
                      <div className="mini-node mini-node--teal">
                        <strong>② 波形仪器视图</strong>
                        <span className="mini-node__sub">自动绑定滑杆 · 真内核采样</span>
                      </div>
                    </div>
                    <div className="live-wave-card spotlight-box">
                      <div className="live-wave-card__head">
                        <strong>定象坊 · 实时波形仪器</strong>
                        <span className="mono live-wave-card__stat">
                          ω = {omega.toFixed(1)} · 周期 T = {(2 * Math.PI / omega).toFixed(2)}
                        </span>
                      </div>
                      <svg className="live-wave-svg" viewBox="0 0 300 128" role="img" aria-label="实时正弦波曲线">
                        <line x1="14" y1="64" x2="286" y2="64" stroke="#cdc7b6" />
                        <line x1="150" y1="12" x2="150" y2="116" stroke="#cdc7b6" />
                        <path d={wavePath} fill="none" stroke="#2234d4" strokeWidth="2.5" />
                      </svg>
                      <label className="slider-row">
                        <span className="slider-row__top">
                          <span>动手试一试：拖动角频率 ω</span>
                          <output>{omega.toFixed(1)}</output>
                        </span>
                        <input
                          type="range"
                          min={0.5}
                          max={5.0}
                          step={0.1}
                          value={omega}
                          onChange={(e) => setOmega(parseFloat(e.currentTarget.value))}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="guide-callout">
                    <span><strong>引导提示：</strong> 这不是假动画！你可以直接拖动上面高光框里的 <strong>ω 滑杆</strong>，公式会实时重算波形。</span>
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="tour-scene is-active" key="scene-2">
                  <div className="mock-living-slide">
                    <div>
                      <span className="mono mock-living-slide__tag">通文册 · SLIDE 03（已激活）</span>
                      <h4 className="mock-living-slide__title">简谐波与角频率 ω</h4>
                      <p className="mock-living-slide__desc">原有版式一字未动，右侧死截图已替换为定象坊积木。讲台上点一下预设即可对比：</p>
                      <div className="preset-row spotlight-box mock-living-slide__presets">
                        {WAVE_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            className={`preset-btn${Math.abs(omega - preset.value) < 0.05 ? ' is-active' : ''}`}
                            onClick={() => setOmega(preset.value)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="live-wave-card live-wave-card--bordered">
                      <div className="live-wave-card__head">
                        <strong>嵌入插件 · 波形仪器</strong>
                        <span className="mono live-wave-card__blue">ω = {omega.toFixed(1)}</span>
                      </div>
                      <svg className="live-wave-svg" viewBox="0 0 300 128" role="img" aria-label="嵌入活页的实时正弦波">
                        <line x1="14" y1="64" x2="286" y2="64" stroke="#cdc7b6" />
                        <line x1="150" y1="12" x2="150" y2="116" stroke="#cdc7b6" />
                        <path d={wavePath} fill="none" stroke="#2234d4" strokeWidth="2.5" />
                      </svg>
                      <div className="live-wave-card__foot">
                        <span>讲台免切软件 · 直接推演</span>
                        <Link to="/workshop" className="live-wave-card__link">拆开积木 ↗</Link>
                      </div>
                    </div>
                  </div>
                  <div className="guide-callout">
                    <span><strong>引导提示：</strong> 点一下左侧高光框里的<strong>情景预设</strong>，就像老师在讲台上直接切幻灯片状态一样丝滑。</span>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="tour-scene is-active" key="scene-3">
                  <div className="mock-share-grid">
                    <div className="share-pass spotlight-box">
                      <span className="share-pass__tag">OFFLINE · 单文件离线包</span>
                      <h4>教室断网，照样现场重算</h4>
                      <p>把整套活页与定象坊内核打包成单个 HTML 或 .zip 工程包，拷进 U 盘就能在任何教室电脑上离线流畅演播。</p>
                    </div>
                    <div className="share-pass share-pass--red">
                      <span className="share-pass__tag share-pass__tag--red">REVERSE · 课后反钻定象坊</span>
                      <h4>学生不仅能看，还能拆开改</h4>
                      <p>拿到分享链接后，在活页里调完参数，点击「拆开积木」即可回到定象坊自己改公式、加节点，沉淀到个人空间。</p>
                    </div>
                  </div>
                  <div className="guide-callout">
                    <span><strong>闭环达成：</strong> 从「静态原稿」→「定象坊建模」→「活页演播」→「课后反钻沉淀」，这就是万象能为你做的完整闭环。</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
