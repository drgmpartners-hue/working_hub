/**
 * Layout for the (main) route group.
 * 상단 글로벌 네비(TopNav) + ProtectedRoute.
 * 전체 어드바이저 앱은 다크 테마(.wh).
 * - /home: 풀블리드
 * - 그 외 전 메뉴: 공통 1600px 컨테이너(--wh-maxw) + 양쪽 여백 40px
 */
'use client';

import { usePathname } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AuthFetchGuard } from '@/components/AuthFetchGuard';
import { TopNav } from '@/components/common/TopNav';
import { ImpersonationBanner } from '@/components/common/ImpersonationBanner';
import { ProgramGuard } from '@/components/common/ProgramGuard';

interface MainLayoutProps {
  children: React.ReactNode;
}

export default function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const isHome = pathname === '/home';

  return (
    <ProtectedRoute>
      <AuthFetchGuard />
      <div style={{ minHeight: '100vh', backgroundColor: '#0B1220' }}>
        {/* Sticky top: 대행 배너(대행 중일 때만) + 상단 네비 — 스크롤해도 사라지지 않음 */}
        <div style={{ position: 'sticky', top: 0, zIndex: 45 }}>
          <ImpersonationBanner />
          <TopNav />
        </div>

        {/* Page content — 전 페이지 다크(.wh), 전 메뉴 동일 1600px 컨테이너 */}
        {isHome ? (
          <main className="wh"><ProgramGuard>{children}</ProgramGuard></main>
        ) : (
          <main className="wh" style={{ maxWidth: 'var(--wh-maxw)', margin: '0 auto', padding: '24px 40px' }}>
            <ProgramGuard>{children}</ProgramGuard>
          </main>
        )}
      </div>
    </ProtectedRoute>
  );
}
