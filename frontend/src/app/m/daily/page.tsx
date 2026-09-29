'use client';

/** 폰 전용 daily 브리핑(로그인 없음) — /m/daily?t=열쇠값 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MobileBriefingPage } from '@/components/company-report/MobileBriefing';

function Inner() {
  const t = useSearchParams().get('t') || '';
  return <MobileBriefingPage kind="daily" token={t} />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
