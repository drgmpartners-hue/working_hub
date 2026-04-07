'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRetirementStore, type RetirementTab } from '../hooks/useRetirementStore';

interface TabItem {
  key: RetirementTab;
  label: string;
}

const TABS: TabItem[] = [
  { key: 'desired-plan', label: '희망은퇴플랜' },
  { key: 'investment-flow', label: '투자흐름' },
  { key: 'retirement-plan', label: '은퇴플랜' },
  { key: 'interactive-calc', label: '인터랙티브 계산기' },
  { key: 'pension-plan', label: '연금수령 계획' },
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
        borderBottom: '1px solid #E5E7EB',
        backgroundColor: '#ffffff',
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
              color: isActive ? '#1E3A5F' : '#6B7280',
              borderBottom: isActive ? '2px solid #1E3A5F' : '2px solid transparent',
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
