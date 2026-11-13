import {
  check,
  empty,
  fmt,
  matrixValue,
  metric,
  numberValue,
  seriesFrom,
  type TemplateEvaluation,
  type TemplateValues,
} from './types.ts';

const POINTS = 241;

function activation(name: string, x: number): { value: number | null; derivative: number | null; note: string } {
  if (name === 'sigmoid') {
    const value = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
    return { value, derivative: value * (1 - value), note: '' };
  }
  if (name === 'tanh') {
    const value = Math.tanh(x);
    return { value, derivative: 1 - value * value, note: '' };
  }
  if (name === 'relu') {
    return {
      value: Math.max(0, x),
      derivative: x > 0 ? 1 : 0,
      note: x === 0 ? 'ReLU 在 x=0 处采用导数 0 的约定。' : '',
    };
  }
  return { value: null, derivative: null, note: '未登记的激活函数' };
}

export function evaluateActivation(values: TemplateValues, _provider: Record<string, unknown>): TemplateEvaluation {
  const name = String(values.activation ?? 'relu');
  const x = numberValue(values.x, 0);
  const upstream = numberValue(values.upstream, 1);
  const result = activation(name, x);
  const checks = [check('activation_registered', '激活函数', result.value === null ? 'fail' : 'pass', name)];
  if (name === 'relu') {
    checks.push(check('relu_zero_convention', 'ReLU 零点约定', x !== 0 ? 'pass' : 'warn', result.note || 'x=0 时导数取 0；这是本模板的固定约定。'));
  }
  if (result.value === null) return empty('deep_learning', '未知激活函数', checks);
  const derivative = result.derivative ?? 0;
  const xs = Array.from({ length: POINTS }, (_, index) => -5 + (10 * index) / (POINTS - 1));
  const ys = xs.map((value) => activation(name, value).value);
  checks.push(check('finite', '有限值', Number.isFinite(result.value) ? 'pass' : 'fail', `激活值 ${fmt(result.value)}。`));
  return {
    subject: 'deep_learning',
    kind: 'activation',
    activation: name,
    x,
    value: result.value,
    derivative,
    gradient: upstream * derivative,
    series: seriesFrom(xs, ys),
    metrics: [
      metric('activation_value', '激活值', fmt(result.value)),
      metric('derivative', '局部导数', fmt(derivative)),
      metric('gradient', '反向梯度', fmt(upstream * derivative)),
    ],
    checks,
    trace: [],
  };
}

export function evaluateConvPool(values: TemplateValues, provider: Record<string, unknown>): TemplateEvaluation {
  const mode = String(values.mode ?? 'conv');
  const stride = Math.max(1, Math.round(numberValue(values.stride, 1)));
  const padding = Math.max(0, Math.round(numberValue(values.padding, 0)));
  const matrix = matrixValue(values.matrix);
  const checks = [];
  if (!matrix) {
    checks.push(check('shape_match', '输入矩阵', 'fail', '缺少可解析的输入矩阵。'));
    return empty('deep_learning', '输入矩阵缺失', checks);
  }
  let kernel = matrixValue(values.kernel);
  const window = Array.isArray(provider.window) ? provider.window.map(Number) : null;
  if (!kernel && window && window.length === 2) {
    kernel = Array.from({ length: window[0]! }, () => Array.from({ length: window[1]! }, () => 0));
  }
  if (mode === 'conv' && !kernel) {
    checks.push(check('shape_match', '卷积核', 'fail', '卷积模式缺少卷积核。'));
    return empty('deep_learning', '卷积核缺失', checks);
  }
  if (!kernel) {
    checks.push(check('shape_match', '池化窗口', 'fail', '池化模式缺少窗口形状。'));
    return empty('deep_learning', '池化窗口缺失', checks);
  }
  const height = matrix.length;
  const width = matrix[0]!.length;
  const kernelHeight = kernel.length;
  const kernelWidth = kernel[0]!.length;
  const padded = Array.from({ length: height + 2 * padding }, () => Array.from({ length: width + 2 * padding }, () => 0));
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      padded[row + padding]![column + padding] = matrix[row]![column]!;
    }
  }
  const outHeight = Math.floor((height + 2 * padding - kernelHeight) / stride) + 1;
  const outWidth = Math.floor((width + 2 * padding - kernelWidth) / stride) + 1;
  if (outHeight <= 0 || outWidth <= 0) {
    checks.push(check('shape_match', '输出形状', 'fail', '核大于填充后的输入，无法产生输出。'));
    return empty('deep_learning', '输出形状为空', checks);
  }
  const output: number[][] = [];
  let operations = 0;
  for (let row = 0; row < outHeight; row += 1) {
    const outputRow: number[] = [];
    for (let column = 0; column < outWidth; column += 1) {
      const windowValues: number[] = [];
      for (let i = 0; i < kernelHeight; i += 1) {
        for (let j = 0; j < kernelWidth; j += 1) {
          windowValues.push(padded[row * stride + i]![column * stride + j]!);
        }
      }
      operations += windowValues.length;
      let value: number;
      if (mode === 'conv') {
        value = windowValues.reduce(
          (sum, current, index) => sum + current * kernel![Math.floor(index / kernelWidth)]![index % kernelWidth]!,
          0,
        );
      } else if (mode === 'maxpool') {
        value = Math.max(...windowValues);
      } else {
        value = windowValues.reduce((sum, current) => sum + current, 0) / windowValues.length;
      }
      outputRow.push(Number(value.toPrecision(8)));
    }
    output.push(outputRow);
  }
  checks.push(check('shape_match', '维度匹配', 'pass', `输出 ${outHeight}×${outWidth}。`));
  checks.push(check('stride_positive', '步长/填充', 'pass', `stride=${stride}, padding=${padding}。`));
  checks.push(check('convention', '卷积约定', 'pass', mode === 'conv' ? '采用深度学习互相关约定（不翻转核）。' : '池化按窗口取最大/平均。'));
  return {
    subject: 'deep_learning',
    kind: 'conv_pool',
    mode,
    matrix,
    kernel,
    output,
    output_shape: [outHeight, outWidth],
    series: [],
    stride,
    padding,
    metrics: [
      metric('output_shape', '输出形状', `${outHeight}×${outWidth}`),
      metric('operations', '乘加/比较次数', String(operations)),
      metric('mode', '模式', mode),
    ],
    table: {
      headers: ['对象', '内容'],
      rows: [
        ['输入', JSON.stringify(matrix)],
        ['核/窗口', JSON.stringify(kernel)],
        ['输出', JSON.stringify(output)],
      ],
    },
    checks,
    trace: [],
  };
}
