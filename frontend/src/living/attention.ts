/** 教学示例：三个二维 key/value，计算单个 query 的缩放点积注意力。 */
export function attention(query: number, temperature: number, causal: boolean) {
  const keys: [number, number][] = [[1, 0], [0, 1], [1, 1]];
  const values: [number, number][] = [[1, 0], [0, 1], [1, 1]];
  const scores = keys.map(([x, y]) => (query * x + y) / Math.sqrt(2) / temperature);
  const visible = scores.map((_, i) => !causal || i <= 1);
  const max = Math.max(...scores.filter((_, i) => visible[i]));
  const exp = scores.map((s, i) => visible[i] ? Math.exp(s - max) : 0);
  const sum = exp.reduce((a, b) => a + b, 0);
  const weights = exp.map((e) => e / sum);
  const output = [0, 1].map((axis) => weights.reduce((s, w, i) => s + w * values[i]![axis]!, 0));
  return { scores, weights, output };
}
