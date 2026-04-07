'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TabNavigation } from './components/TabNavigation';
import { CustomerSelector } from './components/CustomerSelector';
import { DesiredPlanTab } from './components/tab1/DesiredPlanTab';
import { InvestmentFlowTab } from './components/tab2/InvestmentFlowTab';
import { RetirementPlanTab } from './components/tab3/RetirementPlanTab';
import { InteractiveCalcTab } from './components/tab4/InteractiveCalcTab';
import { PensionPlanTab } from './components/tab5/PensionPlanTab';
import { useRetirementStore, type RetirementTab } from './hooks/useRetirementStore';

const VALID_TABS: RetirementTab[] = [
  'desired-plan',
  'investment-flow',
  'retirement-plan',
  'interactive-calc',
  'pension-plan',
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
      case 'interactive-calc':
        return <InteractiveCalcTab />;
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
      {/* 탭 네비게이션 */}
      <TabNavigation />

      {/* 고객 선택 바 */}
      <CustomerSelector />

      {/* 탭 콘텐츠 */}
      <div style={{ padding: '24px' }}>{renderTab()}</div>
    </div>
  );
}

export default function RetirementPage() {
  return (
    <div>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: '20px' }}>
        <h1
          style={{
            fontSize: '20px',
            fontWeight: '700',
            color: '#1E3A5F',
            margin: 0,
          }}
        >
          Wrap 은퇴설계
        </h1>
        <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '4px 0 0' }}>
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
