/** 个人主页顶部动态引入区：基于真实资产进度的「创作闭环罗盘」。 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listCustomBlocks } from '@/canvas/customBlocks';
import styles from './PageIntros.module.css';

interface SpaceIntroBannerProps {
  displayName: string;
  worksCount: number;
  materialsCount: number;
  interactiveObjectsCount: number;
}

const STORAGE_KEY = 'wanxiang.intro.space.collapsed.v1';

interface StationMeta {
  code: string;
  title: string;
  desc: string;
  adviceTitle: string;
  adviceBody: string;
  ctaLabel: string;
  to: string;
}

const STATIONS: StationMeta[] = [
  {
    code: '01',
    title: '在工坊造仪器',
    desc: '拖积木连线或一句话让 AI 生成真计算实验',
    adviceTitle: '01 在工坊造仪器：',
    adviceBody: '65+ 真内核模板 + AI 智能计算方块，一句话就能生成可调参实验。',
    ctaLabel: '打开万象工坊 →',
    to: '/workshop',
  },
  {
    code: '02',
    title: '存入个人积木库',
    desc: '框选封装常用子模块，跨画布随时拖出复用',
    adviceTitle: '02 存入个人积木库：',
    adviceBody: '在画布中框选多个积木一键封装并保存，以后在任何画布都能拖出来用。',
    ctaLabel: '新建空白画布 →',
    to: '/canvas',
  },
  {
    code: '03',
    title: '嵌进活页 PPT',
    desc: '上传原有课件，在重点页贴上刚造好的活仪器',
    adviceTitle: '03 嵌进活页 PPT：',
    adviceBody: '上传原稿 PPTX / PDF，保留排版的同时在重点页插入工坊插件。',
    ctaLabel: '打开万象活页 →',
    to: '/living',
  },
  {
    code: '04',
    title: '导出离线课件',
    desc: '打包单文件 HTML 带去教室，断网也能流畅演播',
    adviceTitle: '04 导出离线课件：',
    adviceBody: '在活页演播台一键导出单文件 HTML 拷进 U 盘，教室断网也能流畅讲授。',
    ctaLabel: '去活页导出课件 →',
    to: '/living',
  },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function SpaceIntroBanner({
  displayName,
  worksCount,
  materialsCount,
  interactiveObjectsCount,
}: SpaceIntroBannerProps): JSX.Element {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [focusedStation, setFocusedStation] = useState<number | null>(null);

  const customBlocksCount = useMemo(() => listCustomBlocks().length, []);

  // 按用户真实资产状态点亮对应站点
  const stationDone = useMemo<boolean[]>(() => {
    const step1 = worksCount > 0;
    const step2 = customBlocksCount > 0;
    const step3 = materialsCount > 0;
    const step4 = materialsCount > 0 && (interactiveObjectsCount > 0 || worksCount > 0);
    return [step1, step2, step3, step4];
  }, [worksCount, customBlocksCount, materialsCount, interactiveObjectsCount]);

  const doneCount = stationDone.filter(Boolean).length;
  const nextIndex = stationDone.findIndex((done) => !done);

  const fillWidth = useMemo(() => {
    if (doneCount <= 0) return '0%';
    if (doneCount === 1) return '26%';
    if (doneCount === 2) return '52%';
    return '76%';
  }, [doneCount]);

  const activeAdvice = useMemo(() => {
    if (focusedStation !== null) {
      const station = STATIONS[focusedStation] ?? STATIONS[0]!;
      return {
        lead: station.adviceTitle,
        body: station.adviceBody,
        ctaLabel: station.ctaLabel,
        to: station.to,
      };
    }
    if (doneCount === 0) {
      return {
        lead: '刚来到万象？',
        body: '先去工坊挑一个现成实验，或用一句话让 AI 帮你生成第一台活仪器。',
        ctaLabel: '去万象工坊造第 1 台仪器 →',
        to: '/workshop',
      };
    }
    if (doneCount === 4) {
      return {
        lead: '全闭环已达成！',
        body: '你已打通从造仪器、存积木到活页演播的完整流程，随时继续创作新实验。',
        ctaLabel: '+ 新建空白画布 →',
        to: '/canvas',
      };
    }
    if (worksCount > 0 && materialsCount === 0) {
      return {
        lead: `你已有 ${worksCount} 件工坊作品！`,
        body: '下一步可以上传一份 PPT 把它嵌进去，或者把常用模块存入「我的积木库」。',
        ctaLabel: '去万象活页导入 PPT →',
        to: '/living',
      };
    }
    const target = STATIONS[nextIndex >= 0 ? nextIndex : 0] ?? STATIONS[0]!;
    return {
      lead: `建议下一步 · ${target.title}：`,
      body: target.adviceBody,
      ctaLabel: target.ctaLabel,
      to: target.to,
    };
  }, [focusedStation, doneCount, worksCount, materialsCount, nextIndex]);

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* 隐私模式静默忽略 */
      }
      return next;
    });
  };

  return (
    <section
      className={`${styles.introShell} ${collapsed ? styles.isCollapsed : ''}`}
      aria-label="创作闭环罗盘"
    >
      <div className={styles.introHead}>
        <div className={styles.introHeadLeft}>
          <span className={styles.eyebrowPill}>
            <span className={`${styles.dot} ${styles.dotTeal}`} />
            创作闭环罗盘
          </span>
          <span className={styles.introHeadTitle}>从灵感到课堂，四步点亮你的教学工作室</span>
        </div>
        <button type="button" className={styles.collapseBtn} onClick={toggleCollapsed}>
          {collapsed ? '展开导览 ▾' : '收起导览 ▴'}
        </button>
      </div>

      {!collapsed ? (
        <div className={styles.introBody}>
          <div className={styles.pulseTopRow}>
            <div className={styles.pulseGreeting}>
              <strong>
                {timeGreeting()}，{displayName}
              </strong>{' '}
              · 你的创作闭环已点亮 {doneCount} / 4 站
            </div>
            <span className={styles.pulseCountBadge}>
              {worksCount} 作品 · {customBlocksCount} 自制积木 · {materialsCount} 活页
            </span>
          </div>

          <div className={styles.compassTrack}>
            <div className={styles.compassLineBg} aria-hidden="true" />
            <div
              className={styles.compassLineFill}
              style={{ width: fillWidth }}
              aria-hidden="true"
            />

            {STATIONS.map((station, idx) => {
              const isDone = stationDone[idx];
              const isNext = !isDone && idx === nextIndex;
              return (
                <button
                  key={station.code}
                  type="button"
                  className={`${styles.compassNode} ${
                    isDone ? styles.compassNodeDone : ''
                  } ${isNext ? styles.compassNodeNext : ''}`}
                  onClick={() => setFocusedStation(idx)}
                >
                  <div className={styles.compassNodeTop}>
                    <span className={styles.compassDot}>{isDone ? '✓' : station.code}</span>
                    <span
                      className={`${styles.statusStamp} ${
                        isDone ? styles.statusStampDone : isNext ? styles.statusStampNext : ''
                      }`}
                    >
                      {isDone ? '已点亮' : isNext ? '建议下一步' : '待解锁'}
                    </span>
                  </div>
                  <h4>{station.title}</h4>
                  <p>{station.desc}</p>
                </button>
              );
            })}
          </div>

          <div className={styles.pulseAdviceBar}>
            <div className={styles.pulseAdviceText}>
              <strong>{activeAdvice.lead}</strong> {activeAdvice.body}
            </div>
            <button
              type="button"
              className={styles.pulseCta}
              onClick={() => navigate(activeAdvice.to)}
            >
              {activeAdvice.ctaLabel}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
