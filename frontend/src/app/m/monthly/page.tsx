'use client';

/** 폰 전용 monthly 브리핑(로그인 없음) — /m/monthly?t=열쇠값 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MobileBriefingPage } from '@/components/company-report/MobileBriefing';

function Inner() {
  const t = useSearchParams().get('t') || '';
  return <MobileBriefingPage kind="monthly" token={t} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
