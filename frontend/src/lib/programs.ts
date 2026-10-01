/**
 * 매니저별 사용 프로그램 (docs/login_logic P11).
 * 키는 백엔드 app/core/programs.py 와 같다. 대표는 언제나 전부, 매니저는 대표가 열어 준 것만.
 * 서버(/users/me 의 programs)가 최종 목록을 내려 주므로 화면은 그것만 본다.
 */
import type { User } from '@/types/auth';

export interface ProgramDef {
  key: string;
  label: string;
  group: string;
  /** 이 주소로 시작하는 화면이 이 프로그램 */
  paths: string[];
}

export const PROGRAMS: ProgramDef[] = [
  { key: 'customers', label: '고객 정보 관리', group: '데이터 관리', paths: ['/customer-management'] },
  { key: 'product_master', label: '증권사 상품 관리', group: '데이터 관리', paths: ['/portfolio/product-master'] },
  { key: 'wrap_accounts', label: '투자상품 관리', group: '데이터 관리', paths: ['/data-management/wrap-accounts'] },
  { key: 'commission_drgm', label: 'Dr.GM 수당정산', group: '업무 자동화', paths: ['/commission/dr-gm'] },
  { key: 'commission_securities', label: '증권사 수당정산', group: '업무 자동화', paths: ['/commission/securities'] },
  { key: 'portfolio', label: '주식, 펀드 관리', group: '투자 분석', paths: ['/portfolio/irp', '/portfolio/pension'] },
  { key: 'retirement', label: '은퇴플랜 관리', group: '투자 분석', paths: ['/retirement'] },
  { key: 'stock_recommend', label: '주식·ETF 추천', group: '투자 분석', paths: ['/investment'] },
  { key: 'company_report', label: '기업 리포트', group: '콘텐츠 제작', paths: ['/content/company-report'] },
];

export const PROGRAM_KEYS = PROGRAMS.map((p) => p.key);

/** 주소 → 프로그램 키(해당 없으면 null: 메인·대시보드·내 정보 등 누구나) */
export function programForPath(pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const p of PROGRAMS) {
    for (const prefix of p.paths) {
      if ((pathname === prefix || pathname.startsWith(prefix + '/')) && (!best || prefix.length > best.len)) {
        best = { key: p.key, len: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}

/** 이 사용자가 프로그램을 쓸 수 있는지. 목록을 아직 모르면(구버전 응답) 막지 않는다 */
export function canUse(user: User | null | undefined, key: string | null): boolean {
  if (!key || !user) return true;
  if (user.role === 'owner') return true;
  if (!Array.isArray(user.programs)) return true;
  return user.programs.includes(key);
}

/** 메뉴 링크(href) 기준 */
export function canOpen(user: User | null | undefined, href: string): boolean {
  return canUse(user, programForPath(href));
}

export function programLabel(key: string): string {
  return PROGRAMS.find((p) => p.key === key)?.label ?? key;
}
