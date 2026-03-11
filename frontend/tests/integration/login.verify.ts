/**
 * P1-S1-V: 로그인 연결점 검증
 *
 * 검증 항목:
 * - Field Coverage: users.[email] 존재
 * - Endpoint: POST /api/v1/auth/login/json 응답 정상
 * - Navigation: LoginForm 성공 → /dashboard 라우트 존재
 * - Auth: 비로그인 상태에서 접근 가능
 */
import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:8000';

test.describe('P1-S1-V: 로그인 연결점 검증', () => {
  /**
   * Field Coverage: 로그인 폼에 email 필드가 존재하는지 확인
   */
  test('Field Coverage: users.[email] 필드 존재', async ({ page }) => {
    await page.goto('/login');

    // email input field exists
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');

    // password input field exists
    const passwordInput = page.locator('input[name="password"]');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  /**
   * Endpoint: POST /api/v1/auth/login/json이 올바른 형식으로 호출되는지 확인
   */
  test('Endpoint: POST /api/v1/auth/login/json 요청 형식 검증', async ({ page }) => {
    let capturedRequest: {
      url: string;
      method: string;
      body: string;
      contentType: string | null;
    } | null = null;

    // Intercept the login API call
    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      const request = route.request();
      capturedRequest = {
        url: request.url(),
        method: request.method(),
        body: request.postData() || '',
        contentType: request.headers()['content-type'] || null,
      };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'verify-token',
          token_type: 'bearer',
        }),
      });
    });

    // Mock user fetch for post-login
    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000001',
          email: 'verify@test.com',
          nickname: 'Verify',
          profile_image: null,
          is_active: true,
          created_at: '2026-01-01T00:00:00',
          updated_at: '2026-01-01T00:00:00',
        }),
      });
    });

    await page.goto('/login');
    await page.fill('input[name="email"]', 'verify@test.com');
    await page.fill('input[name="password"]', 'TestPass1!');
    await page.click('button[type="submit"]');

    // Wait for API call
    await page.waitForTimeout(1000);

    // Verify request was made correctly
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.method).toBe('POST');
    expect(capturedRequest!.url).toContain('/api/v1/auth/login/json');
    expect(capturedRequest!.contentType).toContain('application/json');

    // Verify request body contains email and password
    const body = JSON.parse(capturedRequest!.body);
    expect(body).toHaveProperty('email', 'verify@test.com');
    expect(body).toHaveProperty('password', 'TestPass1!');
  });

  /**
   * Navigation: 로그인 성공 후 /dashboard 라우트로 이동하는지 검증
   */
  test('Navigation: LoginForm 성공 → /dashboard 라우트 이동', async ({ page }) => {
    // Mock APIs
    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'nav-token', token_type: 'bearer' }),
      });
    });
    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000001',
          email: 'nav@test.com',
          nickname: 'NavUser',
          profile_image: null,
          is_active: true,
          created_at: '2026-01-01T00:00:00',
          updated_at: '2026-01-01T00:00:00',
        }),
      });
    });

    await page.goto('/login');
    await page.fill('input[name="email"]', 'nav@test.com');
    await page.fill('input[name="password"]', 'TestPass1!');
    await page.click('button[type="submit"]');

    // Verify navigation to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
  });

  /**
   * Auth: 비로그인 상태에서 /login 접근 가능 (리다이렉트 없음)
   */
  test('Auth: 비로그인 상태에서 /login 접근 가능', async ({ page }) => {
    // Clear auth state
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');

    // Should stay on /login (no redirect)
    await expect(page).toHaveURL(/\/login/);

    // Login form should be accessible
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
