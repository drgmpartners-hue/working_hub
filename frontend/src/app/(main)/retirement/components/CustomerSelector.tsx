'use client';

import { useState, useEffect } from 'react';
import { useRetirementStore, type RetirementCustomer } from '../hooks/useRetirementStore';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

interface Client {
  id: string;
  name: string;
  unique_code?: string;
  birth_date?: string | null;
  phone?: string;
  email?: string;
}

function calculateAge(birthDateStr: string): number {
  const birth = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function CustomerSelector() {
  const { selectedCustomer, setCustomer } = useRetirementStore();

  const [clients, setClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientBirthDate, setNewClientBirthDate] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function closeAddModal() {
    setShowAddModal(false);
    setNewClientName('');
    setNewClientBirthDate('');
    setNewClientPhone('');
    setNewClientEmail('');
    setAddError(null);
  }

  async function handleAddClient() {
    if (!newClientName.trim()) {
      setAddError('고객명은 필수입니다.');
      return;
    }
    if (!newClientBirthDate) {
      setAddError('생년월일은 필수입니다.');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          name: newClientName.trim(),
          birth_date: newClientBirthDate || null,
          phone: newClientPhone.trim() || null,
          email: newClientEmail.trim() || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        closeAddModal();
        await loadClients();
        handleClientChange(created.id);
      } else {
        const detail = await res.json().catch(() => ({}));
        setAddError(detail?.detail ?? '고객 추가에 실패했습니다.');
      }
    } catch {
      setAddError('오류가 발생했습니다.');
    } finally {
      setIsAdding(false);
    }
  }

  // 고객 목록 로드 (IRP와 동일 패턴)
  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const data = await res.json();
      setClients(Array.isArray(data) ? data : []);
    } catch {
      setClients([]);
    } finally {
      setIsLoading(false);
    }
  }

  // 고객 선택 → retirement profile 확인/생성
  async function handleClientChange(clientId: string) {
    if (!clientId) {
      setCustomer(null);
      setSelectedClient(null);
      return;
    }
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setSelectedClient(client);

    // retirement profile 조회
    let targetFund = 0;
    let retirementAge = 0;
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/profiles/${clientId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (res.ok) {
        const profile = await res.json();
        targetFund = profile.target_retirement_fund ?? 0;
        retirementAge = profile.desired_retirement_age ?? 0;
      } else if (res.status === 404) {
        // 프로필 없으면 자동 생성
        const createRes = await fetch(`${API_URL}/api/v1/retirement/profiles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authLib.getAuthHeader(),
          },
          body: JSON.stringify({
            customer_id: clientId,
            current_age: client.birth_date ? calculateAge(client.birth_date) : 35,
            age_at_design: client.birth_date ? calculateAge(client.birth_date) : 35,
            desired_retirement_age: 65,
          }),
        });
        if (createRes.ok) {
          const newProfile = await createRes.json();
          targetFund = newProfile.target_retirement_fund ?? 0;
          retirementAge = newProfile.desired_retirement_age ?? 0;
        }
      }
    } catch {
      // silent
    }

    // desired-plans에서도 희망은퇴나이 조회 (1번탭 저장값)
    try {
      const dpRes = await fetch(`${API_URL}/api/v1/retirement/desired-plans/${clientId}`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (dpRes.ok) {
        const dp = await dpRes.json();
        if (dp.desired_retirement_age) retirementAge = dp.desired_retirement_age;
        // 목표은퇴자금 = 계산결과의 PV 계산값 (target_retirement_fund) 우선
        if (dp.target_retirement_fund) targetFund = dp.target_retirement_fund;
        else if (dp.simulation_target_fund) targetFund = dp.simulation_target_fund;
      }
    } catch { /* silent */ }

    const currentAge = client.birth_date ? calculateAge(client.birth_date) : 0;
    const customer: RetirementCustomer = {
      id: client.id,
      name: client.name,
      targetFund,
      retirementAge,
      currentAge,
      birthDate: client.birth_date ?? null,
    };
    setCustomer(customer);
    setSearchQuery('');
  }

  // 검색 필터
  const filtered = clients.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.unique_code ?? '').includes(q);
  });

  const age = selectedClient?.birth_date ? calculateAge(selectedClient.birth_date) : null;

  return (
    <>
    <div
      style={{
        minHeight: '64px',
        backgroundColor: '#F9FAFB',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        padding: '10px 24px',
        gap: '16px',
      }}
    >
      {/* 검색 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>검색</label>
        <input
          type="text"
          placeholder="이름/고유번호"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '6px 10px',
            fontSize: '0.8125rem',
            border: '1px solid #E1E5EB',
            borderRadius: 8,
            outline: 'none',
            color: '#1A1A2E',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 고객 선택 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>고객 선택</label>
        <select
          value={selectedCustomer?.id ?? ''}
          onChange={(e) => handleClientChange(e.target.value)}
          disabled={isLoading}
          style={{
            padding: '6px 10px',
            fontSize: '0.8125rem',
            border: '1px solid #E1E5EB',
            borderRadius: 8,
            outline: 'none',
            color: selectedCustomer ? '#1A1A2E' : '#9CA3AF',
            backgroundColor: '#fff',
            cursor: isLoading ? 'wait' : 'pointer',
          }}
        >
          <option value="">-- 고객 선택 --</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.unique_code ? ` (${c.unique_code})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 고객 추가 버튼 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'transparent' }}>&nbsp;</label>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            padding: '6px 14px',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#fff',
            backgroundColor: '#1E3A5F',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          + 고객 추가
        </button>
      </div>

      {/* 선택된 고객 정보 표시 - 2단 가로정렬 */}
      {selectedCustomer && selectedClient && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'transparent' }}>&nbsp;</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {/* 고객명 */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 3 }}>고객명</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{selectedCustomer.name}</div>
          </div>
          {/* 생년월일 */}
          {selectedClient.birth_date && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 3 }}>생년월일</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                {selectedClient.birth_date}{age !== null && <span style={{ color: '#1E3A5F', marginLeft: 4 }}>(만 {age}세)</span>}
              </div>
            </div>
          )}
          {/* 목표은퇴자금 */}
          {selectedCustomer.targetFund > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 3 }}>목표은퇴자금</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E3A5F' }}>
                {(() => {
                  const v = selectedCustomer.targetFund;
                  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억원`;
                  return `${v.toLocaleString()}만원`;
                })()}
              </div>
            </div>
          )}
          {/* 희망은퇴나이 */}
          {selectedCustomer.retirementAge > 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 3 }}>희망은퇴나이</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F' }}>{selectedCustomer.retirementAge}세</div>
            </div>
          )}
          </div>
        </div>
      )}
    </div>

    {/* 고객 추가 모달 */}
    {showAddModal && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}
        onClick={closeAddModal}
      >
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: 14,
            padding: '28px',
            width: '100%',
            maxWidth: '480px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            maxHeight: '90vh',
            overflowY: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 모달 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
              고객 추가
            </h3>
            <button
              onClick={closeAddModal}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px', lineHeight: 1 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* 고객명 */}
          <div style={{ marginBottom: '16px' }}>
            <label style={modalLabelStyle}>
              고객명 <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="홍길동"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              autoFocus
              style={modalInputStyle}
            />
          </div>

          {/* 생년월일 */}
          <div style={{ marginBottom: '16px' }}>
            <label style={modalLabelStyle}>
              생년월일 <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="date"
              value={newClientBirthDate}
              onChange={(e) => setNewClientBirthDate(e.target.value)}
              style={modalInputStyle}
            />
          </div>

          {/* 전화번호 */}
          <div style={{ marginBottom: '16px' }}>
            <label style={modalLabelStyle}>전화번호</label>
            <input
              type="text"
              placeholder="010-0000-0000"
              value={newClientPhone}
              onChange={(e) => {
                let val = e.target.value.replace(/[^0-9]/g, '');
                if (val.length > 11) val = val.slice(0, 11);
                if (val.length <= 3) {
                  setNewClientPhone(val);
                } else if (val.length <= 7) {
                  setNewClientPhone(`${val.slice(0, 3)}-${val.slice(3)}`);
                } else {
                  setNewClientPhone(`${val.slice(0, 3)}-${val.slice(3, 7)}-${val.slice(7)}`);
                }
              }}
              style={modalInputStyle}
            />
          </div>

          {/* 이메일 */}
          <div style={{ marginBottom: '24px' }}>
            <label style={modalLabelStyle}>이메일</label>
            <input
              type="email"
              placeholder="example@email.com"
              value={newClientEmail}
              onChange={(e) => setNewClientEmail(e.target.value)}
              style={modalInputStyle}
            />
          </div>

          {/* 오류 메시지 */}
          {addError && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#FFF5F5',
                border: '1px solid #FECACA',
                fontSize: '0.8125rem',
                color: '#DC2626',
              }}
            >
              {addError}
            </div>
          )}

          {/* 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={closeAddModal}
              disabled={isAdding}
              style={{
                padding: '9px 20px',
                borderRadius: '8px',
                border: '1px solid #D1D5DB',
                background: '#fff',
                color: '#374151',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: isAdding ? 'not-allowed' : 'pointer',
                opacity: isAdding ? 0.6 : 1,
              }}
            >
              취소
            </button>
            <button
              onClick={handleAddClient}
              disabled={isAdding}
              style={{
                padding: '9px 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#1E3A5F',
                color: '#fff',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: isAdding ? 'not-allowed' : 'pointer',
                opacity: isAdding ? 0.7 : 1,
                minWidth: '80px',
              }}
            >
              {isAdding ? '추가 중...' : '추가'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared style objects (modal)                                        */
/* ------------------------------------------------------------------ */

const modalLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
};

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: '8px',
  border: '1px solid #D1D5DB',
  fontSize: '0.875rem',
  color: '#111827',
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fff',
};