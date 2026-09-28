/**
 * Protected route component that redirects unauthenticated users.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { authLib } from '@/lib/auth';

/** 현재 경로를 ?next=로 넘겨 로그인 후 원래 화면(예: 알림톡 링크)으로 돌아오게 한다. */
function loginUrl(): string {
  if (typeof window === 'undefined') return '/login';
  const here = window.location.pathname + window.location.search;
  return here && here !== '/' ? `/login?next=${encodeURIComponent(here)}` : '/login';
}

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const { token, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.push(loginUrl());
      return;
    }
    // 저장소 불일치 감지: zustand(auth-storage)엔 토큰이 있는데 실제 API용
    // access_token이 없으면 "화면은 뜨는데 모든 API가 401"인 상태가 된다 → 정리 후 재로그인.
    if (!authLib.getToken()) {
      authLib.clearAllAuth();
      router.push(loginUrl());
    }
  }, [token, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return <>{children}</>;
}

export default ProtectedRoute;
