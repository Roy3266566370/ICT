/**
 * SharePage.tsx —— 学生端只读全屏页（P2-10）。
 *
 * 路由：`/p/:shareId`（`routes.tsx` 中只追加这一条，不接教师导航）。
 *
 * 设计约束：
 *  1. **只读全屏**：没有"准备页 / 详情 / 发布"入口，也不读取会话状态；
 *     唯一的数据来源是公开端点 `GET /api/v1/p/{share_id}`。
 *  2. **不带教师侧信息**：后端快照已裁剪，页图 URL 由 share_id 生成；
 *     本页不显示材料 id、会话 id、文件路径或教师备注。
 *  3. **两根渲染路径**：
 *     - 有 `regions`（真实上传材料/课程材料）→ 复用 `components/reader` 的
 *       `PageCanvas + ParamDrawer + PlayBar`，原页图上可拖参数；
 *     - 无 `regions`（手工示例等）→ 用前端只读 iSpec 面板展示参数 + table/text，
 *       页图缺失时给出 16:9 内联占位图（不是白屏）。
 *  4. 移动端：页面保持 16:9，参数与对象视图折叠进底部抽屉（`<details>`）。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useParams } from 'react-router-dom';
import SharedDeckPage from './SharedDeckPage';
import markUrl from '@/assets/brand/wanxiang-mark.png';
import { api, errorMessage, isApiError } from '@/api/client';
import type { SharePageImage, ShareSnapshot } from '@/api/types';
import {
  PageCanvas,
  ParamDrawer,
  PlayBar,
  parsePageRegions,
} from '@/components/reader';
import { useRegionRuntime } from '@/components/reader/useRegionRuntime';
import { NARROW_ASIDE_QUERY, useMediaQuery } from '@/components/workbench/useMediaQuery';
import { useReducedMotion } from '@/App';
import type { LinkedTextRuntime, PageRegion } from '@/regions/types';
import styles from './SharePage.module.css';

/* -------------------------------------------------------------------------- */
/* iSpec（只读子集）解析                                                       */
/* -------------------------------------------------------------------------- */

/** 可编辑标量：与 iSpec 的 number/integer/boolean/string 对齐。 */
type ScalarValue = number | boolean | string;

interface ParsedParameter {
  id: string;
  label: string;
  type: 'number' | 'integer' | 'boolean' | 'string';
  min: number | null;
  max: number | null;
  step: number | null;
  defaultValue: ScalarValue;
  unit: string;
}

type ParsedView =
  | { kind: 'table'; title: string; columns: string[] }
  | { kind: 'text'; title: string; template: string }
  | { kind: 'figure'; title: string }
  | { kind: 'vega'; title: string };

interface ParsedSpec {
  title: string;
  parameters: ParsedParameter[];
  views: ParsedView[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readScalar(value: unknown): ScalarValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  return null;
}

function parseSpecParameter(raw: unknown): ParsedParameter | null {
  const item = asRecord(raw);
  if (item === null) return null;
  const id = item['id'];
  if (typeof id !== 'string' || id.length === 0) return null;
  const defaultValue = readScalar(item['default']);
  if (defaultValue === null) return null;
  const label = typeof item['label'] === 'string' && item['label'].length > 0 ? item['label'] : id;
  const rawType = item['type'];
  const type: ParsedParameter['type'] =
    rawType === 'boolean'
      ? 'boolean'
      : rawType === 'integer'
        ? 'integer'
        : rawType === 'string'
          ? 'string'
          : 'number';
  if ((type === 'number' || type === 'integer') && typeof defaultValue !== 'number') return null;
  if (type === 'boolean' && typeof defaultValue !== 'boolean') return null;
  const min = readFinite(item['min']);
  const max = readFinite(item['max']);
  const step = readFinite(item['step']);
  const unit = typeof item['unit'] === 'string' ? item['unit'] : '';
  return { id, label, type, min, max, step, defaultValue, unit };
}

function parseSpecView(raw: unknown): ParsedView | null {
  const item = asRecord(raw);
  if (item === null) return null;
  const title = typeof item['title'] === 'string' ? item['title'] : '';
  const type = item['type'];
  if (type === 'table') {
    const columns = item['columns'];
    if (!Array.isArray(columns)) return null;
    return {
      kind: 'table',
      title,
      columns: columns.filter((column): column is string => typeof column === 'string'),
    };
  }
  if (type === 'text') {
    const template = item['template'];
    if (typeof template !== 'string') return null;
    return { kind: 'text', title, template };
  }
  if (type === 'figure') return { kind: 'figure', title };
  if (type === 'vega') return { kind: 'vega', title };
  return null;
}

function parseShareSpecs(raw: unknown[]): ParsedSpec[] {
  return raw.reduce<ParsedSpec[]>((acc, entry) => {
    const record = asRecord(entry);
    if (record === null) return acc;
    const rawParameters = record['parameters'];
    const parameters = Array.isArray(rawParameters)
      ? rawParameters.reduce<ParsedParameter[]>((list, item) => {
          const parsed = parseSpecParameter(item);
          if (parsed !== null) list.push(parsed);
          return list;
        }, [])
      : [];
    const rawViews = record['views'];
    const views = Array.isArray(rawViews)
      ? rawViews.reduce<ParsedView[]>((list, item) => {
          const parsed = parseSpecView(item);
          if (parsed !== null) list.push(parsed);
          return list;
        }, [])
      : [];
    if (parameters.length === 0 && views.length === 0) return acc;
    const rawTitle = record['title'];
    const title =
      typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : `对象 ${acc.length + 1}`;
    acc.push({ title, parameters, views });
    return acc;
  }, []);
}

/* -------------------------------------------------------------------------- */
/* 展示工具                                                                   */
/* -------------------------------------------------------------------------- */

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function formatScalar(value: ScalarValue): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    return String(Math.round(value * 1e4) / 1e4);
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value;
}

function formatMaybe(value: ScalarValue | undefined): string {
  return value === undefined ? '—' : formatScalar(value);
}

function renderTemplate(
  template: string,
  values: Record<string, ScalarValue>,
  specIndex: number,
): string {
  return template.replace(PLACEHOLDER_PATTERN, (match: string, id: string) => {
    const value = values[`${specIndex}:${id}`];
    return value === undefined ? match : formatScalar(value);
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 无页图时的 16:9 内联占位图。
 *
 * 示例材料（`clone_of_example_id`）没有 PPT 原页，也不会伪造页图；
 * 这里明确告诉学生"下方对象视图可交互"，而不是白屏或空白 `<img>`。
 */
function placeholderPage(title: string): string {
  const safeTitle = escapeXml(title.slice(0, 36));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img">
<rect width="1280" height="720" fill="#eef1f8"/>
<rect x="40" y="40" width="1200" height="640" rx="18" fill="none" stroke="#c3cbdd" stroke-width="2" stroke-dasharray="10 8"/>
<text x="640" y="300" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="40" fill="#0a1a33">${safeTitle}</text>
<text x="640" y="372" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="26" fill="#5b6880">该材料没有可渲染的原始页面</text>
<text x="640" y="420" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="22" fill="#7a879c">下方对象视图与参数可离线交互</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* -------------------------------------------------------------------------- */
/* 对象视图面板（iSpec 只读）                                                   */
/* -------------------------------------------------------------------------- */

interface ShareSpecPanelProps {
  specs: ParsedSpec[];
  values: Record<string, ScalarValue>;
  pageImage: string;
  narrow: boolean;
  onChange: (specIndex: number, parameterId: string, value: ScalarValue) => void;
}

function ShareSpecPanel(props: ShareSpecPanelProps): ReactElement {
  const { specs, values, pageImage, narrow, onChange } = props;

  const changeControl = (
    specIndex: number,
    parameter: ParsedParameter,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    if (parameter.type === 'boolean') {
      onChange(specIndex, parameter.id, event.target.checked);
      return;
    }
    if (parameter.type === 'string') {
      onChange(specIndex, parameter.id, event.target.value);
      return;
    }
    const parsed = Number(event.target.value);
    if (!Number.isFinite(parsed)) return;
    onChange(specIndex, parameter.id, parameter.type === 'integer' ? Math.round(parsed) : parsed);
  };

  const body = (
    <div className={styles.specBody}>
      {specs.length === 0 ? (
        <p className={styles.specEmpty} role="status">
          该分享没有可交互的对象视图；可以翻阅原始页面阅读。
        </p>
      ) : (
        specs.map((spec, specIndex) => (
          <section className={styles.spec} key={`${spec.title}-${specIndex}`} aria-label={spec.title}>
            <h2 className={styles.specTitle}>{spec.title}</h2>

            {spec.parameters.length > 0 ? (
              <div className={styles.params}>
                {spec.parameters.map((parameter) => {
                  const key = `${specIndex}:${parameter.id}`;
                  const value = values[key] ?? parameter.defaultValue;
                  return (
                    <label className={styles.param} key={key}>
                      <span className={styles.paramLabel}>
                        {parameter.label}
                        {parameter.unit.length > 0 ? `（${parameter.unit}）` : ''}
                      </span>
                      {parameter.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(event) => changeControl(specIndex, parameter, event)}
                        />
                      ) : parameter.type === 'string' ? (
                        <input
                          type="text"
                          value={typeof value === 'string' ? value : ''}
                          onChange={(event) => changeControl(specIndex, parameter, event)}
                        />
                      ) : parameter.min !== null && parameter.max !== null ? (
                        <input
                          type="range"
                          min={parameter.min}
                          max={parameter.max}
                          step={parameter.step ?? 1}
                          value={
                            typeof value === 'number'
                              ? value
                              : typeof parameter.defaultValue === 'number'
                                ? parameter.defaultValue
                                : 0
                          }
                          onChange={(event) => changeControl(specIndex, parameter, event)}
                        />
                      ) : (
                        <input
                          type="number"
                          step={parameter.step ?? 1}
                          value={typeof value === 'number' ? value : 0}
                          onChange={(event) => changeControl(specIndex, parameter, event)}
                        />
                      )}
                      <output className={styles.paramValue}>{formatScalar(value)}</output>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className={styles.specEmpty}>该对象没有可调标量参数，直接阅读下方视图。</p>
            )}

            {spec.views.map((view, viewIndex) => {
              if (view.kind === 'table') {
                return (
                  <div className={styles.viewBlock} key={`table-${viewIndex}`}>
                    {view.title.length > 0 ? <h3 className={styles.viewTitle}>{view.title}</h3> : null}
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {view.columns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {view.columns.map((column) => (
                            <td key={column}>{formatMaybe(values[`${specIndex}:${column}`])}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (view.kind === 'text') {
                return (
                  <div className={styles.viewBlock} key={`text-${viewIndex}`}>
                    {view.title.length > 0 ? <h3 className={styles.viewTitle}>{view.title}</h3> : null}
                    <p className={styles.textView}>
                      {renderTemplate(view.template, values, specIndex)}
                    </p>
                  </div>
                );
              }
              if (view.kind === 'figure') {
                return (
                  <figure className={styles.figureView} key={`figure-${viewIndex}`}>
                    <img src={pageImage} alt="图形视图（静态页面图）" />
                    <figcaption>图形视图已降级为静态页面图。</figcaption>
                  </figure>
                );
              }
              return (
                <p className={styles.degrade} key={`vega-${viewIndex}`}>
                  vega 图表需要联网渲染，分享页只展示静态页面图。
                </p>
              );
            })}
          </section>
        ))
      )}
    </div>
  );

  if (narrow) {
    return (
      <details className={styles.specDrawer}>
        <summary className={styles.specDrawerSummary}>参数与视图</summary>
        {body}
      </details>
    );
  }
  return (
    <aside className={styles.specAside} aria-label="对象视图">
      {body}
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                       */
/* -------------------------------------------------------------------------- */

const EMPTY_PARAMS: Record<string, unknown> = {};

export function SharePage(): ReactElement {
  return <SharedDeckPage />;
}

export function LegacySharePage(): ReactElement {
  const params = useParams<{ shareId?: string }>();
  const shareId = params.shareId ?? null;
  const reducedMotion = useReducedMotion();
  const narrow = useMediaQuery(NARROW_ASIDE_QUERY);

  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /* ---------------- 加载快照 ---------------- */

  useEffect(() => {
    if (shareId === null || shareId.length === 0) {
      setLoading(false);
      setError('缺少分享标识');
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getShare(shareId)
      .then((payload) => {
        if (!active) return;
        setSnapshot(payload);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(
          isApiError(failure) && failure.status === 404
            ? '这个分享链接不存在或已被撤销。'
            : errorMessage(failure),
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareId]);

  // 浏览器标签页标题只显示教学内容标题，不显示材料 id。
  useEffect(() => {
    if (snapshot === null) return undefined;
    const previous = document.title;
    document.title = `${snapshot.title} · 万象分享`;
    return () => {
      document.title = previous;
    };
  }, [snapshot]);

  /* ---------------- 区域与页图 ---------------- */

  const regions = useMemo<PageRegion[]>(() => {
    if (snapshot === null) return [];
    const withMaterialId = snapshot.regions.map((raw) => {
      const record = asRecord(raw);
      if (record === null) return raw;
      // 后端公开快照刻意不含 material_id；前端补一个非敏感的占位值，
      // 以便复用 `parsePageRegions`（它把 material_id 作为区域归属的必填字段）。
      return record['material_id'] === undefined
        ? { ...record, material_id: shareId ?? 'shared' }
        : record;
    });
    return parsePageRegions({ regions: withMaterialId });
  }, [snapshot, shareId]);

  const pagesByNo = useMemo<Map<number, SharePageImage>>(() => {
    const map = new Map<number, SharePageImage>();
    if (snapshot === null) return map;
    for (const page of snapshot.pages) {
      if (Number.isFinite(page.page_no) && page.page_no > 0) map.set(page.page_no, page);
    }
    return map;
  }, [snapshot]);

  const pageCount = useMemo(() => {
    let maximum = Math.max(1, Math.floor(snapshot?.page_count ?? 1));
    pagesByNo.forEach((_value, pageNo) => {
      if (pageNo > maximum) maximum = pageNo;
    });
    for (const region of regions) {
      if (region.page > maximum) maximum = region.page;
    }
    return maximum;
  }, [snapshot, pagesByNo, regions]);

  const firstInteractivePage = useMemo(() => {
    const confirmed = regions.find((region) => region.status === 'confirmed');
    return confirmed === undefined ? 1 : confirmed.page;
  }, [regions]);

  const [page, setPage] = useState(1);
  useEffect(() => {
    if (snapshot === null) return;
    const next = Math.min(Math.max(1, firstInteractivePage), pageCount);
    setPage(next);
  }, [snapshot, firstInteractivePage, pageCount]);

  const pageRegions = useMemo(
    () => regions.filter((region) => region.page === page),
    [regions, page],
  );

  const renderedRegions = useMemo<PageRegion[]>(() => {
    return pageRegions.map((region) => {
      const image = pagesByNo.get(region.page);
      if (image === undefined) {
        // 页图不在快照里时，绝不回落到教师侧 fixtures 路径。
        return { ...region, assets: { page_image: '', erased_image: '' } };
      }
      // PageCanvas 会从 region.assets 取擦除底图；把后端公开 URL 注入进来，
      // 避免它回落到 `/fixtures/...`（学生端不应依赖教师侧目录）。
      return {
        ...region,
        assets: {
          page_image: image.image_url ?? '',
          erased_image: image.erased_image_url ?? '',
        },
      };
    });
  }, [pageRegions, pagesByNo]);

  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  useEffect(() => {
    const first = pageRegions.find((region) => region.status === 'confirmed');
    setActiveRegionId(first === undefined ? null : first.region_id);
  }, [page, regions, pageRegions]);

  const activeRegion = useMemo<PageRegion | null>(() => {
    if (activeRegionId === null) return null;
    return renderedRegions.find((region) => region.region_id === activeRegionId) ?? null;
  }, [activeRegionId, renderedRegions]);

  const runtime = useRegionRuntime(activeRegion, reducedMotion);
  const [runtimeTexts, setRuntimeTexts] = useState<Record<string, LinkedTextRuntime[]>>({});
  // 桌面默认展开参数抽屉（学生一进来就能拖参数）；窄屏保持收起，避免遮挡 16:9 页面。
  const [paramOpen, setParamOpen] = useState(false);
  useEffect(() => {
    setParamOpen(!narrow);
  }, [narrow, activeRegionId]);

  const activeParams = useMemo<Record<string, unknown>>(() => {
    if (activeRegion === null) return EMPTY_PARAMS;
    return {
      ...activeRegion.original_params,
      ...(runtime.paramsByRegion[activeRegion.region_id] ?? {}),
    };
  }, [activeRegion, runtime.paramsByRegion]);

  const changed =
    activeRegion !== null &&
    JSON.stringify(activeParams) !== JSON.stringify(activeRegion.original_params);

  const stages = useMemo<Record<string, 0 | 1 | 2>>(() => {
    if (activeRegion === null) return {};
    return { [activeRegion.region_id]: runtime.stage };
  }, [activeRegion, runtime.stage]);

  /* ---------------- iSpec 参数值 ---------------- */

  const specs = useMemo(
    () => (snapshot === null ? [] : parseShareSpecs(snapshot.ispecs)),
    [snapshot],
  );

  const [specValues, setSpecValues] = useState<Record<string, ScalarValue>>({});
  useEffect(() => {
    const next: Record<string, ScalarValue> = {};
    specs.forEach((spec, specIndex) => {
      for (const parameter of spec.parameters) {
        next[`${specIndex}:${parameter.id}`] = parameter.defaultValue;
      }
    });
    setSpecValues(next);
  }, [specs]);

  const handleSpecChange = useCallback(
    (specIndex: number, parameterId: string, value: ScalarValue): void => {
      setSpecValues((previous) => ({ ...previous, [`${specIndex}:${parameterId}`]: value }));
    },
    [],
  );

  /* ---------------- 交互 ---------------- */

  const pageImageUrl = useMemo(() => {
    const image = pagesByNo.get(page);
    return image?.image_url ?? placeholderPage(snapshot?.title ?? '万象分享');
  }, [page, pagesByNo, snapshot]);

  const handleLinkedTexts = useCallback(
    (regionId: string, texts: LinkedTextRuntime[]): void => {
      setRuntimeTexts((previous) => ({ ...previous, [regionId]: texts }));
    },
    [],
  );

  const handleCopy = useCallback((): void => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    if (url.length === 0) return;
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      setCopied(false);
      return;
    }
    void clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }, []);

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href;

  /* ---------------- 渲染 ---------------- */

  if (loading) {
    return (
      <main className={styles.statePage} role="status" aria-live="polite">
        正在打开分享…
      </main>
    );
  }

  if (error !== null || snapshot === null) {
    return (
      <main className={styles.statePage} role="alert">
        <h1 className={styles.stateTitle}>分享打不开</h1>
        <p className={styles.stateHint}>{error ?? '分享数据暂时不可用，请稍后重试。'}</p>
        <p className={styles.stateHint}>如果你是从老师那里拿到的链接，请确认链接完整后重新打开。</p>
      </main>
    );
  }

  const hasRegions = pageRegions.length > 0;
  const pageInteractive = pageRegions.some((region) => region.status === 'confirmed');

  return (
    <main className={styles.root} data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <header className={styles.topbar}>
        <div className={styles.heading}>
          <p className={styles.brand}>
            <img src={markUrl} alt="" width={18} height={18} />
            万象 · 只读分享
          </p>
          <h1 className={styles.title}>{snapshot.title}</h1>
          <p className={styles.subtitle}>
            第 {page} / {pageCount} 页 · {pageInteractive ? '可交互' : '仅阅读'}
          </p>
        </div>
        <div className={styles.topActions}>
          <label className={styles.pagePicker}>
            <span>页面</span>
            <select
              value={String(page)}
              aria-label="选择页面"
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(next)) setPage(Math.min(Math.max(1, next), pageCount));
              }}
            >
              {Array.from({ length: pageCount }, (_, index) => {
                const pageNo = index + 1;
                return (
                  <option key={pageNo} value={String(pageNo)}>
                    第 {pageNo} 页
                  </option>
                );
              })}
            </select>
          </label>
          <button type="button" className={styles.copyButton} onClick={handleCopy}>
            复制链接
          </button>
          {copied ? (
            <span className={styles.copyHint} role="status">
              已复制
            </span>
          ) : null}
          <input
            className={styles.copyField}
            readOnly
            value={shareUrl}
            aria-label="分享链接"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.stage} aria-label="页面内容">
          <div className={styles.pageFrame} data-interactive={hasRegions ? 'true' : 'false'}>
            {hasRegions ? (
              <PageCanvas
                page={page}
                pageImage={pageImageUrl}
                regions={renderedRegions}
                activeRegion={activeRegion}
                paramsByRegion={runtime.paramsByRegion}
                stages={stages}
                runtimeTexts={runtimeTexts}
                reducedMotion={reducedMotion}
                onActivate={setActiveRegionId}
                onDeactivate={() => setActiveRegionId(null)}
                onChangeParams={runtime.setParamsFor}
                onLinkedTexts={handleLinkedTexts}
              />
            ) : (
              <img
                className={styles.staticPage}
                data-testid="share-page-image"
                src={pageImageUrl}
                alt={`第 ${page} 页（只读）`}
                draggable={false}
              />
            )}
          </div>

          <div className={styles.stageBar}>
            <nav className={styles.pageNav} aria-label="翻页">
              <button
                type="button"
                className={styles.navButton}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                上一页
              </button>
              <span className={styles.pageIndicator}>
                第 {page} / {pageCount} 页
              </span>
              <button
                type="button"
                className={styles.navButton}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page >= pageCount}
              >
                下一页
              </button>
            </nav>

            {activeRegion !== null && (
              <PlayBar
                stage={runtime.stage}
                playing={runtime.playing}
                changed={changed}
                reducedMotion={reducedMotion}
                onPlay={runtime.play}
                onPause={runtime.pause}
                onStep={runtime.step}
                onReset={() => runtime.resetRegion(activeRegion)}
                onRestore={() => {
                  runtime.resetRegion(activeRegion);
                  setActiveRegionId(null);
                }}
              />
            )}

            {!hasRegions && (
              <p className={styles.stageHint} role="status">
                本页按原文阅读，没有可交互图示；参数与视图在
                {narrow ? '下方抽屉' : '右侧面板'}中。
              </p>
            )}
          </div>

          {activeRegion !== null && (
            <ParamDrawer
              region={activeRegion}
              params={activeParams}
              errors={{}}
              open={paramOpen}
              onToggle={() => setParamOpen((previous) => !previous)}
              onChange={(patch) => runtime.setParamsFor(activeRegion.region_id, patch)}
              onReset={() => runtime.resetRegion(activeRegion)}
            />
          )}
        </section>

        <ShareSpecPanel
          specs={specs}
          values={specValues}
          pageImage={pageImageUrl}
          narrow={narrow}
          onChange={handleSpecChange}
        />
      </div>

      <footer className={styles.footer}>由万象发布 · 只读</footer>
    </main>
  );
}

export default SharePage;
