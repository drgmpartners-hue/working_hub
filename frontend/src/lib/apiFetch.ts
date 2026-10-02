/**
 * 공용 API 호출 (수정_tasks P2-3) — 화면마다 따로 쓰던 fetch(주소 조립·토큰 헤더·JSON·오류 문구)를 한 곳에.
 *
 *   const data = await apiJson<Summary>('/api/v1/dashboard/summary', { signal });
 *   await apiJson('/api/v1/x', { method: 'PATCH', json: { a: 1 } });
 *
 * - 로그인 토큰을 자동으로 붙인다(auth: false 로 끌 수 있음).
 * - json 을 주면 Content-Type 과 본문을 만든다.
 * - 시간 제한(기본 30초) — 넘으면 끊고 ApiError(0, '응답이 늦어 …').
 * - signal(AbortController)을 넘기면 화면을 떠나거나 고객을 바꿀 때 지난 요청을 취소한다.
 *   취소된 요청은 isAbort(e) 로 걸러 조용히 넘긴다(오류 알림 대상 아님).
 * - 실패(2xx 아님)면 서버 detail 을 담은 ApiError 를 던진다.
 *
 * 기존 raw fetch 는 한 번에 다 바꾸지 않고, 손대는 화면부터 점진적으로 옮긴다.
 */
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | null;
  /** JSON 으로 보낼 값(있으면 body 대신) */
  json?: unknown;
  /** 로그인 토큰을 붙일지 (기본 true) */
  auth?: boolean;
  /** 시간 제한 ms (기본 30초, 0 이면 없음) */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 30_000;

export function isAbort(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

function detailText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && typeof (d as { message?: unknown }).message === 'string') return (d as { message: string }).message;
  if (Array.isArray(d) && d[0] && typeof d[0].msg === 'string') return d[0].msg; // FastAPI 422
  return '';
}

/** fetch 그대로의 Response 를 돌려준다(상태 코드를 직접 보고 싶을 때). 시간 초과는 ApiError(0). */
export async function apiFetch(path: string, opts: ApiOptions = {}): Promise<Response> {
  const { json, auth = true, timeoutMs = DEFAULT_TIMEOUT, signal, headers, ...init } = opts;
  const url = /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
  const h = new Headers(headers);
  if (auth) {
    const t = authLib.getToken();
    if (t && !h.has('Authorization')) h.set('Authorization', `Bearer ${t}`);
  }
  let body = init.body ?? undefined;
  if (json !== undefined) {
    h.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  // 바깥 signal(화면 이탈 등) + 시간 제한을 하나로
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs) : undefined;
  try {
    return await fetch(url, { ...init, headers: h, body, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw new ApiError(0, `응답이 늦어 요청을 멈췄습니다(${Math.round(timeoutMs / 1000)}초). 잠시 후 다시 시도해 주세요.`);
    throw e; // 취소(AbortError)·네트워크 오류는 그대로
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 성공이면 JSON(본문 없으면 null), 실패면 ApiError(서버 detail 포함). */
export async function apiJson<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const d = detailText(body);
    throw new ApiError(res.status, `요청 실패 (${res.status})${d ? `: ${d}` : ''}`, body);
  }
  return body as T;
}
