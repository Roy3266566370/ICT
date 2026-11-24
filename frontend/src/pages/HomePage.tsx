/**
 * HomePage.tsx —— 万象首页（围绕万象工坊 × 万象活页生态闭环构建）
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import markUrl from '@/assets/brand/wanxiang-mark.png';
import { SiteNav } from '@/components/home/SiteNav';
import { useUploadDialog } from '@/components/home/deck/useUploadDialog';
import { GuidedWalkthrough } from '@/components/home/ecosystem/GuidedWalkthrough';
import { HeroStackVisual } from '@/components/home/ecosystem/HeroStackVisual';
import { LivingCompareSection } from '@/components/home/ecosystem/LivingCompareSection';
import { WorkshopLabsSection } from '@/components/home/ecosystem/WorkshopLabsSection';
import { prefetchCommonRoutes } from '@/components/navigation/routePrefetch';
import { LivingUploadPanel } from '@/components/upload/LivingUploadPanel';
import './HomeRedesign.css';

const WORKSHOP_TEMPLATES = [
  { label: '斜率场与 RK4', to: '/workshop' },
  { label: '黎曼和收敛', to: '/canvas?template=ftc-sweep' },
  { label: 'CPU 调度', to: '/canvas?template=cpuScheduleLab' },
  { label: '梯度下降', to: '/canvas?template=dlOptimizer' },
  { label: '图遍历 BFS', to: '/canvas?template=dsTraversal' },
] as const;

export function HomePage(): JSX.Element {
  const { open: uploadOpen, openUpload, closeUpload, closeRef, dialogRef } = useUploadDialog();

  useEffect(() => {
    prefetchCommonRoutes();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  return (
    <>
      <SiteNav current="home" onUpload={openUpload} />

      <div className="wx-home">
        <main id="top">
          {/* 1. HERO：双轮主线 + 2.5D 立体悬浮生态架构 */}
          <section className="hero">
            <div className="container">
              <div className="hero__grid">
                <div>
                  <div className="hero__badge">
                    <i aria-hidden="true" /> 万象工坊 × 万象活页 · 双引擎教学与推演生态
                  </div>
                  <h1 className="hero__title">
                    在工坊造<span className="highlight">活仪器</span>，<br />
                    在活页把课讲活。
                  </h1>
                  <p className="hero__lead">
                    <strong>万象工坊</strong>把公式、算法与沙盘连成可调参的真实计算模型；
                    <strong>万象活页</strong>把静态 PPT 与 PDF 变成能现场推演的动态课件。
                    一次建模，随处嵌入，让讲台与思考真正流动起来。
                  </p>
                  <div className="hero__actions">
                    <Link className="btn btn--primary" to="/workshop">
                      进入万象工坊 <span aria-hidden="true">↗</span>
                    </Link>
                    <Link className="btn" to="/living">
                      把课件做成活页 <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                  <div className="hero__metrics">
                    <div className="hero__metric">
                      <strong>真内核</strong>
                      <span>实时数值与符号计算</span>
                    </div>
                    <div className="hero__metric">
                      <strong>双向贯通</strong>
                      <span>工坊与活页一键互转</span>
                    </div>
                    <div className="hero__metric">
                      <strong>离线可演</strong>
                      <span>单文件断网照常推演</span>
                    </div>
                  </div>
                </div>

                <HeroStackVisual />
              </div>
            </div>
          </section>

          {/* 2. §01 新人引导式动态剧场 */}
          <GuidedWalkthrough />

          {/* 3. §02 万象工坊精选 3 个真交互例子 */}
          <WorkshopLabsSection />

          {/* 4. §03 万象活页 Before/After 可拖拽卷帘 */}
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
                      <span className="sec-no cta-secno--teal">TRACK A</span> 从万象工坊出发
                    </p>
                    <h3>搭一个能亲手推演的活仪器</h3>
                    <p>挑选学科模板或空白画布，连线、调参、封装成你的第一块可复用积木与活页插件。</p>
                  </div>
                  <div className="cta-chips">
                    {WORKSHOP_TEMPLATES.map((tpl) => (
                      <Link key={tpl.label} to={tpl.to}>
                        {tpl.label}
                      </Link>
                    ))}
                  </div>
                  <div>
                    <Link className="btn btn--light" to="/workshop">
                      进入万象工坊 <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </div>

                <div className="cta-card cta-card--living">
                  <div>
                    <p className="eyebrow">
                      <span className="sec-no">TRACK B</span> 从万象活页出发
                    </p>
                    <h3>把手头现成的课件变成活页</h3>
                    <p>拖入你已有的 PPTX、PDF 或讲义图片，保留原有版式，几分钟内挂载工坊交互仪器。</p>
                  </div>
                  <button type="button" className="drop-zone" onClick={openUpload}>
                    <span className="file-badges">
                      <span>PPTX</span>
                      <span>PDF</span>
                      <span>PNG / JPG</span>
                      <span>.ZIP 工程包</span>
                    </span>
                    <span className="drop-zone__hint">点击这里上传教学材料，直接进入横向动态活页工作台</span>
                  </button>
                  <div>
                    <Link className="btn btn--primary" to="/living">
                      进入万象活页工作台 <span aria-hidden="true">↗</span>
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
              <span><strong>万象 WANXIANG</strong> · 万象工坊 × 万象活页 · 纸 / 墨 / 真计算内核</span>
            </div>
            <nav className="site-foot__links" aria-label="页脚导航">
              <Link to="/workshop">万象工坊</Link>
              <Link to="/living">万象活页</Link>
              <Link to="/space">个人主页</Link>
              <a href="#top">返回顶部 ↑</a>
            </nav>
          </div>
        </footer>
      </div>

      {uploadOpen ? (
        <div
          className="wx-upload-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUpload();
          }}
        >
          <div ref={dialogRef} className="wx-upload-dialog" role="dialog" aria-modal="true" aria-label="上传教学材料">
            <button
              ref={closeRef}
              type="button"
              className="wx-upload-close"
              onClick={closeUpload}
              aria-label="关闭上传窗口"
            >
              ×
            </button>
            <div className="wx-upload-body">
              <LivingUploadPanel />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default HomePage;
