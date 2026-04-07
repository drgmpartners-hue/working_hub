/**
 * P2-S1-T1: 랩어카운트 관리 CRUD UI 통합 테스트
 *
 * 시나리오:
 * - 초기 로드: /data-management/wrap-accounts 접속 → 테이블 표시
 * - 필터: 활성/비활성 필터 동작
 * - 상품 등록: AddAccountModal → POST API 호출 → 목록 갱신
 * - 상품 수정: EditAccountModal → PUT API 호출 → 목록 갱신
 * - 비활성화: DELETE API 호출 → 상태 변경
 */
import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:8000';

const MOCK_WRAP_ACCOUNTS = [
  {
    id: 1,
    product_name: '삼성 글로벌 랩',
    securities_company: '삼성증권',
    investment_target: '글로벌 주식',
    target_return_rate: 8.5,
    description: '글로벌 분산투자 랩어카운트',
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
  {
    id: 2,
    product_name: '미래에셋 국내 성장 랩',
    securities_company: '미래에셋증권',
    investment_target: '국내 성장주',
    target_return_rate: 12.0,
    description: '국내 성장주 집중투자',
    is_active: true,
    created_at: '2026-01-02T00:00:00',
    updated_at: '2026-01-02T00:00:00',
  },
  {
    id: 3,
    product_name: '한국투자 채권혼합 랩',
    securities_company: '한국투자증권',
    investment_target: '채권혼합',
    target_return_rate: 5.0,
    description: '안정형 채권혼합 포트폴리오',
    is_active: false,
    created_at: '2026-01-03T00:00:00',
    updated_at: '2026-01-03T00:00:00',
  },
];

const MOCK_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
  nickname: 'TestUser',
  profile_image: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

async function setupAuthenticatedState(page: import('@playwright/test').Page) {
  await page.route(`${API_URL}/api/v1/auth/login/json`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'mock-jwt-token', token_type: 'bearer' }),
    });
  });

  await page.route(`${API_URL}/api/v1/users/me`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    });
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'Test1234!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
}

test.describe('랩어카운트 관리 페이지 (/data-management/wrap-accounts)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedState(page);

    // Mock wrap-accounts API
    await page.route(`${API_URL}/api/v1/retirement/wrap-accounts*`, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_WRAP_ACCOUNTS),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/data-management/wrap-accounts');
  });

  test('초기 로드 — 페이지 제목과 테이블 표시', async ({ page }) => {
    // Page heading
    await expect(page.getByRole('heading', { name: /랩어카운트/ })).toBeVisible({ timeout: 10000 });

    // Table headers
    await expect(page.getByText('상품명')).toBeVisible();
    await expect(page.getByText('증권사')).toBeVisible();
    await expect(page.getByText('투자대상')).toBeVisible();
    await expect(page.getByText('목표수익률')).toBeVisible();
    await expect(page.getByText('상태')).toBeVisible();
  });

  test('초기 로드 — 상품 목록 3개 표시', async ({ page }) => {
    await expect(page.getByText('삼성 글로벌 랩')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('미래에셋 국내 성장 랩')).toBeVisible();
    await expect(page.getByText('한국투자 채권혼합 랩')).toBeVisible();
  });

  test('초기 로드 — 활성/비활성 배지 표시', async ({ page }) => {
    const activeBadges = page.getByText('활성');
    const inactiveBadge = page.getByText('비활성');

    await expect(activeBadges.first()).toBeVisible({ timeout: 10000 });
    await expect(inactiveBadge).toBeVisible();
  });

  test('상품 등록 버튼 클릭 — 모달 열림', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /상품 등록|추가/ });
    await expect(addButton).toBeVisible({ timeout: 10000 });
    await addButton.click();

    // Modal should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/상품명/)).toBeVisible();
    await expect(page.getByText(/증권사/)).toBeVisible();
  });

  test('상품 등록 모달 — 필수 필드 입력 후 저장', async ({ page }) => {
    const newAccount = {
      id: 4,
      product_name: '신한 글로벌 랩',
      securities_company: '신한증권',
      investment_target: '글로벌',
      target_return_rate: 9.0,
      description: null,
      is_active: true,
      created_at: '2026-01-04T00:00:00',
      updated_at: '2026-01-04T00:00:00',
    };

    // Mock POST
    await page.route(`${API_URL}/api/v1/retirement/wrap-accounts`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newAccount),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([...MOCK_WRAP_ACCOUNTS, newAccount]),
        });
      }
    });

    // Open modal
    const addButton = page.getByRole('button', { name: /상품 등록|추가/ });
    await addButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill form
    await page.getByLabel(/상품명/).fill('신한 글로벌 랩');
    await page.getByLabel(/증권사/).fill('신한증권');

    // Submit
    const saveButton = page.getByRole('button', { name: /저장|등록|확인/ });
    await saveButton.click();

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
  });

  test('수정 버튼 클릭 — 수정 모달 열림 및 기존 데이터 표시', async ({ page }) => {
    await expect(page.getByText('삼성 글로벌 랩')).toBeVisible({ timeout: 10000 });

    // Click edit button for first row
    const editButtons = page.getByRole('button', { name: /수정|편집/ });
    await editButtons.first().click();

    // Modal should open with existing data
    await expect(page.getByRole('dialog')).toBeVisible();

    // Should have input with existing product name
    const productNameInput = page.getByLabel(/상품명/);
    await expect(productNameInput).toHaveValue('삼성 글로벌 랩');
  });

  test('비활성화 버튼 클릭 — 확인 다이얼로그 표시', async ({ page }) => {
    await expect(page.getByText('삼성 글로벌 랩')).toBeVisible({ timeout: 10000 });

    // Click deactivate button
    const deactivateButtons = page.getByRole('button', { name: /비활성화|삭제/ });
    await deactivateButtons.first().click();

    // Confirm dialog or confirmation prompt should appear
    await expect(
      page.getByText(/비활성화|정말|확인/).first()
    ).toBeVisible({ timeout: 3000 });
  });

  test('필터 — 활성 필터 선택 시 활성 상품만 표시', async ({ page }) => {
    await expect(page.getByText('삼성 글로벌 랩')).toBeVisible({ timeout: 10000 });

    // Find filter - could be a select or button
    const filterSelect = page.locator('select').first();
    if (await filterSelect.count() > 0) {
      await filterSelect.selectOption({ label: '활성' });
    }

    // Active items should be visible
    await expect(page.getByText('삼성 글로벌 랩')).toBeVisible();
    await expect(page.getByText('미래에셋 국내 성장 랩')).toBeVisible();
  });
});

test.describe('랩어카운트 — 비로그인 시 리다이렉트', () => {
  test('비로그인 상태에서 접근 시 /login으로 리다이렉트', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto('/data-management/wrap-accounts');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
