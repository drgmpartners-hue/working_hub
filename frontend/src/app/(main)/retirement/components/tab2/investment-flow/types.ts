/** 투자 흐름 탭 — 타입·라벨 상수 (수정_tasks P2-4: InvestmentFlowTab.tsx 에서 동작 변경 없이 분리) */

/* ------------------------------------------------------------------ */
/*  타입 정의                                                           */
/* ------------------------------------------------------------------ */

export interface InvestmentRecord {
  id: number;
  profile_id: string;
  wrap_account_id: number | null;
  deposit_account_id: number | null;
  record_type: 'investment' | 'additional_savings' | 'withdrawal';
  product_name: string | null;
  investment_amount: number;
  evaluation_amount: number | null;
  return_rate: number | null;
  status: 'ing' | 'exit' | 'deposit';
  start_date: string;
  end_date: string | null;
  join_date?: string | null;
  expected_maturity_date?: string | null;
  actual_maturity_date?: string | null;
  original_maturity_date?: string | null;
  predecessor_id: number | null;
  successor_id: number | null;
  interim_evaluations: Record<string, number> | null;
  memo: string | null;
}

export interface AnnualFlowRow {
  year: number;
  age: number | null;
  order_in_year: number | null;
  lump_sum: number;
  annual_savings: number;
  total_contribution: number;
  annual_return: number;
  annual_evaluation: number;
  annual_return_rate: number;
  deposit_in: number;
  cumulative_deposit_in: number;
  withdrawal: number;
  cumulative_withdrawal: number;
  total_evaluation: number;
}

export interface WrapAccount {
  id: number;
  product_name: string;
  securities_company: string;
  is_active: boolean;
}

export type StatusFilter = 'all' | 'ing' | 'exit' | 'deposit';

/* ---- 예수금 계좌 타입 ---- */
export interface DepositAccount {
  id: number;
  customer_id: string;
  securities_company: string;
  account_number: string | null;
  nickname: string | null;
  current_balance: number;
  is_active: boolean;
  created_at: string;
}

export type TransactionType = 'investment' | 'termination' | 'deposit' | 'withdrawal' | 'interest' | 'savings' | 'other';

export interface DepositTransaction {
  id: number;
  account_id: number;
  transaction_date: string;
  transaction_type: TransactionType;
  related_product: string | null;
  investment_record_id: number | null;
  credit_amount: number;
  savings_amount: number;
  debit_amount: number;
  balance: number;
  memo: string | null;
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  investment: '투자',
  termination: '종료',
  deposit: '입금',
  withdrawal: '출금',
  interest: '이자',
  savings: '적립',
  other: '기타',
};

export const TRANSACTION_TYPE_COLORS: Record<TransactionType, string> = {
  investment: '#3B82F6',
  termination: '#10B981',
  deposit: '#3B82F6',
  withdrawal: '#EF4444',
  interest: '#D4A847',
  savings: '#8B5CF6',
  other: '#6B7280',
};

export const STATUS_LABELS: Record<string, string> = {
  ing: '운용중',
  exit: '종결',
  deposit: '적립',
};

export const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  ing: { bg: 'rgba(59,130,246,0.13)', text: '#60A5FA', dot: '#3B82F6' },
  exit: { bg: 'rgba(16,185,129,0.12)', text: '#34D399', dot: '#22C55E' },
  deposit: { bg: 'rgba(245,158,11,0.12)', text: '#FCD34D', dot: '#F59E0B' },
};

export const RECORD_TYPE_LABELS: Record<string, string> = {
  investment: '신규투자',
  additional_savings: '추가적립',
  withdrawal: '인출',
};
