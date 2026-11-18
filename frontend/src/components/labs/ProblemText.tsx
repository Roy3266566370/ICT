import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { segmentProblemText, validLatex } from '@/labs/mathText';
import { integralTitleFormula, readableProblemTitle } from '@/labs/problemTitle';
import type { LabProblem } from '@/labs/types';

interface MathTextProps {
  text: string;
}

function FormulaNotice({ source }: { source: string }): ReactNode {
  return <span role="status" title={source}>（公式未完整识别，请核对原题）</span>;
}

export function LabFormula({ tex, ...props }: ComponentProps<typeof Formula>): ReactNode {
  const block = props.block ?? /^\s*(?:\$\$|\\\[)/.test(tex);
  const latex = useMemo(() => validLatex(tex, block), [tex, block]);
  if (!tex.trim()) return null;
  return latex === null ? <FormulaNotice source={tex} /> : <Formula tex={latex} {...props} block={block} />;
}

/**
 * 行内文本的公式排版；无法解析的 TeX 显示核对提示，原文保留在提示中。
 * 适合放进 `<h1>`、`<h3>`、`<p>` 等任意行内容器。
 */
export function MathText({ text }: MathTextProps): ReactNode {
  const parts = useMemo(() => segmentProblemText(text), [text]);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'math' ? (
          <LabFormula key={`math-${index}`} tex={part.tex} block={part.block} />
        ) : /\\[A-Za-z([]|\$(?=\\|[A-Za-z_{])/.test(part.value) ? (
          <FormulaNotice key={`review-${index}`} source={part.value} />
        ) : (
          <span key={`text-${index}`}>{part.value}</span>
        ),
      )}
    </>
  );
}

/** Heading display can use a matching recognized formula when OCR lost ∫. */
export function ProblemTitle({problem}:{problem:LabProblem}): ReactNode {
  const formula=useMemo(()=>integralTitleFormula(problem),[problem]);
  return formula ? <>{formula.prefix}<LabFormula tex={formula.tex} /></> : <MathText text={readableProblemTitle(problem)} />;
}

interface Props {
  text: string;
  className?: string;
}

/**
 * 题目原文展示：能确认的公式片段用 KaTeX 排版，其余文字逐字保留。
 *
 * 只改变显示，不改变 `problem.text`；残缺公式提示核对，不推测缺失符号。
 */
export function ProblemText({ text, className }: Props): ReactNode {
  return (
    <p className={className}>
      <MathText text={text} />
    </p>
  );
}

export default ProblemText;
