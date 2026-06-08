'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

/* ------------------------------------------------------------------ */
/*  Nav model — 실제 라우트 기반                                          */
/* ------------------------------------------------------------------ */

interface SubItem {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
}
interface NavGroup {
  label: string;
  href?: string; // 단일 링크일 때
  match: string[]; // active 판정용 경로 prefix
  items?: SubItem[];
}

const ic = {
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
  ),
  grid: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
  ),
  chart: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 5-6" /></svg>
  ),
  doc: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
  ),
  gear: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>
  ),
  receipt: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
  ),
  shield: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
  ),
  trend: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
  ),
  image: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>
  ),
};

const NAV: NavGroup[] = [
  { label: '메인', href: '/home', match: ['/home'] },
  { label: '대시보드', href: '/dashboard', match: ['/dashboard'] },
  {
    label: '데이터 관리',
    match: ['/customer-management', '/portfolio/product-master', '/data-management'],
    items: [
      { title: '고객 정보 관리', desc: '프로필·계좌·고유번호', href: '/customer-management', icon: ic.users },
      { title: '증권사 상품 관리', desc: '상품·위험도·지역 마스터', href: '/portfolio/product-master', icon: ic.grid },
      { title: '투자상품 관리', desc: '투자 상품 등록·관리', href: '/data-management/wrap-accounts', icon: ic.chart },
    ],
  },
  {
    label: '업무 자동화',
    match: ['/commission'],
    items: [
      { title: 'Dr.GM 수당정산', desc: '엑셀 업로드 자동 계산', href: '/commission/dr-gm', icon: ic.gear },
      { title: '증권사 수당정산', desc: '크롤링·정산 검증', href: '/commission/securities', icon: ic.receipt },
    ],
  },
  {
    label: '투자 분석',
    match: ['/portfolio/irp', '/retirement', '/investment'],
    items: [
      { title: '증권사 투자 상품 관리기', desc: 'IRP/연금 수익률·리밸런싱', href: '/portfolio/irp', icon: ic.doc },
      { title: 'Wrap 은퇴설계', desc: '현금흐름 시뮬레이션', href: '/retirement', icon: ic.shield },
      { title: '주식·ETF 추천', desc: '테마별 AI 추천', href: '/investment/stock-recommend', icon: ic.trend },
    ],
  },
  {
    label: '콘텐츠 제작',
    match: ['/content'],
    items: [
      { title: '카드뉴스 제작', desc: 'AI 카드뉴스 생성', href: '/content/card-news', icon: ic.image },
      { title: '보고서 제작', desc: 'AI 브랜드 보고서', href: '/content/report', icon: ic.doc },
      { title: '표지/홍보 디자인', desc: 'AI 표지·홍보 생성', href: '/content/cover-promo', icon: ic.image },
    ],
  },
];

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout, isLoading } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const isActive = (g: NavGroup) => g.match.some((m) => pathname === m || pathname.startsWith(m + '/'));

  const displayName = user?.nickname || user?.email || 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <header className="wh-topbar">
      <div className="wh-topbar-inner">
        {/* Brand */}
        <Link href="/home" className="wh-brand" aria-label="Working Hub 홈">
          <div className="mark" />
          <div className="name">Working<span> Hub</span></div>
        </Link>

        {/* Main nav */}
        <nav className="wh-mainnav">
          {NAV.map((g) =>
            g.items ? (
              <div key={g.label} className="wh-nav-item">
                <a className={isActive(g) ? 'active' : ''}>
                  {g.label} <span className="wh-caret" />
                </a>
                <div className="wh-submenu">
                  {g.items.map((it) => (
                    <Link key={it.href} href={it.href}>
                      <span className="si">{it.icon}</span>
                      <span className="st">{it.title}<small>{it.desc}</small></span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div key={g.label} className="wh-nav-item">
                <Link href={g.href!} className={isActive(g) ? 'active' : ''}>{g.label}</Link>
              </div>
            )
          )}
        </nav>

        {/* Actions */}
        <div className="wh-topbar-actions">
          <button className="wh-icon-btn" title="알림" type="button">
            <span className="dot" />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </button>
          <button className="wh-icon-btn" title="설정" type="button" onClick={() => router.push('/settings')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <button className="wh-avatar" type="button" onClick={() => router.push('/profile')}>
            <span className="pic">{initials}</span>
            <span className="meta"><b>{displayName}</b><small>Working Hub</small></span>
          </button>
          <button className="wh-icon-btn" title="로그아웃" type="button" onClick={handleLogout} disabled={isLoading}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export default TopNav;
