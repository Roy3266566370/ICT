import { expect, test } from '@playwright/test';

const timestamp = '2099-01-01T00:00:00Z';
const material = {
  material_id: 'qa-library-material', title: '删除验收课件', status: 'ready',
  page_count: 2, object_count: 3, created_at: timestamp, expires_at: timestamp,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me', route => route.fulfill({
    status: 401,
    json: { error: { code: 'AUTH_REQUIRED', message: '请登录', retryable: false } },
  }));
});

test('注册提交展示字段错误并将焦点移至第一个错误字段', async ({ page }) => {
  await page.goto('/register');
  const username = page.locator('#register-username');
  await username.fill('a');
  await page.locator('#register-email').fill('bad-email');
  await page.locator('#register-password').fill('123');
  await page.locator('#register-confirm-password').fill('456');
  await page.getByRole('button', { name: '建立档案' }).click();

  await expect(username).toBeFocused({ timeout: 1500 });
  for (const input of ['username', 'email', 'password', 'confirm-password']) {
    await expect(page.locator(`#register-${input}`)).toHaveAttribute('aria-invalid', 'true');
  }
  await expect(page.getByRole('combobox', { name: /身份标签/ })).toHaveCSS('appearance', 'none');
  await expect(page.getByRole('link', { name: /以访客身份体验定象坊/ })).toHaveAttribute('href', '/workshop');
});

test('登录错误在修改凭据时立即清除', async ({ page }) => {
  await page.goto('/login');
  const identifier = page.getByLabel('用户名或邮箱');
  const submit = page.locator('form button[type=submit]');
  await submit.click();
  await expect(identifier).toHaveAttribute('aria-invalid', 'true');
  await identifier.fill('test-user');
  await expect(identifier).not.toHaveAttribute('aria-invalid', 'true', { timeout: 1500 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const path of ['/living', '/space']) {
  test(`${path} 确认一次只发送一个删除请求`, async ({ page }) => {
    let deleted = false;
    let requests = 0;
    await page.route('**/api/v1/**', route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/v1/me') return route.fallback();
      if (pathname.endsWith(`/materials/${material.material_id}`) && route.request().method() === 'DELETE') {
        requests += 1;
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      const data = pathname.includes('/sessions') ? { csrf_token: 'qa-csrf', expires_at: timestamp }
        : pathname.endsWith('/materials') ? { items: deleted ? [] : [material], retention_expires_at: timestamp }
          : { works: [] };
      return route.fulfill({ json: { data } });
    });
    await page.goto(path);
    const openDelete = async () => {
      if (path === '/space') {
        await page.getByLabel(`${material.title}的更多操作`).click();
        await page.getByRole('button', { name: '删除活页' }).click();
      } else {
        await page.getByRole('button', { name: `删除「${material.title}」`, exact: true }).click({ timeout: 2000 });
      }
    };
    await openDelete();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(material.title);
    await dialog.getByRole('button', { name: '取消' }).click();
    expect(requests).toBe(0);

    await openDelete();
    await dialog.getByRole('button', { name: '确认删除' }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: material.title })).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(material.title) })).toHaveCount(0);
    expect(requests).toBe(1);
  });
}
