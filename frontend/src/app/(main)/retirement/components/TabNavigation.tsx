'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRetirementStore, type RetirementTab } from '../hooks/useRetirementStore';

interface TabItem {
  key: RetirementTab;
  label: string;
}

const TABS: TabItem[] = [
  { key: 'desired-plan', label: '은퇴플랜 설계' },
  { key: 'retirement-plan', label: '은퇴플랜' },
  { key: 'pension-plan', label: '연금수령 계획' },
  { key: 'investment-flow', label: '투자흐름' },
];

export function TabNavigation() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeTab, setTab } = useRetirementStore();

  const handleTabClick = (tab: RetirementTab) => {
    setTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`/retirement?${params.toString()}`);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        height: '48px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-card)',
        paddingLeft: '24px',
        paddingRight: '24px',
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            style={{
              height: '48px',
              padding: '0 16px',
              fontSize: '14px',
              fontWeight: isActive ? '600' : '400',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid #2E8B8B' : '2px solid transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              background: 'none',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
