'use client';

/** 기업 폴더 탭 — 기업DB를 이 기업으로 걸러 보여준다(P2-7) */
import { FileBrowser } from './FileBrowser';

export function FolderTab({ companyId, companyName }: { companyId: string; companyName: string }) {
  return <FileBrowser companyId={companyId} title={`${companyName} 폴더`} />;
}

export default FolderTab;
