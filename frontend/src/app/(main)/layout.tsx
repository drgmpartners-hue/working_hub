/**
 * Layout for the (main) route group.
 * 상단 글로벌 네비(TopNav) + ProtectedRoute.
 * 전체 어드바이저 앱은 다크 테마(.wh).
 * - /home: 풀블리드
 * - 데이터관리/투자분석 데이터 밀집 페이지: 풀폭(full-width)
 * - 그 외: 1280px 컨테이너
 */
'use client';

import { usePathname } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { TopNav } from '@/components/common/TopNav';

interface MainLayoutProps {
  children: React.ReactNode;
}

/* 데이터관리 · 투자분석 메뉴 — 화면 전폭을 쓰는 페이지들 */
const FULL_WIDTH_ROUTES = [
  '/customer-management',          // 고객 정보 관리
  '/portfolio/product-master',     // 증권사 상품 관리
  '/data-management',              // 투자상품 관리(wrap-accounts)
  '/portfolio/irp',                // 주식, 펀드 관리
  '/retirement',                   // 은퇴플랜 관리
  '/investment',                   // 주식·ETF 추천
];

export default function MainLayout({ children }: MainLayoutProps) {
  const pathname = usePathname();
  const isHome = pathname === '/home';
  const isFullWidth = FULL_WIDTH_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/')
  );

  return (
    <ProtectedRoute>
      <div style={{ minHeight: '100vh', backgroundColor: '#0B1220' }}>
        {/* Sticky top nav */}
        <TopNav />

        {/* Page content — 전 페이지 다크(.wh) */}
        {isHome ? (
          <main className="wh">{children}</main>
        ) : (
          <main
            className="wh"
            style={
              isFullWidth
                ? { maxWidth: 'var(--wh-maxw)', margin: '0 auto', padding: '24px var(--sp-12)' }
                : { maxWidth: '1280px', margin: '0 auto', padding: '24px' }
            }
          >
            {children}
          </main>
        )}
      </div>
    </ProtectedRoute>
  );
}
