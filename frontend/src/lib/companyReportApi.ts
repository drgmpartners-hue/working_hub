/**
 * 기업 리포트 API 헬퍼 — /api/v1/company-report/*
 * 기존 페이지들과 같은 방식(API_URL + authLib 토큰)으로 호출한다.
 */
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

export const CR_BASE = `${API_URL}/api/v1/company-report`;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function crFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authLib.getToken();
  const headers: Record<string, string> = {
    ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${CR_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const crGet = <T,>(path: string) => crFetch<T>(path);
export const crPost = <T,>(path: string, body?: unknown) =>
  crFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const crPut = <T,>(path: string, body: unknown) => crFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const crPatch = <T,>(path: string, body: unknown) => crFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const crDelete = <T,>(path: string) => crFetch<T>(path, { method: 'DELETE' });
