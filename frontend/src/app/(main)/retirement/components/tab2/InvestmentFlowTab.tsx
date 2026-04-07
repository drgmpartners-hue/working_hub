'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/common/Modal';
import { useRetirementStore } from '../../hooks/useRetirementStore';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  타입 정의                                                           */
/* ------------------------------------------------------------------ */

interface InvestmentRecord {
  id: number;
  profile_id: string;
  wrap_account_id: number | null;
  record_type: 'investment' | 'additional_savings' | 'withdrawal';
  product_name: string | null;
  investment_amount: number;
  evaluation_amount: number | null;
  return_rate: number | null;
  status: 'ing' | 'exit' | 'deposit';
  start_date: string;
  end_date: string | null;
  predecessor_id: number | null;
  successor_id: number | null;
  memo: string | null;
}

interface AnnualFlowRow {
  year: number;
  age: number | null;
  order_in_year: number | null;
  lump_sum: number;
  annual_savings: number;
  total_contribution: number;
  annual_return: number;
  annual_evaluation: number;
  annual_return_rate: number;
  withdrawal: number;
  cumulative_withdrawal: number;
  total_evaluation: number;
}

interface WrapAccount {
  id: number;
  account_name: string;
  is_active: boolean;
}

type StatusFilter = 'all' | 'ing' | 'exit' | 'deposit';

const STATUS_LABELS: Record<string, string> = {
  ing: '운용중',
  exit: '종결',
  deposit: '적립',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  ing: { bg: '#EFF6FF', text: '#2563EB', dot: '#3B82F6' },
  exit: { bg: '#F0FDF4', text: '#16A34A', dot: '#22C55E' },
  deposit: { bg: '#FFFBEB', text: '#D97706', dot: '#F59E0B' },
};

const RECORD_TYPE_LABELS: Record<string, string> = {
  investment: '신규투자',
  additional_savings: '추가적립',
  withdrawal: '인출',
};

/* ------------------------------------------------------------------ */
/*  상태 변경 모달                                                       */
/* ------------------------------------------------------------------ */

interface StatusChangeModalProps {
  record: InvestmentRecord;
  onClose: () => void;
  onSave: (endDate: string, evalAmount: number) => Promise<void>;
}

function StatusChangeModal({ record, onClose, onSave }: StatusChangeModalProps) {
  const [endDate, setEndDate] = useState('');
  const [evalAmountStr, setEvalAmountStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const evalAmount = parseCurrency(evalAmountStr);
  const returnRate =
    record.investment_amount > 0
      ? (((evalAmount - record.investment_amount) / record.investment_amount) * 100).toFixed(2)
      : null;

  const handleSave = async () => {
    if (!endDate) { setError('종료일을 입력해주세요.'); return; }
    if (!evalAmountStr) { setError('평가금액을 입력해주세요.'); return; }
    setSaving(true);
    try {
      await onSave(endDate, evalAmount);
      onClose();
    } catch {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="종결 처리" maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ padding: '10px 14px', backgroundColor: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#374151' }}>
          <strong>{record.product_name || '(상품명 없음)'}</strong> 를 종결 처리합니다.
        </div>

        <div>
          <label style={labelStyle}>종료일 <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>평가금액 (만원) <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="text"
            inputMode="numeric"
            value={evalAmountStr}
            onChange={(e) => setEvalAmountStr(formatInputCurrency(e.target.value))}
            placeholder="0"
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </div>

        {evalAmountStr && returnRate !== null && (
          <div style={{
            padding: '8px 14px',
            backgroundColor: parseFloat(returnRate) >= 0 ? '#F0FDF4' : '#FFF1F2',
            borderRadius: 8,
            fontSize: 13,
            color: parseFloat(returnRate) >= 0 ? '#16A34A' : '#DC2626',
          }}>
            수익률: {returnRate}%
          </div>
        )}

        {error && <p style={{ color: '#DC2626', fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>취소</button>
          <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            {saving ? '저장 중...' : '종결 처리'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  투자기록 추가 모달                                                   */
/* ------------------------------------------------------------------ */

interface AddRecordModalProps {
  customerId: string;
  wrapAccounts: WrapAccount[];
  exitRecords: InvestmentRecord[];
  onClose: () => void;
  onSaved: () => void;
}

function AddRecordModal({ customerId, wrapAccounts, exitRecords, onClose, onSaved }: AddRecordModalProps) {
  const [recordType, setRecordType] = useState<'investment' | 'additional_savings' | 'withdrawal'>('investment');
  const [wrapAccountId, setWrapAccountId] = useState<number | ''>('');
  const [investmentAmountStr, setInvestmentAmountStr] = useState('');
  const [startDate, setStartDate] = useState('');
  const [status, setStatus] = useState<'ing' | 'exit'>('ing');
  const [endDate, setEndDate] = useState('');
  const [evalAmountStr, setEvalAmountStr] = useState('');
  const [predecessorId, setPredecessorId] = useState<number | ''>('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const investmentAmount = parseCurrency(investmentAmountStr);
  const evalAmount = parseCurrency(evalAmountStr);
  const returnRate =
    status === 'exit' && investmentAmount > 0 && evalAmountStr
      ? (((evalAmount - investmentAmount) / investmentAmount) * 100).toFixed(2)
      : null;

  const handleSave = async () => {
    if (!investmentAmountStr) { setError('투자금액을 입력해주세요.'); return; }
    if (!startDate) { setError('시작일을 입력해주세요.'); return; }
    if (status === 'exit' && !endDate) { setError('종료일을 입력해주세요.'); return; }

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        profile_id: customerId,
        record_type: recordType,
        wrap_account_id: wrapAccountId || null,
        investment_amount: investmentAmount,
        status,
        start_date: startDate,
        memo: memo || null,
        predecessor_id: predecessorId || null,
      };
      if (status === 'exit') {
        body.end_date = endDate;
        body.evaluation_amount = evalAmount;
        body.return_rate = returnRate ? parseFloat(returnRate) : null;
      }

      const res = await fetch(`${API_URL}/api/v1/retirement/investment-records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('저장 실패');
      onSaved();
      onClose();
    } catch {
      setError('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="투자기록 추가" maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* 유형 */}
        <div>
          <label style={labelStyle}>유형</label>
          <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
            {(['investment', 'additional_savings', 'withdrawal'] as const).map((type) => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="record_type"
                  value={type}
                  checked={recordType === type}
                  onChange={() => setRecordType(type)}
                />
                {RECORD_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </div>

        {/* 상품 */}
        <div>
          <label style={labelStyle}>상품 (Wrap 계좌)</label>
          <select
            value={wrapAccountId}
            onChange={(e) => setWrapAccountId(e.target.value ? Number(e.target.value) : '')}
            style={selectStyle}
          >
            <option value="">선택 안함</option>
            {wrapAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.account_name}</option>
            ))}
          </select>
        </div>

        {/* 투자금액 */}
        <div>
          <label style={labelStyle}>투자금액 (만원) <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="text"
            inputMode="numeric"
            value={investmentAmountStr}
            onChange={(e) => setInvestmentAmountStr(formatInputCurrency(e.target.value))}
            placeholder="0"
            style={{ ...inputStyle, textAlign: 'right' }}
          />
        </div>

        {/* 시작일 */}
        <div>
          <label style={labelStyle}>시작일 <span style={{ color: '#EF4444' }}>*</span></label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* 상태 */}
        <div>
          <label style={labelStyle}>상태</label>
          <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
            {(['ing', 'exit'] as const).map((s) => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="status"
                  value={s}
                  checked={status === s}
                  onChange={() => setStatus(s)}
                />
                {s === 'ing' ? '운용중' : '종결'}
              </label>
            ))}
          </div>
        </div>

        {/* exit 시 추가 필드 */}
        {status === 'exit' && (
          <div style={{
            padding: '14px 16px',
            backgroundColor: '#F9FAFB',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}>
            <div>
              <label style={labelStyle}>종료일 <span style={{ color: '#EF4444' }}>*</span></label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>평가금액 (만원) <span style={{ color: '#EF4444' }}>*</span></label>
              <input
                type="text"
                inputMode="numeric"
                value={evalAmountStr}
                onChange={(e) => setEvalAmountStr(formatInputCurrency(e.target.value))}
                placeholder="0"
                style={{ ...inputStyle, textAlign: 'right' }}
              />
            </div>
            {returnRate !== null && (
              <div style={{
                padding: '6px 12px',
                backgroundColor: parseFloat(returnRate) >= 0 ? '#F0FDF4' : '#FFF1F2',
                borderRadius: 6,
                fontSize: 13,
                color: parseFloat(returnRate) >= 0 ? '#16A34A' : '#DC2626',
              }}>
                자동계산 수익률: {returnRate}%
              </div>
            )}
          </div>
        )}

        {/* 선행상품 (연결 정보) */}
        {exitRecords.length > 0 && (
          <div>
            <label style={labelStyle}>선행상품 (연결)</label>
            <select
              value={predecessorId}
              onChange={(e) => setPredecessorId(e.target.value ? Number(e.target.value) : '')}
              style={selectStyle}
            >
              <option value="">없음</option>
              {exitRecords.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.product_name || `기록 #${r.id}`} ({r.start_date} ~ {r.end_date})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 메모 */}
        <div>
          <label style={labelStyle}>메모</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={3}
            placeholder="메모를 입력하세요..."
            style={{
              ...inputStyle,
              resize: 'vertical',
              minHeight: 72,
              fontFamily: 'inherit',
            }}
          />
        </div>

        {error && <p style={{ color: '#DC2626', fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>취소</button>
          <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export function InvestmentFlowTab() {
  const { selectedCustomerId } = useRetirementStore();

  // 연간 투자흐름표 상태
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [annualFlowData, setAnnualFlowData] = useState<AnnualFlowRow[]>([]);
  const [annualFlowLoading, setAnnualFlowLoading] = useState(false);

  // 투자기록 상태
  const [records, setRecords] = useState<InvestmentRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // 연결상품 하이라이트
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusChangeRecord, setStatusChangeRecord] = useState<InvestmentRecord | null>(null);

  // Wrap 계좌 목록 (모달용)
  const [wrapAccounts, setWrapAccounts] = useState<WrapAccount[]>([]);

  /* ---- 연도 목록 ---- */
  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);

  /* ---- API: 연간 투자흐름 ---- */
  const fetchAnnualFlow = useCallback(async () => {
    if (!selectedCustomerId) return;
    setAnnualFlowLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/investment-records/annual-flow/${selectedCustomerId}/${selectedYear}`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setAnnualFlowData([]); return; }
      const data = await res.json();
      setAnnualFlowData(Array.isArray(data) ? data : [data]);
    } catch {
      setAnnualFlowData([]);
    } finally {
      setAnnualFlowLoading(false);
    }
  }, [selectedCustomerId, selectedYear]);

  /* ---- API: 투자기록 목록 ---- */
  const fetchRecords = useCallback(async () => {
    if (!selectedCustomerId) return;
    setRecordsLoading(true);
    try {
      const params = new URLSearchParams({ customer_id: selectedCustomerId });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(
        `${API_URL}/api/v1/retirement/investment-records?${params}`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) { setRecords([]); return; }
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch {
      setRecords([]);
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedCustomerId, statusFilter]);

  /* ---- API: Wrap 계좌 목록 ---- */
  const fetchWrapAccounts = useCallback(async () => {
    if (!selectedCustomerId) return;
    try {
      const res = await fetch(
        `${API_URL}/api/v1/retirement/wrap-accounts?is_active=true`,
        { headers: authLib.getAuthHeader() }
      );
      if (!res.ok) return;
      const data = await res.json();
      setWrapAccounts(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, [selectedCustomerId]);

  useEffect(() => { fetchAnnualFlow(); }, [fetchAnnualFlow]);
  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchWrapAccounts(); }, [fetchWrapAccounts]);

  /* ---- 연결상품 클릭 → 스크롤 + 하이라이트 ---- */
  const handleLinkClick = (targetId: number) => {
    setHighlightedId(targetId);
    const row = rowRefs.current.get(targetId);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => setHighlightedId(null), 2000);
  };

  /* ---- 상태 변경 저장 ---- */
  const handleStatusChangeSave = async (endDate: string, evalAmount: number) => {
    if (!statusChangeRecord) return;
    const investmentAmount = statusChangeRecord.investment_amount;
    const returnRate = investmentAmount > 0
      ? ((evalAmount - investmentAmount) / investmentAmount) * 100
      : null;

    const res = await fetch(
      `${API_URL}/api/v1/retirement/investment-records/${statusChangeRecord.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authLib.getAuthHeader(),
        },
        body: JSON.stringify({
          status: 'exit',
          end_date: endDate,
          evaluation_amount: evalAmount,
          return_rate: returnRate,
        }),
      }
    );
    if (!res.ok) throw new Error('업데이트 실패');
    await fetchRecords();
  };

  /* ---- 필터링된 기록 ---- */
  const filteredRecords = records; // 서버에서 이미 필터링

  const exitRecords = records.filter((r) => r.status === 'exit');

  /* ---- 고객 미선택 ---- */
  if (!selectedCustomerId) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: '#9CA3AF',
        fontSize: 14,
      }}>
        고객을 먼저 선택해주세요.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ===== (1) 연간 투자흐름표 ===== */}
      <section>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
            연간 투자흐름표
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>
              (단위: 만원)
            </span>
          </h3>
          <select
            data-testid="year-select"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            style={{
              ...selectStyle,
              width: 'auto',
              padding: '6px 10px',
              fontSize: 13,
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {[
                  '연도', '연차', '나이',
                  '일시납금액', '연적립금액', '총납입금액',
                  '연간총수익', '연간평가금액', '연수익률',
                  '인출금액', '누적인출액', '총평가금액',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: h === '연도' || h === '연차' || h === '나이' ? 'center' : 'right',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 11,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {annualFlowLoading ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : annualFlowData.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                annualFlowData.map((row, idx) => {
                  const rateColor = row.annual_return_rate > 0
                    ? '#16A34A'
                    : row.annual_return_rate < 0
                    ? '#DC2626'
                    : '#374151';
                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        backgroundColor: idx % 2 === 0 ? '#fff' : '#FAFAFA',
                      }}
                    >
                      <td style={tdCenter}>{row.year}</td>
                      <td style={tdCenter}>{row.order_in_year ?? '-'}</td>
                      <td style={tdCenter}>{row.age ?? '-'}</td>
                      <td style={tdRight}>{formatCurrency(row.lump_sum)}</td>
                      <td style={tdRight}>{formatCurrency(row.annual_savings)}</td>
                      <td style={{ ...tdRight, fontWeight: 600 }}>{formatCurrency(row.total_contribution)}</td>
                      <td style={{ ...tdRight, color: row.annual_return >= 0 ? '#16A34A' : '#DC2626' }}>
                        {formatCurrency(row.annual_return)}
                      </td>
                      <td style={tdRight}>{formatCurrency(row.annual_evaluation)}</td>
                      <td style={{ ...tdRight, color: rateColor, fontWeight: 600 }}>
                        {row.annual_return_rate != null ? `${row.annual_return_rate.toFixed(2)}%` : '-'}
                      </td>
                      <td style={tdRight}>{formatCurrency(row.withdrawal)}</td>
                      <td style={tdRight}>{formatCurrency(row.cumulative_withdrawal)}</td>
                      <td style={{ ...tdRight, fontWeight: 700, color: '#1E3A5F' }}>
                        {formatCurrency(row.total_evaluation)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== (2) 투자기록 테이블 ===== */}
      <section>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1E3A5F' }}>
              투자기록
            </h3>

            {/* 상태 필터 버튼 그룹 */}
            <div style={{ display: 'flex', gap: 4 }}>
              {([
                { value: 'all' as StatusFilter, label: '전체' },
                { value: 'ing' as StatusFilter, label: '운용중' },
                { value: 'exit' as StatusFilter, label: '종결' },
                { value: 'deposit' as StatusFilter, label: '적립' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: statusFilter === value ? 600 : 400,
                    borderRadius: 6,
                    border: statusFilter === value ? '1.5px solid #1E3A5F' : '1px solid #E5E7EB',
                    backgroundColor: statusFilter === value ? '#1E3A5F' : '#fff',
                    color: statusFilter === value ? '#fff' : '#6B7280',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 7,
              border: 'none',
              backgroundColor: '#1E3A5F',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            + 투자기록 추가
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {['#', '상품명', '투자금액', '평가금액', '수익률', '상태', '시작일', '종료일', '연결상품', '메모'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '9px 12px',
                      textAlign: ['투자금액', '평가금액', '수익률'].includes(h) ? 'right' : 'left',
                      fontWeight: 600,
                      color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB',
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recordsLoading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#9CA3AF', fontSize: 13 }}>
                    투자기록이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record, idx) => {
                  const isHighlighted = highlightedId === record.id;
                  const statusStyle = STATUS_STYLES[record.status] ?? STATUS_STYLES.ing;
                  const returnColor =
                    record.return_rate != null
                      ? record.return_rate > 0
                        ? '#16A34A'
                        : record.return_rate < 0
                        ? '#DC2626'
                        : '#374151'
                      : '#9CA3AF';

                  // 연결상품 (predecessor)
                  const predecessor = record.predecessor_id
                    ? records.find((r) => r.id === record.predecessor_id)
                    : null;

                  return (
                    <tr
                      key={record.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(record.id, el);
                        else rowRefs.current.delete(record.id);
                      }}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        backgroundColor: isHighlighted ? '#FEF9C3' : idx % 2 === 0 ? '#fff' : '#FAFAFA',
                        transition: 'background-color 0.4s ease',
                      }}
                    >
                      <td style={{ ...tdBase, color: '#9CA3AF', width: 36 }}>{idx + 1}</td>
                      <td style={tdBase}>{record.product_name || '-'}</td>
                      <td style={{ ...tdRight }}>{formatCurrency(record.investment_amount)}</td>
                      <td style={{ ...tdRight }}>
                        {record.evaluation_amount != null ? formatCurrency(record.evaluation_amount) : '-'}
                      </td>
                      <td style={{ ...tdRight, color: returnColor, fontWeight: 600 }}>
                        {record.return_rate != null ? `${record.return_rate.toFixed(2)}%` : '-'}
                      </td>

                      {/* 상태 배지 */}
                      <td style={tdBase}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            backgroundColor: statusStyle.bg,
                            color: statusStyle.text,
                            whiteSpace: 'nowrap',
                          }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: statusStyle.dot,
                              flexShrink: 0,
                            }} />
                            {STATUS_LABELS[record.status]}
                          </span>

                          {/* ing → exit 전환 버튼 */}
                          {record.status === 'ing' && (
                            <button
                              onClick={() => setStatusChangeRecord(record)}
                              title="종결 처리"
                              style={{
                                padding: '2px 6px',
                                fontSize: 10,
                                borderRadius: 4,
                                border: '1px solid #E5E7EB',
                                backgroundColor: '#fff',
                                color: '#6B7280',
                                cursor: 'pointer',
                              }}
                            >
                              종결
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={{ ...tdBase, color: '#6B7280' }}>{record.start_date}</td>
                      <td style={{ ...tdBase, color: '#6B7280' }}>{record.end_date ?? '-'}</td>

                      {/* 연결상품 */}
                      <td style={tdBase}>
                        {predecessor ? (
                          <button
                            onClick={() => handleLinkClick(predecessor.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: '#2563EB',
                              cursor: 'pointer',
                              fontSize: 12,
                              textDecoration: 'underline',
                              textUnderlineOffset: 2,
                            }}
                          >
                            {predecessor.product_name || `#${predecessor.id}`}
                          </button>
                        ) : (
                          <span style={{ color: '#D1D5DB' }}>-</span>
                        )}
                      </td>

                      <td style={{ ...tdBase, color: '#6B7280', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {record.memo || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== 모달들 ===== */}
      {showAddModal && (
        <AddRecordModal
          customerId={selectedCustomerId}
          wrapAccounts={wrapAccounts}
          exitRecords={exitRecords}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            fetchRecords();
            fetchAnnualFlow();
          }}
        />
      )}

      {statusChangeRecord && (
        <StatusChangeModal
          record={statusChangeRecord}
          onClose={() => setStatusChangeRecord(null)}
          onSave={handleStatusChangeSave}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  공통 스타일 상수                                                     */
/* ------------------------------------------------------------------ */

const tdBase: React.CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'middle',
  color: '#1A1A2E',
  fontSize: 13,
};

const tdCenter: React.CSSProperties = {
  ...tdBase,
  textAlign: 'center',
};

const tdRight: React.CSSProperties = {
  ...tdBase,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  fontSize: 13,
  color: '#1A1A2E',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D1D5DB',
  borderRadius: 7,
  fontSize: 13,
  color: '#1A1A2E',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: '#fff',
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 7,
  border: '1px solid #E5E7EB',
  backgroundColor: '#fff',
  color: '#6B7280',
  cursor: 'pointer',
};

const saveBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 7,
  border: 'none',
  backgroundColor: '#1E3A5F',
  color: '#fff',
  cursor: 'pointer',
};
