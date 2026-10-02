/**
 * 브라우저 저장소(localStorage) 공통 (수정_tasks P2-6).
 *
 * 예전 문제
 *  - 키가 'notion_product_config' 처럼 전역이라, 같은 브라우저에서 다른 직원으로 로그인(또는 대행)하거나
 *    로컬 화면을 운영 서버·로컬 서버에 번갈아 붙이면 남의/다른 환경의 설정이 섞였다.
 *  - 저장된 값이 깨졌거나 모양이 바뀌면 JSON.parse 실패 → 기능이 조용히 멈췄다.
 *
 * 지금
 *  - 키 = `wh:<서버>:<사용자>:<이름>` (서버 = API 주소의 호스트, 사용자 = 로그인 토큰의 사용자 ID)
 *  - 읽다가 깨졌거나(check 통과 못 함) 하면 그 키를 지우고 null → 화면은 처음 상태로 다시 시작
 *  - 예전 전역 키에 값이 있으면 처음 한 번 새 키로 옮기고 예전 키는 지운다
 */
import { API_URL } from '@/lib/api-url';

function serverTag(): string {
  try {
    return new URL(API_URL).host || 'same-origin';
  } catch {
    return 'same-origin';
  }
}

/** 로그인 토큰(JWT)의 sub — 대행 중이면 대행 대상 사용자. 없으면 'anon'. */
function userTag(): string {
  if (typeof window === 'undefined') return 'anon';
  try {
    const t = window.localStorage.getItem('access_token');
    if (!t) return 'anon';
    const part = t.split('.')[1];
    if (!part) return 'anon';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json?.sub === 'string' && json.sub ? json.sub : 'anon';
  } catch {
    return 'anon';
  }
}

export function scopedKey(name: string): string {
  return `wh:${serverTag()}:${userTag()}:${name}`;
}

function ls(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 예전 전역 키 → 새 키로 한 번만 옮김 */
function migrate(name: string, legacyKey?: string): void {
  const s = ls();
  if (!s || !legacyKey) return;
  try {
    const old = s.getItem(legacyKey);
    if (old == null) return;
    const key = scopedKey(name);
    if (s.getItem(key) == null) s.setItem(key, old);
    s.removeItem(legacyKey);
  } catch {
    /* 저장소를 못 쓰는 브라우저(사생활 보호 모드 등) — 무시 */
  }
}

export function loadString(name: string, legacyKey?: string): string | null {
  migrate(name, legacyKey);
  try {
    return ls()?.getItem(scopedKey(name)) ?? null;
  } catch {
    return null;
  }
}

export function saveString(name: string, value: string): void {
  try {
    ls()?.setItem(scopedKey(name), value);
  } catch {
    /* 꽉 찼거나 막힘 — 저장 못 해도 화면은 계속 */
  }
}

export function removeKey(name: string): void {
  try {
    ls()?.removeItem(scopedKey(name));
  } catch {
    /* 무시 */
  }
}

/**
 * JSON 읽기. 깨졌거나 check 가 false 면 그 값을 지우고 null(자동 초기화).
 * check 를 주면 예전 모양으로 저장된 설정 때문에 화면이 멈추는 일을 막는다.
 */
export function loadJSON<T>(name: string, check?: (v: unknown) => boolean, legacyKey?: string): T | null {
  const raw = loadString(name, legacyKey);
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (check && !check(v)) throw new Error('shape');
    return v as T;
  } catch {
    removeKey(name);
    return null;
  }
}

export function saveJSON(name: string, value: unknown): void {
  saveString(name, JSON.stringify(value));
}

/** Notion 연결 설정({dbId, dbTitle, mapping}) 모양 검사 — 여러 화면에서 같이 쓴다 */
export function isNotionConfig(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.dbId === 'string' && !!o.dbId && !!o.mapping && typeof o.mapping === 'object' && !Array.isArray(o.mapping);
}

/**
 * 저장해 둔 Notion DB 를 더는 열 수 없다는 응답인지(삭제·이동·잘못된 ID).
 * 로그인 만료(401)·API 키 미설정·권한 같은 다른 오류로는 설정을 지우지 않는다.
 */
export async function notionDbGone(res: Response): Promise<boolean> {
  if (res.status === 400) return true;
  if (res.status !== 404) return false;
  try {
    const b = await res.clone().json();
    return typeof b?.detail === 'string' && b.detail.includes('데이터베이스를 찾을 수 없습니다');
  } catch {
    return false;
  }
}
