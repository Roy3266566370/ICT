// Run against the open prototype using agent-browser eval -b with this file encoded as UTF-8 base64.
(() => {
  const checks = [];
  const find = selector => document.querySelector(selector);
  const assert = (condition, name) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const slide = (selector, value) => {
    const input = find(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = () => find('#question-form').requestSubmit();
  const close = () => find('#experiment-dialog').close();

  assert(document.documentElement.scrollWidth <= innerWidth, `No page overflow at ${innerWidth}px`);
  find('[data-model="derivative"]').click();
  slide('#hero-slider', -1.5);
  assert(find('#hero-result').textContent === 'f′(x) = -3.00', 'Derivative recalculates for a negative x');
  assert(find('#hero-plot').getAttribute('aria-label').includes('-3.00'), 'Graph description follows computed value');

  find('[data-model="integral"]').click();
  slide('#hero-slider', 60);
  assert(find('#hero-result').textContent === 'S60 = 0.3417', 'Right endpoint Riemann sum is correct');
  assert(find('#hero-plot').querySelectorAll('rect[height]').length === 61, 'Integral renders all 60 rectangles plus grid');

  find('[data-model="matrix"]').click();
  slide('#hero-slider', -1.25);
  assert(find('#hero-result').textContent === 'det(A) = 1.00', 'Shear determinant stays one');
  assert(find('#hero-value').textContent === '-1.25', 'Matrix parameter responds to slider');
  assert(find('[data-model="matrix"]').getAttribute('aria-pressed') === 'true', 'Selected model is exposed accessibly');

  find('[data-fill="derivative"]').click();
  assert(find('#question').value.includes('x = 1.2'), 'Sample fills the question');
  submit();
  assert(find('#experiment-dialog').open, 'Submitting sample opens experiment');
  assert(find('.solution-steps').children.length === 3, 'Sample explains three solution stages');
  slide('#modal-slider', 0);
  assert(find('#modal-result').textContent === 'f′(x) = 0.00', 'Modal model computes zero slope');
  close();

  find('#question').value = '';
  submit();
  assert(!find('#question-error').hidden, 'Empty question receives an inline error');
  assert(!find('#experiment-dialog').open, 'Empty question does not start an experiment');

  const rawQuestion = '<img src=x onerror=alert(1)> 请解释一道新题';
  find('#question').value = rawQuestion;
  submit();
  assert(find('#submitted-question').textContent === rawQuestion, 'Custom question is preserved as literal text');
  assert(!find('#submitted-question img'), 'Question input is not interpreted as HTML');
  assert(find('.preview-notice').textContent.includes('尚未连接'), 'Free question explains preview boundary honestly');
  find('[data-preview="integral"]').click();
  assert(find('#dialog-title').textContent.includes('面积'), 'Custom-question dialog can open a working sample');
  close();

  const transfer = new DataTransfer();
  transfer.items.add(new File(['test question'], 'question.txt', { type: 'text/plain' }));
  find('#file-input').files = transfer.files;
  find('#file-input').dispatchEvent(new Event('change', { bubbles: true }));
  assert(!find('#attachment').hidden && find('#filename').textContent === 'question.txt', 'Local attachment filename appears');
  find('#question').value = '';
  submit();
  assert(find('#submitted-question').textContent.includes('question.txt'), 'Attachment-only submission displays preview');
  close();
  find('#remove-file').click();
  assert(find('#file-input').files.length === 0 && find('#attachment').hidden, 'Attachment can be removed');

  find('#open-workshop').click();
  slide('#workshop-slider', 1.5);
  assert(find('#modal-result').textContent.includes('f(x) = 2.25') && find('#modal-result').textContent.includes('f′(x) = 3.00'), 'Workshop graph and derivative respond together');
  close();

  for (const type of ['derivative', 'integral', 'matrix']) {
    find(`[data-open="${type}"]`).click();
    assert(find('#experiment-dialog').open && find('#modal-slider'), `${type} example opens a working model`);
    close();
  }
  if (innerWidth <= 680) {
    find('.menu-toggle').click();
    assert(!find('#mobile-nav').hidden, 'Mobile navigation opens');
    find('#mobile-nav a').click();
    assert(find('#mobile-nav').hidden, 'Mobile navigation closes after selecting a link');
  }

  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert(ids.length === new Set(ids).size, 'No duplicate element IDs');
  const anchors = [...document.querySelectorAll('a[href^="#"]')];
  assert(anchors.every(link => link.hash === '' || document.getElementById(link.hash.slice(1))), 'Every section link has a destination');

  find('#question').value = '';
  find('#question-error').hidden = true;
  find('#question').removeAttribute('aria-invalid');
  find('#toast').hidden = true;
  find('[data-model="derivative"]').click();
  document.activeElement?.blur();
  window.scrollTo({ top: 0, behavior: 'instant' });
  return { passed: checks.length, checks };
})();
