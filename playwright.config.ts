import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev:server', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev:client', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
