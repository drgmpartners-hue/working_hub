/**
 * 고객용 보고서에 찍는 '담당 OOO · 연락처' (docs/login_logic P9, 결정 D-7).
 * 로고·회사명은 Dr.GM 으로 통일하고, 담당자는 그 고객의 담당 매니저(고객 정보 관리의 담당자)를 쓴다.
 * 연락처는 매니저 본인의 '내 정보'(이름·전화번호)에서 온다.
 */
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

export interface ReportManager {
  nickname: string;
  phone?: string | null;
  email?: string | null;
}

export const REPORT_BRAND = 'Dr.GM Family Office';

export function contactLine(m?: ReportManager | null): string {
  if (!m || !m.nickname) return '';
  return [`담당 ${m.nickname}`, m.phone || '', m.email || ''].filter(Boolean).join(' · ');
}

/** PDF(jsPDF) 생성기가 푸터에 그릴 한 줄. 생성 직전에 setPdfContact 로 넣는다. */
let pdfContact = '';
export function setPdfContact(line: string) {
  pdfContact = line || '';
}
export function getPdfContact(): string {
  return pdfContact;
}

/** 고객 id → 담당 매니저 연락처 한 줄. 못 읽으면 빈 문자열(보고서는 그대로 만든다). */
export async function loadClientContact(clientId?: string | null): Promise<string> {
  if (!clientId) return '';
  try {
    const res = await fetch(`${API_URL}/api/v1/clients/${clientId}`, { headers: { ...authLib.getAuthHeader() } });
    if (!res.ok) return '';
    const c = (await res.json()) as { manager?: ReportManager | null };
    return contactLine(c.manager);
  } catch {
    return '';
  }
}
