/**
 * P1-S1-T2: 로그인 통합 테스트
 *
 * 시나리오:
 * - 로그인 성공: 올바른 이메일/비밀번호 → /dashboard 이동, JWT 저장
 * - 로그인 실패: 잘못된 비밀번호 → 에러 메시지 표시
 * - 빈 필드 제출: 미입력 후 클릭 → 필수 입력 안내
 */
import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:8000';

// Test user credentials (must exist in the backend)
const TEST_USER = {
  email: 'test@example.com',
  password: 'Test1234!',
  nickname: 'TestUser',
};

test.describe('로그인 화면 (/login)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure logged-out state
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
  });

  test('로그인 성공 — /dashboard 이동, JWT 저장', async ({ page }) => {
    // Mock login API
    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-jwt-token-12345',
          token_type: 'bearer',
        }),
      });
    });

    // Mock user fetch
    await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000001',
          email: TEST_USER.email,
          nickname: TEST_USER.nickname,
          profile_image: null,
          is_active: true,
          created_at: '2026-01-01T00:00:00',
          updated_at: '2026-01-01T00:00:00',
        }),
      });
    });

    // Fill form
    await page.fill('input[name="email"]', TEST_USER.email);
    await page.fill('input[name="password"]', TEST_USER.password);

    // Submit
    await page.click('button[type="submit"]');

    // Should navigate to /dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // JWT should be stored in localStorage
    const token = await page.evaluate(() => {
      const stored = localStorage.getItem('auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.state?.token;
      }
      return localStorage.getItem('access_token');
    });
    expect(token).toBeTruthy();
  });

  test('로그인 실패 — 잘못된 비밀번호 시 에러 메시지 표시', async ({ page }) => {
    // Mock login API with 401
    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Incorrect email or password',
        }),
      });
    });

    // Fill form with wrong password
    await page.fill('input[name="email"]', TEST_USER.email);
    await page.fill('input[name="password"]', 'WrongPassword!');

    // Submit
    await page.click('button[type="submit"]');

    // Should show error message (use .first() to avoid Next.js route announcer conflict)
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5000 });
    await expect(alert).toContainText(/Incorrect|failed|잘못/i);

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('빈 필드 제출 — 필수 입력 안내 표시', async ({ page }) => {
    // Submit without filling any fields
    await page.click('button[type="submit"]');

    // Should show validation error messages
    await expect(page.getByText('이메일을 입력해주세요')).toBeVisible();
    await expect(page.getByText('비밀번호를 입력해주세요')).toBeVisible();

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('이메일만 입력 후 제출 — 비밀번호 필수 안내', async ({ page }) => {
    await page.fill('input[name="email"]', TEST_USER.email);
    await page.click('button[type="submit"]');

    // Should show only password error
    await expect(page.getByText('비밀번호를 입력해주세요')).toBeVisible();
    await expect(page.getByText('이메일을 입력해주세요')).not.toBeVisible();
  });

  test('로그인 중 로딩 상태 표시', async ({ page }) => {
    // Delay the API response
    await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'mock-token',
          token_type: 'bearer',
        }),
      });
    });

    await page.fill('input[name="email"]', TEST_USER.email);
    await page.fill('input[name="password"]', TEST_USER.password);
    await page.click('button[type="submit"]');

    // Button should show loading text
    await expect(page.getByText('로그인 중...')).toBeVisible();
  });

  test('회원가입 링크 존재', async ({ page }) => {
    const registerLink = page.getByRole('link', { name: '회원가입' });
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute('href', '/register');
  });
});
