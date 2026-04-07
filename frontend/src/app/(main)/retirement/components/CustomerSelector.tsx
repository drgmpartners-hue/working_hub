'use client';

import { useState, useEffect, useRef } from 'react';
import { useRetirementStore, type RetirementCustomer } from '../hooks/useRetirementStore';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

interface RetirementProfile {
  id: string;
  name: string;
  unique_code?: string;
  target_fund?: number;
  desired_retirement_age?: number;
}

export function CustomerSelector() {
  const { selectedCustomer, setCustomer } = useRetirementStore();

  const [profiles, setProfiles] = useState<RetirementProfile[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 프로필 목록 로드
  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/retirement/profiles`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setProfiles(Array.isArray(data) ? data : data.items ?? []);
      }
    } catch {
      // API 미구현 시 빈 목록
      setProfiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    if (!isOpen) {
      loadProfiles();
    }
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (profile: RetirementProfile) => {
    const customer: RetirementCustomer = {
      id: profile.id,
      name: profile.name,
      targetFund: profile.target_fund ?? 0,
      retirementAge: profile.desired_retirement_age ?? 0,
    };
    setCustomer(customer);
    setIsOpen(false);
    setSearchQuery('');
  };

  const filtered = profiles.filter(
    (p) =>
      p.name.includes(searchQuery) ||
      (p.unique_code && p.unique_code.includes(searchQuery))
  );

  const formatFund = (amount: number) => {
    if (amount === 0) return '-';
    const eok = Math.floor(amount / 100000000);
    const man = Math.floor((amount % 100000000) / 10000);
    if (man === 0) return `${eok}억`;
    return `${eok}억 ${man}만원`;
  };

  return (
    <div
      style={{
        height: '56px',
        backgroundColor: '#F9FAFB',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '24px',
        paddingRight: '24px',
        gap: '16px',
      }}
    >
      {/* 고객 선택 드롭다운 */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={handleOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            border: '1px solid #D1D5DB',
            borderRadius: '6px',
            backgroundColor: '#ffffff',
            fontSize: '14px',
            color: '#374151',
            cursor: 'pointer',
            minWidth: '180px',
          }}
        >
          <span style={{ flex: 1, textAlign: 'left' }}>
            {selectedCustomer ? selectedCustomer.name : '고객 선택'}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <path d="M2 4l4 4 4-4" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 50,
              width: '280px',
              backgroundColor: '#ffffff',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              overflow: 'hidden',
            }}
          >
            {/* 검색 입력 */}
            <div style={{ padding: '8px' }}>
              <input
                type="text"
                placeholder="이름 또는 고유번호 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>

            {/* 목록 */}
            <ul style={{ maxHeight: '240px', overflowY: 'auto', margin: 0, padding: '4px 0', listStyle: 'none' }}>
              {isLoading ? (
                <li style={{ padding: '12px 16px', fontSize: '13px', color: '#9CA3AF', textAlign: 'center' }}>
                  불러오는 중...
                </li>
              ) : filtered.length === 0 ? (
                <li style={{ padding: '12px 16px', fontSize: '13px', color: '#9CA3AF', textAlign: 'center' }}>
                  검색 결과 없음
                </li>
              ) : (
                filtered.map((profile) => (
                  <li key={profile.id}>
                    <button
                      onClick={() => handleSelect(profile)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 16px',
                        fontSize: '13px',
                        color: '#374151',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F3F4F6';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                      }}
                    >
                      {profile.name}
                      {profile.unique_code && (
                        <span style={{ color: '#9CA3AF', marginLeft: '6px' }}>({profile.unique_code})</span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 선택된 고객 정보 표시 */}
      {selectedCustomer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '13px',
            color: '#374151',
          }}
        >
          <span style={{ fontWeight: '600', color: '#1E3A5F' }}>
            {selectedCustomer.name}
            {selectedCustomer.id && (
              <span style={{ fontWeight: '400', color: '#6B7280', marginLeft: '4px' }}>
                ({selectedCustomer.id})
              </span>
            )}
          </span>
          <span style={{ color: '#9CA3AF' }}>|</span>
          <span>
            목표은퇴자금:{' '}
            <strong style={{ color: '#1E3A5F' }}>{formatFund(selectedCustomer.targetFund)}</strong>
          </span>
          <span style={{ color: '#9CA3AF' }}>|</span>
          <span>
            희망은퇴나이:{' '}
            <strong style={{ color: '#1E3A5F' }}>
              {selectedCustomer.retirementAge > 0 ? `${selectedCustomer.retirementAge}세` : '-'}
            </strong>
          </span>
        </div>
      )}
    </div>
  );
}
