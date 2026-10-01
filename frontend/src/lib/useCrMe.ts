'use client';

import { useCallback, useEffect, useState } from 'react';
import { crGet } from '@/lib/companyReportApi';

export interface CrMe {
  id: string;
  name?: string;
  is_admin: boolean;
  can_claim?: boolean;
  is_owner?: boolean;
  /** 매니저 본인 자동 발송 상태(2026-10-01) */
  self_send?: { enabled: boolean; has_phone: boolean; phone_masked: string | null; company_count: number };
}

/** 기업 리포트 화면의 관리자 여부(승인·발송 설정 버튼 표시용). reload로 다시 읽는다 */
export function useCrMe(): CrMe | null;
export function useCrMe(withReload: true): [CrMe | null, () => void];
export function useCrMe(withReload?: boolean) {
  const [me, setMe] = useState<CrMe | null>(null);
  const load = useCallback(() => {
    crGet<CrMe>('/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return withReload ? [me, load] : me;
}
