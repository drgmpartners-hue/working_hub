'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** /content/company-report → 브리핑 탭으로 연다 */
export default function CompanyReportIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/content/company-report/briefing');
  }, [router]);
  return null;
}
