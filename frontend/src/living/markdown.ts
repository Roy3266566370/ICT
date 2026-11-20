function balancedMath(text: string): boolean {
  const prose = text.replace(/(`+)([\s\S]*?)\1(?!`)/g, '');
  let delimiter = 0;
  for (let i = 0; i < prose.length; i++) {
    if (prose[i] === '\\') { i++; continue; }
    if (prose[i] !== '$') continue;
    let count = 1;
    while (prose[i + count] === '$') count++;
    if (count > 2 || (delimiter && count !== delimiter)) return false;
    delimiter = delimiter ? 0 : count;
    i += count - 1;
  }
  return delimiter === 0;
}

export function prepareLivingMarkdown(markdown: string): string {
  const result: string[] = [];
  let paragraph: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flush = () => {
    const text = paragraph.join('\n');
    // OCR 中未闭合的公式不能借用后续段落的美元符号闭合。
    result.push(balancedMath(text) ? text : text.replace(/([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '\\$1').replace(/\n/g, '  \n'));
    paragraph = [];
  };
  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = match?.[1];
    if (fence) {
      result.push(line);
      if (marker && marker.charAt(0) === fence.marker && marker.length >= fence.length && !match?.[2]?.trim()) fence = null;
    } else if (marker) {
      if (paragraph.length) flush();
      fence = { marker: marker.charAt(0), length: marker.length };
      result.push(line);
    } else if (!line.trim()) {
      if (paragraph.length) flush();
      result.push(line);
    } else paragraph.push(line);
  }
  if (paragraph.length) flush();
  return result.join('\n');
}
