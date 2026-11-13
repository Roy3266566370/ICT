import { defineConfig, devices } from '@playwright/test';

/**
 * 浏览器验收需要真实的本地前后端与一份测试材料：
 *   E2E_BASE_URL=http://127.0.0.1:5173
 *   E2E_MATERIAL_ID=<已上传材料>
 *   E2E_GENERATED_VIEW_MATERIAL_ID=<开启专用视图开关后的材料>
 * 运行：npm run test:ppt-ai:e2e
 * 浏览器安装：npx playwright install chromium
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
