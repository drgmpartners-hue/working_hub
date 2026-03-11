/**
 * P1-S2-T2: 대시보드 통합 테스트
 *
 * 시나리오:
 * - 초기 로드: 로그인 후 접속 → 3개 카테고리 그룹 표시, 모두 접힌 상태
 * - 카테고리 펼침: 업무 자동화 클릭 → Dr.GM, 증권사 카드 표시
 * - 프로그램 이동: Dr.GM 카드 클릭 → /commission/dr-gm 이동
 * - 로그아웃: 로그아웃 클릭 → /login 이동, 세션 삭제
 */
import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:8000';

const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
  nickname: 'TestUser',
  profile_image: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

/**
 * Sets up authenticated state by performing a mock login flow,
 * which properly hydrates the Zustand store.
 */
async function setupAuthenticatedState(page: import('@playwright/test').Page) {
  // 1. Set up all route mocks FIRST
  await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock-jwt-token',
        token_type: 'bearer',
      }),
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

  // 2. Perform actual login through the UI
  await page.goto('/login');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'Test1234!');
  await page.click('button[type="submit"]');

  // 3. Wait for navigation to dashboard (login success redirects there)
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
}

test.describe('대시보드 화면 (/dashboard)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedState(page);
    // Already on /dashboard after login flow
  });

  test('초기 로드 — 3개 카테고리 그룹 표시', async ({ page }) => {
    // 3 category groups should be visible
    await expect(page.getByText('업무 자동화')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('투자 분석')).toBeVisible();
    await expect(page.getByText('콘텐츠 제작')).toBeVisible();
  });

  test('사용자 인사 메시지 표시', async ({ page }) => {
    // Should show greeting with user's nickname
    await expect(page.getByText(`안녕하세요, ${MOCK_USER.nickname}님`)).toBeVisible();
  });

  test('카테고리 펼침 — 업무 자동화 클릭 시 프로그램 카드 표시', async ({ page }) => {
    // Click the "업무 자동화" category header
    await page.getByText('업무 자동화').click();

    // Should show program cards
    await expect(page.getByText('Dr.GM 수당정산 계산기')).toBeVisible();
    await expect(page.getByText('증권사 수당정산 계산기')).toBeVisible();
  });

  test('카테고리 펼침 — 투자 분석 클릭 시 프로그램 카드 표시', async ({ page }) => {
    await page.getByText('투자 분석').click();

    await expect(page.getByText('IRP 포트폴리오 수익률 관리기')).toBeVisible();
    await expect(page.getByText('주식/ETF 추천 프로그램')).toBeVisible();
  });

  test('카테고리 펼침 — 콘텐츠 제작 클릭 시 프로그램 카드 표시', async ({ page }) => {
    await page.getByText('콘텐츠 제작').click();

    await expect(page.getByText('카드뉴스 제작')).toBeVisible();
    await expect(page.getByText('보고서 제작')).toBeVisible();
    await expect(page.getByText('표지/홍보페이지 디자인')).toBeVisible();
  });

  test('프로그램 이동 — Dr.GM 카드 클릭 시 /commission/dr-gm 이동', async ({ page }) => {
    // Open the category
    await page.getByText('업무 자동화').click();

    // ProgramCard is a <button> that uses router.push, not an <a> tag
    const drGmCard = page.getByRole('button', { name: /Dr\.GM 수당정산/ });
    await expect(drGmCard).toBeVisible();

    // Click and verify navigation
    await drGmCard.click();
    await expect(page).toHaveURL(/\/commission\/dr-gm/, { timeout: 5000 });
  });

  test('프로그램 카드 확인 — 모든 프로그램 카드 존재', async ({ page }) => {
    // Open all categories and check program cards exist
    const expectedPrograms = [
      { category: '업무 자동화', programs: ['Dr.GM 수당정산 계산기', '증권사 수당정산 계산기'] },
      { category: '투자 분석', programs: ['IRP 포트폴리오 수익률 관리기', '주식/ETF 추천 프로그램'] },
      {
        category: '콘텐츠 제작',
        programs: ['카드뉴스 제작', '보고서 제작', '표지/홍보페이지 디자인'],
      },
    ];

    for (const group of expectedPrograms) {
      await page.getByText(group.category).click();
      for (const name of group.programs) {
        await expect(page.getByText(name, { exact: false })).toBeVisible();
      }
    }
  });

  test('로그아웃 — /login 이동, 세션 삭제', async ({ page }) => {
    // Click logout button
    await page.getByText('Logout').click();

    // Should navigate to /login
    await expect(page).toHaveURL(/\/login/);

    // Token should be cleared
    const token = await page.evaluate(() => {
      const stored = localStorage.getItem('auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.state?.token;
      }
      return null;
    });
    expect(token).toBeFalsy();
  });

  test('HeaderBar 렌더링 — Working Hub 로고 및 사용자 정보 표시', async ({ page }) => {
    // Header with "Working Hub" text should be visible
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByText('Working Hub')).toBeVisible();

    // Logout button in header
    await expect(header.getByText('Logout')).toBeVisible();

    // Home link to /dashboard in header
    await expect(header.locator('a[href="/dashboard"]')).toBeVisible();
  });
});

test.describe('대시보드 — 비로그인 시 리다이렉트', () => {
  test('비로그인 상태에서 /dashboard 접근 시 /login으로 리다이렉트', async ({ page }) => {
    // Clear all storage
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Try to access dashboard
    await page.goto('/dashboard');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
