import { test, expect } from '@playwright/test';

test.describe('3번탭 - 은퇴플랜', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/retirement?tab=retirement-plan');
  });

  test('기본정보 입력 폼 10개 필드가 렌더링된다', async ({ page }) => {
    await expect(page.getByLabel('현재 나이')).toBeVisible();
    await expect(page.getByLabel('일시납입금액')).toBeVisible();
    await expect(page.getByLabel('연적립금액')).toBeVisible();
    await expect(page.getByLabel('납입기간')).toBeVisible();
    await expect(page.getByLabel('연수익률')).toBeVisible();
    await expect(page.getByLabel('목표은퇴자금')).toBeVisible();
    await expect(page.getByLabel('목표 연금액')).toBeVisible();
    await expect(page.getByLabel('희망 은퇴나이')).toBeVisible();
    await expect(page.getByLabel('가능 은퇴나이')).toBeVisible();
    // 물가상승률&상속재원 고려 토글/체크박스
    await expect(page.getByLabel('물가상승률 & 상속재원 고려')).toBeVisible();
  });

  test('금액 필드 입력 시 천단위 콤마가 적용된다', async ({ page }) => {
    const lumpSumInput = page.getByLabel('일시납입금액');
    await lumpSumInput.fill('10000');
    await expect(lumpSumInput).toHaveValue('10,000');

    const annualSavingsInput = page.getByLabel('연적립금액');
    await annualSavingsInput.fill('5000');
    await expect(annualSavingsInput).toHaveValue('5,000');

    const targetFundInput = page.getByLabel('목표은퇴자금');
    await targetFundInput.fill('100000');
    await expect(targetFundInput).toHaveValue('100,000');

    const targetPensionInput = page.getByLabel('목표 연금액');
    await targetPensionInput.fill('300');
    await expect(targetPensionInput).toHaveValue('300');
  });

  test('[계산] 버튼이 존재한다', async ({ page }) => {
    await expect(page.getByRole('button', { name: '계산' })).toBeVisible();
  });

  test('저장 버튼이 존재한다', async ({ page }) => {
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible();
  });

  test('연도별 예상 평가금액 테이블 헤더가 존재한다', async ({ page }) => {
    // 계산 전에는 테이블이 없거나, 빈 상태임을 확인
    // 테이블 섹션이 있는지 확인
    await expect(page.getByText('연도별 예상 평가금액')).toBeVisible();
  });

  test('성장 그래프 섹션이 존재한다', async ({ page }) => {
    await expect(page.getByText('성장 그래프')).toBeVisible();
  });
});
