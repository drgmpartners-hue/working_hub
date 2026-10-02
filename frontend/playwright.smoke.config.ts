/**
 * 핵심 흐름 스모크 테스트 (수정_tasks P2-7) — 서버(백엔드) 없이 화면만 띄워 API 응답을 흉내 낸다.
 *   npx playwright test -c playwright.smoke.config.ts
 * 크로미움 위치를 직접 지정해야 하는 환경이면 PW_CHROMIUM_PATH 로 넘긴다.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.SMOKE_PORT || 3100);

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 백엔드 주소를 비워 같은 주소(/api/v1/...)로 부르게 하고, 테스트가 그 요청을 가로챈다
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_API_URL: '', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
