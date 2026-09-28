'use client';

import { ComingSoon } from './ComingSoon';

/** 기업 폴더 탭 — 기업DB를 이 기업으로 걸러 보여준다(P2-7에서 구현) */
export function FolderTab({ companyId, companyName }: { companyId: string; companyName: string }) {
  void companyId;
  return <ComingSoon title={`${companyName} 폴더`} phase="P2" desc="기업DB 화면(P2-7)과 함께 열립니다." />;
}

export default FolderTab;
