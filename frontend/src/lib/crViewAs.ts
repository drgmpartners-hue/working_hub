/**
 * 기업 리포트 — 대표의 [담당자 선택] (docs/login_logic P9).
 *
 * 값: '' = 전체(모든 담당자 기업), 'company' = 회사 공통만, 매니저 id = 그 매니저 화면 그대로.
 * 기업 리포트 API 호출마다 X-View-As 헤더로 보낸다. 매니저 계정이면 서버가 무시한다(항상 자기 화면).
 * 선택은 이 브라우저에만 기억한다(편의 기능).
 */
'use client';

import { useSyncExternalStore } from 'react';

const KEY = 'cr_view_as';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return (typeof window !== 'undefined' && window.localStorage.getItem(KEY)) || '';
  } catch {
    return '';
  }
}

let current = read();

export function getViewAs(): string {
  return current;
}

export function setViewAs(v: string) {
  current = v || '';
  try {
    if (current) window.localStorage.setItem(KEY, current);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* 저장 실패는 무시(이번 화면에서만 유지) */
  }
  listeners.forEach((l) => l());
}

export function useViewAs(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => '',
  );
}

/** 지금 화면이 '매니저 한 명의 화면'인지 (매니저 본인이거나, 대표가 매니저를 고른 상태) */
export function isManagerView(role: string | undefined, viewAs: string): boolean {
  if (role !== 'owner') return true;
  return !!viewAs && viewAs !== 'company';
}

export function viewAsHeader(): Record<string, string> {
  return current ? { 'X-View-As': current } : {};
}
