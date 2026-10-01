/** 대표 관리 화면 공용 타입·호출 (docs/login_logic P4). */
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import type { CSSProperties } from 'react';

export interface ManagerStats {
  clients: number;
  accounts: number;
  commission_calculations: number;
  content_projects: number;
  portfolio_analyses: number;
  messages_7d: number;
  new_clients_7d: number;
}

export interface ManagerRow {
  id: string;
  email: string;
  nickname: string;
  phone: string | null;
  role: 'owner' | 'manager';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  deactivated_at: string | null;
  /** 사용 프로그램 (docs/login_logic P11): null = 전부 */
  allowed_programs?: string[] | null;
  programs?: string[];
  stats: ManagerStats;
}

export interface Overview {
  totals: {
    managers: number;
    owners: number;
    clients: number;
    accounts: number;
    commission_calculations: number;
    content_projects: number;
    portfolio_analyses: number;
  };
  by_manager: ManagerRow[];
  unassigned_clients: number;
  recent_activity: {
    created_at: string;
    actor: string | null;
    effective: string | null;
    is_impersonated: boolean;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
  }[];
}

export interface ManagerSummary {
  manager: Omit<ManagerRow, 'stats'>;
  stats: ManagerStats;
  clients: { id: string; name: string; unique_code: string | null; created_at: string; accounts: number }[];
  recent_commission_calculations: { id: string; calc_type: string; status: string; created_at: string }[];
  recent_content_projects: { id: string; title: string; content_type: string; status: string; created_at: string }[];
  recent_portfolio_analyses: { id: string; data_source: string; status: string; created_at: string }[];
  recent_messages: { id: string; message_type: string; summary: string; sent_at: string; client_name: string }[];
}

/** 서버 오류 메시지(detail)를 그대로 보여 주는 fetch 래퍼. */
export async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader(), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = '요청을 처리하지 못했습니다.';
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') msg = body.detail;
    } catch { /* 본문 없음 */ }
    if (res.status === 404) msg = '대상을 찾을 수 없습니다.';
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v.endsWith('Z') || v.includes('+') ? v : v + 'Z');
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '-';
  return v.slice(0, 10);
}

export const cell: CSSProperties = { padding: '11px 14px', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' };
export const headCell: CSSProperties = {
  padding: '11px 14px', textAlign: 'left', fontWeight: 600, fontSize: '0.8125rem',
  color: 'var(--text-secondary)', whiteSpace: 'nowrap', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
};

export interface AuditItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor: string | null;
  effective_id: string | null;
  effective: string | null;
  is_impersonated: boolean;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  client_id: string | null;
  client_name: string | null;
  method: string | null;
  path: string | null;
  status_code: number | null;
  ip: string | null;
}

export const ACTION_LABEL: Record<string, string> = {
  create: '등록',
  update: '수정',
  delete: '삭제',
  impersonate_start: '대행 시작',
  impersonate_end: '대행 종료',
  transfer: '담당자 이관',
  transfer_all: '고객 일괄 이관',
  view_ssn: '주민번호 조회',
  login: '로그인',
  login_failed: '로그인 실패',
};

/** 경로 첫 조각 → 사람이 읽는 메뉴 이름 */
export const RESOURCE_LABEL: Record<string, string> = {
  clients: '고객 정보',
  snapshots: '포트폴리오 스냅샷',
  'client-portal': '고객 포털',
  'call-reservations': '통화 예약',
  'message-logs': '문자 이력',
  messaging: '문자 발송',
  reports: '보고서',
  'retirement/profiles': '은퇴 프로필',
  'retirement/desired-plans': '희망 은퇴 플랜',
  'retirement/plans': '은퇴 플랜',
  'retirement/pension': '연금 계획',
  'retirement/investment-records': '투자 기록',
  'retirement/deposit-accounts': '예수금 계좌',
  'retirement/deposit-transactions': '예수금 거래',
  'retirement/wrap-accounts': '투자상품',
  'retirement/simulation': '은퇴 시뮬레이션',
  'product-master': '증권사 상품',
  'product-name-changes': '상품명 변경',
  'recommended-portfolio': '추천 포트폴리오',
  commissions: '수당 정산',
  content: '콘텐츠',
  portfolios: '포트폴리오 분석·제안',
  'sms-templates': '문자 템플릿',
  'field-options': '드롭다운 설정',
  'user-api-keys': 'API 키',
  managers: '매니저 계정',
  users: '계정 정보',
  brand: '브랜드 설정',
  settings: 'AI 설정',
  stock: '주식·ETF',
  'company-report': '기업 리포트',
  upload: '파일 업로드',
  crawling: '크롤링',
  auth: '로그인·비밀번호',
};
