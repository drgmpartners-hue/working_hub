/**
 * 스모크 테스트 공통 — 백엔드 없이 /api/v1/** 요청을 가로채 흉내 응답을 준다(수정_tasks P2-7).
 * 테스트마다 필요한 응답만 routes 로 덮어쓴다. 모르는 주소는 빈 목록/빈 객체로 답하고 기록한다.
 */
import type { Page, Route } from '@playwright/test';

/** 서명은 가짜지만 모양은 진짜 JWT — 화면이 sub(사용자 ID)를 읽는다 */
export function fakeJwt(sub: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: 4102444800 })}.sig`;
}

export const OWNER = {
  id: 'u-owner-1', email: 'owner@test.local', nickname: '김대표', phone: null, profile_image: null,
  is_active: true, role: 'owner', programs: ['customers', 'product_master', 'wrap_accounts', 'portfolio', 'retirement', 'company_report'],
  created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00',
};

export type Handler = (route: Route, url: URL) => Promise<void> | void;
export type Routes = Record<string, unknown | Handler>; // 'GET /api/v1/users/me' → JSON 또는 함수

export async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function mockApi(page: Page, routes: Routes = {}, user = OWNER): Promise<string[]> {
  const unknown: string[] = [];
  const base: Routes = {
    'GET /api/v1/users/me': user,
    'GET /api/v1/auth/session': { actor: user, effective: user, is_impersonating: false, impersonation_expires_at: null },
    'GET /api/v1/version': { env: 'test', commit: null, branch: null },
    'POST /api/v1/auth/logout': {},
  };
  const all = { ...base, ...routes };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    const hit = all[key] ?? Object.entries(all).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    if (hit !== undefined) {
      if (typeof hit === 'function') return (hit as Handler)(route, url);
      return json(route, hit);
    }
    unknown.push(key);
    return json(route, req.method() === 'GET' ? [] : {});
  });
  return unknown;
}

/** 로그인된 상태로 시작(로그인 화면은 따로 시험) */
export async function signIn(page: Page, user = OWNER) {
  const token = fakeJwt(user.id);
  await page.addInitScript((t) => {
    if (!window.localStorage.getItem('access_token')) {
      window.localStorage.setItem('access_token', t);
      window.localStorage.setItem('auth-storage', JSON.stringify({ state: { token: t }, version: 0 }));
    }
  }, token);
  return token;
}
