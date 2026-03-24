'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api-url';

interface PortalAuthFormProps {
  token: string;
  maskedName: string;
  onSuccess: (jwt: string) => void;
}

export function PortalAuthForm({ token, maskedName, onSuccess }: PortalAuthFormProps) {
  const [uniqueCode, setUniqueCode] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failCount, setFailCount] = useState(0);
  const [locked, setLocked] = useState(false);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    if (val.length <= 3) {
      setPhone(val);
    } else if (val.length <= 7) {
      setPhone(`${val.slice(0, 3)}-${val.slice(3)}`);
    } else {
      setPhone(`${val.slice(0, 3)}-${val.slice(3, 7)}-${val.slice(7)}`);
    }
  };

  const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    if (val.length <= 4) {
      setBirthDate(val);
    } else if (val.length <= 6) {
      setBirthDate(`${val.slice(0, 4)}-${val.slice(4)}`);
    } else {
      setBirthDate(`${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6)}`);
    }
  };

  const handleSubmit = async () => {
    if (locked) return;
    if (!uniqueCode || !birthDate || !phone) {
      setError('고유번호, 생년월일, 핸드폰번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/v1/client-portal/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unique_code: uniqueCode, birth_date: birthDate, phone }),
      });

      if (res.ok) {
        const data = await res.json();
        onSuccess(data.access_token);
      } else {
        const newCount = failCount + 1;
        setFailCount(newCount);
        if (newCount >= 3) {
          setLocked(true);
          setError('잠시 후 다시 시도해주세요.');
        } else {
          setError(`정보가 일치하지 않습니다. (${newCount}/3회)`);
        }
      }
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 고객명 마스킹 표시 */}
      <div
        style={{
          backgroundColor: '#F0F4F8',
          borderRadius: 12,
          padding: '20px 24px',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 8 }}>고객님 성함</p>
        <p style={{ fontSize: 28, fontWeight: 700, color: '#1E3A5F', letterSpacing: 4 }}>
          {maskedName}
        </p>
        <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 8 }}>
          본인 확인을 위해 아래 정보를 입력해주세요.
        </p>
      </div>

      {/* 입력 폼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8,
            }}
          >
            고유번호
          </label>
          <input
            type="text"
            placeholder="6자리 숫자"
            value={uniqueCode}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '');
              if (val.length <= 6) setUniqueCode(val);
            }}
            disabled={locked || loading}
            maxLength={6}
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: 16,
              border: '1.5px solid #D1D5DB',
              borderRadius: 10,
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: locked ? '#F9FAFB' : '#fff',
              color: '#111827',
              letterSpacing: 4,
              textAlign: 'center',
            }}
          />
          <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
            담당자에게 안내받은 고유번호를 입력해주세요.
          </p>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8,
            }}
          >
            생년월일
          </label>
          <input
            type="text"
            placeholder="YYYY-MM-DD"
            value={birthDate}
            onChange={handleBirthDateChange}
            disabled={locked || loading}
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: 16,
              border: '1.5px solid #D1D5DB',
              borderRadius: 10,
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: locked ? '#F9FAFB' : '#fff',
              color: '#111827',
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
              marginBottom: 8,
            }}
          >
            핸드폰번호
          </label>
          <input
            type="text"
            placeholder="010-XXXX-XXXX"
            value={phone}
            onChange={handlePhoneChange}
            disabled={locked || loading}
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: 16,
              border: '1.5px solid #D1D5DB',
              borderRadius: 10,
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: locked ? '#F9FAFB' : '#fff',
              color: '#111827',
            }}
          />
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div
          style={{
            backgroundColor: locked ? '#FEF3C7' : '#FEF2F2',
            border: `1px solid ${locked ? '#FCD34D' : '#FECACA'}`,
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 14,
            color: locked ? '#92400E' : '#DC2626',
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}

      {/* 확인 버튼 */}
      <button
        onClick={handleSubmit}
        disabled={locked || loading}
        style={{
          width: '100%',
          minHeight: 52,
          backgroundColor: locked ? '#9CA3AF' : '#1E3A5F',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 700,
          cursor: locked || loading ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.2s ease',
          letterSpacing: 1,
        }}
      >
        {loading ? '확인 중...' : locked ? '잠금됨' : '확인'}
      </button>

      <p style={{ textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>
        본 화면은 고객 확인 전용 페이지입니다.
      </p>
    </div>
  );
}

export default PortalAuthForm;
