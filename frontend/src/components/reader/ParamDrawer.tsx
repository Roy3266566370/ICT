/**
 * ParamDrawer.tsx —— 选中图示后才出现的参数抽屉（rebuild-spec §6）。
 *
 * 默认收起为 42px 竖排把手，选中区域后展开；不占用页面宽度（浮层），
 * 因此不会把以页为中心的阅读区压小。只展示少量关键可调参数，
 * 非数值参数（如三条向量）由画面上的拖拽点直接编辑，不伪造假控件。
 */
import type { ReactElement } from 'react';
import type { Parameter } from '@/api/types';
import { ParamControl } from '@/components/ui';
import type { PageRegion } from '@/regions/types';
import { isRegionChanged } from './regionData';
import styles from './ParamDrawer.module.css';

export interface ParamDrawerProps {
  region: PageRegion;
  params: Record<string, unknown>;
  errors: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Record<string, unknown>) => void;
  onReset: () => void;
}

export interface EditableScalar {
  key: string;
  value: number;
  parameter: Parameter;
}

const DEFAULT_RANGE = { min: -3, max: 3, step: 0.1 } as const;

/** 从区域参数中提炼可编辑的标量（数组/对象由图形上的专用交互编辑）。 */
export function deriveEditableScalars(params: Record<string, unknown>): EditableScalar[] {
  const keys = Object.keys(params).filter((key) => typeof params[key] === 'number');
  return keys.flatMap((key) => {
    const value = params[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    return [
      {
        key,
        value,
        parameter: {
          id: key,
          name: key,
          type: 'decimal',
          value,
          unit: '1',
          range: { min: DEFAULT_RANGE.min, max: DEFAULT_RANGE.max, step: DEFAULT_RANGE.step },
          source_ref_ids: [],
          provenance: 'inferred',
          editable: true,
        },
      },
    ];
  });
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

function describeSpectrum(params: Record<string, unknown>): string | null {
  const { a11, a12, a21, a22 } = params;
  if (
    typeof a11 !== 'number' ||
    typeof a12 !== 'number' ||
    typeof a21 !== 'number' ||
    typeof a22 !== 'number'
  ) {
    return null;
  }
  const det = a11 * a22 - a12 * a21;
  const trace = a11 + a22;
  const disc = trace * trace - 4 * det;
  if (disc < 0) return `det A = ${formatNumber(det)} · tr A = ${formatNumber(trace)} · 特征值为复数（旋转型）`;
  const root = Math.sqrt(disc);
  const first = (trace + root) / 2;
  const second = (trace - root) / 2;
  return `det A = ${formatNumber(det)} · tr A = ${formatNumber(trace)} · 特征值 ${formatNumber(first)} / ${formatNumber(second)}`;
}

export function ParamDrawer(props: ParamDrawerProps): ReactElement {
  const { region, params, errors, open, onToggle, onChange, onReset } = props;
  const scalars = deriveEditableScalars(params);
  const spectrum = describeSpectrum(params);
  const changed = isRegionChanged(region, params);

  return (
    <>
      {open ? <div className={styles.backdrop} aria-hidden="true" onClick={onToggle} /> : null}
      <aside className={styles.drawer} data-open={open ? 'true' : 'false'} aria-label="图示参数">
        <button
          type="button"
          className={styles.handle}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="reader-param-body"
          aria-label={open ? '收起参数抽屉' : '展开参数抽屉'}
        >
          <span aria-hidden="true">参数</span>
        </button>

        <div className={styles.body} id="reader-param-body" hidden={!open}>
          <header className={styles.header}>
            <h2 className={styles.title}>本页图示参数</h2>
            <button type="button" className={styles.close} onClick={onToggle} aria-label="收起参数抽屉">
              ×
            </button>
          </header>

          {scalars.length === 0 ? (
            <p className={styles.empty}>该图示的参数在画面上的拖拽点直接编辑，右侧抽屉没有额外滑杆。</p>
          ) : (
            <div className={styles.controls}>
              {scalars.map((scalar) => (
                <ParamControl
                  key={scalar.key}
                  parameter={scalar.parameter}
                  value={scalar.value}
                  error={errors[scalar.key] ?? null}
                  disabled={false}
                  onChange={(value) => onChange({ [scalar.key]: value })}
                />
              ))}
            </div>
          )}

          <div className={styles.footer}>
            <p className={styles.stat} aria-live="polite">
              {spectrum ?? '调整参数后，图形与原位文字同步更新。'}
            </p>
            <button type="button" className={styles.reset} onClick={onReset} disabled={!changed}>
              恢复本区域原值
            </button>
          </div>

          <p className={styles.note}>改动会保留在本区域参数里，切换页面或对象不会清空。</p>
        </div>
      </aside>
    </>
  );
}