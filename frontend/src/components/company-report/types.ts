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
  deleted_at?: string | null;
  created_at: string;
  keywords: KeywordSet;
  stats: CompanyStats;
  /** 담당자별 분리 (docs/login_logic P9): common = 회사 공통(대표 등록), manager = 매니저가 추가 */
  scope?: 'common' | 'manager';
  manager_user_id?: string | null;
  manager_name?: string | null;
  /** 지금 보는 담당자 화면에서 숨긴 공통 기업 */
  is_hidden?: boolean;
  /** 로그인한 사람이 고칠 수 있는지(공통 기업은 대표만) */
  can_edit?: boolean;
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
  market: 'US' | 'KR' | 'CMD' | 'FX';
  unit?: string;
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
  auto?: boolean;
  verify_label?: string;
  verification?: FactVerification | null;
}

/** 사실 자동 검증 결과(원문 인용·주체·출처 수·검색 교차 확인) */
export interface FactVerification {
  status?: string;
  level?: 'official' | 'multi' | 'single' | 'conflict' | 'not_company' | 'not_in_source' | 'speculative' | 'error';
  reason?: string;
  outlets?: number;
  outlet_names?: string[];
  quote?: string;
  role?: string;
  check_reason?: string;
  original?: { title?: string; fact_date?: string | null } | null;
  search?: { verdict?: string; note?: string; sources?: { press?: string; title?: string; url?: string }[] } | null;
  checked_at?: string;
  attempts?: number;
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

export interface DbFile {
  id: string;
  company_id: string | null;
  company_name: string | null;
  folder: string;
  folder_label: string;
  path: string;
  display_name: string;
  original_name: string | null;
  file_type: string;
  size: number;
  period_label: string | null;
  doc_kind: string | null;
  origin: 'auto' | 'upload';
  version: number;
  status: string;
  memo: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const FOLDER_LABELS: Record<string, string> = {
  info: '01_기업정보',
  news: '02_뉴스',
  docs: '03_자료',
  reports: '04_보고서',
  images: '05_이미지',
  portfolio: '_포트폴리오 공통',
};

export const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;

// ---------------------------------------------------------------- 월간 브리핑(P3)
export interface MSentence {
  text: string;
  source_ids: string[];
}

export interface MSource {
  type: 'article' | 'fact' | 'funding';
  id: string;
  company_id: string;
  title: string;
  url?: string;
  date?: string;
  press?: string;
  tag?: string;
}

export interface MCaution {
  what: MSentence;
  impact?: MSentence;
  check?: MSentence;
}

export interface MCompanySection {
  company_id: string;
  name: string;
  article_count: number;
  caution_count: number;
  summary: MSentence[];
  facts: (MSentence & { date?: string })[];
  meaning: MSentence | null;
  client_explain: MSentence | null;
  qa: { q: string; a: string; source_ids: string[] }[];
  caution: MCaution | null;
  checkpoints: (MSentence & { when?: string })[];
}

export interface MStatRow {
  company_id: string;
  name: string;
  total: number;
  positive: number;
  neutral: number;
  caution: number;
  prev_total: number;
  change: number;
  avg3: number;
}

export interface MonthlyBriefing {
  id: string;
  month: string;
  status: 'generating' | 'ready' | 'held' | 'sent' | 'failed';
  content: {
    summary?: MSentence[];
    highlights?: (MSentence & { company_id: string; name: string })[];
    companies?: MCompanySection[];
    cautions?: (MCaution & { company_id: string; name: string })[];
    checkpoints?: (MSentence & { company_id: string; name: string; when?: string })[];
    sources?: Record<string, MSource>;
  };
  stats: {
    month?: string;
    prev_month?: string;
    company_total?: number;
    company_with_news?: number;
    article_count?: number;
    positive_count?: number;
    caution_count?: number;
    prev_article_count?: number;
    companies?: MStatRow[];
    coverage_alerts?: { company_id: string; name: string; total: number; avg3: number; note: string }[];
  };
  review_summary: { total?: number; removed?: number; removed_ratio?: number; review_ok?: boolean; ai_errors?: string[] };
  hold_reason: string | null;
  approved_at: string | null;
  sent_at: string | null;
  updated_at: string | null;
}

export interface MonthlyListItem {
  id: string;
  month: string;
  status: MonthlyBriefing['status'];
  article_count: number;
  caution_count: number;
}

export interface MonthlyDigest {
  month: string;
  summary: string | null;
  content: Omit<MCompanySection, 'company_id' | 'name' | 'article_count' | 'caution_count'> | null;
  article_count: number;
  positive_count: number;
  caution_count: number;
}
