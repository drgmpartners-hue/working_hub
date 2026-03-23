'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api-url';

interface CallReservationFormProps {
  suggestId: string;
  onSuccess: () => void;
}

const TIME_OPTIONS = [
  { label: '오전 10시', value: '10:00' },
  { label: '오후 2시', value: '14:00' },
  { label: '오후 4시', value: '16:00' },
  { label: '오후 6시', value: '18:00' },
];

function getTodayString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function CallReservationForm({ suggestId, onSuccess }: CallReservationFormProps) {
  const [preferredDate, setPreferredDate] = useState(getTodayString());
  const [preferredTime, setPreferredTime] = useState('10:00');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReserve = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_URL}/api/v1/client-portal/suggestion/${suggestId}/call-reserve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preferred_date: preferredDate,
            preferred_time: preferredTime,
          }),
        }
      );

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail ?? '예약에 실패했습니다. 다시 시도해주세요.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        borderTop: '1px solid #E5E7EB',
        paddingTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📞</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
          담당자와 상담하기
        </span>
      </div>

      {/* 날짜 선택 */}
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: '#374151',
            marginBottom: 8,
          }}
        >
          통화 날짜
        </label>
        <input
          type="date"
          value={preferredDate}
          onChange={(e) => setPreferredDate(e.target.value)}
          min={getTodayString()}
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: 15,
            border: '1.5px solid #D1D5DB',
            borderRadius: 10,
            outline: 'none',
            boxSizing: 'border-box',
            color: '#111827',
            backgroundColor: '#fff',
          }}
        />
      </div>

      {/* 시간 선택 */}
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: '#374151',
            marginBottom: 8,
          }}
        >
          통화 시간
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPreferredTime(opt.value)}
              style={{
                padding: '12px 8px',
                fontSize: 14,
                fontWeight: preferredTime === opt.value ? 700 : 500,
                color: preferredTime === opt.value ? '#fff' : '#374151',
                backgroundColor: preferredTime === opt.value ? '#1E3A5F' : '#F9FAFB',
                border: `1.5px solid ${preferredTime === opt.value ? '#1E3A5F' : '#E5E7EB'}`,
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            color: '#DC2626',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={handleReserve}
        disabled={loading}
        style={{
          width: '100%',
          minHeight: 52,
          backgroundColor: loading ? '#9CA3AF' : '#059669',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s ease',
        }}
      >
        {loading ? '예약 중...' : '통화 예약하기'}
      </button>
    </div>
  );
}

export default CallReservationForm;
