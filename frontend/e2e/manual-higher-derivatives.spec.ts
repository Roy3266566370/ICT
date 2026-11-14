import { test, expect } from '@playwright/test';
for (const [expression, order, point, expected] of [ ['x^3','1','','3*x^2'], ['x^4','2','','12*x^2'], ['sin(x)','2','pi/2','-1'] ]) {
  test(`手动导函数/高阶导数 ${expression} ${order}阶 ${point}`, async ({ page }) => {
    const ai: string[] = [];
    page.on('request', r => { if (r.url().includes('/ai-solve')) ai.push(r.url()); });
    await page.goto('/labs');
    await page.getByRole('button', { name: /^导函数与高阶导数/ }).click();
    await page.getByRole('textbox', { name: '函数表达式', exact: true }).fill(expression);
    await page.getByRole('spinbutton', { name: '导数阶数', exact: true }).fill(order);
    if (point) await page.getByRole('textbox', { name: '求值点（可选）', exact: true }).fill(point);
    await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认这是你要计算的题目' })).toBeVisible();
    await page.getByRole('checkbox', { name: '我已核对公式、阶数和可选求值点' }).check();
    const response = page.waitForResponse(r => r.url().endsWith('/api/v1/labs/manual') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认并计算', exact: true }).click();
    const result = await response;
    expect(result.status(), await result.text()).toBe(201);
    const p = (await result.json()).data.problems[0];
    expect(point ? p.manual_input.result_latex : p.solution.exact).toBe(expected);
    if (!point) expect(p.manual_input.conditions).not.toHaveProperty('point');
    await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toContainText('逐阶求导');
    await page.reload();
    await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toBeVisible();
    expect(ai).toHaveLength(0);
  });
}
