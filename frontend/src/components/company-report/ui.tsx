'use client';

/** 기업 리포트 화면 공용 소품 — 기존 .wh 테마 변수만 사용 */
import { CSSProperties, ReactNode, useState } from 'react';

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  borderRadius: 8,
  border: '1px solid var(--border)',
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

export const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 };

export const mutedText: CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };

export function Field({ label, children, span = 1 }: { label: string; children: ReactNode; span?: number }) {
  return (
    <label style={{ display: 'block', gridColumn: `span ${span}` }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 8px' }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{children}</h3>
      {right}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--danger-bg)',
        color: 'var(--danger)',
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {message}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ ...mutedText, padding: '16px 0', textAlign: 'center' }} aria-live="polite">
      {label || '불러오는 중…'}
    </div>
  );
}

/** 키워드 칩 편집기(필수어·보조어·제외어) */
export function ChipEditor({
  label,
  hint,
  values,
  onChange,
  tone = 'info',
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  tone?: 'info' | 'pos' | 'neg' | 'warn';
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !values.includes(x));
    if (parts.length) onChange([...values, ...parts]);
    setDraft('');
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <span style={labelStyle}>
        {label}
        {hint ? <span style={{ marginLeft: 6, opacity: 0.8 }}>· {hint}</span> : null}
      </span>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: 8,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          minHeight: 40,
          alignItems: 'center',
        }}
      >
        {values.map((v) => (
          <span key={v} className={`wh-badge ${tone}`}>
            {v}
            <button
              type="button"
              aria-label={`${v} 삭제`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13 }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="입력 후 Enter"
          aria-label={`${label} 추가`}
          style={{ flex: 1, minWidth: 120, border: 'none', background: 'transparent', color: 'var(--text-primary)', outline: 'none', fontSize: 13 }}
        />
      </div>
    </div>
  );
}

export function fmtDate(v: string | null | undefined, withTime = false): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}
