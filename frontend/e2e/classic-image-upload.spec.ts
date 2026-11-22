import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const kind of ['新图 PNG', '嵌图 PPTX', 'PNG', 'JPG'] as const) {
  test(kind + ' 上传后在经典工作台直接操作换基图', async ({ page }, info) => {
    test.setTimeout(360_000);
    const fixture = kind === '新图 PNG' ? 'basis-alternate.png' : kind === '嵌图 PPTX' ? 'auto-vector-arrows.pptx' : null;
    const file = fixture ? fileURLToPath(new URL('./fixtures/' + fixture, import.meta.url)) : kind === 'JPG' ? process.env.E2E_BASIS_JPG : process.env.E2E_BASIS_IMAGE ?? join(homedir(), 'AppData/Local/Temp/codex-clipboard-d84daf93-afe7-407b-95b8-bf75ef43cb1a.png');
    test.skip(!file || !existsSync(file), '请用 E2E_BASIS_IMAGE 或 E2E_BASIS_JPG 指定验收图片');
    await page.goto(kind === 'JPG' ? '/' : '/living');
    if (kind === 'JPG') await page.getByRole('button', { name: '上传文件', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles(file!);
    await expect(page).toHaveURL(/\/materials\/[^/]+\/work/, { timeout: 60000 });
    const pageNo = kind === '嵌图 PPTX' ? 2 : 1;
    if (pageNo === 2) await page.getByRole('button', { name: /^第 2 页/ }).first().click({ timeout: 180000 });
    const slide = page.getByLabel(`幻灯片第 ${pageNo} 页`, { exact: true });
    const arrows = slide.locator('[data-vector-node]');
    const expected = fixture ? 6 : Number(process.env.E2E_BASIS_ARROW_COUNT ?? 0);
    if (expected) await expect(arrows).toHaveCount(expected, { timeout: 180000 });
    const arrow = expected === 6
      ? arrows.filter({ has: page.getByLabel('拖动终点'), hasNot: page.getByLabel('拖动起点') })
      : arrows.first();
    const handle = arrow.getByLabel('拖动终点');
    await expect(handle).toBeVisible({ timeout: 180000 });
    const guide = slide.locator('[data-basis-segment="2"]');
    const coords = slide.locator('[data-basis-coordinates]');
    if (expected === 6) await expect(coords).toHaveText('斜基：坐标 (1, 1)');
    const target = expected === 6 ? await guide.getAttribute('x2') : null;
    const corner = expected === 6 ? await guide.getAttribute('x1') : null;
    const line = arrow.locator('[data-vector-stroke]');
    const before = await line.getAttribute('x2');
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 28, y - 12, { steps: 6 });
    if (expected === 6) {
      await expect(coords).not.toHaveText('斜基：坐标 (1, 1)');
      await expect(guide).not.toHaveAttribute('x1', corner!);
      await expect(guide).toHaveAttribute('x2', target!);
    }
    await page.mouse.up();
    await expect(line).not.toHaveAttribute('x2', before!);
    const length = slide.getByLabel('线长', { exact: true });
    await length.fill('120');
    await expect(length).toHaveValue('120');
    await slide.getByLabel('线条颜色').fill('#007744');
    await expect(line).toHaveAttribute('stroke', '#007744');
    if (expected === 6) {
      const first = slide.getByRole('button', { name: '第 1 步：沿 b₁' });
      const second = slide.getByRole('button', { name: '第 2 步：沿 b₂' });
      await expect(second).toBeDisabled();
      await first.click();
      await expect(guide).toHaveCount(0);
      await expect(second).toBeEnabled();
      await second.click();
      await expect(guide).toHaveAttribute('x2', target!);
    }
    await page.screenshot({ path: info.outputPath('image-slide.png') });
    await page.getByRole('button', { name: '查看原图', exact: true }).click();
    await expect(arrow).toBeHidden();
    await expect(slide.getByRole('img', { name: `第 ${pageNo} 页原始 PPT` })).toBeVisible();
    await page.getByRole('button', { name: '显示可操作图形', exact: true }).click();
    await expect(line).toHaveAttribute('stroke', '#007744');
    if (expected === 6) await expect(guide).toHaveAttribute('x2', target!);
  });
}
