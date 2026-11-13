import { test, expect, type Page } from '@playwright/test';

async function enterIntegral(page: Page, expression: string, lower: string, upper: string): Promise<void> {
  await page.goto('/labs');
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill(expression);
  await page.getByRole('textbox', { name: '积分下限', exact: true }).fill(lower);
  await page.getByRole('textbox', { name: '积分上限', exact: true }).fill(upper);
}

async function confirmAndCompute(page: Page) {
  await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认这是你要计算的题目' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认并计算', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '我已核对公式、积分变量和全部条件' }).check();
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/labs/manual') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '确认并计算', exact: true }).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(201);
  const document = (await result.json()).data;
  await expect(page.getByRole('region', { name: '原题计算结果与过程', exact: true })).toBeVisible();
  return document;
}

test('定积分从填写、重确认到过程展示，保存重开并恢复原题', async ({ page }) => {
  const aiRequests: string[] = [];
  page.on('request', r => { if (r.url().includes('/ai-solve')) aiRequests.push(r.url()); });
  await enterIntegral(page, 'x^2', '0', '2');
  await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
  await page.getByRole('checkbox', { name: '我已核对公式、积分变量和全部条件' }).check();
  await page.getByRole('textbox', { name: '积分上限', exact: true }).fill('3');
  await expect(page.getByRole('heading', { name: '确认这是你要计算的题目' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '积分上限', exact: true }).fill('2');
  const document = await confirmAndCompute(page);
  expect(document.problems[0].solution.exact).toBe('8/3');
  await page.getByRole('spinbutton', { name: '积分上限 b 数值', exact: true }).fill('3');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('当前图形为修改后的实验');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('已保存到服务端', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: '积分上限 b 数值', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: '恢复原题', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '积分上限 b 数值', exact: true })).toHaveValue('2');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('当前图形对应已确认的原题');
  await page.getByRole('button', { name: '核对识别条件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '核对与修正条件' });
  await dialog.getByRole('textbox', { name: '上限', exact: true }).fill('');
  await expect(dialog.getByRole('button', { name: '确认并重新求解', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(aiRequests).toEqual([]);
});

test('含 pi 的积分保留精确端点，不定积分保留常数和求导步骤', async ({ page }) => {
  await enterIntegral(page, 'sin(x)', '0', 'pi');
  const definite = await confirmAndCompute(page);
  expect(definite.problems[0].solution.exact).toBe('2');
  expect(definite.problems[0].manual_input.conditions.upper).toBe('pi');
  expect(Number(await page.getByRole('spinbutton', { name: '积分上限 b 数值', exact: true }).inputValue()))
    .toBeCloseTo(definite.problems[0].model.defaults.upper, 12);
  await page.goto('/labs');
  await page.getByRole('button', { name: '不定积分 求原函数族', exact: false }).click();
  await expect(page.getByRole('textbox', { name: '积分下限', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '填入可修改示例', exact: true }).click();
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('x*cos(x)');
  const indefinite = await confirmAndCompute(page);
  expect(indefinite.problems[0].solution.answer).toContain('+C');
  expect(indefinite.problems[0].solution.verification.level).toBe('symbolic');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('符号求导核验通过');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('求导核对');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('分部积分：选择 u 与 dv');
  await expect(page.getByRole('button', { name: '播放执行轨迹', exact: true })).toBeVisible();
});

test('不定积分展示经核验的换元与实数对数原函数', async ({ page }) => {
  await page.goto('/labs');
  await page.getByRole('button', { name: '不定积分 求原函数族', exact: false }).click();
  await page.getByRole('button', { name: '填入可修改示例', exact: true }).click();
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('x*cos(x^2)');
  const substituted = await confirmAndCompute(page);
  expect(substituted.problems[0].solution.answer).toBe('F(x)=sin(x^2)/2+C');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('换元：配对复合结构与它的导数');

  await page.goto('/labs');
  await page.getByRole('button', { name: '不定积分 求原函数族', exact: false }).click();
  await page.getByRole('button', { name: '填入可修改示例', exact: true }).click();
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('1/x');
  const reciprocal = await confirmAndCompute(page);
  expect(reciprocal.problems[0].solution.answer).toContain('Abs(x)');
  await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('对数参数写成绝对值');
});

test('数值抽查通过的原函数标注非全域证明', async ({ page }) => {
  await page.goto('/labs');
  await page.getByRole('button', { name: '不定积分 求原函数族', exact: false }).click();
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('1/(x*log(x))');
  const document = await confirmAndCompute(page);
  expect(document.problems[0].solution.verification.level).toBe('numeric');
  const region = page.getByRole('region', { name: '原题计算结果与过程', exact: true });
  await expect(region.locator('[data-verification="numeric"]')).toContainText('数值抽查通过（非全域证明）');
  await expect(region).toContainText('数值抽查核对');
  await expect(region).toContainText('不是全域证明');
});

test('无法核验原函数时明确标记为不支持，不展示伪造答案', async ({ page }) => {
  await page.goto('/labs');
  await page.getByRole('button', { name: '不定积分 求原函数族', exact: false }).click();
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('sin(1/x)');
  const document = await confirmAndCompute(page);
  expect(document.problems[0].manual_input.result_status).toBe('unsupported');
  expect(document.problems[0].manual_input.result_answer).toBe('');
  expect(document.problems[0].solution.verification.level).toBe('unconfirmed');
  const region = page.getByRole('region', { name: '原题计算结果与过程', exact: true });
  await expect(region.locator('[data-verification="unconfirmed"]')).toContainText('尚未确认');
  await expect(region.getByRole('status')).toContainText('当前内核未能给出可核验的闭式原函数');
  await expect(region).toContainText('未能通过求导核对');
  await expect(region).not.toContainText('+C');
});

test('缺条件及非法公式不能计算，保留文件识别与原有示例', async ({ page }) => {
  await enterIntegral(page, 'x^2', '', '2');
  await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请填写积分下限');
  await page.getByRole('textbox', { name: '积分下限', exact: true }).fill('0');
  await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('sin(');
  await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请检查公式');
  await expect(page.getByRole('button', { name: '选择或拖入题目文件，也可以粘贴截图' })).toBeVisible();
  await page.getByRole('button', { name: '微积分 定积分 曲线、积分区域与黎曼和 打开示例 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '定积分 · 黎曼和', exact: true })).toBeVisible();
});

test.describe('移动端共用数学键盘', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('单一键盘跟随焦点，确认公式正确并自动进入视口', async ({ page }) => {
    await page.goto('/labs');
    await expect(page.locator('[role="group"][aria-label$="数学键盘"]')).toHaveCount(1);
    const lower = page.getByRole('textbox', { name: '积分下限', exact: true });
    await lower.click();
    await expect(page.getByRole('group', { name: '积分下限数学键盘', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '7', exact: true }).click();
    await expect(lower).toHaveValue('7');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.locator('[role="group"][aria-label$="数学键盘"]')).toHaveCount(0);
    await page.getByRole('button', { name: '展开键盘', exact: true }).click();
    await page.getByRole('textbox', { name: '被积函数', exact: true }).fill('1/(1+x^2)');
    await lower.fill('0');
    await page.getByRole('textbox', { name: '积分上限', exact: true }).fill('1');
    await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
    const heading = page.getByRole('heading', { name: '确认这是你要计算的题目' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
    const tex = await page.locator('[aria-label="确认题目"] annotation').first().textContent();
    expect(tex).toContain('\\frac{1}{x^{2} + 1}');
    expect(tex).not.toContain('1 \\frac');
  });
});
