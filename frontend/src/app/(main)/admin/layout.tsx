/**
 * 대표 전용 관리 화면 가드 (docs/login_logic P7-2, 결정 D-3).
 * 매니저가 /admin 으로 들어오면 /home 으로 보낸다.
 * 화면 가드는 편의일 뿐 — 실제 차단은 서버(require_owner)가 한다.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((st) => st.user);
  const isLoading = useAuthStore((st) => st.isLoading);

  useEffect(() => {
    if (!isLoading && user && user.role !== 'owner') router.replace('/home');
  }, [user, isLoading, router]);

  if (!user) {
    return <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>;
  }
  if (user.role !== 'owner') return null;
  return <>{children}</>;
}
