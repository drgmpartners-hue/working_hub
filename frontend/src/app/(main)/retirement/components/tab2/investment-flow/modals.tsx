'use client';

/** 투자 흐름 탭 — 상태 변경·예수금 계좌·Wrap 상품 모달 (수정_tasks P2-4: InvestmentFlowTab.tsx 에서 동작 변경 없이 분리) */
import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/common/Modal';
import { formatInputCurrency, parseCurrency } from '../../../utils/formatCurrency';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';
import { DepositAccount, InvestmentRecord } from './types';
import { cancelBtnStyle, inputStyle, labelStyle, saveBtnStyle } from './ui';

/* ------------------------------------------------------------------ */
/*  상태 변경 모달                                                       */
/* ------------------------------------------------------------------ */

export interface StatusChangeModalProps {
  record: InvestmentRecord;
  onClose: () => void;
  onSave: (endDate: string, evalAmount: number) => Promise<void>;
}

export function StatusChangeModal({ record, onClose, onSave }: StatusChangeModalProps) {
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
        <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-surface)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 8 }}><strong>{record.product_name || '(상품명)'}</strong> 를 종결 처리합니다.</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>투자금액: <strong style={{ color: 'var(--text-primary)' }}>{record.investment_amount?.toLocaleString() ?? '-'}원</strong></span>
            <span>가입일: <strong style={{ color: 'var(--text-primary)' }}>{record.start_date || record.join_date || '-'}</strong></span>
          </div>
        </div>

        <div>
          <label style={labelStyle}>종료일 <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>평가금액 (원) <span style={{ color: 'var(--danger)' }}>*</span></label>
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
            backgroundColor: parseFloat(returnRate) >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
            borderRadius: 8,
            fontSize: 13,
            color: parseFloat(returnRate) >= 0 ? '#34D399' : '#F87171',
          }}>
            수익률: {returnRate}%
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}

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
/*  예수금 계좌 추가 모달                                               */
/* ------------------------------------------------------------------ */

export interface AddDepositAccountModalProps {
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AddDepositAccountModal({ customerId, onClose, onSaved }: AddDepositAccountModalProps) {
  const [securitiesCompany, setSecuritiesCompany] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!securitiesCompany.trim()) { setError('증권사를 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          customer_id: customerId,
          securities_company: securitiesCompany.trim(),
          account_number: accountNumber.trim() || null,
          nickname: nickname.trim() || null,
        }),
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
    <Modal open onClose={onClose} title="예수금 계좌 추가" maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>증권사 <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            type="text"
            value={securitiesCompany}
            onChange={(e) => setSecuritiesCompany(e.target.value)}
            placeholder="예: NH투자증권"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>계좌번호</label>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="예: 123-456-789"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>별명</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 메인계좌"
            style={inputStyle}
          />
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}
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
/*  Wrap 상품 추가 모달                                                  */
/* ------------------------------------------------------------------ */

export function AddWrapProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 투자상품 관리(retirement/wrap-accounts)에서 상품 검색·선택
  const [pmList, setPmList] = useState<Array<{ id: string; product_name: string; category?: string | null; institution?: string | null }>>([]);
  const [catApiOpts, setCatApiOpts] = useState<string[]>([]);
  const [pmOpen, setPmOpen] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, { headers: authLib.getAuthHeader() }),
          fetch(`${API_URL}/api/v1/retirement/wrap-accounts/options?field_name=category`, { headers: authLib.getAuthHeader() }),
        ]);
        if (pRes.ok) { const d = await pRes.json(); setPmList(Array.isArray(d) ? d : d.items ?? []); }
        if (cRes.ok) { const o = await cRes.json(); setCatApiOpts((Array.isArray(o) ? o : []).map((x: { option_value: string }) => x.option_value).filter(Boolean)); }
      } catch { /* ignore */ }
    })();
  }, []);

  // 카테고리 목록 = 투자상품 관리 상품들의 실제 카테고리(distinct) + 옵션 설정값
  const categoryOptions = Array.from(new Set([
    ...catApiOpts,
    ...pmList.map(p => p.category).filter(Boolean) as string[],
  ])).sort((a, b) => a.localeCompare(b, 'ko'));

  const handleSave = async () => {
    if (!productName.trim()) { setError('상품명을 입력해주세요.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ product_name: productName.trim(), category: category.trim() || null }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch { setError('등록에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const mS: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const cS: React.CSSProperties = { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 460, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' };
  const iS: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' };
  const lS: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };

  const q = productName.trim().toLowerCase();
  // 상품명 중복 제거(같은 이름 여러 건 방지)
  const dedup = Array.from(new Map(pmList.filter(p => p.product_name).map(p => [p.product_name, p])).values());
  const matches = (q ? dedup.filter(p => p.product_name.toLowerCase().includes(q)) : dedup).slice(0, 40);

  return (
    <div style={mS} onClick={onClose}>
      <div style={cS} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue-400)' }}>은퇴플랜 상품등록</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 상품명 — 투자상품 관리 검색 + 직접입력 */}
          <div style={{ position: 'relative' }}>
            <label style={lS}>상품명 <span style={{ color: 'var(--danger)' }}>*</span> <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>· 투자상품 관리에서 검색 또는 직접 입력</span></label>
            <input style={iS} value={productName}
              onChange={e => { setProductName(e.target.value); setPmOpen(true); }}
              onFocus={() => setPmOpen(true)}
              onBlur={() => setTimeout(() => setPmOpen(false), 150)}
              autoComplete="off"
              placeholder="상품명 검색 또는 직접 입력" />
            {pmOpen && matches.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% - 1px)', left: 0, right: 0, zIndex: 200, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderTop: 'none', borderRadius: '0 0 8px 8px', maxHeight: 240, overflowY: 'auto' }}>
                {matches.map(p => (
                  <button key={p.id} type="button"
                    onMouseDown={() => { setProductName(p.product_name); if (p.category) setCategory(p.category); setPmOpen(false); }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-card-2)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{p.product_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{[p.category, p.institution].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 카테고리 — 투자상품 관리 카테고리 드롭다운(상품 선택 시 자동) */}
          <div>
            <label style={lS}>카테고리 <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>· 상품 선택 시 자동 · 목록에서 선택</span></label>
            <select style={{ ...iS, cursor: 'pointer' }} value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">선택하세요</option>
              {(category && !categoryOptions.includes(category) ? [category, ...categoryOptions] : categoryOptions).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving || !productName.trim()}
            style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, color: '#fff', backgroundColor: saving || !productName.trim() ? 'var(--bg-surface)' : 'var(--blue-600)', border: 'none', borderRadius: 8, cursor: saving || !productName.trim() ? 'not-allowed' : 'pointer' }}>
            {saving ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  예수금 계좌 수정 모달                                                */
/* ------------------------------------------------------------------ */

export function EditDepositAccountModal({ account, onClose, onSaved }: {
  account: DepositAccount; onClose: () => void; onSaved: () => void;
}) {
  const [company, setCompany] = useState(account.securities_company);
  const [number, setNumber] = useState(account.account_number || '');
  const [nick, setNick] = useState(account.nickname || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!company.trim()) { setError('거래기관을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/deposit-accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          securities_company: company.trim(),
          account_number: number.trim() || null,
          nickname: nick.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      setError('수정에 실패했습니다.');
    } finally { setSaving(false); }
  };

  const mStyle: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const cStyle: React.CSSProperties = { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 28, width: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' };
  const iStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
  const lStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };

  return (
    <div style={mStyle} onClick={onClose}>
      <div style={cStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue-400)' }}>예수금 계좌 수정</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lStyle}>거래기관 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input style={iStyle} value={company} onChange={e => setCompany(e.target.value)} />
          </div>
          <div>
            <label style={lStyle}>계좌번호</label>
            <input style={iStyle} value={number} onChange={e => setNumber(e.target.value)} placeholder="예: 123-456-789" />
          </div>
          <div>
            <label style={lStyle}>별명</label>
            <input style={iStyle} value={nick} onChange={e => setNick(e.target.value)} placeholder="예: 메인계좌" />
          </div>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 14, color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: saving ? 'var(--bg-surface)' : 'var(--blue-600)', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? '수정 중...' : '수정'}
          </button>
        </div>
      </div>
    </div>
  );
}
