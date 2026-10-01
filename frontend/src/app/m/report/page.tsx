'use client';

/** 고객용 반기 보고서 폰 화면(로그인 없음) — /m/report?t=열쇠값 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MobileReportPage } from '@/components/company-report/MobileReport';

function Inner() {
  const t = useSearchParams().get('t') || '';
  return <MobileReportPage token={t} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
