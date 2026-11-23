import { useMemo } from 'react';
import katex from 'katex';

export function Formula({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, {
    displayMode: block,
    output: 'htmlAndMathml',
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  }), [tex, block]);

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
