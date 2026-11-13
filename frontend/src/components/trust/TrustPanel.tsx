import { useEffect, useMemo, useState } from 'react';
import type { ISpec, TrustParameter, TrustReport } from '@/ispec/types';
import { confirmISpecParameter } from '@/api/trust';
import { TrustBadge, TrustDot } from './TrustBadge';
import styles from './TrustPanel.module.css';

interface Props {
  spec: ISpec;
  materialId?: string;
  pageNo: number;
  pageTitle?: string;
  imageUrl?: string;
  pageWidth?: number;
  pageHeight?: number;
  onClose: () => void;
  onUpdated?: (trust: TrustReport, parameterId: string) => void;
}

const DEFAULT_PAGE_WIDTH = 12192000;
const DEFAULT_PAGE_HEIGHT = 6858000;

function statusLabel(parameter: TrustParameter): string {
  return parameter.status_label;
}

function anchorText(parameter: TrustParameter): string {
  if (!parameter.anchor.excerpt) return '没有原文摘录';
  return parameter.anchor.excerpt;
}

function valueText(value: TrustParameter['value'], unit: string): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  return unit ? `${text} ${unit}` : text;
}

function bboxStyle(
  parameter: TrustParameter,
  pageWidth: number,
  pageHeight: number,
) {
  const bbox = parameter.anchor.bbox;
  if (!bbox) return null;
  const max = Math.max(bbox.x + bbox.w, bbox.y + bbox.h);
  const width = max <= 1.02 ? 1 : pageWidth;
  const height = max <= 1.02 ? 1 : pageHeight;
  return {
    left: `${(100 * bbox.x) / width}%`,
    top: `${(100 * bbox.y) / height}%`,
    width: `${(100 * bbox.w) / width}%`,
    height: `${(100 * bbox.h) / height}%`,
  };
}

function parseEditValue(raw: string, parameter: TrustParameter, spec: ISpec): number | string | boolean | null {
  const declared = spec.parameters.find((item) => item.id === parameter.id);
  if (declared?.type === 'boolean') return raw === 'true';
  if (declared?.type === 'string' || declared?.type === 'enum') {
    if (declared.options && declared.options.length && !declared.options.includes(raw)) return null;
    return raw;
  }
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  if (declared?.min !== undefined && number < declared.min) return null;
  if (declared?.max !== undefined && number > declared.max) return null;
  return declared?.type === 'integer' ? Math.round(number) : number;
}

export function TrustPanel({
  spec,
  materialId,
  pageNo,
  pageTitle,
  imageUrl,
  pageWidth = DEFAULT_PAGE_WIDTH,
  pageHeight = DEFAULT_PAGE_HEIGHT,
  onClose,
  onUpdated,
}: Props) {
  const [trust, setTrust] = useState<TrustReport | undefined>(spec.trust);
  const [activeId, setActiveId] = useState<string>('');
  const [editingId, setEditingId] = useState<string>('');
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setTrust(spec.trust), [spec.trust, spec.object_id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const active = trust?.parameters.find((parameter) => parameter.id === activeId) ?? null;
  const highlights = useMemo(
    () => (trust?.parameters ?? []).map((parameter) => ({ parameter, style: bboxStyle(parameter, pageWidth, pageHeight) })).filter((item) => item.style),
    [trust, pageWidth, pageHeight],
  );

  const updateParameter = async (parameter: TrustParameter, action: 'confirm' | 'edit', value?: number | string | boolean) => {
    if (!materialId) {
      setError('离线或只读快照不能写入确认记录。');
      return;
    }
    setBusy(parameter.id);
    setError('');
    try {
      const result = await confirmISpecParameter(materialId, spec.object_id, parameter.id, {
        action,
        value,
        note: action === 'edit' ? '用户修改并确认' : '用户确认推断参数',
      });
      setTrust(result.trust);
      setEditingId('');
      onUpdated?.(result.trust, parameter.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认失败，请稍后重试。');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="可信溯源面板" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>TRUST · 第 {pageNo} 页</p>
            <h2>{spec.title ?? pageTitle ?? '对象可信度'}</h2>
            <div className={styles.headerMeta}>
              {trust ? <TrustBadge trust={trust} /> : <span className={styles.muted}>尚无 TrustReport</span>}
              <span>{trust?.reason ?? '服务端尚未生成可信报告。'}</span>
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭可信面板">×</button>
        </header>

        <div className={styles.body}>
          <section className={styles.originColumn} aria-label="原页定位">
            <div className={styles.sectionHead}><b>原页定位</b><span>参数锚点在本页的真实位置</span></div>
            <div className={styles.imageWrap} style={{ aspectRatio: `${pageWidth}/${pageHeight}` }}>
              {imageUrl ? <img src={imageUrl} alt={`第 ${pageNo} 页原稿`} /> : <p className={styles.noImage}>原页图片暂不可用</p>}
              {imageUrl ? highlights.map(({ parameter, style }) => (
                <button
                  key={parameter.id}
                  type="button"
                  className={styles.highlight}
                  data-status={parameter.status}
                  data-active={parameter.id === activeId ? 'true' : 'false'}
                  style={style!}
                  onClick={() => setActiveId(parameter.id)}
                  title={`${parameter.label}：${parameter.anchor_verified ? '锚点已核验' : anchorText(parameter)}`}
                >
                  <span>{parameter.label}</span>
                </button>
              )) : null}
            </div>
            <p className={styles.caption}>{pageTitle ?? `第 ${pageNo} 页`} · 黄色为推断/默认值，绿色为原文或已确认。</p>
            {active ? (
              <div className={styles.activeAnchor}>
                <div className={styles.sectionHead}><b>当前参数锚点</b><span>{statusLabel(active)}</span></div>
                <blockquote>{anchorText(active)}</blockquote>
                <p className={active.anchor_verified ? styles.verified : styles.unverified}>
                  {active.anchor_verified ? '✓ 摘录已在本页原文中找到' : active.anchor_checked ? '× 摘录未通过原文核验' : '○ 该页原文不可用，尚不能核验'}
                </p>
              </div>
            ) : null}
          </section>

          <section className={styles.detailColumn} aria-label="参数与校验">
            <div className={styles.sectionHead}>
              <b>参数来源</b>
              <span>{trust?.parameters.length ?? spec.parameters.length} 项 · 推断参数可确认或修改</span>
            </div>
            <div className={styles.parameterList}>
              {(trust?.parameters ?? spec.parameters.map((parameter) => ({
                id: parameter.id,
                label: parameter.label,
                status: parameter.source.status === 'manual_demo' ? 'default' : parameter.source.status,
                status_label: parameter.source.status === 'manual_demo' ? '默认值' : parameter.source.status === 'confirmed' ? '用户确认' : parameter.source.status === 'inferred' ? '推断' : '原文读取',
                value: parameter.default,
                unit: parameter.unit ?? '',
                anchor: { page: parameter.source.page, element_id: parameter.source.element_id, bbox: parameter.source.bbox, excerpt: parameter.source.excerpt },
                anchor_checked: false,
                anchor_verified: false,
                anchor_errors: ['TrustReport 尚未生成'],
                user_checks: parameter.source.user_checks ?? [],
              }))).map((parameter) => (
                <article
                  key={parameter.id}
                  className={styles.parameter}
                  data-status={parameter.status}
                  data-active={parameter.id === activeId ? 'true' : 'false'}
                  onClick={() => setActiveId(parameter.id)}
                >
                  <div className={styles.paramHead}>
                    <span><TrustDot level={parameter.status === 'inferred' || parameter.status === 'default' ? 'yellow' : 'green'} /> <b>{parameter.label}</b></span>
                    <span className={styles.value}>{valueText(parameter.value, parameter.unit)}</span>
                    <span className={styles.paramStatus}>{parameter.status_label}</span>
                  </div>
                  <p className={styles.excerpt}>{anchorText(parameter)}</p>
                  <p className={parameter.anchor_verified ? styles.verified : styles.unverified}>
                    {parameter.anchor_verified ? '✓ 锚点已核验' : parameter.anchor_checked ? '× 锚点未通过' : '○ 锚点未核验'}
                  </p>
                  <div className={styles.paramActions} onClick={(event) => event.stopPropagation()}>
                    {parameter.status === 'inferred' || parameter.status === 'default' ? (
                      <button type="button" className={styles.primary} disabled={!materialId || busy === parameter.id} onClick={() => void updateParameter(parameter, 'confirm')}>
                        {busy === parameter.id ? '写入中…' : '确认'}
                      </button>
                    ) : <span className={styles.confirmed}>{parameter.status === 'confirmed' ? '已确认' : '原文读取'}</span>}
                    {materialId ? (
                      editingId === parameter.id ? (
                        <span className={styles.editRow}>
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                            aria-label={`修改${parameter.label}`}
                          />
                          <button type="button" className={styles.ghost} disabled={busy === parameter.id} onClick={() => {
                            const parsed = parseEditValue(editValue, parameter, spec);
                            if (parsed === null) { setError(`「${parameter.label}」的修改值不合法`); return; }
                            void updateParameter(parameter, 'edit', parsed);
                          }}>保存</button>
                          <button type="button" className={styles.ghost} onClick={() => setEditingId('')}>取消</button>
                        </span>
                      ) : (
                        <button type="button" className={styles.ghost} onClick={() => { setEditingId(parameter.id); setEditValue(String(parameter.value ?? '')); }}>修改</button>
                      )
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.sectionHead}><b>独立校验</b><span>{trust?.validation.profile ?? '无独立实现'}</span></div>
            {trust ? (
              <div className={styles.validation} data-status={trust.validation.status}>
                <p><b>{trust.validation.status === 'pass' ? '通过' : trust.validation.status === 'fail' ? '失败' : '未独立校验'}</b> · {trust.validation.reason}</p>
                {trust.validation.comparisons.length ? (
                  <table>
                    <thead><tr><th>检查</th><th>参考</th><th>内核</th><th>差值</th><th>结果</th></tr></thead>
                    <tbody>{trust.validation.comparisons.map((item) => (
                      <tr key={item.check_id} data-status={item.status}>
                        <td>{item.title}</td><td>{item.expected}</td><td>{item.actual ?? '—'}</td><td>{item.delta === null ? '—' : item.delta.toExponential(2)}</td><td>{item.status}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : null}
              </div>
            ) : <p className={styles.muted}>TrustReport 尚未生成；不会把未校验对象显示为可信。</p>}

            {trust?.declarations.length ? (
              <>
                <div className={styles.sectionHead}><b>原文声明一致性</b><span>参数合法但结论矛盾也会被拦下</span></div>
                <ul className={styles.declarations}>{trust.declarations.map((item) => (
                  <li key={item.id} data-status={item.status}>{item.claim} → {item.status === 'pass' ? '一致' : '矛盾'}（{item.detail}）</li>
                ))}</ul>
              </>
            ) : null}

            <div className={styles.sectionHead}><b>模型信息</b><span>模型自评分只作诊断，不作执行依据</span></div>
            <div className={styles.model}>
              {trust?.model.used ? (
                <p>使用过模型辅助 · 置信度 {trust.model.confidence === null ? '未提供' : trust.model.confidence.toFixed(2)} · {trust.model.provider || '未记录 provider'}</p>
              ) : <p>未记录模型调用。</p>}
              <small>{trust?.model.note ?? '推断参数可能来自规则或模型；以参数来源与独立校验为准。'}</small>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default TrustPanel;
