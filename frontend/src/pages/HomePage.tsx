/**
 * HomePage.tsx —— 万象首页（围绕定象坊 × 通文册生态闭环构建）
 */
import { useEffect, useLayoutEffect } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';

import markUrl from '@/assets/brand/wanxiang-mark.png';
import { MainSiteNav } from '@/components/home/MainSiteNav';
import { GuidedWalkthrough } from '@/components/home/ecosystem/GuidedWalkthrough';
import { HeroDynamicalStage } from '@/components/home/ecosystem/HeroDynamicalStage';
import { LivingCompareSection } from '@/components/home/ecosystem/LivingCompareSection';
import { WorkshopLabsSection } from '@/components/home/ecosystem/WorkshopLabsSection';
import { prefetchCommonRoutes } from '@/components/navigation/routePrefetch';
import './HomeRedesign.css';

const WORKSHOP_TEMPLATES = [
  { label: '斜率场与 RK4', to: '/canvas?template=ch07-ode-dynamics' },
  { label: '积分与 FTC', to: '/canvas?template=ch04-integrals' },
  { label: 'CPU 调度', to: '/canvas?template=os01-process-sched' },
  { label: '梯度下降', to: '/canvas?template=dl-mlp-backprop' },
  { label: '树 · 哈夫曼 · AVL', to: '/canvas?template=ds02-trees' },
] as const;

const HOME_SCROLL_KEY = 'xiangsheng.home.scrollY';

export function HomePage(): JSX.Element {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    prefetchCommonRoutes();
  }, []);

  useLayoutEffect(() => {
    const navState = location.state as { restoreScroll?: boolean } | null;
    const shouldRestore = navigationType === 'POP' || navState?.restoreScroll === true;
    let savedY = 0;
    if (shouldRestore) {
      try {
        const raw = Number(window.sessionStorage.getItem(HOME_SCROLL_KEY));
        if (Number.isFinite(raw) && raw > 0) savedY = raw;
      } catch {
        /* ignore storage failures */
      }
    }
    const raf = window.requestAnimationFrame(() => {
      window.scrollTo({ top: savedY, left: 0, behavior: 'auto' });
    });
    return () => {
      window.cancelAnimationFrame(raf);
      try {
        window.sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY));
      } catch {
        /* ignore storage failures */
      }
    };
  }, [location.state, navigationType]);

  return (
    <MainSiteNav current="home">{openUpload => (
      <div className="wx-home">
        <main id="top">
          {/* 1. HERO：「一式定象，万象皆通」建筑高对比 Slogan + 波动场×相轨演化自动舞台 */}
          <HeroDynamicalStage />

          {/* 2. §01 新人引导式动态剧场 */}
          <GuidedWalkthrough />

          {/* 3. §02 定象坊精选 3 个真交互例子 */}
          <WorkshopLabsSection />

          {/* 4. §03 通文册 Before/After 可拖拽卷帘 */}
          <LivingCompareSection />

          {/* 5. §04 工程原则 + 双子收口 */}
          <section className="section">
            <div className="container">
              <div className="principles-grid">
                <article className="principle-card">
                  <span className="principle-card__no">01 · TRUTH</span>
                  <h3>真内核计算，不靠假动画</h3>
                  <p>页面里的每一条曲线和读数都来自实时数值内核；修改表达式与边界，结果即时重算，不画写死的演示动画。</p>
                </article>
                <article className="principle-card">
                  <span className="principle-card__no">02 · VERIFY</span>
                  <h3>原稿留痕，核对之后再算</h3>
                  <p>导入课件或公式图片时保留原稿对照，不凭空补全缺失条件，也不把数值近似当作严格数学证明。</p>
                </article>
                <article className="principle-card">
                  <span className="principle-card__no">03 · PORTABLE</span>
                  <h3>属于你的活课件资产</h3>
                  <p>支持工程包与单文件离线导出，分享链接随时可撤，隐私信息与本地路径绝不随快照带出。</p>
                </article>
              </div>

              <div className="dual-cta">
                <div className="cta-card cta-card--workshop">
                  <div>
                    <p className="eyebrow cta-eyebrow--dark">
                      <span className="sec-no cta-secno--teal">TRACK A</span> 从定象坊出发
                    </p>
                    <h3>搭一个可交互的实验</h3>
                    <p>从模板或空白画布开始，连线、调参，把实验封装成可复用的积木。</p>
                  </div>
                  <div className="cta-chips">
                    {WORKSHOP_TEMPLATES.map((tpl) => (
                      <Link
                        key={tpl.label}
                        to={tpl.to}
                        state={{ from: '/', fromLabel: '← 返回主页', restoreScroll: true }}
                      >
                        {tpl.label}
                      </Link>
                    ))}
                  </div>
                  <div>
                    <Link className="btn btn--light" to="/workshop">
                      进入定象坊 <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </div>

                <div className="cta-card cta-card--living">
                  <div>
                    <p className="eyebrow">
                      <span className="sec-no">TRACK B</span> 从通文册出发
                    </p>
                    <h3>让现有课件可以交互</h3>
                    <p>拖入你已有的 PPTX、PDF 或讲义图片，保留原有版式，几分钟内挂载<span className="keep-together">定象坊插件</span>。</p>
                  </div>
                  <button type="button" className="drop-zone" onClick={openUpload}>
                    <span className="file-badges">
                      <span>PPTX</span>
                      <span>PDF</span>
                      <span>PNG / JPG</span>
                      <span>.ZIP 工程包</span>
                    </span>
                    <span className="drop-zone__hint">点击这里上传教学材料，直接进入通文册工作台</span>
                  </button>
                  <div>
                    <Link className="btn btn--primary" to="/living">
                      进入通文册工作台 <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="site-foot">
          <div className="container site-foot__inner">
            <div className="site-foot__brand">
              <img className="site-foot__mark" src={markUrl} width={22} height={22} alt="" />
              <span><strong>万象 WANXIANG</strong> · 定象坊 × 通文册 · 纸 / 墨 / 真计算内核</span>
            </div>
            <nav className="site-foot__links" aria-label="页脚导航">
              <Link to="/workshop">定象坊</Link>
              <Link to="/living">通文册</Link>
              <Link to="/space">个人主页</Link>
              <a href="#top">返回顶部 ↑</a>
            </nav>
          </div>
        </footer>
      </div>
    )}</MainSiteNav>
  );
}

export default HomePage;
