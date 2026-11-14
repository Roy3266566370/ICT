import { test, expect } from '@playwright/test';
for (const [task, expression, point, expected] of [
  ['导数与切线', 'sin(x)', 'pi', '-1'],
  ['导数与切线', 'x^2', '1/3', '2/3'],
  ['极限', 'sin(x)/x', '0', '1'],
  ['极限', 'sin(x)/(x-pi)', 'pi', '-1'],
]) {
  test(`${task} ${expression} 在 ${point} 的手动流程`, async ({ page }) => {
    await page.goto('/labs');
    await page.getByRole('button', { name: new RegExp(`^${task}`) }).click();
    await page.getByRole('textbox', { name: '函数表达式', exact: true }).fill(expression);
    await page.getByRole('textbox', { name: task === '极限' ? '趋近点' : '求导点', exact: true }).fill(point);
    await page.getByRole('button', { name: '预览并确认题目', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认这是你要计算的题目' })).toBeVisible();
    await page.getByRole('checkbox', { name: /^我已核对公式/ }).check();
    const response = page.waitForResponse(r => r.url().endsWith('/api/v1/labs/manual') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认并计算', exact: true }).click();
    const result = await response;
    expect(result.status(), await result.text()).toBe(201);
    const p = (await result.json()).data.problems[0];
    expect(p.solution.exact).toBe(expected);
    expect(p.manual_input.conditions.point).toBe(point);
    await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: '原题计算结果与过程' })).toBeVisible();
  });
}
