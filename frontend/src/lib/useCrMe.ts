'use client';

import { useEffect, useState } from 'react';
import { crGet } from '@/lib/companyReportApi';

/** 기업 리포트 화면의 관리자 여부(승인·발송 설정 버튼 표시용) */
export function useCrMe() {
  const [me, setMe] = useState<{ id: string; is_admin: boolean } | null>(null);
  useEffect(() => {
    crGet<{ id: string; is_admin: boolean }>('/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  return me;
}
