'use strict';

// Standalone design prototype: sample models run locally; no project API is called.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const format = (value, digits = 2) => (Math.abs(value) < 0.00001 ? 0 : value).toFixed(digits);
const models = {
  derivative: {
    category: '微积分 · 导数的几何意义', formula: 'f(x) = x²', note: '让抽象的关系，变得具体。',
    title: '导数，是怎样「切」出来的？',
    question: '已知函数 f(x) = x²，求它在 x = 1.2 处的导数，并解释导数的几何意义。',
    description: '先求导，再移动观察点。把一个变化率，和眼前这条切线联系起来。',
    min: -1.8, max: 1.8, step: 0.01, initial: 1.2, label: '移动观察点 x', hint: '拖动滑杆，看看切线如何变化',
    curve: '函数曲线', tangent: '此刻的切线',
    value: value => format(value), result: value => `f′(x) = ${format(2 * value)}`,
    plotLabel: value => `函数 y=x²，在 x=${format(value)} 处的切线斜率为 ${format(2 * value)}`,
    steps: [
      ['从定义出发', '当 h 趋近于 0，割线的斜率趋近于切线的斜率。', 'f′(x) = lim (f(x+h) − f(x)) / h'],
      ['展开并化简', '将 f(x) = x² 代入，差商为 2x + h。让 h 趋近于 0。', 'f′(x) = 2x'],
      ['回到题目', '在 x = 1.2 处，导数为 2.4。图中的切线，就以这个变化率经过观察点。', 'f′(1.2) = 2.4']
    ], tip: '试试把 x 拖到 0。切线变平了，这时导数是多少？'
  },
  integral: {
    category: '微积分 · 黎曼和与定积分', formula: '∫₀¹ x² dx', note: '把一整片面积，拆成一小块。',
    title: '一块面积，怎样一点点相加？',
    question: '求定积分 ∫₀¹ x² dx，并用右端点黎曼和解释它的几何意义。',
    description: '用长方形近似曲线下的面积。分得越细，近似值越靠近真正的定积分。',
    min: 2, max: 60, step: 1, initial: 8, label: '改变分割数量 n', hint: '分得更细，近似会更接近吗？',
    curve: '函数曲线', tangent: '右端点矩形',
    value: value => `${value} 份`, result: value => `S${value} = ${format(riemannSum(value), 4)}`,
    plotLabel: value => `y=x² 在 0 到 1 区间的右端点黎曼和，${value} 个矩形，面积近似 ${format(riemannSum(value), 4)}`,
    steps: [
      ['把区间等分', '把 [0, 1] 分成 n 份，每一份的宽度为 1/n。取每段的右端点作为矩形高度。', 'Δx = 1/n，xᵢ = i/n'],
      ['把矩形的面积加起来', '右端点矩形高于这条递增曲线，因此当前近似面积大于实际积分。', 'Sₙ = Σ (i/n)² · (1/n)'],
      ['让分割数量趋向无穷', '利用平方和公式，Sₙ = (n+1)(2n+1)/(6n²)，极限为 1/3。', '∫₀¹ x² dx = [x³/3]₀¹ = 1/3']
    ], tip: '观察近似值与 0.3333… 的距离。有限个长方形提供数值直觉，极限给出精确结果。'
  },
  matrix: {
    category: '线性代数 · 平面的剪切变换', formula: 'A = [1 k; 0 1]', note: '形状在变，什么没有变？',
    title: '一个矩阵，能把平面怎样？',
    question: '设 A = [[1, k], [0, 1]]，求单位正方形经 A 变换后的形状与面积。',
    description: '让矩阵作用在每一个顶点上。改变 k，看看平面被怎样推了一把。',
    min: -1.5, max: 1.5, step: 0.01, initial: 0.7, label: '改变剪切系数 k', hint: '形状改变了，面积会改变吗？',
    curve: '原始正方形', tangent: '变换后图形',
    value: value => format(value), result: () => 'det(A) = 1.00',
    plotLabel: value => `单位正方形经过剪切系数 k=${format(value)} 的矩阵变换，成为面积为 1 的平行四边形`,
    steps: [
      ['写出变换关系', '每一个点的横坐标增加 k 倍的纵坐标，纵坐标保持不变。', '(x, y) → (x + ky, y)'],
      ['变换四个顶点', '四个顶点依次成为 (0,0)、(1,0)、(1+k,1)、(k,1)，形成平行四边形。', 'A · (0, 1)ᵀ = (k, 1)ᵀ'],
      ['观察面积', '底边为 1，高为 1，面积始终为 1；这也等于原面积乘以行列式的绝对值。', 'det(A) = 1×1 − k×0 = 1']
    ], tip: '把 k 拖到负数，图形会向另一侧倾斜。面积仍然是 1，这就是这类剪切变换的不变量。'
  }
};

function riemannSum(n) {
  return (n + 1) * (2 * n + 1) / (6 * n * n);
}

function grid(prefix, xStart = 55, xEnd = 520, yTop = 23, yBottom = 270, unit = 44) {
  return `<defs><pattern id="${prefix}-grid" width="${unit}" height="${unit}" patternUnits="userSpaceOnUse"><path d="M ${unit} 0 L 0 0 0 ${unit}" fill="none" stroke="#dce3d0" stroke-width=".8"/></pattern></defs><rect x="${xStart}" y="${yTop}" width="${xEnd - xStart}" height="${yBottom - yTop}" fill="url(#${prefix}-grid)"/>`;
}

function plotSVG(type, value, prefix) {
  let content = '';
  if (type === 'derivative') {
    const ox = 269, oy = 261, sx = 99, sy = 49;
    const point = (x, y) => `${format(ox + x * sx)},${format(oy - y * sy)}`;
    const curve = Array.from({ length: 89 }, (_, i) => {
      const x = -2.2 + i * 0.05;
      return `${i ? 'L' : 'M'}${point(x, x * x)}`;
    }).join(' ');
    const px = ox + value * sx, py = oy - value * value * sy;
    const slope = 2 * value;
    const tangent = x => value * value + slope * (x - value);
    const textX = value > 0.6 ? px - 128 : px + 16;
    const labelY = Math.max(37, py - 30);
    content = `${grid(prefix)}<path d="M49 261H528m-259 14V15" stroke="#8f9f80" stroke-width="1"/><path d="m524 257 5 4-5 4m-259-245 4-5 4 5" stroke="#8f9f80" fill="none"/><text x="529" y="281">x</text><text x="280" y="22">y</text><text x="254" y="282">0</text><text x="364" y="282">1</text><text x="465" y="282">2</text><text x="61" y="282">−2</text><text x="157" y="282">−1</text><text x="250" y="168">2</text><text x="250" y="70">4</text><path d="${curve}" fill="none" stroke="#668154" stroke-width="2.5"/><path d="M${point(value, 0)}L${point(value, value * value)}L${point(0, value * value)}" stroke="#a2ac91" stroke-width="1" stroke-dasharray="4 5" fill="none"/><defs><clipPath id="${prefix}-clip"><rect x="49" y="13" width="480" height="259"/></clipPath></defs><path d="M${point(-2.3, tangent(-2.3))}L${point(2.6, tangent(2.6))}" stroke="#ad503a" stroke-width="1.8" clip-path="url(#${prefix}-clip)"/><circle cx="${px}" cy="${py}" r="11" fill="#ac4a3612"/><circle cx="${px}" cy="${py}" r="5" fill="#ac4a36" stroke="#fcfcf6" stroke-width="2"/><text x="${textX}" y="${labelY}" style="fill:#a04f39;font-size:13px">P (${format(value, 1)}, ${format(value * value)})</text><text x="102" y="93" style="fill:#668154;font-family:Georgia,serif;font-size:21px;font-style:italic">y = x²</text>`;
  } else if (type === 'integral') {
    const ox = 95, oy = 265, sx = 360, sy = 213;
    const p = (x, y) => `${ox + x * sx},${oy - y * sy}`;
    let rectangles = '';
    for (let i = 1; i <= value; i++) {
      const y = (i / value) ** 2;
      rectangles += `<rect x="${ox + (i - 1) / value * sx}" y="${oy - y * sy}" width="${sx / value}" height="${y * sy}" fill="#b9674330" stroke="#ad6445" stroke-width=".75"/>`;
    }
    const curve = Array.from({ length: 51 }, (_, i) => `${i ? 'L' : 'M'}${p(i / 50, (i / 50) ** 2)}`).join(' ');
    content = `${grid(prefix)}${rectangles}<path d="M65 265H510M95 280V25" stroke="#8f9f80"/><path d="${curve}" fill="none" stroke="#668154" stroke-width="2.5"/><text x="83" y="287">0</text><text x="452" y="287">1</text><text x="510" y="281">x</text><text x="77" y="33">y</text><text x="170" y="80" style="fill:#668154;font-family:Georgia,serif;font-size:22px;font-style:italic">y = x²</text><text x="170" y="108" style="fill:#9c694b;font-size:12px">n = ${value}</text>`;
  } else {
    const ox = 218, oy = 247, unit = 116;
    const p = (x, y) => `${ox + x * unit},${oy - y * unit}`;
    const polygon = [p(0, 0), p(1, 0), p(1 + value, 1), p(value, 1)].join(' ');
    content = `${grid(prefix, 28, 538, 23, 270, 29)}<path d="M28 247H539M218 275V22" stroke="#8f9f80"/><polygon points="${p(0, 0)} ${p(1, 0)} ${p(1, 1)} ${p(0, 1)}" fill="#6681540c" stroke="#75905e" stroke-width="1.5" stroke-dasharray="5 5"/><polygon points="${polygon}" fill="#b9674321" stroke="#a7543b" stroke-width="2"/><path d="M${p(0, 0)}L${p(1 + value, 1)}" stroke="#a7543b" stroke-width="1" stroke-dasharray="3 4"/><circle cx="${ox + value * unit}" cy="${oy - unit}" r="4" fill="#ac4a36"/><circle cx="${ox + (1 + value) * unit}" cy="${oy - unit}" r="4" fill="#ac4a36"/><text x="204" y="269">0</text><text x="328" y="269">1</text><text x="201" y="135">1</text><text x="533" y="270">x</text><text x="229" y="30">y</text><text x="${ox + value * unit + 10}" y="111" style="fill:#a04f39;font-size:13px">(${format(value, 1)}, 1)</text><text x="355" y="54" style="fill:#668154;font-family:Georgia,serif;font-size:20px;font-style:italic">S = 1</text>`;
  }
  return `<svg viewBox="0 0 560 310" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${content}</svg>`;
}

let currentModel = 'derivative';
const heroSlider = $('#hero-slider');

function renderHero() {
  const model = models[currentModel];
  const value = Number(heroSlider.value);
  $('#hero-plot').innerHTML = plotSVG(currentModel, value, 'hero');
  $('#hero-plot').setAttribute('aria-label', model.plotLabel(value));
  $('#hero-value').textContent = model.value(value);
  $('#hero-result').textContent = model.result(value);
  heroSlider.setAttribute('aria-valuetext', `${model.label} ${model.value(value)}，${model.result(value)}`);
}

function selectModel(type) {
  if (!models[type]) return;
  currentModel = type;
  const model = models[type];
  $('#experiment-category').textContent = model.category;
  $('#experiment-formula').textContent = model.formula;
  $('#experiment-note').textContent = model.note;
  $('#hero-slider-label').textContent = model.label;
  $('#hero-slider-hint').textContent = model.hint;
  heroSlider.min = model.min;
  heroSlider.max = model.max;
  heroSlider.step = model.step;
  heroSlider.value = model.initial;
  $('#hero-min').textContent = model.min;
  $('#hero-max').textContent = model.max;
  $('#hero-legend').children[0].lastChild.textContent = model.curve;
  $('#hero-legend').children[1].lastChild.textContent = model.tangent;
  $$('[data-model]').forEach(button => {
    const selected = button.dataset.model === type;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  });
  renderHero();
}

heroSlider.addEventListener('input', renderHero);
$$('[data-model]').forEach(button => button.addEventListener('click', () => selectModel(button.dataset.model)));
$$('[data-fill]').forEach(button => button.addEventListener('click', () => {
  const type = button.dataset.fill;
  $('#question').value = models[type].question;
  $('#question-error').hidden = true;
  selectModel(type);
  $('#question').focus({ preventScroll: true });
}));

for (const type of Object.keys(models)) {
  $(`#art-${type}`).innerHTML = plotSVG(type, models[type].initial, `card-${type}`);
}

const dialog = $('#experiment-dialog');
let dialogTrigger = null;
function showDialog() {
  if (!dialog.open) {
    dialogTrigger = document.activeElement;
    dialog.showModal();
  }
}

function openExperiment(type) {
  const model = models[type];
  $('#dialog-content').innerHTML = `<div class="dialog-intro"><p class="eyebrow">${model.category} / 本地交互示例</p><h2 id="dialog-title">${model.title}</h2><p>${model.description}</p></div><div class="modal-experiment"><div class="modal-board"><div id="modal-plot" class="modal-plot" role="img"></div><div class="modal-result" id="modal-result"></div><div class="modal-slider-label"><label for="modal-slider">${model.label}</label><output id="modal-value" for="modal-slider"></output></div><input id="modal-slider" type="range" min="${model.min}" max="${model.max}" step="${model.step}" value="${model.initial}"><div class="range-labels"><span>${model.min}</span><span>${model.hint}</span><span>${model.max}</span></div></div><div><ol class="solution-steps">${model.steps.map(([title, text, formula]) => `<li><strong>${title}</strong>${text}<span class="solution-formula">${formula}</span></li>`).join('')}</ol><p class="modal-tip">${model.tip}</p></div></div>`;
  const slider = $('#modal-slider');
  function update() {
    const value = Number(slider.value);
    $('#modal-plot').innerHTML = plotSVG(type, value, 'modal');
    $('#modal-plot').setAttribute('aria-label', model.plotLabel(value));
    $('#modal-result').textContent = model.result(value);
    $('#modal-value').textContent = model.value(value);
    slider.setAttribute('aria-valuetext', `${model.label} ${model.value(value)}，${model.result(value)}`);
  }
  slider.addEventListener('input', update);
  update();
  showDialog();
}
$$('[data-open]').forEach(button => button.addEventListener('click', () => openExperiment(button.dataset.open)));
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
dialog.addEventListener('close', () => {
  if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
});

const fileInput = $('#file-input');
$('#attach-button').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const allowed = /\.(pdf|png|jpe?g|webp|pptx|txt|md|csv)$/i;
  if (!allowed.test(file.name) || file.size > 25 * 1024 * 1024) {
    fileInput.value = '';
    $('#attachment').hidden = true;
    $('#question-error').textContent = '请选择 25 MB 以内的图片、PDF、PPTX 或文本文件。';
    $('#question-error').hidden = false;
    return;
  }
  $('#filename').textContent = file.name;
  $('#attachment').hidden = false;
  $('#question-error').hidden = true;
  showToast('已添加附件。此设计预览仅在本地展示文件名，不上传文件。');
});
$('#remove-file').addEventListener('click', () => {
  fileInput.value = '';
  $('#attachment').hidden = true;
  $('#attach-button').focus();
});

$('#question-form').addEventListener('submit', event => {
  event.preventDefault();
  const question = $('#question').value.trim();
  if (!question && !fileInput.files.length) {
    $('#question-error').textContent = '先写下一道题，或选择一份题目文件。也可以从下面的示例开始。';
    $('#question-error').hidden = false;
    $('#question').setAttribute('aria-invalid', 'true');
    $('#question').focus();
    return;
  }
  $('#question-error').hidden = true;
  $('#question').removeAttribute('aria-invalid');
  const matchingExample = Object.keys(models).find(type => question === models[type].question);
  if (matchingExample && !fileInput.files.length) {
    openExperiment(matchingExample);
    return;
  }
  $('#dialog-content').innerHTML = '<div class="dialog-intro"><p class="eyebrow">从你的题目开始</p><h2 id="dialog-title">问题，已经有了一个起点。</h2><p id="submitted-question"></p></div><div class="preview-notice">这是一个独立的首页设计预览，尚未连接题目识别与解答服务。你的题目和附件不会被上传。你可以先打开下面的交互示例，体验「解答 + 建模」的呈现方式。</div><div class="modal-example-actions"><button type="button" data-preview="derivative">导数与切线 ↗</button><button type="button" data-preview="integral">黎曼和与面积 ↗</button><button type="button" data-preview="matrix">矩阵与剪切 ↗</button></div>';
  $('#submitted-question').textContent = question || `已选择附件：${fileInput.files[0].name}`;
  $$('[data-preview]', dialog).forEach(button => button.addEventListener('click', () => openExperiment(button.dataset.preview)));
  showDialog();
});
$('#question').addEventListener('input', () => {
  $('#question').removeAttribute('aria-invalid');
  $('#question-error').hidden = true;
});

$('#open-workshop').addEventListener('click', () => {
  $('#dialog-content').innerHTML = '<div class="dialog-intro"><p class="eyebrow">万象工坊 / 积木连接示例</p><h2 id="dialog-title">一个函数，可以有几种看法？</h2><p>函数源输出同一个函数，连接图像与导数观察器。改变观察点，图形和计算结果一起回应。</p></div><div class="workshop-demo"><div class="modal-board"><div id="modal-plot" class="modal-plot" role="img"></div><div class="modal-result" id="modal-result"></div><div class="modal-slider-label"><label for="workshop-slider">观察点 x</label><output id="workshop-value" for="workshop-slider"></output></div><input id="workshop-slider" type="range" min="-1.8" max="1.8" step="0.01" value="1"><p class="modal-tip">函数源 f(x) = x² → 函数图像 → 导数观察器 f′(x) = 2x。这里演示积木连接后的联动结果。</p></div></div>';
  const slider = $('#workshop-slider');
  const update = () => {
    const value = Number(slider.value);
    $('#modal-plot').innerHTML = plotSVG('derivative', value, 'workshop');
    $('#modal-plot').setAttribute('aria-label', models.derivative.plotLabel(value));
    $('#workshop-value').textContent = format(value);
    $('#modal-result').textContent = `x = ${format(value)}  →  f(x) = ${format(value * value)}  →  f′(x) = ${format(2 * value)}`;
  };
  slider.addEventListener('input', update);
  update();
  showDialog();
});

const menuButton = $('.menu-toggle');
const mobileNav = $('#mobile-nav');
function closeMenu() {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', '打开导航');
}
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', expanded);
  menuButton.setAttribute('aria-label', expanded ? '关闭导航' : '打开导航');
  mobileNav.hidden = !expanded;
});
$$('a', mobileNav).forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
window.matchMedia('(min-width: 681px)').addEventListener('change', event => {
  if (event.matches) closeMenu();
});

let toastTimeout;
function showToast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4800);
}

selectModel('derivative');
