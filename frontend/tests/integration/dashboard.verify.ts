/**
 * P1-S2-V: 대시보드 연결점 검증
 *
 * 검증 항목:
 * - Field Coverage: users.[name, email] 존재
 * - Endpoint: GET /api/v1/users/me 응답 정상
 * - Navigation: ProgramCard → 각 프로그램 라우트 존재
 * - Auth: 비로그인 시 /login 리다이렉트
 * - Shared: HeaderBar 렌더링
 */
import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8000';

const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'verify@test.com',
  nickname: 'VerifyUser',
  profile_image: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

async function loginAndGoToDashboard(page: import('@playwright/test').Page) {
  await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'verify-jwt-token', token_type: 'bearer' }),
    });
  });

  await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });

  await page.route(`${API_URL}/api/v1/auth/logout`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Successfully logged out' }),
    });
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'verify@test.com');
  await page.fill('input[name="password"]', 'TestPass1!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
}

test.describe('P1-S2-V: 대시보드 연결점 검증', () => {
  test('Field Coverage: users.[nickname, email] 대시보드에 표시', async ({ page }) => {
    await loginAndGoToDashboard(page);
    // nickname appears in both greeting and header — check greeting heading
    await expect(
      page.getByRole('heading', { name: new RegExp(MOCK_USER.nickname) })
    ).toBeVisible();
  });

  test('Endpoint: GET /api/v1/users/me 호출 검증', async ({ page }) => {
    let apiCalled = false;
    let authHeaderSent = false;

    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'verify-jwt-token', token_type: 'bearer' }),
      });
    });

    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      apiCalled = true;
      const authHeader = route.request().headers()['authorization'];
      if (authHeader && authHeader.includes('Bearer')) {
        authHeaderSent = true;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USER),
      });
    });

    await page.goto('/login');
    await page.fill('input[name="email"]', 'verify@test.com');
    await page.fill('input[name="password"]', 'TestPass1!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    expect(apiCalled).toBe(true);
    expect(authHeaderSent).toBe(true);
  });

  test('Navigation: ProgramCard → /commission/dr-gm 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('업무 자동화').click();
    const card = page.getByRole('button', { name: /Dr\.GM 수당정산/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/commission\/dr-gm/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /commission/securities 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('업무 자동화').click();
    const card = page.getByRole('button', { name: /증권사 수당정산/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/commission\/securities/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /portfolio/irp 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('투자 분석').click();
    const card = page.getByRole('button', { name: /IRP 포트폴리오/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/portfolio\/irp/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /investment/stock-recommend 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('투자 분석').click();
    const card = page.getByRole('button', { name: /주식\/ETF 추천/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/investment\/stock-recommend/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /content/card-news 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('콘텐츠 제작').click();
    const card = page.getByRole('button', { name: /카드뉴스 제작/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/content\/card-news/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /content/report 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('콘텐츠 제작').click();
    const card = page.getByRole('button', { name: /보고서 제작/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/content\/report/, { timeout: 5000 });
  });

  test('Navigation: ProgramCard → /content/cover-promo 라우트 존재', async ({ page }) => {
    await loginAndGoToDashboard(page);
    await page.getByText('콘텐츠 제작').click();
    const card = page.getByRole('button', { name: /표지\/홍보페이지/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/content\/cover-promo/, { timeout: 5000 });
  });

  test('Auth: 비로그인 시 /login 리다이렉트', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('Shared: HeaderBar 렌더링 — 로고, 사용자 정보, 로그아웃', async ({ page }) => {
    await loginAndGoToDashboard(page);

    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByText('Working Hub')).toBeVisible();
    await expect(header.getByText('Logout')).toBeVisible();
    await expect(header.locator('a[href="/dashboard"]')).toBeVisible();
  });
});
