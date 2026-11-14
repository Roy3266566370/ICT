import { test, expect } from '@playwright/test';
for (const [expression, mode, value, conclusion] of [
  ['sin(x)/x','expression','','可去间断点'],
  ['sin(x)/x','value','1','连续'],
  ['abs(x)/x','expression','','跳跃间断点'],
  ['1/x','expression','','无穷间断点'],
  ['sin(1/x)','expression','','振荡间断点'],
]) {
  test(`连续性 ${expression} ${mode}`, async ({ page }) => {
    const ai: string[] = [];
    page.on('request', r => { if (r.url().includes('/ai-solve')) ai.push(r.url()); });
    await page.goto('/labs');
    await page.getByRole('button', { name: /^连续性与间断点/ }).click();
    await page.getByRole('textbox', { name: '函数表达式', exact: true }).fill(expression);
    await page.getByRole('textbox', { name: '研究点', exact: true }).fill('0');
    await page.getByRole('combobox', { name: '该点函数值的定义' }).selectOption(mode);
    if (mode === 'value') await page.getByRole('textbox', { name: '单点函数值', exact: true }).fill(value);
    await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
    await page.getByRole('checkbox', { name: '我已核对公式、研究点和单点定义' }).check();
    const response = page.waitForResponse(r => r.url().endsWith('/api/v1/labs/manual') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认并计算', exact: true }).click();
    const result=await response;
    expect(result.status(),await result.text()).toBe(201);
    const p=(await result.json()).data.problems[0];
    expect(p.manual_input.continuity.label).toBe(conclusion);
    await expect(page.getByRole('table', { name: '连续性核对' })).toContainText(conclusion);
    await page.reload();
    await expect(page.getByRole('table', { name: '连续性核对' })).toContainText(conclusion);
    expect(ai).toHaveLength(0);
  });
}

test('核对窗口补入单点值后从可去间断改为连续', async ({ page }) => {
  await page.goto('/labs');
  await page.getByRole('button', { name: /^连续性与间断点/ }).click();
  await page.getByRole('textbox', { name: '函数表达式', exact: true }).fill('sin(x)/x');
  await page.getByRole('textbox', { name: '研究点', exact: true }).fill('0');
  await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
  await page.getByRole('checkbox', { name: '我已核对公式、研究点和单点定义' }).check();
  await page.getByRole('button', { name: '确认并计算', exact: true }).click();
  await expect(page.getByRole('table', { name: '连续性核对' })).toContainText('可去间断点');
  await page.getByRole('button', { name: '核对识别条件', exact: true }).click();
  const dialog=page.getByRole('dialog', { name: '核对与修正条件' });
  await dialog.getByRole('combobox', { name: '该点函数值的定义' }).selectOption('value');
  await expect(dialog.getByRole('button', { name: '确认并重新求解', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: '单点函数值', exact: true }).fill('1');
  await dialog.getByRole('button', { name: '确认并重新求解', exact: true }).click();
  await expect(page.getByRole('table', { name: '连续性核对' })).toContainText('连续');
  await expect(page.getByRole('table', { name: '连续性核对' })).not.toContainText('可去间断点');
});
