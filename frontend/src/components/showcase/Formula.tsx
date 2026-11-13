import { useMemo } from 'react';
import katex from 'katex';

interface FormulaProps {
  tex: string;
  block?: boolean;
  className?: string;
  label?: string;
}

/** 只用静态 TeX 字符串渲染公式；不接受用户文本，避免注入。 */
export function Formula({ tex, block = false, className, label }: FormulaProps): JSX.Element {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
      }),
    [tex, block],
  );
  return (
    <span
      className={className}
      role={label ? 'math' : undefined}
      aria-label={label}
      style={block ? { display: 'block', maxWidth: '100%', overflowX: 'auto' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default Formula;
