'use client';

/** 투자 흐름 탭 — Notion 가져오기·동기화(도우미·모달) (수정_tasks P2-4: InvestmentFlowTab.tsx 에서 동작 변경 없이 분리) */
import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/common/Modal';
import { API_URL } from '@/lib/api-url';
import { isNotionConfig, loadJSON, removeKey, saveJSON } from '@/lib/storage';
import { authLib } from '@/lib/auth';
import { DepositAccount, DepositTransaction, TRANSACTION_TYPE_COLORS, TRANSACTION_TYPE_LABELS, TransactionType } from './types';

/* ------------------------------------------------------------------ */
/*  Notion 투자기록 불러오기 모달                                         */
/* ------------------------------------------------------------------ */

/** Notion 컬럼 ↔ 투자기록 필드 매핑 대상 (필터용 2개 + 실제 저장 필드 8개) */
export const NOTION_IR_MAP_FIELDS: { k: string; l: string; filterHint?: boolean }[] = [
  { k: 'customer_name', l: '고객명', filterHint: true },
  { k: 'category', l: '카테고리', filterHint: true },
  { k: 'asset_class_1', l: '자산구분(1)' },
  { k: 'asset_class_2', l: '자산구분(2)' },
  { k: 'product_name', l: '상품명' },
  { k: 'investment_amount', l: '납입원금' },
  { k: 'evaluation_amount', l: '평가금액' },
  { k: 'join_date', l: '가입일' },
  { k: 'expected_maturity_date', l: '예상만기일' },
  { k: 'actual_maturity_date', l: '실제만기일' },
  { k: 'original_maturity_date', l: '원만기일' },
  { k: 'memo', l: '메모' },
];

/** 저장된 정렬 방향이 'asc'/'desc' 가 아니면 기본값 (수정_tasks P2-6) */
export function asSortDir(v: string | null, dflt: 'asc' | 'desc'): 'asc' | 'desc' {
  return v === 'asc' || v === 'desc' ? v : dflt;
}

export const NOTION_IR_CONFIG_KEY = 'notion_investment_record_config_v2';
export const NOTION_IR_TARGET_CATEGORY = '증권사투자';
export const NOTION_IR_TARGET_DB = '상품가입정보';   // 고정 대상 Notion DB (제목 부분일치) — 예수금 모달과 동일

/** Notion 텍스트 → YYYY-MM-DD 정규화 (실패 시 null) */
export function normalizeNotionDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dotMatch = trimmed.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (dotMatch) {
    const [, y, m, d] = dotMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** 고객명 정규화 (괄호·공백 제거) — Notion 관계형 값과 견고하게 매칭 */
export function notionNormName(s: string | undefined | null): string {
  return (s ?? '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').toLowerCase();
}

/** Notion 동기화 미리보기 항목 — 적용 전에 사용자가 보고 선택한다 */
export type SyncPlanItem = {
  key: string;
  action: 'add' | 'update';
  label: string;
  date?: string;
  amount?: number;         // 양수=입금/투자금액, 음수=출금
  body: Record<string, unknown>;
  recordId?: number;       // update 대상 투자기록 id
};

/** Notion 동기화 미리보기 모달 — 체크된 항목만 적용 */
export function SyncPreviewModal({ title, subtitle, items, checked, onToggle, onToggleAll, applying, onApply, onClose }: {
  title: string;
  subtitle?: string;
  items: SyncPlanItem[];
  checked: Set<string>;
  onToggle: (k: string) => void;
  onToggleAll: () => void;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const allChecked = items.length > 0 && items.every(i => checked.has(i.key));
  const nAdd = items.filter(i => i.action === 'add' && checked.has(i.key)).length;
  const nUpd = items.filter(i => i.action === 'update' && checked.has(i.key)).length;
  return (
    <Modal open onClose={onClose} title={title} maxWidth={640}>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={allChecked} onChange={onToggleAll} style={{ width: 15, height: 15, cursor: 'pointer' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>전체선택 ({checked.size}/{items.length})</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {items.map(i => {
            const c = checked.has(i.key);
            return (
              <div key={i.key} onClick={() => onToggle(i.key)}
                style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', background: c ? 'rgba(16,185,129,0.08)' : 'var(--bg-card)' }}>
                <input type="checkbox" checked={c} onChange={() => onToggle(i.key)} onClick={e => e.stopPropagation()}
                  style={{ width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }} />
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                  color: i.action === 'add' ? 'var(--blue-400)' : 'var(--warning)',
                  border: `1px solid ${i.action === 'add' ? 'rgba(59,130,246,0.4)' : 'rgba(245,158,11,0.4)'}` }}>
                  {i.action === 'add' ? '신규' : '업데이트'}
                </span>
                {i.date && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, minWidth: 72 }}>{i.date}</span>}
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
                {i.amount != null && (
                  <span style={{ color: i.amount >= 0 ? '#3B82F6' : 'var(--danger)', fontSize: 11, flexShrink: 0 }}>
                    {i.amount >= 0 ? '+' : ''}{i.amount.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>신규 {nAdd}건{nUpd > 0 ? ` · 업데이트 ${nUpd}건` : ''} 적용 예정</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={applying}
            style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border-strong)', fontSize: 13, fontWeight: 600, backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: applying ? 'wait' : 'pointer' }}>
            취소
          </button>
          <button onClick={onApply} disabled={applying || checked.size === 0}
            style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
              background: (applying || checked.size === 0) ? 'var(--bg-surface)' : 'var(--blue-600)',
              color: (applying || checked.size === 0) ? 'var(--text-muted)' : '#fff',
              cursor: (applying || checked.size === 0) ? 'not-allowed' : 'pointer' }}>
            {applying ? '적용 중...' : `선택 ${checked.size}건 적용`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Notion rows 조회 — 서버 필터가 0건이면 조건을 줄여가며 재시도 (전체조건 → 첫 조건만 → 무필터).
 *  Notion 컬럼 타입/값 표기가 필터와 어긋나도 데이터를 받아온 뒤 클라이언트 필터가 최종 판정한다. */
export async function fetchNotionRowsWithFallback(
  dbId: string,
  pairs: { property?: string; value?: string }[],
  propNames?: string[],   // 지정 시 해당 컬럼만 받아옴 (롤업·관계형 해석 생략 → 대폭 고속화)
): Promise<{ id: string; properties: Record<string, string> }[]> {
  const wanted = (propNames ?? []).filter(Boolean);
  const propsQS = wanted.length ? `props=${encodeURIComponent(JSON.stringify(wanted))}` : '';
  const withProps = (fq: string) => (propsQS ? (fq ? `${fq}&${propsQS}` : `?${propsQS}`) : fq);
  const fqFull = notionFilterQS(pairs);
  const fqFirst = pairs.length > 1 ? notionFilterQS([pairs[0]]) : '';
  const attempts = [...new Set([fqFull, fqFirst, ''])];   // 중복 제거, 마지막은 무필터
  let lastErr: Error | null = null;
  for (const fq of attempts) {
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows${withProps(fq)}`, { headers: authLib.getAuthHeader() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { detail?: string }));
        lastErr = new Error(d?.detail || `데이터 조회 실패 (HTTP ${res.status})`);
        continue;
      }
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (e) { lastErr = e instanceof Error ? e : new Error('네트워크 오류'); }
  }
  if (lastErr) throw lastErr;
  return [];
}

/** Notion rows 조회용 서버측 필터 쿼리스트링 (고객명·카테고리) — DB 전체 다운로드로 인한 504 방지.
 *  서버 필터는 최적화일 뿐, 클라이언트 필터가 최종 판정하므로 일부 조건이 생략돼도 결과는 동일하다. */
export function notionFilterQS(pairs: { property?: string; value?: string }[]): string {
  const valid = pairs
    .filter(p => !!p.property && !!p.value?.trim())
    // 괄호 표기(예: '박민환(HB5236)')는 제거 후 contains 매칭 — 양쪽 표기 차이에 견고
    .map(p => ({ property: p.property as string, value: (p.value as string).replace(/\(.*?\)/g, '').trim() }));
  return valid.length ? `?filters=${encodeURIComponent(JSON.stringify(valid))}` : '';
}

/** Notion 행 + 매핑 → 투자기록 body (가입일 파싱 실패 시 null). 불러오기·동기화 공통 사용 */
export function notionRowToRecordBody(
  row: { properties: Record<string, string> },
  mapping: Record<string, string>,
  profileId: string,
): Record<string, unknown> | null {
  const g = (k: string) => (mapping[k] ? row.properties[mapping[k]] : undefined);
  const productName = mapping['product_name'] ? row.properties[mapping['product_name']]?.trim() : '';
  const startDate = normalizeNotionDate(g('join_date'));
  if (!startDate) return null;
  const actDate = normalizeNotionDate(g('actual_maturity_date'));
  return {
    profile_id: profileId,
    record_type: 'investment',
    product_name: productName || null,
    investment_amount: parseNotionAmountToWon(g('investment_amount')) ?? 0,
    evaluation_amount: parseNotionAmountToWon(g('evaluation_amount')),
    // 실제만기일이 있으면 종결, 없으면 운용중
    status: actDate ? 'exit' : 'ing',
    start_date: startDate,
    join_date: startDate,
    expected_maturity_date: normalizeNotionDate(g('expected_maturity_date')),
    actual_maturity_date: actDate,
    original_maturity_date: normalizeNotionDate(g('original_maturity_date')),
    memo: mapping['memo'] ? (row.properties[mapping['memo']]?.trim() || null) : null,
  };
}

/** Notion 금액 문자열 → 원 단위 정수. '만원/만' 표기가 있으면 ×10000, 그 외는 원 그대로 (원단위 보존). */
export function parseNotionAmountToWon(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasManwon = /만\s*원|만$/.test(trimmed);
  const numStr = trimmed.replace(/[^0-9.\-]/g, '');
  if (!numStr) return null;
  let num = parseFloat(numStr);
  if (isNaN(num)) return null;
  if (hasManwon) num = num * 10000;
  return Math.round(num);
}

/* ================================================================== */
/*  예수금 거래 Notion 불러오기 — 상수·헬퍼                            */
/* ================================================================== */

// v4: 고객별 전용 DB(예: '올원랩어카운트_고객명') 방식 — 고객명/카테고리/메모 매핑 제거, 고객별 설정 저장
export const NOTION_DTX_CONFIG_KEY = 'notion_deposit_tx_config_v4';

export const NOTION_DTX_MAP_FIELDS: { k: string; l: string; req?: boolean; filter?: boolean }[] = [
  { k: 'transaction_date', l: '발생일', req: true },
  { k: 'related_product', l: '상품명' },
  { k: 'credit_amount', l: '입금액' },
  { k: 'credit_amount_2', l: '적립액(자동이체)' },
  { k: 'debit_amount', l: '출금액' },
  { k: 'transaction_type', l: '구분' },
  { k: 'account_number', l: '증권번호' },   // 거래 테이블이 아닌 예수금 계좌 정보(계좌번호)로 저장
];

/** 컬럼명 키워드 추측 (module scope 공용) */
export function notionGuessColumn(cols: string[], keywords: string[]): string {
  const found = cols.find(c => { const cl = c.toLowerCase(); return keywords.some(k => cl.includes(k)); });
  return found ?? '';
}

export function autoGuessDtxMapping(cols: string[]): Record<string, string> {
  const pick = (exact: string, guesses: string[]) => (cols.includes(exact) ? exact : notionGuessColumn(cols, guesses));
  // 고객별 예수금 DB의 6개 필드(상품명·구분·발생일·자동이체·입금액·출금액) 기준 자동 매칭
  return {
    transaction_date: pick('발생일', ['발생일', '거래일', '가입일', '일자', '날짜', 'date']),
    related_product: pick('상품명', ['상품명', '관련상품', '상품', 'product']),
    credit_amount: pick('입금액', ['입금액', '입금', 'credit']),
    credit_amount_2: pick('자동이체', ['자동이체', '이체', '적립']),
    debit_amount: pick('출금액', ['출금액', '출금', 'debit']),
    transaction_type: pick('구분', ['구분', '거래유형', '유형', 'type']),
    account_number: pick('증권번호', ['증권번호', '계좌번호']),
  };
}

/** Notion 거래유형 텍스트 → 내부 TransactionType */
export function normalizeNotionTxType(raw: string | undefined | null): TransactionType {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'deposit';
  if (/입금|deposit/.test(s)) return 'deposit';
  if (/출금|withdraw/.test(s)) return 'withdrawal';
  if (/이자|interest/.test(s)) return 'interest';
  if (/적립|saving/.test(s)) return 'savings';
  if (/투자|invest/.test(s)) return 'investment';
  if (/종료|해지|만기|terminat/.test(s)) return 'termination';
  return 'other';
}

/** Notion 행 + 매핑 → 예수금 거래 body (거래일 파싱 실패 시 null) */
export function notionRowToTxBody(
  row: { properties: Record<string, string> },
  mapping: Record<string, string>,
): Record<string, unknown> | null {
  const g = (k: string) => (mapping[k] ? row.properties[mapping[k]] : undefined);
  const date = normalizeNotionDate(g('transaction_date'));
  if (!date) return null;
  // 입금액과 적립액(자동이체)을 분리 저장 — 잔액 = 입금 + 적립 - 출금
  const credit = parseNotionAmountToWon(g('credit_amount')) ?? 0;
  const savings = parseNotionAmountToWon(g('credit_amount_2')) ?? 0;
  const debit = parseNotionAmountToWon(g('debit_amount')) ?? 0;
  // 거래유형 미매핑 시 입/적립/출금액으로 추론
  const ttype = mapping['transaction_type']
    ? normalizeNotionTxType(g('transaction_type'))
    : (credit > 0 ? 'deposit' : savings > 0 ? 'savings' : debit > 0 ? 'withdrawal' : 'other');
  return {
    transaction_date: date,
    transaction_type: ttype,
    related_product: mapping['related_product'] ? (row.properties[mapping['related_product']]?.trim() || null) : null,
    credit_amount: credit,
    savings_amount: savings,
    debit_amount: debit,
    memo: mapping['memo'] ? (row.properties[mapping['memo']]?.trim() || null) : null,
  };
}

/** 중복 판정 키: 거래일|입금액|적립액|출금액|거래유형 */
export function notionTxBodyKey(body: Record<string, unknown>): string {
  return `${body.transaction_date}|${body.credit_amount}|${Number(body.savings_amount ?? 0)}|${body.debit_amount}|${body.transaction_type}`;
}
export function depositTxKey(t: DepositTransaction): string {
  return `${t.transaction_date}|${t.credit_amount}|${t.savings_amount ?? 0}|${t.debit_amount}|${t.transaction_type}`;
}

/* ------------------------------------------------------------------ */
/*  다크 커스텀 드롭다운 (네이티브 select의 OS 밝은 팝업 문제 해결)      */
/*  Modal이 overflow:hidden이라 portal + fixed 위치로 렌더            */
/* ------------------------------------------------------------------ */
export function MapSelect({ value, onChange, options, placeholder = '--', highlight = false, minWidth }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  highlight?: boolean;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const belowSpace = window.innerHeight - r.bottom;
      const openUp = belowSpace < 240 && r.top > belowSpace;
      setPos({
        left: r.left,
        width: r.width,
        top: openUp ? undefined : r.bottom + 2,
        bottom: openUp ? window.innerHeight - r.top + 2 : undefined,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // 트리거 버튼 안이나 포털 메뉴 안 클릭은 닫지 않음 (옵션 선택이 취소되지 않도록)
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    // 메뉴 내부 스크롤(옵션 목록 스크롤바)은 닫지 않음 — 바깥 페이지 스크롤만 닫음
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);
  const items = [{ value: '', label: placeholder }, ...options];

  return (
    <div style={{ position: 'relative', flex: 1, minWidth }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
          padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', textAlign: 'left',
          border: '1px solid var(--border-strong)',
          backgroundColor: highlight ? 'rgba(16,185,129,0.12)' : 'var(--bg-card)',
          color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? selected.label : placeholder}</span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>▼</span>
      </button>
      {mounted && open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom,
            zIndex: 2000, maxHeight: 240, overflowY: 'auto',
            backgroundColor: '#1a2332', border: '1px solid #2d3a4f', borderRadius: 6,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)', padding: '4px 0',
          }}
        >
          {items.map(o => {
            const isSel = o.value === value;
            return (
              <div
                key={o.value || '__empty'}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  padding: '6px 10px', fontSize: 11, cursor: 'pointer',
                  color: isSel ? '#60A5FA' : '#e5e7eb',
                  backgroundColor: isSel ? 'rgba(59,130,246,0.15)' : 'transparent',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.07)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSel ? 'rgba(59,130,246,0.15)' : 'transparent'; }}
              >
                {o.label}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export interface NotionImportRecordsModalProps {
  customerId: string;
  customerName: string;
  existingKeys: Set<string>;
  onClose: () => void;
  onImported: () => void;
}

export function NotionImportRecordsModal({ customerId, customerName, existingKeys, onClose, onImported }: NotionImportRecordsModalProps) {
  const [irStep, setIrStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [irDbs, setIrDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [irRows, setIrRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [irCols, setIrCols] = useState<string[]>([]);
  const [irMap, setIrMap] = useState<Record<string, string>>({});
  const [irLoading, setIrLoading] = useState(false);
  const [irError, setIrError] = useState<string | null>(null);
  const [irDbSearch, setIrDbSearch] = useState('');
  const [irRowSearch, setIrRowSearch] = useState('');
  const [irSelectedDbId, setIrSelectedDbId] = useState('');
  const [irSelectedDbTitle, setIrSelectedDbTitle] = useState('');
  const [irSelectedRows, setIrSelectedRows] = useState<Set<string>>(new Set());
  const [irBulkLoading, setIrBulkLoading] = useState(false);
  const [irLoaded, setIrLoaded] = useState(false);  // '불러오기' 클릭 시 true → 조건 맞는 행 표시

  function saveIrConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
    saveJSON(NOTION_IR_CONFIG_KEY, { dbId, dbTitle, mapping });
  }
  function loadIrConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
    return loadJSON(NOTION_IR_CONFIG_KEY, isNotionConfig, NOTION_IR_CONFIG_KEY);
  }
  function clearIrConfig() {
    removeKey(NOTION_IR_CONFIG_KEY);
  }

  function guessColumn(cols: string[], keywords: string[]): string {
    const found = cols.find(c => {
      const cl = c.toLowerCase();
      return keywords.some(k => cl.includes(k));
    });
    return found ?? '';
  }

  function autoGuessMapping(cols: string[]): Record<string, string> {
    // 정확한 컬럼명이 있으면 그것을, 없으면 키워드 추측. (상품가입정보 DB 실제 컬럼명 우선)
    const pick = (exact: string, guesses: string[]) => (cols.includes(exact) ? exact : guessColumn(cols, guesses));
    return {
      customer_name: pick('고객명', ['고객명', '고객', 'customer', '이름']),
      category: pick('카테고리', ['카테고리', 'category']),
      asset_class_1: pick('자산구분(1)', ['자산구분(1)', '자산구분1']),
      asset_class_2: pick('자산구분(2)', ['자산구분(2)', '자산구분2']),
      product_name: pick('상품명', ['상품명', '상품', 'product']),
      investment_amount: pick('일시납입금액', ['일시납입', '납입원금', '원금', '납입', '투자금액']),
      evaluation_amount: pick('평가금액', ['평가금액', '평가', 'eval']),
      join_date: pick('가입일', ['가입일', '가입', 'join']),
      expected_maturity_date: pick('예상만기일', ['예상만기']),
      actual_maturity_date: pick('실제만기일', ['실제만기']),
      original_maturity_date: pick('원 만기일', ['원 만기', '원만기']),
      memo: pick('비고', ['비고', '메모', 'note', 'memo']),
    };
  }

  async function irFetchDbList() {
    setIrLoading(true); setIrError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      setIrDbs(await res.json());
      setIrStep('selectDb');
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); }
    finally { setIrLoading(false); }
  }

  async function irLoadRows(dbId: string, dbTitle: string, savedMapping?: Record<string, string>): Promise<boolean> {
    setIrLoading(true); setIrError(null);
    setIrSelectedDbId(dbId);
    setIrSelectedDbTitle(dbTitle);
    try {
      // 1) 컬럼 목록 먼저 → 매핑 확정
      const pR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: authLib.getAuthHeader() });
      if (!pR.ok) {
        const d = await pR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${pR.status})`);
      }
      const props: { name: string }[] = await pR.json();
      const cols = props.map(p => p.name);
      const resolvedMap = savedMapping ?? autoGuessMapping(cols);
      // 2) 고객명·카테고리 서버측 필터로 이 고객 행만 조회 (전체 DB 다운로드 → 504 방지)
      //    필터가 0건이면 조건을 줄여 재시도 — 컬럼 타입/값 표기 차이에 견고
      const rows = await fetchNotionRowsWithFallback(
        dbId,
        [
          { property: resolvedMap['customer_name'], value: customerName },
          { property: resolvedMap['category'], value: NOTION_IR_TARGET_CATEGORY },
        ],
        Object.values(resolvedMap),   // 매핑된 컬럼만 받아 페이지당 응답 고속화
      );
      setIrCols(cols);
      setIrRows(rows);
      setIrMap(resolvedMap);
      // 매핑 화면 진입 즉시 저장 → 다음에 열면 DB·매핑 자동 복원(재매칭 불필요)
      saveIrConfig(dbId, dbTitle, resolvedMap);
      setIrStep('mapping');
      return true;
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); return false; }
    finally { setIrLoading(false); }
  }

  // 대상 DB('상품가입정보')를 목록에서 찾아 자동 선택. 없으면 수동 선택으로 폴백
  // keepMapping: 같은 대상 DB로 재연결하는 경우 기존 필드 매핑을 그대로 이어받음
  async function irAutoSelectDb(keepMapping?: Record<string, string>) {
    setIrError(null); setIrLoading(true);
    let list: { id: string; title: string; icon: string | null }[];
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      list = await res.json();
      setIrDbs(list);
    } catch (e: unknown) { setIrError(e instanceof Error ? e.message : '오류'); setIrLoading(false); return; }
    const target = list.find(d => d.title.includes(NOTION_IR_TARGET_DB));
    if (target) {
      await irLoadRows(target.id, target.title, keepMapping);   // irLoadRows가 loading 처리
    } else {
      setIrLoading(false);
      setIrStep('selectDb');   // 대상 DB를 못 찾으면 수동 선택
    }
  }

  async function irOpenSelector() {
    const saved = loadIrConfig();
    // 저장된 설정이 대상 DB('상품가입정보')가 아니면 오염된 설정 → 폐기 후 자동 재연결
    // (과거 'DB 변경'으로 다른 DB가 저장되면 매핑이 통째로 덮여 사라지던 문제의 자가 복구)
    if (saved && saved.dbId && saved.dbTitle?.includes(NOTION_IR_TARGET_DB)) {
      const ok = await irLoadRows(saved.dbId, saved.dbTitle, saved.mapping);
      if (!ok) { clearIrConfig(); await irAutoSelectDb(saved.mapping); }  // dbId만 낡은 경우: 매핑은 보존한 채 재연결
    } else {
      if (saved) clearIrConfig();
      await irAutoSelectDb();   // 다른 DB의 매핑은 의미 없으므로 자동 추측으로 새로 매칭
    }
  }

  useEffect(() => {
    irOpenSelector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function irReset() {
    setIrStep('idle'); setIrDbs([]); setIrRows([]); setIrCols([]);
    setIrError(null); setIrDbSearch(''); setIrRowSearch('');
    setIrSelectedRows(new Set());
    clearIrConfig();
  }

  function irUpdateMap(key: string, value: string) {
    const updated = { ...irMap, [key]: value };
    setIrMap(updated);
    setIrLoaded(false);  // 매핑 바뀌면 다시 '불러오기' 눌러야 함
    if (irSelectedDbId) {
      saveIrConfig(irSelectedDbId, irSelectedDbTitle, updated);
      // 서버측 필터 컬럼이 바뀌면 새 필터로 행 재조회 (이전 필터로 받은 행엔 누락 가능)
      if (key === 'customer_name' || key === 'category') {
        void irLoadRows(irSelectedDbId, irSelectedDbTitle, updated);
      }
    }
  }

  /* ---- 필터: 고객명 일치 + 카테고리 = 증권사투자, '불러오기' 클릭 시 적용 ---- */
  const customerNameCol = irMap['customer_name'];
  const categoryCol = irMap['category'];
  const filterReady = !!customerNameCol && !!categoryCol;

  const matchedRows = (filterReady && irLoaded)
    ? irRows.filter(r =>
        notionNormName(r.properties[customerNameCol]) === notionNormName(customerName) &&
        (r.properties[categoryCol] ?? '').trim() === NOTION_IR_TARGET_CATEGORY
      )
    : [];

  const q = irRowSearch.toLowerCase().trim();
  const displayRows = q
    ? matchedRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q)))
    : matchedRows;

  function irToggleRow(id: string) {
    setIrSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Notion 행의 중복 판정 키: 상품명|가입일 (투자기록의 키와 동일 형식) */
  function irRowKey(row: { properties: Record<string, string> }): string {
    const pn = irMap['product_name'] ? (row.properties[irMap['product_name']]?.trim() ?? '') : '';
    const jd = normalizeNotionDate(irMap['join_date'] ? row.properties[irMap['join_date']] : undefined) ?? '';
    return `${pn}|${jd}`;
  }
  function irIsExisting(row: { properties: Record<string, string> }): boolean {
    return existingKeys.has(irRowKey(row));
  }

  function irToggleAll() {
    // 이미 등록된 행은 제외하고, 신규 행만 전체 선택/해제
    const newIds = displayRows.filter(r => !irIsExisting(r)).map(r => r.id);
    const allSelected = newIds.length > 0 && newIds.every(id => irSelectedRows.has(id));
    setIrSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) newIds.forEach(id => next.delete(id));
      else newIds.forEach(id => next.add(id));
      return next;
    });
  }

  /** Notion 행 → 투자기록 생성 body (가입일 파싱 실패 시 null 반환) */
  function irMapRowToBody(row: { properties: Record<string, string> }): Record<string, unknown> | null {
    return notionRowToRecordBody(row, irMap, customerId);
  }

  async function irBulkImport() {
    if (irSelectedRows.size === 0) return;
    setIrBulkLoading(true);
    let success = 0, fail = 0, skipped = 0;
    const items = displayRows.filter(r => irSelectedRows.has(r.id));
    for (const row of items) {
      const body = irMapRowToBody(row);
      if (!body) { skipped++; continue; }
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/investment-records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify(body),
        });
        if (res.ok) success++; else fail++;
      } catch { fail++; }
    }
    setIrBulkLoading(false);
    setIrSelectedRows(new Set());
    saveIrConfig(irSelectedDbId, irSelectedDbTitle, irMap);
    alert(`${success}건 등록 완료${fail > 0 ? `, ${fail}건 실패` : ''}${skipped > 0 ? `, ${skipped}건 가입일 누락으로 스킵` : ''}`);
    onImported();
    onClose();
  }

  /* ---- 목록 불러오기 = 이 고객의 '증권사투자' 상품을 리스트로 표시 (신규만 자동 체크) ---- */
  function irLoadList() {
    if (!filterReady) return;
    const target = notionNormName(customerName);
    const matched = irRows.filter(r =>
      notionNormName(r.properties[customerNameCol]) === target &&
      (r.properties[categoryCol] ?? '').trim() === NOTION_IR_TARGET_CATEGORY
    );
    if (matched.length === 0) {
      // 진단: 불러온 행의 실제 값을 보여줘 어느 쪽(고객명/카테고리)이 어긋났는지 바로 확인
      const sample = (col: string) =>
        [...new Set(irRows.map(r => (r.properties[col] ?? '').trim()).filter(Boolean))].slice(0, 5).join(', ') || '(비어있음)';
      alert(
        `'${customerName}' 고객의 '${NOTION_IR_TARGET_CATEGORY}' 상품을 Notion에서 찾지 못했습니다.\n\n` +
        `불러온 행 ${irRows.length}건 기준 실제 값 예시:\n` +
        `· 고객명(${customerNameCol}): ${sample(customerNameCol)}\n` +
        `· 카테고리(${categoryCol}): ${sample(categoryCol)}\n\n` +
        `위 값이 화면과 다르면 Notion 값 또는 매핑 컬럼을 확인하세요.`
      );
      return;
    }
    // 기존 투자기록에 없는 신규 상품만 미리 체크
    const preselect = new Set<string>();
    for (const r of matched) {
      if (!irIsExisting(r)) preselect.add(r.id);
    }
    setIrSelectedRows(preselect);
    setIrLoaded(true);
    saveIrConfig(irSelectedDbId, irSelectedDbTitle, irMap);
  }

  return (
    <Modal open onClose={onClose} title="Notion에서 투자기록 불러오기" maxWidth={720}>
      <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--bg-surface)', fontSize: 12, color: 'var(--text-muted)' }}>
        고객 <strong style={{ color: 'var(--text-primary)' }}>{customerName || '(선택된 고객)'}</strong> · 카테고리 <strong style={{ color: 'var(--text-primary)' }}>{NOTION_IR_TARGET_CATEGORY}</strong> 조건에 맞는 행만 표시·등록됩니다.
      </div>

      {irStep === 'idle' && (
        <button
          onClick={irOpenSelector}
          disabled={irLoading}
          style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: irLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {irLoading ? '연결 중...' : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Notion에서 데이터 가져오기
            </>
          )}
        </button>
      )}

      {irError && (
        <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{irError}</span>
          <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
        </div>
      )}

      {irStep === 'selectDb' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between' }}>
            <span>데이터베이스 선택</span>
            <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
          </div>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input type="text" placeholder="검색..." value={irDbSearch} onChange={e => setIrDbSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          </div>
          {irLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {irDbs.filter(d => !irDbSearch || d.title.toLowerCase().includes(irDbSearch.toLowerCase())).map(d => (
                <button key={d.id}
                  onClick={() => { setIrDbSearch(''); irLoadRows(d.id, d.title); }}
                  style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-card-2)')}
                  onMouseOut={e => (e.currentTarget.style.background = 'var(--bg-card)')}
                >
                  <span>{d.icon ?? '📄'}</span>
                  <span style={{ fontWeight: 500 }}>{d.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {irStep === 'mapping' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>필드 매핑 + 투자기록 선택 {irSelectedDbTitle ? `(${irSelectedDbTitle})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { clearIrConfig(); setIrRows([]); setIrCols([]); irFetchDbList(); }}
                style={{ background: 'none', border: 'none', color: 'var(--blue-400)', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
              <button onClick={irReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
            </div>
          </div>
          {irLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>데이터 불러오는 중...</div>
          ) : (
            <>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Notion 컬럼 → 투자기록 필드 매핑 (고객명·카테고리는 필터에도 사용됩니다)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {NOTION_IR_MAP_FIELDS.map(f => (
                    <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ width: 84, color: f.filterHint ? 'var(--blue-400)' : 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.l}{f.filterHint ? ' *' : ''}
                      </span>
                      <MapSelect
                        value={irMap[f.k] ?? ''}
                        onChange={v => irUpdateMap(f.k, v)}
                        options={irCols.map(c => ({ value: c, label: c }))}
                        highlight={!!irMap[f.k]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {!filterReady && (
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--warning)', backgroundColor: 'rgba(245,158,11,0.1)', borderBottom: '1px solid var(--border)' }}>
                  ‘고객명’과 ‘카테고리’ 필드를 먼저 매핑하세요.
                </div>
              )}

              {/* 불러오기 버튼 + 검색 */}
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={irLoadList}
                  disabled={!filterReady}
                  title={filterReady ? '' : '고객명·카테고리 매핑 필요'}
                  style={{ flex: 1, padding: '9px 16px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    cursor: !filterReady ? 'not-allowed' : 'pointer',
                    backgroundColor: !filterReady ? 'var(--bg-surface)' : 'var(--blue-600)',
                    color: !filterReady ? 'var(--text-muted)' : '#fff' }}
                >{`🔍 ‘${customerName || '고객'}’의 ${NOTION_IR_TARGET_CATEGORY} 상품 목록 불러오기`}</button>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {!irLoaded ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {filterReady ? '위 ‘목록 불러오기’ 버튼을 누르면 이 고객의 증권사투자 상품 목록을 보여줍니다. 기존에 없는 신규 상품만 자동 체크되며, 빼고 싶은 상품은 체크를 해제하세요.' : '고객명·카테고리 필드를 매핑하세요.'}
                  </div>
                ) : displayRows.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {q ? '검색 결과 없음' : '조건에 맞는 상품이 없습니다.'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
                      {(() => {
                        const newRows = displayRows.filter(r => !irIsExisting(r));
                        const allNewChecked = newRows.length > 0 && newRows.every(r => irSelectedRows.has(r.id));
                        return (
                          <>
                            <input type="checkbox" checked={allNewChecked} onChange={irToggleAll} disabled={newRows.length === 0}
                              style={{ width: 15, height: 15, cursor: newRows.length === 0 ? 'default' : 'pointer' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>신규 전체선택 ({irSelectedRows.size}/{newRows.length})</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>총 {displayRows.length}건 · 기존 {displayRows.length - newRows.length}건</span>
                          </>
                        );
                      })()}
                    </div>
                    {displayRows.map(r => {
                      const dn = irMap['product_name'] ? (r.properties[irMap['product_name']] ?? '-') : '-';
                      const rawAmt = irMap['investment_amount'] ? (r.properties[irMap['investment_amount']] ?? '') : '';
                      const wonAmt = parseNotionAmountToWon(rawAmt);
                      const jd = normalizeNotionDate(irMap['join_date'] ? r.properties[irMap['join_date']] : undefined);
                      const existing = irIsExisting(r);
                      const checked = irSelectedRows.has(r.id);
                      return (
                        <div key={r.id}
                          style={{ width: '100%', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: existing ? 'var(--bg-surface)' : checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: existing ? 'default' : 'pointer', opacity: existing ? 0.6 : 1 }}
                          onClick={existing ? undefined : () => irToggleRow(r.id)}
                        >
                          <input type="checkbox" checked={checked && !existing} disabled={existing}
                            onChange={() => irToggleRow(r.id)} onClick={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, cursor: existing ? 'default' : 'pointer', flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dn}</span>
                          {jd && <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{jd}</span>}
                          {wonAmt != null && <span style={{ color: 'var(--text-secondary)', fontSize: 11, flexShrink: 0, minWidth: 90, textAlign: 'right' }}>{wonAmt.toLocaleString()}원</span>}
                          {existing && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-card-2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>이미 등록됨</span>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {irLoaded && displayRows.length > 0 && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{irSelectedRows.size > 0 ? `${irSelectedRows.size}건 추가 예정` : '추가할 상품을 선택하세요'}</span>
                  <button onClick={irBulkImport} disabled={irBulkLoading || irSelectedRows.size === 0}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
                      background: (irBulkLoading || irSelectedRows.size === 0) ? 'var(--bg-card)' : 'var(--blue-600)',
                      color: (irBulkLoading || irSelectedRows.size === 0) ? 'var(--text-muted)' : '#fff',
                      cursor: (irBulkLoading || irSelectedRows.size === 0) ? 'not-allowed' : 'pointer' }}>
                    {irBulkLoading ? '추가 중...' : `선택 ${irSelectedRows.size}건 투자기록에 추가`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  예수금 거래 Notion 불러오기 모달                                     */
/* ------------------------------------------------------------------ */

export function NotionImportDepositTxModal({ customerId, customerName, accounts, onClose, onImported, onAccountCreated }: {
  customerId: string;
  customerName: string;
  accounts: DepositAccount[];
  onClose: () => void;
  onImported: () => void;
  onAccountCreated: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [dbs, setDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [rows, setRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbSearch, setDbSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [selDbId, setSelDbId] = useState('');
  const [selDbTitle, setSelDbTitle] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState<number | ''>(accounts[0]?.id ?? '');
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());

  /* ---- 계좌가 없을 때 모달 내에서 바로 생성 ---- */
  const [extraAccounts, setExtraAccounts] = useState<DepositAccount[]>([]);
  const [creatingAcct, setCreatingAcct] = useState(false);
  const [newAcctCompany, setNewAcctCompany] = useState('');
  const [newAcctNumber, setNewAcctNumber] = useState('');
  const [newAcctNick, setNewAcctNick] = useState('');
  const [acctSaving, setAcctSaving] = useState(false);
  const allAccounts = useMemo(() => {
    const ids = new Set(accounts.map(a => a.id));
    return [...accounts, ...extraAccounts.filter(a => !ids.has(a.id))];
  }, [accounts, extraAccounts]);

  const createDepositAccount = async () => {
    if (!newAcctCompany.trim()) { alert('증권사를 입력하세요.'); return; }
    setAcctSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          customer_id: customerId,
          securities_company: newAcctCompany.trim(),
          account_number: newAcctNumber.trim() || null,
          nickname: newAcctNick.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      const created: DepositAccount = await res.json();
      setExtraAccounts(prev => [...prev, created]);
      setTargetAccountId(created.id);
      setCreatingAcct(false);
      setNewAcctCompany(''); setNewAcctNumber(''); setNewAcctNick('');
      onAccountCreated();
    } catch { alert('계좌 생성에 실패했습니다.'); }
    finally { setAcctSaving(false); }
  };

  // 고객마다 전용 DB가 다르므로 설정을 고객별로 저장
  const cfgStorageKey = `${NOTION_DTX_CONFIG_KEY}:${customerId}`;
  function saveCfg(dbId: string, dbTitle: string, mapping: Record<string, string>, acctId: number | '') {
    saveJSON(cfgStorageKey, { dbId, dbTitle, mapping, acctId });
  }
  function loadCfg(): { dbId: string; dbTitle: string; mapping: Record<string, string>; acctId?: number } | null {
    return loadJSON(cfgStorageKey, isNotionConfig, cfgStorageKey);
  }
  function clearCfg() { removeKey(cfgStorageKey); }

  async function fetchDbList() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: authLib.getAuthHeader() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || `조회 실패 (HTTP ${res.status})`); }
      setDbs(await res.json());
      setStep('selectDb');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '오류'); }
    finally { setLoading(false); }
  }

  async function loadRows(dbId: string, dbTitle: string, savedMapping?: Record<string, string>): Promise<boolean> {
    setLoading(true); setError(null);
    setSelDbId(dbId); setSelDbTitle(dbTitle);
    try {
      // 1) 컬럼 목록 먼저 → 매핑 확정
      const pR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: authLib.getAuthHeader() });
      if (!pR.ok) {
        const d = await pR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${pR.status})`);
      }
      const props: { name: string }[] = await pR.json();
      const colNames = props.map(p => p.name);
      const resolvedMap = savedMapping ?? autoGuessDtxMapping(colNames);
      // 2) 고객별 전용 DB라 전체 행이 이 고객의 거래 — 필터 없이 조회
      const rR = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows`, { headers: authLib.getAuthHeader() });
      if (!rR.ok) {
        const d = await rR.json().catch(() => ({} as { detail?: string }));
        throw new Error(d?.detail || `데이터 조회 실패 (HTTP ${rR.status})`);
      }
      const rws: { id: string; properties: Record<string, string> }[] = await rR.json();
      setCols(colNames);
      setRows(rws);
      setMap(resolvedMap);
      // 매핑 화면 진입 즉시 저장 → 다음에 열면 DB·매핑 자동 복원(재매칭 불필요)
      saveCfg(dbId, dbTitle, resolvedMap, targetAccountId);
      setStep('mapping');
      return true;
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '오류'); return false; }
    finally { setLoading(false); }
  }

  async function openSelector() {
    // 고객별 전용 DB(예: '올원랩어카운트_고객명')는 사용자가 직접 지정한다.
    // 이 고객에 저장된 설정이 있으면 복원, 없거나 조회 실패면 DB 선택 화면으로.
    const saved = loadCfg();
    if (saved && saved.dbId) {
      if (saved.acctId != null && accounts.some(a => a.id === saved.acctId)) setTargetAccountId(saved.acctId);
      const ok = await loadRows(saved.dbId, saved.dbTitle, saved.mapping);
      if (!ok) { clearCfg(); await fetchDbList(); }  // dbId가 낡은 경우 수동 재선택
    } else {
      await fetchDbList();
    }
  }

  useEffect(() => {
    openSelector();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 대상 계좌의 기존 거래 → 중복 판정 키 셋
  useEffect(() => {
    if (targetAccountId === '') { setExistingKeys(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${targetAccountId}/transactions`, { headers: authLib.getAuthHeader() });
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setExistingKeys(new Set((Array.isArray(data) ? data : []).map(depositTxKey)));
      } catch { if (!cancelled) setExistingKeys(new Set()); }
    })();
    return () => { cancelled = true; };
  }, [targetAccountId]);

  function reset() {
    setStep('idle'); setDbs([]); setRows([]); setCols([]);
    setError(null); setDbSearch(''); setRowSearch(''); setLoaded(false);
    setSelectedRows(new Set()); clearCfg();
  }
  function updateMap(k: string, v: string) {
    const updated = { ...map, [k]: v };
    setMap(updated); setLoaded(false);
    if (selDbId) saveCfg(selDbId, selDbTitle, updated, targetAccountId);
  }

  // 고객별 전용 DB — 발생일(거래일)만 매핑되면 불러오기 가능, 행 필터 불필요
  const filterReady = !!map['transaction_date'];

  const matchedRows = (filterReady && loaded) ? rows : [];
  const q = rowSearch.toLowerCase().trim();
  const displayRows = q
    ? matchedRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q)))
    : matchedRows;

  function rowKey(row: { properties: Record<string, string> }): string {
    const body = notionRowToTxBody(row, map);
    return body ? notionTxBodyKey(body) : '';
  }
  function isExisting(row: { properties: Record<string, string> }): boolean {
    const k = rowKey(row); return !!k && existingKeys.has(k);
  }

  function toggleRow(id: string) {
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    const newIds = displayRows.filter(r => !isExisting(r) && notionRowToTxBody(r, map)).map(r => r.id);
    const allSelected = newIds.length > 0 && newIds.every(id => selectedRows.has(id));
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) newIds.forEach(id => next.delete(id)); else newIds.forEach(id => next.add(id));
      return next;
    });
  }

  function loadList() {
    if (!filterReady) return;
    if (rows.length === 0) {
      alert('이 DB에 거래 데이터가 없습니다. DB 선택을 확인하세요.');
      return;
    }
    const preselect = new Set<string>();
    for (const r of rows) { if (notionRowToTxBody(r, map) && !isExisting(r)) preselect.add(r.id); }
    setSelectedRows(preselect);
    setLoaded(true);
    saveCfg(selDbId, selDbTitle, map, targetAccountId);
  }

  async function bulkImport() {
    if (selectedRows.size === 0) return;
    setBulkLoading(true);
    const items = displayRows.filter(r => selectedRows.has(r.id));

    // 증권번호(매핑 시): 거래 테이블이 아닌 예수금 계좌 정보(계좌번호)로 저장
    const acctNumCol = map['account_number'];
    const svcNum = acctNumCol
      ? (items.map(r => (r.properties[acctNumCol] ?? '').trim()).find(v => v) ?? '')
      : '';

    // 대상 계좌 미선택 시 자동 생성 — 체크만 하고 추가해도 동작하도록 (Notion '증권사' 컬럼 값으로 이름 유추)
    let acctId: number | '' = targetAccountId;
    let autoCreatedCompany: string | null = null;
    if (acctId === '') {
      const secCol = cols.find(c => c.includes('증권사'));
      const counts = new Map<string, number>();
      if (secCol) {
        for (const r of items) {
          const v = (r.properties[secCol] ?? '').trim();
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      const company = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || (selDbTitle || '증권사 미지정');
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ customer_id: customerId, securities_company: company, account_number: svcNum || null, nickname: `${customerName} 예수금`.trim() }),
        });
        if (!res.ok) throw new Error();
        const created: DepositAccount = await res.json();
        setExtraAccounts(prev => [...prev, created]);
        setTargetAccountId(created.id);
        onAccountCreated();
        acctId = created.id;
        autoCreatedCompany = company;
      } catch {
        setBulkLoading(false);
        alert('예수금 계좌 자동 생성에 실패했습니다. [+새 계좌]로 직접 만들어 주세요.');
        return;
      }
    } else if (svcNum) {
      // 기존 계좌: 계좌번호가 비어 있으면 Notion 증권번호로 채움 (수동 입력값은 덮지 않음)
      const acct = allAccounts.find(a => a.id === acctId);
      if (acct && !acct.account_number) {
        try {
          await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${acctId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify({ account_number: svcNum }),
          });
          onAccountCreated();   // 계좌 목록 갱신
        } catch { /* 계좌번호 갱신 실패는 거래 추가를 막지 않음 */ }
      }
    }

    let success = 0, fail = 0, skipped = 0;
    let failDetail = '';   // 첫 실패 사유를 표시해 원인 파악 가능하게
    for (const row of items) {
      const body = notionRowToTxBody(row, map);
      if (!body) { skipped++; continue; }
      if (existingKeys.has(notionTxBodyKey(body))) { skipped++; continue; }
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${acctId}/transactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() }, body: JSON.stringify(body),
        });
        if (res.ok) success++;
        else {
          fail++;
          if (!failDetail) {
            const d = await res.json().catch(() => ({} as { detail?: unknown }));
            failDetail = typeof d?.detail === 'string' ? d.detail : `HTTP ${res.status}`;
          }
        }
      } catch (err) { fail++; if (!failDetail) failDetail = err instanceof Error ? err.message : '네트워크 오류'; }
    }
    setBulkLoading(false);
    setSelectedRows(new Set());
    saveCfg(selDbId, selDbTitle, map, acctId);
    alert(
      `${success}건 추가 완료${fail > 0 ? `, ${fail}건 실패` : ''}${skipped > 0 ? `, ${skipped}건 스킵(중복/거래일 누락)` : ''}` +
      (failDetail ? `\n실패 사유: ${failDetail}` : '') +
      (autoCreatedCompany ? `\n(예수금 계좌 '${autoCreatedCompany}' 자동 생성됨 — 계좌번호·별명은 목록에서 수정 가능)` : '')
    );
    onImported();
    onClose();
  }

  const acctLabel = (a: DepositAccount) => a.nickname || `${a.securities_company} ${a.account_number || ''}`;

  return (
    <Modal open onClose={onClose} title="Notion에서 예수금 거래 불러오기" maxWidth={760}>
      {/* 대상 계좌 선택 (항상 표시) — 계좌가 없으면 바로 생성 가능 */}
      <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>대상 예수금 계좌</span>
          <MapSelect
            value={targetAccountId === '' ? '' : String(targetAccountId)}
            onChange={v => {
              const acctId = v ? Number(v) : '';
              setTargetAccountId(acctId);
              if (selDbId) saveCfg(selDbId, selDbTitle, map, acctId);   // 대상 계좌도 저장
            }}
            options={allAccounts.map(a => ({ value: String(a.id), label: acctLabel(a) }))}
            placeholder={allAccounts.length === 0 ? '계좌 없음 — 새로 만드세요' : '계좌 선택…'}
            minWidth={160}
          />
          <button
            type="button"
            onClick={() => setCreatingAcct(v => !v)}
            style={{ padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--blue-500)', backgroundColor: 'var(--bg-card)', color: 'var(--blue-400)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {creatingAcct ? '취소' : '➕ 새 계좌'}
          </button>
        </div>

        {creatingAcct && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" value={newAcctCompany} onChange={e => setNewAcctCompany(e.target.value)} placeholder="증권사 *"
              style={{ width: 140, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <input type="text" value={newAcctNumber} onChange={e => setNewAcctNumber(e.target.value)} placeholder="계좌번호"
              style={{ width: 140, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <input type="text" value={newAcctNick} onChange={e => setNewAcctNick(e.target.value)} placeholder="별명"
              style={{ width: 120, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <button type="button" onClick={createDepositAccount} disabled={acctSaving}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none', backgroundColor: 'var(--blue-600)', color: '#fff', cursor: acctSaving ? 'wait' : 'pointer' }}>
              {acctSaving ? '생성 중...' : '계좌 만들기'}
            </button>
          </div>
        )}

        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>선택 계좌에 이미 있는 거래(거래일·입출금액·유형 동일)는 자동 제외됩니다.</div>
      </div>

      {step === 'idle' && (
        <button
          onClick={openSelector}
          disabled={loading}
          style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? '연결 중...' : '📄 Notion에서 데이터 가져오기'}
        </button>
      )}

      {error && (
        <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 12, color: 'var(--danger)', display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
        </div>
      )}

      {step === 'selectDb' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between' }}>
            <span>데이터베이스 선택</span>
            <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
          </div>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input type="text" placeholder="검색..." value={dbSearch} onChange={e => setDbSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>불러오는 중...</div>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {dbs.filter(d => !dbSearch || d.title.toLowerCase().includes(dbSearch.toLowerCase())).map(d => (
                <button key={d.id}
                  onClick={() => { setDbSearch(''); loadRows(d.id, d.title); }}
                  style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}
                >
                  <span>{d.icon ?? '📄'}</span>
                  <span style={{ fontWeight: 500 }}>{d.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'mapping' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', background: 'var(--bg-surface)', fontSize: 12, fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>필드 매핑 + 거래 선택 {selDbTitle ? `(${selDbTitle})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { clearCfg(); setRows([]); setCols([]); fetchDbList(); }}
                style={{ background: 'none', border: 'none', color: 'var(--blue-400)', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
              <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>취소</button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>데이터 불러오는 중...</div>
          ) : (
            <>
              <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Notion 컬럼 → 예수금 거래 필드 매핑 (발생일 * 필수 · ‘자동이체’는 적립액으로 저장 · 고객별 전용 DB라 행 필터 없음)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {NOTION_DTX_MAP_FIELDS.map(f => {
                    const hint = f.req || f.filter;
                    return (
                    <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                      <span style={{ width: 72, color: hint ? 'var(--blue-400)' : 'var(--text-secondary)', fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.l}{hint ? ' *' : ''}
                      </span>
                      <MapSelect
                        value={map[f.k] ?? ''}
                        onChange={v => updateMap(f.k, v)}
                        options={cols.map(c => ({ value: c, label: c }))}
                        highlight={!!map[f.k]}
                      />
                    </div>
                    );
                  })}
                </div>
              </div>

              {!filterReady && (
                <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--warning)', backgroundColor: 'rgba(245,158,11,0.1)', borderBottom: '1px solid var(--border)' }}>
                  ‘발생일’ 필드를 먼저 매핑하세요.
                </div>
              )}

              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={loadList}
                  disabled={!filterReady}
                  title={filterReady ? '' : '발생일 매핑 필요'}
                  style={{ flex: 1, padding: '9px 16px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    cursor: !filterReady ? 'not-allowed' : 'pointer',
                    backgroundColor: !filterReady ? 'var(--bg-surface)' : 'var(--blue-600)',
                    color: !filterReady ? 'var(--text-muted)' : '#fff' }}
                >{`🔍 ‘${selDbTitle || 'DB'}’ 거래 목록 불러오기`}</button>
                {loaded && (
                  <input type="text" placeholder="행 검색..." value={rowSearch} onChange={e => setRowSearch(e.target.value)}
                    style={{ width: 140, padding: '7px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                )}
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {!loaded ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {filterReady ? '위 버튼을 누르면 이 DB의 거래 목록을 보여줍니다. 대상 계좌에 없는 신규 거래만 자동 체크됩니다.' : '발생일 필드를 매핑하세요.'}
                  </div>
                ) : displayRows.length === 0 ? (
                  <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    {q ? '검색 결과 없음' : '표시할 거래가 없습니다.'}
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
                      {(() => {
                        const newRows = displayRows.filter(r => !isExisting(r) && notionRowToTxBody(r, map));
                        const allNewChecked = newRows.length > 0 && newRows.every(r => selectedRows.has(r.id));
                        return (
                          <>
                            <input type="checkbox" checked={allNewChecked} onChange={toggleAll} disabled={newRows.length === 0}
                              style={{ width: 15, height: 15, cursor: newRows.length === 0 ? 'default' : 'pointer' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>신규 전체선택 ({selectedRows.size}/{newRows.length})</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>총 {displayRows.length}건 · 중복 {displayRows.filter(r => isExisting(r)).length}건</span>
                          </>
                        );
                      })()}
                    </div>
                    {displayRows.map(r => {
                      const body = notionRowToTxBody(r, map);
                      const date = body?.transaction_date as string | undefined;
                      const ttype = body?.transaction_type as TransactionType | undefined;
                      const credit = (body?.credit_amount as number) ?? 0;
                      const savings = (body?.savings_amount as number) ?? 0;
                      const debit = (body?.debit_amount as number) ?? 0;
                      const product = map['related_product'] ? (r.properties[map['related_product']] ?? '') : '';
                      const existing = isExisting(r);
                      const invalid = !body;
                      const checked = selectedRows.has(r.id);
                      const disabled = existing || invalid;
                      return (
                        <div key={r.id}
                          style={{ width: '100%', padding: '7px 10px', borderBottom: '1px solid var(--border)', background: disabled ? 'var(--bg-surface)' : checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
                          onClick={disabled ? undefined : () => toggleRow(r.id)}
                        >
                          <input type="checkbox" checked={checked && !disabled} disabled={disabled}
                            onChange={() => toggleRow(r.id)} onClick={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0, minWidth: 72 }}>{date ?? '날짜없음'}</span>
                          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: ttype ? (TRANSACTION_TYPE_COLORS[ttype]) : 'var(--text-muted)' }}>{ttype ? TRANSACTION_TYPE_LABELS[ttype] : '-'}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product || '-'}</span>
                          {credit > 0 && <span style={{ color: '#3B82F6', fontSize: 11, flexShrink: 0 }}>+{credit.toLocaleString()}</span>}
                          {savings > 0 && <span style={{ color: '#34D399', fontSize: 11, flexShrink: 0 }} title="적립액(자동이체)">적+{savings.toLocaleString()}</span>}
                          {debit > 0 && <span style={{ color: 'var(--danger)', fontSize: 11, flexShrink: 0 }}>-{debit.toLocaleString()}</span>}
                          {existing && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-card-2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>중복</span>}
                          {invalid && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.4)', padding: '1px 6px', borderRadius: 10 }}>거래일 없음</span>}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {loaded && displayRows.length > 0 && (
                <div style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {selectedRows.size > 0
                      ? `${selectedRows.size}건 추가 예정${targetAccountId === '' ? ' — 계좌 미선택 시 자동 생성됩니다' : ''}`
                      : '추가할 거래를 선택하세요'}
                  </span>
                  <button onClick={bulkImport} disabled={bulkLoading || selectedRows.size === 0}
                    title={selectedRows.size === 0 ? '추가할 거래를 선택하세요' : ''}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 700,
                      background: (bulkLoading || selectedRows.size === 0) ? 'var(--bg-card)' : 'var(--blue-600)',
                      color: (bulkLoading || selectedRows.size === 0) ? 'var(--text-muted)' : '#fff',
                      cursor: (bulkLoading || selectedRows.size === 0) ? 'not-allowed' : 'pointer' }}>
                    {bulkLoading ? '추가 중...' : `선택 ${selectedRows.size}건 계좌에 추가`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
