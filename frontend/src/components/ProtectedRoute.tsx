/**
 * Protected route component that redirects unauthenticated users.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { authLib } from '@/lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const { token, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;
    if (!token) {
      router.push('/login');
      return;
    }
    // 저장소 불일치 감지: zustand(auth-storage)엔 토큰이 있는데 실제 API용
    // access_token이 없으면 "화면은 뜨는데 모든 API가 401"인 상태가 된다 → 정리 후 재로그인.
    if (!authLib.getToken()) {
      authLib.clearAllAuth();
      router.push('/login');
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
