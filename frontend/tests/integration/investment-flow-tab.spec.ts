/**
 * P2-S3-T1: 2번탭 - 투자흐름 통합 테스트
 * TDD RED: 구현 전 테스트 작성 (현재 stub 컴포넌트라 실패해야 함)
 */
import { test, expect } from '@playwright/test';

// 테스트용 고객 선택 mock - 실제 환경에서는 고객 선택 후 동작
// 이 테스트는 투자흐름 탭의 핵심 기능을 검증합니다

test.describe('InvestmentFlowTab - 2번탭 투자흐름', () => {
  test.beforeEach(async ({ page }) => {
    // 실제 앱 환경 접근 (로그인 없이 UI 구조 검증)
    await page.goto('/retirement?tab=investment-flow');
  });

  test('연간 투자흐름표 영역이 렌더링된다', async ({ page }) => {
    // 연간 투자흐름표 섹션 확인
    await expect(page.getByText('연간 투자흐름표')).toBeVisible();
  });

  test('투자기록 테이블 영역이 렌더링된다', async ({ page }) => {
    // 투자기록 섹션 확인
    await expect(page.getByText('투자기록')).toBeVisible();
  });

  test('투자기록 추가 버튼이 존재한다', async ({ page }) => {
    // + 투자기록 추가 버튼
    await expect(page.getByText('+ 투자기록 추가')).toBeVisible();
  });

  test('상태 필터 버튼 그룹이 렌더링된다', async ({ page }) => {
    // 필터 버튼: 전체, 운용중, 종결, 적립
    await expect(page.getByRole('button', { name: '전체' })).toBeVisible();
    await expect(page.getByRole('button', { name: '운용중' })).toBeVisible();
    await expect(page.getByRole('button', { name: '종결' })).toBeVisible();
    await expect(page.getByRole('button', { name: '적립' })).toBeVisible();
  });

  test('연도 선택 드롭다운이 존재한다', async ({ page }) => {
    // 연도 선택 드롭다운
    await expect(page.locator('select[data-testid="year-select"]')).toBeVisible();
  });

  test('투자기록 추가 버튼 클릭 시 모달이 열린다', async ({ page }) => {
    await page.getByText('+ 투자기록 추가').click();
    // 모달 열림 확인
    await expect(page.getByText('투자기록 추가')).toBeVisible();
  });

  test('모달에서 유형 라디오 버튼이 보인다', async ({ page }) => {
    await page.getByText('+ 투자기록 추가').click();
    await expect(page.getByLabel('신규투자')).toBeVisible();
    await expect(page.getByLabel('추가적립')).toBeVisible();
    await expect(page.getByLabel('인출')).toBeVisible();
  });

  test('모달에서 상태 라디오 버튼이 보인다', async ({ page }) => {
    await page.getByText('+ 투자기록 추가').click();
    await expect(page.getByLabel('운용중')).toBeVisible();
    await expect(page.getByLabel('종결')).toBeVisible();
  });

  test('모달 닫기 버튼으로 모달을 닫을 수 있다', async ({ page }) => {
    await page.getByText('+ 투자기록 추가').click();
    await expect(page.getByText('투자기록 추가')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('투자기록 추가')).not.toBeVisible();
  });

  test('연간 투자흐름표 테이블 헤더가 올바르게 렌더링된다', async ({ page }) => {
    // 주요 컬럼 헤더 확인
    await expect(page.getByText('연도')).toBeVisible();
    await expect(page.getByText('총납입금액')).toBeVisible();
    await expect(page.getByText('총평가금액')).toBeVisible();
  });

  test('투자기록 테이블 헤더가 올바르게 렌더링된다', async ({ page }) => {
    await expect(page.getByText('상품명')).toBeVisible();
    await expect(page.getByText('투자금액')).toBeVisible();
    await expect(page.getByText('평가금액')).toBeVisible();
    await expect(page.getByText('상태')).toBeVisible();
  });
});
