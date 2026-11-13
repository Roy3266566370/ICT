/**
 * TextSpecView.tsx —— text 视图：把 `template` 里的 `{{id}}` 替换成当前值。
 *
 * 文档硬要求：**参数未偏离默认值时不要覆盖原页文字**。
 * 这里只负责渲染「模板文本 + changed 标记」，是否覆盖原页由宿主根据
 * `changed`（等价于 `isOffDefault(spec, values)`）决定。
 */
import { memo, type ReactElement } from 'react';
import type { SpecEvaluation, TextView } from '../../../ispec/types';
import { renderTemplate, type SpecCell } from '../../../ispec/format';
import styles from './TextSpecView.module.css';
import katex from 'katex';

export interface TextSpecViewProps {
  view: TextView;
  evaluation: SpecEvaluation;
  changed: boolean;
}

export const TextSpecView = memo(function TextSpecView(props: TextSpecViewProps): ReactElement {
  const { view, evaluation, changed } = props;
  const scope: Record<string, SpecCell> = { ...evaluation.values, ...evaluation.derived };
  const rendered = renderTemplate(view.template, scope);

  return (
    <div
      className={styles.root}
      data-text-view
      data-changed={changed ? 'true' : 'false'}
      data-missing={rendered.missing.length > 0 ? rendered.missing.join(',') : undefined}
    >
      {view.title === undefined ? null : <p className={styles.title}>{view.title}</p>}
      {view.title === '原始公式' ? <div className={styles.text} data-linked-text
        dangerouslySetInnerHTML={{__html: katex.renderToString(rendered.text.replace(/\*\*/g, '^').replace(/\*/g, '\\cdot '),
          {throwOnError: false, trust: false, strict: 'ignore', displayMode: true})}}/> :
        <p className={styles.text} data-linked-text>{rendered.text}</p>}
      {changed ? (
        <span className={styles.badge} data-current-badge>
          当前值
        </span>
      ) : null}
      {rendered.missing.length > 0 ? (
        <p className={styles.note} data-missing-fields>
          模板中的 {rendered.missing.map((id) => `{{${id}}}`).join('、')} 在参数与派生量里都不存在，已显示「—」。
        </p>
      ) : null}
    </div>
  );
});

export default TextSpecView;
