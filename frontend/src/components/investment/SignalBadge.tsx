'use client';

export interface SignalData {
  golden_cross?: boolean;
  dead_cross?: boolean;
  ma_alignment?: 'bullish' | 'bearish' | 'neutral' | boolean;
  disparity?: number;
}

interface SignalBadgeProps {
  signal: SignalData;
  compact?: boolean;
}

export function SignalBadge({ signal, compact = false }: SignalBadgeProps) {
  const badges: Array<{ label: string; color: string; bg: string; border: string }> = [];

  if (signal.golden_cross) {
    badges.push({
      label: '골든크로스 ▲',
      color: '#059669',
      bg: 'rgba(5,150,105,0.10)',
      border: 'rgba(5,150,105,0.30)',
    });
  }
  if (signal.dead_cross) {
    badges.push({
      label: '데드크로스 ▼',
      color: '#DC2626',
      bg: 'rgba(220,38,38,0.10)',
      border: 'rgba(220,38,38,0.30)',
    });
  }
  if (signal.ma_alignment === 'bullish' || signal.ma_alignment === true) {
    badges.push({
      label: '정배열',
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
      border: 'rgba(5,150,105,0.25)',
    });
  }
  if (signal.ma_alignment === 'bearish') {
    badges.push({
      label: '역배열',
      color: '#DC2626',
      bg: 'rgba(220,38,38,0.08)',
      border: 'rgba(220,38,38,0.25)',
    });
  }
  if (signal.disparity !== undefined && signal.disparity !== null) {
    const d = signal.disparity;
    const positive = d > 0;
    badges.push({
      label: `20일 이격 ${positive ? '+' : ''}${d.toFixed(1)}%`,
      color: positive ? '#059669' : '#DC2626',
      bg: positive ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
      border: positive ? 'rgba(5,150,105,0.25)' : 'rgba(220,38,38,0.25)',
    });
  }

  if (badges.length === 0) {
    return (
      <span
        style={{
          padding: compact ? '2px 7px' : '3px 9px',
          borderRadius: 5,
          fontSize: compact ? '0.6875rem' : '0.75rem',
          backgroundColor: 'rgba(107,114,128,0.10)',
          color: '#6B7280',
          border: '1px solid rgba(107,114,128,0.20)',
          fontWeight: 500,
        }}
      >
        신호 없음
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {badges.map((b) => (
        <span
          key={b.label}
          style={{
            padding: compact ? '2px 7px' : '3px 9px',
            borderRadius: 5,
            fontSize: compact ? '0.6875rem' : '0.75rem',
            backgroundColor: b.bg,
            color: b.color,
            border: `1px solid ${b.border}`,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

export default SignalBadge;
