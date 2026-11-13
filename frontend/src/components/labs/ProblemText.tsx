import { useMemo, type ReactNode } from 'react';
import { Formula } from '@/components/showcase/Formula';
import { segmentProblemText } from '@/labs/mathText';
import { integralTitleFormula } from '@/labs/problemTitle';
import type { LabProblem } from '@/labs/types';

interface MathTextProps {
  text: string;
}

/**
 * 行内文本的公式排版：能确认的公式片段用 KaTeX 渲染，其余文字逐字保留。
 * 适合放进 `<h1>`、`<h3>`、`<p>` 等任意行内容器。
 */
export function MathText({ text }: MathTextProps): ReactNode {
  const parts = useMemo(() => segmentProblemText(text), [text]);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'math' ? (
          <Formula key={`math-${index}`} tex={part.tex} />
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
  return formula ? <>{formula.prefix}<Formula tex={formula.tex} /></> : <MathText text={problem.title} />;
}

interface Props {
  text: string;
  className?: string;
}

/**
 * 题目原文展示：能确认的公式片段用 KaTeX 排版，其余文字逐字保留。
 *
 * 只改变显示，不改变 `problem.text`；转换失败的片段（常见于 OCR 残缺公式）
 * 会原样显示，不会把原题改写成另一道题。
 */
export function ProblemText({ text, className }: Props): ReactNode {
  return (
    <p className={className}>
      <MathText text={text} />
    </p>
  );
}

export default ProblemText;
