import { test, expect } from '@playwright/test';

test.describe('1번탭 - 희망 은퇴플랜', () => {
  test.beforeEach(async ({ page }) => {
    // 로그인 없이 테스트하기 위해 직접 URL 접근
    // 실제 환경에서는 로그인 필요
    await page.goto('/retirement?tab=desired-plan');
  });

  test('입력 폼이 렌더링된다', async ({ page }) => {
    // 매월 희망 수령 은퇴금액 입력 필드
    await expect(page.getByLabel('매월 희망 수령액')).toBeVisible();
    // 은퇴 기간 입력 필드
    await expect(page.getByLabel('은퇴 기간')).toBeVisible();
  });

  test('숫자 입력 시 천단위 콤마가 적용된다', async ({ page }) => {
    const amountInput = page.getByLabel('매월 희망 수령액');
    await amountInput.fill('1000');
    await expect(amountInput).toHaveValue('1,000');
  });

  test('입력값 변경 시 계산 결과 표가 업데이트된다', async ({ page }) => {
    await page.getByLabel('매월 희망 수령액').fill('200');
    await page.getByLabel('은퇴 기간').fill('20');

    // 계산 결과 표 항목들이 보여야 함
    await expect(page.getByText('목표 은퇴자금')).toBeVisible();
    await expect(page.getByText('필요 일시납')).toBeVisible();
    await expect(page.getByText('필요 연적립')).toBeVisible();
    await expect(page.getByText('예상 수익률')).toBeVisible();
  });

  test('계산 결과 표에 예상 수익률 7%가 기본값으로 표시된다', async ({ page }) => {
    await expect(page.getByText('7%')).toBeVisible();
  });

  test('입력값이 있을 때 Recharts 그래프가 렌더링된다', async ({ page }) => {
    await page.getByLabel('매월 희망 수령액').fill('200');
    await page.getByLabel('은퇴 기간').fill('20');
    // SVG 기반 Recharts 차트가 렌더링되는지 확인
    await expect(page.locator('.recharts-wrapper')).toBeVisible({ timeout: 5000 });
  });

  test('저장 버튼이 존재한다', async ({ page }) => {
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible();
  });
});
