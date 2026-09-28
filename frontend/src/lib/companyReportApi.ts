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

/** 인증이 필요한 파일 받기(미리보기·다운로드·zip) */
export async function crBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const token = authLib.getToken();
  const res = await fetch(`${CR_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let detail = `요청 실패 (${res.status})`;
    try {
      const b = await res.json();
      if (b?.detail) detail = String(b.detail);
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(res.status, detail);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : null };
}

export async function crDownload(path: string, fallbackName = 'download') {
  const { blob, filename } = await crBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function crUpload<T>(path: string, form: FormData): Promise<T> {
  return crFetch<T>(path, { method: 'POST', body: form });
}
