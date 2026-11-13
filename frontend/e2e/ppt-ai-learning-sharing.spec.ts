import { expect, test } from '@playwright/test';

const shareUrl = process.env.E2E_SHARE_URL;

test.describe('分享接收者的学习能力边界', () => {
  test.skip(!shareUrl, '需要 E2E_SHARE_URL（已发布且包含学习内容的分享页）');

  test('可本地操作实验，不出现联网问答和作者私有保存', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
    await page.goto(shareUrl!);
    const entry = page.getByRole('button', { name: '本页学习' });
    if (!(await entry.count())) return;
    await entry.first().click();
    const panel = page.getByLabel('本页学习');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/已打包|分享\/离线内容/)).toBeVisible();
    const ask = panel.getByRole('button', { name: '问一个问题' });
    await expect(ask).toBeDisabled();
    await panel.getByRole('button', { name: '动手试试' }).click();
    await expect(panel.getByRole('button', { name: '保存这次探索' })).toHaveCount(0);
    expect(requests.filter((line) => line.includes('/ai-learning/questions'))).toEqual([]);
    expect(requests.filter((line) => line.includes('/ai-branches/') && line.startsWith('PATCH'))).toEqual([]);
  });
});
