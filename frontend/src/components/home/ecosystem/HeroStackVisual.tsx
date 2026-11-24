/**
 * 首屏右侧：2.5D 立体悬浮三层生态架构（常驻铭牌 + 3D 视差 + 悬停磨砂玻璃说明卡）
 */
import { useCallback, useState, type PointerEvent } from 'react';

type StackPart = 'living' | 'workshop' | 'kernel' | 'loop';

interface PartMeta {
  title: string;
  badge: string;
  desc: string;
}

const PART_INFO: Record<StackPart, PartMeta> = {
  living: {
    title: '万象活页 · 动态课件演播层',
    badge: 'TOP · PRESENT',
    desc: '承接原有 PPTX / PDF 版式，把静态配图原地替换成可交互仪器；讲台现场直接推演，支持离线单文件分发。',
  },
  workshop: {
    title: '万象工坊 · 积木编排与封装层',
    badge: 'MID · WORKSHOP',
    desc: '通过可视化节点连线把抽象公式与算法搭成“活仪器”，自由勾选外露参数、保存情景预设并一键封装为活页插件。',
  },
  kernel: {
    title: '真计算内核 · 多学科算力底座',
    badge: 'BASE · KERNEL',
    desc: '内置高数、408 算法、深度学习与商业沙盘的实时数值计算引擎，不播假动画，改一个参数即刻重算真实结果。',
  },
  loop: {
    title: '课后反钻与资产回流闭环',
    badge: 'LOOP · COMPOUND',
    desc: '听众收到活页分享或离线包后，点击即可反钻回工坊改公式、做延伸实验，并沉淀到个人空间跨学期复用。',
  },
};

export function HeroStackVisual(): JSX.Element {
  const [focused, setFocused] = useState<StackPart | null>(null);
  const [parallax, setParallax] = useState({ nx: 0, ny: 0 });

  const handleMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    setParallax({ nx, ny });
  }, []);

  const handleLeave = useCallback(() => {
    setParallax({ nx: 0, ny: 0 });
    setFocused(null);
  }, []);

  const layerStyle = (depth: number) => ({
    transform: `translate(${(parallax.nx * 8 * depth).toFixed(1)}px, ${(parallax.ny * 6 * depth).toFixed(1)}px)`,
  });

  const activeInfo = focused ? PART_INFO[focused] : null;

  return (
    <div className="hero-emblem" aria-label="万象三层生态架构交互装置">
      <div
        className={`iso-stage${focused ? ' has-focus' : ''}`}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
      >
        <div className="iso-stage__bar">
          <span><b>WANXIANG STACK</b> · 三层生态架构</span>
          <span className="iso-stage__pill"><i aria-hidden="true" />悬停查看各层作用</span>
        </div>

        <svg viewBox="0 0 600 420" role="img" aria-label="底层计算内核、中层万象工坊、顶层万象活页及右侧回流闭环">
          <defs>
            <linearGradient id="wx-mat-kernel-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1b265c" />
              <stop offset="100%" stopColor="#0d1333" />
            </linearGradient>
            <linearGradient id="wx-mat-workshop-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4f6ff" stopOpacity=".96" />
              <stop offset="100%" stopColor="#dce2ff" stopOpacity=".92" />
            </linearGradient>
            <linearGradient id="wx-mat-living-top" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f2ede1" />
            </linearGradient>
            <linearGradient id="wx-mat-loop-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#de421f" />
              <stop offset="50%" stopColor="#0f766e" />
              <stop offset="100%" stopColor="#2234d4" />
            </linearGradient>
            <radialGradient id="wx-floor-shadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#111312" stopOpacity=".14" />
              <stop offset="100%" stopColor="#111312" stopOpacity="0" />
            </radialGradient>
            <filter id="wx-soft-elev" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="14" stdDeviation="11" floodColor="#11162c" floodOpacity="0.14" />
            </filter>
          </defs>

          <ellipse cx="326" cy="390" rx="164" ry="28" fill="url(#wx-floor-shadow)" />

          {/* 01 底层：计算内核 */}
          <g className="iso-layer" style={layerStyle(0.45)}>
            <g
              className={`iso-float-3 iso-hit${focused === 'kernel' ? ' is-focused' : ''}`}
              filter="url(#wx-soft-elev)"
              tabIndex={0}
              onPointerEnter={() => setFocused('kernel')}
              onFocus={() => setFocused('kernel')}
              onPointerLeave={() => setFocused(null)}
              onBlur={() => setFocused(null)}
            >
              <line x1="152" y1="312" x2="118" y2="312" stroke="#4c62d6" strokeWidth="1.2" strokeDasharray="2 3" />
              <rect className="iso-tag-rect" x="14" y="294" width="104" height="36" rx="10" fill="rgba(255,253,248,.92)" stroke="rgba(17,19,18,.14)" />
              <circle cx="28" cy="312" r="3.5" fill="#0f766e" />
              <text x="38" y="310" fontSize="11.5" fontWeight="700" fill="#111312">计算内核</text>
              <text x="38" y="323" fontSize="9" fontFamily="monospace" fill="#696c61">01 · KERNEL</text>

              <polygon points="152,312 326,370 326,385 152,327" fill="#090d24" />
              <polygon points="500,312 326,370 326,385 500,327" fill="#172254" />
              <polygon points="326,254 500,312 326,370 152,312" fill="url(#wx-mat-kernel-top)" stroke="#4c62d6" strokeWidth="1.3" />
              <g stroke="#5b73e8" strokeWidth="0.8" opacity="0.42">
                <line x1="196" y1="297" x2="370" y2="355" />
                <line x1="239" y1="283" x2="413" y2="341" />
                <line x1="283" y1="268" x2="457" y2="326" />
                <line x1="196" y1="327" x2="370" y2="269" />
                <line x1="239" y1="341" x2="413" y2="283" />
                <line x1="283" y1="355" x2="457" y2="297" />
              </g>
              <circle cx="268" cy="312" r="4.8" fill="#60a5fa" />
              <circle cx="326" cy="292" r="5.2" fill="#2dd4bf" />
              <circle cx="384" cy="312" r="4.8" fill="#fb923c" />
              <circle cx="326" cy="332" r="4.5" fill="#a78bfa" />
            </g>
          </g>

          {/* 底层 → 中层 发光上升光束 */}
          <g fill="none" strokeWidth="1.8" opacity=".82">
            <path id="wx-path-k1" d="M268 308 L268 214" stroke="#60a5fa" className="beam-flow" />
            <path id="wx-path-k2" d="M326 288 L326 196" stroke="#2dd4bf" className="beam-flow" />
            <path id="wx-path-k3" d="M384 308 L384 214" stroke="#fb923c" className="beam-flow" />
          </g>
          <circle r="3" fill="#60a5fa"><animateMotion dur="2.1s" repeatCount="indefinite"><mpath href="#wx-path-k1" /></animateMotion></circle>
          <circle r="3.2" fill="#2dd4bf"><animateMotion dur="1.9s" repeatCount="indefinite" begin="0.4s"><mpath href="#wx-path-k2" /></animateMotion></circle>
          <circle r="3" fill="#fb923c"><animateMotion dur="2.3s" repeatCount="indefinite" begin="0.8s"><mpath href="#wx-path-k3" /></animateMotion></circle>

          {/* 02 中层：万象工坊 */}
          <g className="iso-layer" style={layerStyle(0.95)}>
            <g
              className={`iso-float-2 iso-hit${focused === 'workshop' ? ' is-focused' : ''}`}
              filter="url(#wx-soft-elev)"
              tabIndex={0}
              onPointerEnter={() => setFocused('workshop')}
              onFocus={() => setFocused('workshop')}
              onPointerLeave={() => setFocused(null)}
              onBlur={() => setFocused(null)}
            >
              <line x1="152" y1="204" x2="118" y2="204" stroke="#2234d4" strokeWidth="1.2" strokeDasharray="2 3" />
              <rect className="iso-tag-rect" x="14" y="186" width="104" height="36" rx="10" fill="rgba(255,253,248,.92)" stroke="rgba(34,52,212,.24)" />
              <circle cx="28" cy="204" r="3.5" fill="#2234d4" />
              <text x="38" y="202" fontSize="11.5" fontWeight="700" fill="#111b5e">万象工坊</text>
              <text x="38" y="215" fontSize="9" fontFamily="monospace" fill="#696c61">02 · BUILD</text>

              <polygon points="152,204 326,262 326,273 152,215" fill="#bdc7f7" />
              <polygon points="500,204 326,262 326,273 500,215" fill="#d3dafd" />
              <polygon points="326,146 500,204 326,262 152,204" fill="url(#wx-mat-workshop-top)" stroke="#2234d4" strokeWidth="1.5" />
              <g>
                <polygon points="224,200 262,213 262,222 224,209" fill="#101a63" />
                <polygon points="300,200 262,213 262,222 300,209" fill="#1c2ecb" />
                <polygon points="262,187 300,200 262,213 224,200" fill="#3b50f0" />

                <polygon points="288,182 326,195 326,204 288,191" fill="#0b5550" />
                <polygon points="364,182 326,195 326,204 364,191" fill="#0f766e" />
                <polygon points="326,169 364,182 326,195 288,182" fill="#14b8a6" />

                <polygon points="352,204 390,217 390,226 352,213" fill="#9c2a11" />
                <polygon points="428,204 390,217 390,226 428,213" fill="#de421f" />
                <polygon points="390,191 428,204 390,217 352,204" fill="#f36544" />

                <path d="M282 194 L304 186 M348 188 L370 198" stroke="#111b5e" strokeWidth="2" strokeDasharray="4 3" />
              </g>
            </g>
          </g>

          {/* 中层 → 顶层 发光上升光束 */}
          <g fill="none" strokeWidth="2" opacity=".86">
            <path id="wx-path-w1" d="M292 178 L292 106" stroke="#2234d4" className="beam-flow" />
            <path id="wx-path-w2" d="M362 186 L362 108" stroke="#de421f" className="beam-flow" />
          </g>
          <circle r="3.2" fill="#2234d4"><animateMotion dur="1.8s" repeatCount="indefinite"><mpath href="#wx-path-w1" /></animateMotion></circle>
          <circle r="3.2" fill="#de421f"><animateMotion dur="2.0s" repeatCount="indefinite" begin="0.6s"><mpath href="#wx-path-w2" /></animateMotion></circle>

          {/* 03 顶层：万象活页 */}
          <g className="iso-layer" style={layerStyle(1.5)}>
            <g
              className={`iso-float-1 iso-hit${focused === 'living' ? ' is-focused' : ''}`}
              filter="url(#wx-soft-elev)"
              tabIndex={0}
              onPointerEnter={() => setFocused('living')}
              onFocus={() => setFocused('living')}
              onPointerLeave={() => setFocused(null)}
              onBlur={() => setFocused(null)}
            >
              <line x1="152" y1="96" x2="118" y2="96" stroke="#de421f" strokeWidth="1.2" strokeDasharray="2 3" />
              <rect className="iso-tag-rect" x="14" y="78" width="104" height="36" rx="10" fill="rgba(255,253,248,.94)" stroke="rgba(222,66,31,.28)" />
              <circle cx="28" cy="96" r="3.5" fill="#de421f" />
              <text x="38" y="94" fontSize="11.5" fontWeight="700" fill="#de421f">万象活页</text>
              <text x="38" y="107" fontSize="9" fontFamily="monospace" fill="#696c61">03 · LIVE PPT</text>

              <polygon points="152,96 326,154 326,164 152,106" fill="#d7d0be" />
              <polygon points="500,96 326,154 326,164 500,106" fill="#e8e2d3" />
              <polygon points="326,38 500,96 326,154 152,96" fill="url(#wx-mat-living-top)" stroke="#111312" strokeWidth="1.6" />
              <g stroke="#8e8a7d" strokeWidth="2.2" strokeLinecap="round">
                <line x1="220" y1="96" x2="276" y2="77" stroke="#111312" />
                <line x1="238" y1="105" x2="286" y2="88" opacity=".55" />
                <line x1="256" y1="114" x2="296" y2="100" opacity=".4" />
              </g>
              <polygon points="332,64 430,97 372,118 274,85" fill="#eef1ff" stroke="#2234d4" strokeWidth="1.3" />
              <path d="M294 88 Q336 67 366 96 T410 95" fill="none" stroke="#de421f" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="350" cy="84" r="4.5" fill="#0f766e" stroke="#fff" strokeWidth="1.5" />
            </g>
          </g>

          {/* 04 右侧：课后反钻与资产回流闭环轨 */}
          <g className="iso-layer" style={layerStyle(0.8)}>
            <g
              className={`iso-hit${focused === 'loop' ? ' is-focused' : ''}`}
              tabIndex={0}
              onPointerEnter={() => setFocused('loop')}
              onFocus={() => setFocused('loop')}
              onPointerLeave={() => setFocused(null)}
              onBlur={() => setFocused(null)}
            >
              <path d="M506 100 C578 124, 578 292, 506 314" fill="none" stroke="transparent" strokeWidth="30" />
              <path id="wx-path-return" d="M506 100 C578 124, 578 292, 506 314" fill="none" stroke="url(#wx-mat-loop-stroke)" strokeWidth="2.4" className="beam-flow-slow" />
              <polygon points="502,314 514,307 512,319" fill="#2234d4" />
              <circle r="4" fill="#0f766e" stroke="#fff" strokeWidth="1.4">
                <animateMotion dur="3.6s" repeatCount="indefinite"><mpath href="#wx-path-return" /></animateMotion>
              </circle>
              <rect className="iso-tag-rect" x="518" y="186" width="70" height="40" rx="10" fill="rgba(235,251,248,.94)" stroke="rgba(15,118,110,.3)" />
              <text x="553" y="203" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f766e">↺ 闭环</text>
              <text x="553" y="218" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#32362e">反钻复用</text>
            </g>
          </g>
        </svg>

        <div className={`iso-tooltip${activeInfo ? ' is-show' : ''}`} role="status" aria-live="polite">
          {activeInfo ? (
            <>
              <div className="iso-tooltip__head">
                <h3 className="iso-tooltip__title">{activeInfo.title}</h3>
                <span className="iso-tooltip__badge">{activeInfo.badge}</span>
              </div>
              <p className="iso-tooltip__desc">{activeInfo.desc}</p>
            </>
          ) : null}
        </div>
      </div>

      <div className="hero-emblem__foot">
        <span>移动鼠标到任意铭牌或立体层级，展开详细作用</span>
        <span>3D PARALLAX · LIVE</span>
      </div>
    </div>
  );
}
