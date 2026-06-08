'use client';

export interface ScreeningFilterValues {
  pbr_max: string;
  ma_alignment: string;
  score_min: string;
}

interface ScreeningFilterProps {
  values: ScreeningFilterValues;
  onChange: (values: ScreeningFilterValues) => void;
  onReset: () => void;
  loading?: boolean;
}

export const DEFAULT_FILTER: ScreeningFilterValues = {
  pbr_max: '',
  ma_alignment: '',
  score_min: '',
};

export function ScreeningFilter({ values, onChange, onReset, loading }: ScreeningFilterProps) {
  const hasFilter =
    values.pbr_max !== '' || values.ma_alignment !== '' || values.score_min !== '';

  return (
    <div
      style={{
        padding: '12px 16px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2E8B8B" strokeWidth="2" strokeLinecap="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            스크리닝 필터
          </span>
        </div>

        {/* PBR max */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            PBR ≤
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="예: 1.5"
            value={values.pbr_max}
            onChange={(e) => onChange({ ...values, pbr_max: e.target.value })}
            style={{
              width: 80,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              outline: 'none',
            }}
          />
        </div>

        {/* MA alignment */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            이평선
          </label>
          <select
            value={values.ma_alignment}
            onChange={(e) => onChange({ ...values, ma_alignment: e.target.value })}
            style={{
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">전체</option>
            <option value="bullish">정배열</option>
            <option value="bearish">역배열</option>
            <option value="neutral">중립</option>
          </select>
        </div>

        {/* Score min */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            종합점수 ≥
          </label>
          <input
            type="number"
            min="0"
            max="100"
            step="5"
            placeholder="예: 60"
            value={values.score_min}
            onChange={(e) => onChange({ ...values, score_min: e.target.value })}
            style={{
              width: 72,
              padding: '5px 8px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              outline: 'none',
            }}
          />
        </div>

        {hasFilter && (
          <button
            onClick={onReset}
            style={{
              marginLeft: 'auto',
              padding: '5px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)')}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.03" />
            </svg>
            초기화
          </button>
        )}

        {loading && (
          <div
            style={{
              width: 16,
              height: 16,
              border: '2px solid var(--border)',
              borderTopColor: '#2E8B8B',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              marginLeft: hasFilter ? 0 : 'auto',
            }}
          />
        )}
      </div>
    </div>
  );
}

export default ScreeningFilter;
