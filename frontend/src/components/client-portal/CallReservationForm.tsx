'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api-url';

interface CallReservationFormProps {
  suggestId: string;
  onSuccess: () => void;
}

function getTodayString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function CallReservationForm({ suggestId, onSuccess }: CallReservationFormProps) {
  const [preferredDate, setPreferredDate] = useState(getTodayString());
  const [preferredTime, setPreferredTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReserve = async () => {
    if (!preferredTime) {
      setError('상담 시간을 입력해주세요.');
      return;
    }
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
        <span style={{ fontSize: 18 }}>💬</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
          담당자와 상담 예약하기
        </span>
      </div>

      {/* 카카오톡 안내 */}
      <div
        style={{
          backgroundColor: '#FEE500',
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            backgroundColor: '#3C1E1E',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          💬
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#3C1E1E', margin: 0, marginBottom: 2 }}>
            카카오톡으로도 상담 가능합니다
          </p>
          <p style={{ fontSize: 14, fontWeight: 800, color: '#1A1A1A', margin: 0 }}>
            ID: kmh_80
          </p>
        </div>
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
          희망 상담 날짜
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

      {/* 시간 직접 입력 */}
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
          희망 상담 시간
        </label>
        <input
          type="time"
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
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
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6, lineHeight: 1.5 }}>
          * 담당자의 사정에 따라 예약하신 시간의 ±10분 정도 차이가 있을 수 있습니다.
        </p>
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
        {loading ? '예약 중...' : '상담 예약하기'}
      </button>
    </div>
  );
}

export default CallReservationForm;
