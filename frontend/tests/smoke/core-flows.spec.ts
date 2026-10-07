/**
 * 핵심 흐름 스모크 (수정_tasks P2-7) — 화면이 뜨고, 기본 동작이 이어지는지만 빠르게 본다.
 * 백엔드는 흉내(mock.ts). 실행: npx playwright test -c playwright.smoke.config.ts
 */
import { expect, test, type Route } from '@playwright/test';

import { fakeJwt, json, mockApi, OWNER, signIn } from './mock';

const SUMMARY = {
  is_sample: false,
  kpi: { clients: 12, new_clients_week: 2, aum: 1_234_000_000, aum_change_pct: 3.4, avg_return_rate: 5.25,
         reservations_month: 3, pending: 1, accounts: 20, accounts_with_snapshot: 18 },
  aum_trend: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, label: String(i + 1), aum: 1e9 + i * 2e7 })),
  alerts: [{ client_id: 'c1', name: '박위험', kind: 'neg', badge: '위험', message: '평가 수익률 -7.0% — 상담 권장' }],
  alerts_total: 1,
  account_types: [{ type: 'irp', label: 'IRP', count: 12 }, { type: 'pension', label: '연금저축', count: 8 }],
  schedule: [{ time: '14:00', title: '박위험 통화 예약', sub: '확인 대기' }],
  feed: [{ kind: 'client', text: '신규 고객 이신규 등록', at: new Date().toISOString() }],
};

test('로그인 → 대시보드에 실제 요약이 보인다', async ({ page }) => {
  await mockApi(page, {
    'POST /api/v1/auth/login/json': { access_token: fakeJwt(OWNER.id), token_type: 'bearer' },
    'GET /api/v1/dashboard/summary': SUMMARY,
  });
  await page.goto('/login');
  await page.fill('input[name="email"]', OWNER.email);
  await page.fill('input[name="password"]', 'pw-for-test');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/(dashboard|home)/, { timeout: 30_000 }); // 첫 실행은 화면 컴파일이 느림
  await page.goto('/dashboard');
  await expect(page.getByText('박위험').first()).toBeVisible();
  await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('연금저축', { exact: true }).first()).toBeVisible();
});

test('대시보드 요청이 실패하면 오류 문구(빈 화면·앱 오류 아님)', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { 'GET /api/v1/dashboard/summary': (r: Route) => json(r, { detail: 'boom' }, 500) });
  await page.goto('/dashboard');
  await expect(page.getByText(/대시보드를 불러오지 못했습니다/)).toBeVisible();
  await expect(page.getByText('Application error')).toHaveCount(0);
});

test('고객 목록이 뜨고 검색으로 걸러진다', async ({ page }) => {
  await signIn(page);
  const clients = [
    { id: 'c1', name: '홍길동', unique_code: '111111', birth_date: '1970-01-01', ssn_masked: null, phone: '010-1111-2222', email: null, manager: { id: 'm1', nickname: '이매니저' } },
    { id: 'c2', name: '김철수', unique_code: '222222', birth_date: '1980-02-02', ssn_masked: null, phone: '010-3333-4444', email: null, manager: { id: 'm1', nickname: '이매니저' } },
  ];
  await mockApi(page, { 'GET /api/v1/clients': clients, 'GET /api/v1/managers': [{ id: 'm1', nickname: '이매니저' }] });
  await page.goto('/customer-management');
  await expect(page.getByText('홍길동')).toBeVisible();
  await expect(page.getByText('김철수')).toBeVisible();
  await page.fill('input[placeholder="고객명 또는 고유번호 검색"]', '홍길');
  await expect(page.getByText('김철수')).toHaveCount(0);
  await expect(page.getByText('홍길동')).toBeVisible();
});

test('고객 포털: 본인 확인 → 보고서 화면, 확인이 풀리면(401) 다시 본인 확인', async ({ page }) => {
  let snapshotsCalls = 0;
  await mockApi(page, {
    'GET /api/v1/client-portal/tok123': { exists: true, masked_name: '홍*동' },
    'POST /api/v1/client-portal/tok123/verify': { access_token: 'portal-jwt', token_type: 'bearer' },
    'GET /api/v1/client-portal/tok123/snapshots': (r: Route) => {
      snapshotsCalls += 1;
      return json(r, { accounts: [], client_name: '홍길동', unique_code: '111111' });
    },
  });
  await page.goto('/client/tok123');
  await expect(page.getByText('홍*동')).toBeVisible();
  await page.fill('input[placeholder="6자리 숫자"]', '111111');
  await page.fill('input[placeholder="YYYY-MM-DD"]', '1970-01-01');
  await page.fill('input[placeholder="010-XXXX-XXXX"]', '010-1111-2222');
  await page.getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('아직 등록된 포트폴리오 데이터가 없습니다.')).toBeVisible();
  expect(snapshotsCalls).toBeGreaterThan(0);
  // 확인 시간 만료 신호 → 본인 확인으로 복귀
  await page.evaluate(() => window.dispatchEvent(new Event('portal-auth-expired')));
  await expect(page.locator('input[placeholder="6자리 숫자"]')).toBeVisible();
});

test('인쇄 화면은 흰 바탕에 어두운 글씨(흰 바탕 흰 글씨 아님)', async ({ page }) => {
  await signIn(page);
  await mockApi(page, { 'GET /api/v1/dashboard/summary': SUMMARY });
  await page.goto('/dashboard');
  await expect(page.getByText('박위험').first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const c = await page.evaluate(() => {
    const h2 = document.querySelector('h2') as HTMLElement;
    const body = getComputedStyle(document.body).backgroundColor;
    return { body, text: getComputedStyle(h2).color };
  });
  const lum = (rgb: string) => {
    const m = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
  };
  expect(lum(c.body)).toBeGreaterThan(0.9);
  expect(lum(c.text)).toBeLessThan(0.5);
});

test('은퇴설계 투자 흐름 탭이 오류 없이 열린다(파일 분할 후 확인)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await mockApi(page, { 'GET /api/v1/clients': [] });
  await page.goto('/retirement?tab=investment-flow');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Application error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('매니저 API 관리: 회사 공용 키는 상태만, Notion 만 본인 등록', async ({ page }) => {
  const MANAGER = { ...OWNER, id: 'u-mgr-1', email: 'mgr@test.local', nickname: '이매니저', role: 'manager' };
  await signIn(page, MANAGER);
  await mockApi(page, {
    'GET /api/v1/user-api-keys': [],
    'GET /api/v1/user-api-keys/company': [
      { provider: 'claude', personal: false, registered: true },
      { provider: 'dart', personal: false, registered: false },
      { provider: 'notion', personal: true, registered: false },
    ],
  }, MANAGER);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'API 관리' }).click();
  await expect(page.getByText('회사 공용 키 (대표가 관리)')).toBeVisible();
  await expect(page.getByText(/Claude API \(Anthropic\) · 사용 가능/)).toBeVisible();
  await expect(page.getByText(/DART OpenAPI \(금융감독원\) · 미등록/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notion API' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claude API (Anthropic)' })).toHaveCount(0);
});

test('고객 정보 관리: 증권계좌를 고객 줄 아래에 펼쳐 수정·등록', async ({ page }) => {
  await signIn(page);
  const accounts = [
    { id: 'a1', client_id: 'c1', account_type: 'irp', account_number: '123-45-678', securities_company: '미래에셋증권', representative: '백서연', created_at: '2026-01-01T00:00:00' },
  ];
  const calls: { method: string; body: unknown }[] = [];
  await mockApi(page, {
    'GET /api/v1/clients': [{ id: 'c1', name: '신선형', unique_code: '625841', birth_date: '1980-11-04', ssn_masked: null, phone: '010-8846-7268', email: null, manager: { id: 'm1', nickname: '백서연' } }],
    'GET /api/v1/managers': [{ id: 'm1', nickname: '백서연' }],
    'GET /api/v1/clients/c1/accounts': accounts,
    'GET /api/v1/field-options/securities': [{ id: 's1', value: 'mirae', label: '미래에셋증권', sort_order: 1 }, { id: 's2', value: 'kb', label: 'KB증권', sort_order: 2 }],
    'GET /api/v1/field-options/representative': [{ id: 'r1', value: 'baek', label: '백서연', sort_order: 1 }],
    'POST /api/v1/clients/c1/accounts': (r: Route) => {
      calls.push({ method: 'POST', body: r.request().postDataJSON() });
      return json(r, { id: 'a2', client_id: 'c1', ...r.request().postDataJSON(), created_at: '2026-10-07T00:00:00' }, 201);
    },
    'PUT /api/v1/clients/c1/accounts/a1': (r: Route) => {
      calls.push({ method: 'PUT', body: r.request().postDataJSON() });
      return json(r, { ...accounts[0], ...r.request().postDataJSON() });
    },
  });
  await page.goto('/customer-management');
  await page.getByRole('button', { name: /증권계좌/ }).click();
  await expect(page.getByText('신선형 님의 증권계좌')).toBeVisible();
  await expect(page.getByText('123-45-678')).toBeVisible();

  // 수정
  await page.getByRole('row', { name: /123-45-678/ }).getByRole('button', { name: '수정' }).click();
  await page.fill('input[placeholder="계좌번호"]', '999-00-111');
  await page.getByRole('button', { name: '저장' }).click();
  await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ account_number: '999-00-111', account_type: 'irp' });

  // 등록
  await page.getByRole('button', { name: '+ 계좌 등록' }).click();
  await page.locator('select').filter({ hasText: 'KB증권' }).last().selectOption({ label: 'KB증권' });
  await page.fill('input[placeholder="계좌번호"]', '555-66-777');
  await page.getByRole('button', { name: '저장' }).click();
  await expect.poll(() => calls.find((c) => c.method === 'POST')?.body).toMatchObject({ account_number: '555-66-777', securities_company: 'KB증권' });
  await page.screenshot({ path: 'test-results/customer-accounts.png', fullPage: false });
});
