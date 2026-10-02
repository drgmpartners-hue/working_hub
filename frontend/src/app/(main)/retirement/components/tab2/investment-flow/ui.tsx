'use client';

/** 투자 흐름 탭 — 공통 스타일·작은 표시 요소 (수정_tasks P2-4: InvestmentFlowTab.tsx 에서 동작 변경 없이 분리) */
import React from 'react';

/** 섹션 본문 안의 하위 블록 제목 — 파란 헤더바(Section)보다 한 단계 낮은 위계 */
export function SubHead({ label }: { label: string }) {
  return (
    <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ width: 3, height: 14, backgroundColor: 'var(--blue-500)', borderRadius: 2 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  인라인 편집 스타일                                                   */
/* ------------------------------------------------------------------ */

export const inlineInput: React.CSSProperties = {
  height: 30,
  fontSize: 12,
  border: '1.5px solid var(--blue-400)',
  borderRadius: 5,
  padding: '0 6px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  width: '100%',
};

export const inlineSelect: React.CSSProperties = {
  height: 30,
  fontSize: 12,
  border: '1.5px solid var(--blue-400)',
  borderRadius: 5,
  padding: '0 4px',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  width: '100%',
  cursor: 'pointer',
};

export const inlineSaveBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 4,
  border: 'none',
  backgroundColor: 'var(--blue-600)',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const inlineCancelBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 4,
  border: '1px solid var(--border-strong)',
  backgroundColor: 'var(--bg-card)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
/* ------------------------------------------------------------------ */
/*  공통 스타일 상수                                                     */
/* ------------------------------------------------------------------ */

export const tdBase: React.CSSProperties = {
  padding: '9px 12px',
  verticalAlign: 'middle',
  color: 'var(--text-primary)',
  fontSize: 13,
};

export const tdCenter: React.CSSProperties = {
  ...tdBase,
  textAlign: 'center',
};

export const tdRight: React.CSSProperties = {
  ...tdBase,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-strong)',
  borderRadius: 7,
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
};

export const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-strong)',
  borderRadius: 7,
  fontSize: 13,
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'var(--bg-card)',
  cursor: 'pointer',
};

export const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 7,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg-card)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

export const saveBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 7,
  border: 'none',
  backgroundColor: 'var(--blue-600)',
  color: '#fff',
  cursor: 'pointer',
};

/* ---- 예수금 거래내역 테이블 스타일 ---- */
export const txTdBase: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'middle',
  color: 'var(--text-primary)',
  fontSize: 13,
};

export const txTdCenter: React.CSSProperties = {
  ...txTdBase,
  textAlign: 'center',
};

export const txTdRight: React.CSSProperties = {
  ...txTdBase,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
