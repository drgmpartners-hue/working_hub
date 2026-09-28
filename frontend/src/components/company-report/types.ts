/** 기업 리포트 공용 타입 (백엔드 schemas/company_report.py 와 맞춤) */
export interface KeywordSet {
  required: string[];
  boost: string[];
  exclude: string[];
}

export interface CompanyStats {
  today: number;
  week: number;
  caution_week: number;
  total: number;
}

export interface Company {
  id: string;
  name: string;
  name_en: string | null;
  aliases: string[] | null;
  is_listed: boolean;
  stock_code: string | null;
  corp_code: string | null;
  biz_reg_no: string | null;
  ceo_name: string | null;
  industry: string | null;
  address: string | null;
  homepage: string | null;
  established_at: string | null;
  profile_source: string;
  invested_at: string | null;
  invest_type: string | null;
  invest_amount: number | null;
  memo: string | null;
  is_active: boolean;
  last_collected_at: string | null;
  created_at: string;
  keywords: KeywordSet;
  stats: CompanyStats;
}

export interface Candidate {
  source: 'dart' | 'web';
  name: string;
  name_en?: string | null;
  corp_code?: string | null;
  stock_code?: string | null;
  is_listed?: boolean;
  market?: string | null;
  ceo_name?: string | null;
  established_at?: string | null;
  address?: string | null;
  homepage?: string | null;
  industry?: string | null;
  biz_reg_no?: string | null;
  evidence: { title: string; url: string; date?: string | null }[];
}

export interface PreviewSample {
  title: string;
  url: string;
  press: string | null;
  date: string | null;
  passed: boolean;
  score: number;
  reason: string;
}

export interface PreviewResult {
  days?: number;
  count_total: number;
  count_passed: number;
  samples: PreviewSample[];
  warning?: string;
}

export interface Article {
  id: string;
  company_id: string;
  source_type: string;
  source: string;
  url: string;
  title: string;
  press: string | null;
  published_at: string | null;
  summary: string | null;
  tag: 'positive' | 'neutral' | 'caution' | null;
  issue_type: string | null;
  relevance_score: number | null;
  is_hidden: boolean;
}

/** 태그 → 기존 .wh-badge 변형 클래스 */
export const TAG_BADGE: Record<string, { label: string; cls: string }> = {
  positive: { label: '호재', cls: 'pos' },
  neutral: { label: '중립', cls: 'info' },
  caution: { label: '주의', cls: 'neg' },
};

export interface MarketRow {
  key: string;
  name: string;
  market: 'US' | 'KR';
  available: boolean;
  source?: string;
  trade_date?: string;
  open?: number | null;
  close?: number;
  change?: number | null;
  change_pct?: number | null;
}

export interface BriefingArticle {
  id: string;
  title: string;
  url: string;
  press: string | null;
  source_type: string;
  published_at: string | null;
  summary: string | null;
  tag: string | null;
  issue_type: string | null;
  more?: boolean;
}

export interface BriefingCompany {
  company_id: string;
  name: string;
  article_count: number;
  caution_count: number;
  one_liner: string | null;
  articles: BriefingArticle[];
}

export interface DailyBriefing {
  id: string;
  briefing_date: string;
  status: 'draft' | 'approved' | 'sent' | 'failed' | 'skipped';
  basic_info: {
    date?: string;
    weekday?: string;
    weather?: { region: string; available: boolean; text?: string; tmin?: number; tmax?: number; pop?: number };
    markets?: MarketRow[];
    company_total?: number;
    company_with_news?: number;
    article_count?: number;
    caution_count?: number;
  };
  overall: { text: string; source_ids: string[] }[];
  company_summaries: BriefingCompany[];
  article_count: number;
  caution_count: number;
  is_fallback: boolean;
  review_summary: { total?: number; kept?: number; removed?: number; fallback_reason?: string };
  approved_at: string | null;
  sent_at: string | null;
}

export interface BriefingListItem {
  id: string;
  briefing_date: string;
  status: string;
  article_count: number;
  caution_count: number;
  is_fallback: boolean;
}

export interface SourceRef {
  article_id?: string;
  url?: string;
  title?: string;
  date?: string | null;
}

export interface Fact {
  id: string;
  fact_type: string;
  type_label: string;
  fact_date: string | null;
  title: string;
  detail: Record<string, unknown>;
  source_refs: SourceRef[];
  status: 'candidate' | 'confirmed' | 'rejected' | 'superseded';
  origin: 'ai' | 'manual';
  supersedes_id: string | null;
}

export interface FundingRound {
  id: string;
  round_date: string | null;
  round_name: string | null;
  amount: number | null;
  currency: string;
  amount_disclosed: boolean;
  investors: { name: string; lead?: boolean; type?: string }[];
  valuation: number | null;
  is_follow_on: boolean;
  source_refs: SourceRef[];
  status: 'candidate' | 'confirmed' | 'rejected';
  origin: 'ai' | 'manual';
}

export const FACT_STATUS: Record<string, { label: string; cls: string }> = {
  candidate: { label: '후보', cls: 'warn' },
  confirmed: { label: '확정', cls: 'pos' },
  rejected: { label: '제외', cls: 'neg' },
  superseded: { label: '이전 판', cls: 'info' },
};

export const fmtEok = (won: number | null | undefined) =>
  won ? `${(won / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원` : '비공개';
