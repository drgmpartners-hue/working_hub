'use client';

/**
 * 콘텐츠 제작 > 기업 리포트
 * 상단 탭: 투자기업 관리 · 브리핑 · 보고서 관리 · 기업DB · 발송 설정 (+ 공통 검색창)
 * 기업 상세(/companies/[id])는 투자기업 관리 탭 안에서 열린다.
 */
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Tab } from '@/components/common/Tab';

const TABS = [
  { key: 'companies', label: '투자기업 관리', href: '/content/company-report/companies' },
  { key: 'briefing', label: '브리핑', href: '/content/company-report/briefing' },
  { key: 'reports', label: '보고서 관리', href: '/content/company-report/reports' },
  { key: 'db', label: '기업DB', href: '/content/company-report/db' },
  { key: 'settings', label: '발송 설정', href: '/content/company-report/settings' },
];

export default function CompanyReportLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [q, setQ] = useState('');
  const active = TABS.find((t) => pathname.startsWith(t.href))?.key ?? 'briefing';

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/content/company-report/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>기업 리포트</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            투자기업 뉴스 브리핑 · 월간 브리핑 · 반기 기업 종합보고서
          </p>
        </div>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="기업명·키워드 통합 검색"
            aria-label="통합 검색"
            style={{
              width: 260,
              padding: '8px 12px',
              fontSize: 14,
              borderRadius: 8,
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <button type="submit" className="wh-btn wh-btn-ghost wh-btn-sm">검색</button>
        </form>
      </div>
      <Tab
        items={TABS.map(({ key, label }) => ({ key, label }))}
        activeKey={active}
        onChange={(key) => {
          const t = TABS.find((x) => x.key === key);
          if (t) router.push(t.href);
        }}
      />
      <div>{children}</div>
    </div>
  );
}
