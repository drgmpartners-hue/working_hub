'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TabNavigation } from './components/TabNavigation';
import { CustomerSelector } from './components/CustomerSelector';
import { DesiredPlanTab } from './components/tab1/DesiredPlanTab';
import { InvestmentFlowTab } from './components/tab2/InvestmentFlowTab';
import { RetirementPlanTab } from './components/tab3/RetirementPlanTab';
import { PensionPlanTab } from './components/tab5/PensionPlanTab';
import Link from 'next/link';
import { useRetirementStore, type RetirementTab } from './hooks/useRetirementStore';

const VALID_TABS: RetirementTab[] = [
  'desired-plan',
  'retirement-plan',
  'pension-plan',
  'investment-flow',
];

function isValidTab(value: string | null): value is RetirementTab {
  return VALID_TABS.includes(value as RetirementTab);
}

function RetirementContent() {
  const searchParams = useSearchParams();
  const { activeTab, setTab } = useRetirementStore();

  // URL query param과 store 동기화
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isValidTab(tabParam)) {
      setTab(tabParam);
    } else {
      setTab('desired-plan');
    }
  }, [searchParams, setTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'desired-plan':
        return <DesiredPlanTab />;
      case 'investment-flow':
        return <InvestmentFlowTab />;
      case 'retirement-plan':
        return <RetirementPlanTab />;
      case 'pension-plan':
        return <PensionPlanTab />;
      default:
        return <DesiredPlanTab />;
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* 고객 선택 바 (탭 위에 배치 - 전체 탭에 공통 적용) */}
      <div className="no-print"><CustomerSelector /></div>

      {/* 탭 네비게이션 */}
      <div className="no-print"><TabNavigation /></div>

      {/* 탭 콘텐츠 */}
      <div style={{ padding: '24px' }}>{renderTab()}</div>
    </div>
  );
}

export default function RetirementPage() {
  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="no-print" style={{ marginBottom: '20px' }}>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            marginBottom: '12px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6B7280',
            fontSize: '0.8125rem',
            textDecoration: 'none',
            padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </Link>

        <div
          style={{
            width: 32,
            height: 4,
            borderRadius: 2,
            background: 'linear-gradient(90deg,#3B82F6 0%,#1E3A5F 100%)',
            marginBottom: 10,
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: '1.375rem',
            fontWeight: 800,
            color: '#1A1A2E',
            letterSpacing: '-0.4px',
          }}
        >
          Wrap 은퇴설계
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
          고객별 은퇴설계 플랜을 관리합니다.
        </p>
      </div>

      {/* 메인 컨텐츠 - useSearchParams를 위한 Suspense 경계 */}
      <Suspense
        fallback={
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              height: '400px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9CA3AF',
            }}
          >
            로딩 중...
          </div>
        }
      >
        <RetirementContent />
      </Suspense>
    </div>
  );
}
