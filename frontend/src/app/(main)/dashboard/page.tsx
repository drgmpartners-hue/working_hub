/**
 * Dashboard page — /dashboard
 * Shows three accordion category groups, each collapsed by default.
 * Clicking a group reveals program cards that navigate to their routes.
 */
'use client';

import { motion } from 'framer-motion';
import { CategoryGroup, type Program } from '@/components/dashboard/CategoryGroup';
import { useAuthStore } from '@/stores/auth';

/* ------------------------------------------------------------------ */
/*  Category data                                                        */
/* ------------------------------------------------------------------ */

const CATEGORIES: Array<{
  id: string;
  name: string;
  icon: React.ReactNode;
  headerBg: string;
  accentColor: string;
  programs: Program[];
}> = [
  {
    id: 'business-automation',
    name: '업무 자동화',
    accentColor: '#1E3A5F',
    headerBg: '#EEF2F7',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    programs: [
      {
        title: 'Dr.GM 수당정산 계산기',
        description: 'Dr.GM 엑셀 데이터를 업로드하여 수당을 자동 계산합니다',
        href: '/commission/dr-gm',
      },
      {
        title: '증권사 수당정산 계산기',
        description: '증권사 수당 데이터를 크롤링/업로드하여 정산합니다',
        href: '/commission/securities',
      },
    ],
  },
  {
    id: 'investment-analysis',
    name: '투자 분석',
    accentColor: '#2E8B8B',
    headerBg: '#EBF5F5',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    programs: [
      {
        title: 'IRP 포트폴리오 수익률 관리기',
        description: 'IRP 포트폴리오 수익률을 분석하고 리밸런싱을 제안합니다',
        href: '/portfolio/irp',
      },
      {
        title: '상품 마스터 관리',
        description: '상품명 · 위험도 · 지역 매핑 마스터 데이터를 관리합니다',
        href: '/portfolio/product-master',
      },
      {
        title: '주식/ETF 추천 프로그램',
        description: '테마별 주식/ETF를 AI로 분석하고 추천합니다',
        href: '/investment/stock-recommend',
      },
    ],
  },
  {
    id: 'content-creation',
    name: '콘텐츠 제작',
    accentColor: '#D4A847',
    headerBg: '#FBF6EA',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
    programs: [
      {
        title: '카드뉴스 제작',
        description: 'AI로 카드뉴스 콘텐츠를 자동 생성합니다',
        href: '/content/card-news',
      },
      {
        title: '보고서 제작',
        description: 'AI로 브랜드 보고서를 자동 생성합니다',
        href: '/content/report',
      },
      {
        title: '표지/홍보페이지 디자인',
        description: 'AI로 표지와 홍보 디자인을 자동 생성합니다',
        href: '/content/cover-promo',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Stagger animation variants                                          */
/* ------------------------------------------------------------------ */

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  },
};

/* ------------------------------------------------------------------ */
/*  Page component                                                       */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user } = useAuthStore();

  const displayName = user?.nickname || user?.email || '';
  const greeting = displayName ? `안녕하세요, ${displayName}님` : '대시보드';

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        style={{ marginBottom: '32px' }}
      >
        {/* Top rule accent */}
        <div
          style={{
            width: '40px',
            height: '4px',
            borderRadius: '2px',
            background: 'linear-gradient(90deg, #1E3A5F 0%, #4A90D9 100%)',
            marginBottom: '14px',
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: '26px',
            fontWeight: 800,
            color: '#1A1A2E',
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
          }}
        >
          {greeting}
        </h1>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: '14px',
            color: '#6B7280',
          }}
        >
          사용할 프로그램을 선택하세요.
        </p>
      </motion.div>

      {/* Category accordion list */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        {CATEGORIES.map((cat) => (
          <motion.div key={cat.id} variants={itemVariants}>
            <CategoryGroup
              name={cat.name}
              icon={cat.icon}
              programs={cat.programs}
              headerBg={cat.headerBg}
              accentColor={cat.accentColor}
              badge={`${cat.programs.length}개`}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
