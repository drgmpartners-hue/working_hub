'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'irp', label: 'IRP' },
  { value: 'pension', label: '연금저축' },
  { value: 'pension_saving', label: '연금저축(적립)' },
  { value: 'pension_hold', label: '연금저축(거치)' },
  { value: 'retirement', label: '퇴직연금' },
];

const SECURITIES_OPTIONS = [
  { value: 'nh', label: 'NH투자증권' },
  { value: 'samsung', label: '삼성증권' },
  { value: 'hankook', label: '한국투자증권' },
  { value: 'hana', label: '하나증권' },
];

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ClientAccount {
  id: string;
  client_id: string;
  account_type: string;
  account_number?: string;
  securities_company?: string;
}

interface Client {
  id: string;
  name: string;
  phone?: string;
  accounts: ClientAccount[];
}

/* Flat row for the table: one account = one row */
interface FlatRow {
  clientId: string;
  clientName: string;
  phone?: string;
  accountId: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
  /** true if this is the first row for this client (for visual grouping) */
  isFirstForClient: boolean;
}

interface NewRow {
  clientName: string;
  phone: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
}

interface EditState {
  rowKey: string; // `${clientId}-${accountId}`
  clientName: string;
  phone: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
}

interface ClientManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClientAdded?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '0.8125rem',
  border: '1px solid #E1E5EB',
  borderRadius: 6,
  outline: 'none',
  color: '#1A1A2E',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

const readonlyStyle: React.CSSProperties = {
  ...inputStyle,
  backgroundColor: '#F9FAFB',
  color: '#6B7280',
  cursor: 'default',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#fff',
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
  backgroundColor: '#1E3A5F',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '0.8125rem',
  color: '#1A1A2E',
  borderBottom: '1px solid #E1E5EB',
  verticalAlign: 'middle',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ClientManagementModal({ isOpen, onClose, onClientAdded }: ClientManagementModalProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  /* Search / filter */
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterAccountType, setFilterAccountType] = useState('');
  const [filterSecurities, setFilterSecurities] = useState('');

  /* Inline edit state */
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  /* New row state */
  const [addingNew, setAddingNew] = useState(false);
  const [newRow, setNewRow] = useState<NewRow>({
    clientName: '',
    phone: '',
    accountType: 'irp',
    accountNumber: '',
    securitiesCompany: '',
  });
  const [newSaving, setNewSaving] = useState(false);

  /* Add account to existing client */
  const [addAccountClientId, setAddAccountClientId] = useState<string | null>(null);
  const [addAccountForm, setAddAccountForm] = useState({ accountType: 'irp', accountNumber: '', securitiesCompany: '' });
  const [addAccountSaving, setAddAccountSaving] = useState(false);

  /* ---- load clients ---- */

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) return;
      const data: Client[] = await res.json();

      const withAccounts = await Promise.all(
        data.map(async (c) => {
          try {
            const ar = await fetch(`${API_URL}/api/v1/clients/${c.id}/accounts`, {
              headers: { ...authLib.getAuthHeader() },
            });
            const accounts: ClientAccount[] = ar.ok ? await ar.json() : [];
            return { ...c, accounts };
          } catch {
            return { ...c, accounts: [] };
          }
        })
      );
      setClients(withAccounts);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadClients();
    }
  }, [isOpen, loadClients]);

  /* ---- build flat rows ---- */

  const flatRows: FlatRow[] = clients.flatMap((client) => {
    if (client.accounts.length === 0) {
      return [
        {
          clientId: client.id,
          clientName: client.name,
          phone: client.phone ?? '',
          accountId: '',
          accountType: '',
          accountNumber: '',
          securitiesCompany: '',
          isFirstForClient: true,
        },
      ];
    }
    return client.accounts.map((acc, i) => ({
      clientId: client.id,
      clientName: client.name,
      phone: client.phone ?? '',
      accountId: acc.id,
      accountType: acc.account_type,
      accountNumber: acc.account_number ?? '',
      securitiesCompany: acc.securities_company ?? '',
      isFirstForClient: i === 0,
    }));
  });

  /* ---- filter ---- */

  const filteredRows = flatRows.filter((row) => {
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      const matchName = row.clientName.toLowerCase().includes(kw);
      const matchAccount = row.accountNumber.toLowerCase().includes(kw);
      if (!matchName && !matchAccount) return false;
    }
    if (filterAccountType && row.accountType !== filterAccountType) return false;
    if (filterSecurities) {
      const secLabel = SECURITIES_OPTIONS.find((s) => s.value === filterSecurities)?.label ?? filterSecurities;
      if (!row.securitiesCompany.toLowerCase().includes(secLabel.toLowerCase()) &&
          !row.securitiesCompany.toLowerCase().includes(filterSecurities.toLowerCase())) return false;
    }
    return true;
  });

  /* ---- helpers ---- */

  function getAccountTypeLabel(value: string) {
    return ACCOUNT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function resetFilters() {
    setSearchKeyword('');
    setFilterAccountType('');
    setFilterSecurities('');
  }

  /* ---- edit handlers ---- */

  function startEdit(row: FlatRow) {
    setEditState({
      rowKey: `${row.clientId}-${row.accountId}`,
      clientName: row.clientName,
      phone: row.phone ?? '',
      accountType: row.accountType,
      accountNumber: row.accountNumber,
      securitiesCompany: row.securitiesCompany,
    });
  }

  function cancelEdit() {
    setEditState(null);
  }

  async function handleSaveEdit(row: FlatRow) {
    if (!editState) return;
    setSaving(true);
    try {
      /* Update client name */
      const clientRes = await fetch(`${API_URL}/api/v1/clients/${row.clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ name: editState.clientName, phone: editState.phone || null }),
      });
      if (!clientRes.ok) {
        const err = await clientRes.json().catch(() => ({}));
        alert(err?.detail || '고객 정보 저장 실패');
        return;
      }

      /* Update account if exists */
      if (row.accountId) {
        const accRes = await fetch(
          `${API_URL}/api/v1/clients/${row.clientId}/accounts/${row.accountId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify({
              account_type: editState.accountType || undefined,
              account_number: editState.accountNumber || undefined,
              securities_company: editState.securitiesCompany || undefined,
            }),
          }
        );
        if (!accRes.ok) {
          const err = await accRes.json().catch(() => ({}));
          alert(err?.detail || '계좌 정보 저장 실패');
          return;
        }
      }

      setEditState(null);
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  /* ---- delete handlers ---- */

  async function handleDeleteAccount(row: FlatRow) {
    if (!row.accountId) {
      if (!window.confirm(`"${row.clientName}" 고객을 삭제하시겠습니까?`)) return;
      await deleteClient(row.clientId);
      return;
    }
    if (!window.confirm(`"${row.clientName}"의 ${getAccountTypeLabel(row.accountType)} 계좌를 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch(
        `${API_URL}/api/v1/clients/${row.clientId}/accounts/${row.accountId}`,
        { method: 'DELETE', headers: { ...authLib.getAuthHeader() } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '계좌 삭제 실패');
        return;
      }
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  }

  async function deleteClient(clientId: string) {
    try {
      const res = await fetch(`${API_URL}/api/v1/clients/${clientId}`, {
        method: 'DELETE',
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '고객 삭제 실패');
        return;
      }
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('삭제 중 오류가 발생했습니다.');
    }
  }

  /* ---- add account to existing client ---- */

  function startAddAccount(clientId: string) {
    setAddAccountClientId(clientId);
    setAddAccountForm({ accountType: 'irp', accountNumber: '', securitiesCompany: '' });
  }

  function cancelAddAccount() {
    setAddAccountClientId(null);
  }

  async function handleSaveAddAccount() {
    if (!addAccountClientId) return;
    setAddAccountSaving(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/clients/${addAccountClientId}/accounts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({
            account_type: addAccountForm.accountType,
            account_number: addAccountForm.accountNumber || undefined,
            securities_company: addAccountForm.securitiesCompany || undefined,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.detail || '계좌 추가 실패');
        return;
      }
      setAddAccountClientId(null);
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('계좌 추가 중 오류가 발생했습니다.');
    } finally {
      setAddAccountSaving(false);
    }
  }

  /* ---- new row handler ---- */

  async function handleSaveNewRow() {
    if (!newRow.clientName.trim()) {
      alert('고객명을 입력하세요.');
      return;
    }
    setNewSaving(true);
    try {
      /* Create client */
      const clientRes = await fetch(`${API_URL}/api/v1/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ name: newRow.clientName.trim(), phone: newRow.phone.trim() || null }),
      });
      if (!clientRes.ok) {
        const err = await clientRes.json().catch(() => ({}));
        alert(err?.detail || '고객 생성 실패');
        return;
      }
      const createdClient: Client = await clientRes.json();

      /* Create account */
      const accRes = await fetch(`${API_URL}/api/v1/clients/${createdClient.id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          account_type: newRow.accountType,
          account_number: newRow.accountNumber || undefined,
          securities_company: newRow.securitiesCompany || undefined,
        }),
      });
      if (!accRes.ok) {
        const err = await accRes.json().catch(() => ({}));
        alert(err?.detail || '계좌 생성 실패');
        return;
      }

      setNewRow({ clientName: '', phone: '', accountType: 'irp', accountNumber: '', securitiesCompany: '' });
      setAddingNew(false);
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setNewSaving(false);
    }
  }

  /* ---- guard ---- */
  if (!isOpen) return null;

  /* ---- render ---- */

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth: 820,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid #E1E5EB',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 800, color: '#1A1A2E' }}>
            고객 정보 관리
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9CA3AF',
              padding: 6,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F3F4F6')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 24px',
            borderBottom: '1px solid #E1E5EB',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="2"
              style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="고객명 또는 계좌번호 검색"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              style={{
                ...inputStyle,
                paddingLeft: 28,
                fontSize: '0.8125rem',
              }}
            />
          </div>

          <select
            value={filterAccountType}
            onChange={(e) => setFilterAccountType(e.target.value)}
            style={{ ...selectStyle, flex: '0 1 150px', minWidth: 130 }}
          >
            <option value="">계좌유형 전체</option>
            {ACCOUNT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            value={filterSecurities}
            onChange={(e) => setFilterSecurities(e.target.value)}
            style={{ ...selectStyle, flex: '0 1 150px', minWidth: 130 }}
          >
            <option value="">증권사 전체</option>
            {SECURITIES_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button
            onClick={resetFilters}
            style={{
              padding: '5px 12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#6B7280',
              backgroundColor: '#F3F4F6',
              border: '1px solid #E1E5EB',
              borderRadius: 7,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            초기화
          </button>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem', padding: '40px 0' }}>
              불러오는 중...
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 0 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 44, textAlign: 'center' }}>No.</th>
                  <th style={thStyle}>고객명</th>
                  <th style={{ ...thStyle, minWidth: 110 }}>전화번호</th>
                  <th style={thStyle}>증권사</th>
                  <th style={thStyle}>계좌유형</th>
                  <th style={thStyle}>계좌번호</th>
                  <th style={{ ...thStyle, width: 120, textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && !addingNew && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        ...tdStyle,
                        textAlign: 'center',
                        color: '#9CA3AF',
                        padding: '32px 0',
                      }}
                    >
                      {searchKeyword || filterAccountType || filterSecurities
                        ? '검색 결과가 없습니다.'
                        : '등록된 고객이 없습니다. 신규 등록 버튼을 눌러 추가하세요.'}
                    </td>
                  </tr>
                )}

                {filteredRows.map((row, idx) => {
                  const rowKey = `${row.clientId}-${row.accountId}`;
                  const isEditing = editState?.rowKey === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                    <tr
                      style={{
                        backgroundColor: isEditing ? '#F0F4FF' : idx % 2 === 0 ? '#fff' : '#FAFBFC',
                      }}
                    >
                      {/* No. */}
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', fontSize: '0.75rem' }}>
                        {idx + 1}
                      </td>

                      {/* 고객명 */}
                      <td style={{ ...tdStyle, fontWeight: row.isFirstForClient ? 600 : 400, color: row.isFirstForClient ? '#1A1A2E' : '#6B7280' }}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editState!.clientName}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, clientName: e.target.value } : prev)}
                            style={inputStyle}
                            autoFocus
                          />
                        ) : (
                          row.isFirstForClient ? row.clientName : <span style={{ paddingLeft: 12, color: '#9CA3AF' }}>↳</span>
                        )}
                      </td>

                      {/* 전화번호 */}
                      <td style={tdStyle}>
                        {isEditing && row.isFirstForClient ? (
                          <input
                            type="text"
                            value={editState!.phone}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, phone: e.target.value } : prev)}
                            style={{ ...inputStyle, fontSize: '0.75rem' }}
                            placeholder="010-0000-0000"
                          />
                        ) : (
                          row.isFirstForClient ? (
                            <span style={{ color: row.phone ? '#374151' : '#D1D5DB', fontSize: '0.75rem' }}>
                              {row.phone || '-'}
                            </span>
                          ) : null
                        )}
                      </td>

                      {/* 증권사 */}
                      <td style={tdStyle}>
                        {isEditing && row.accountId ? (
                          <select
                            value={
                              SECURITIES_OPTIONS.find((o) =>
                                editState!.securitiesCompany.includes(o.label)
                              )?.value ?? editState!.securitiesCompany
                            }
                            onChange={(e) => {
                              const label = SECURITIES_OPTIONS.find((o) => o.value === e.target.value)?.label ?? e.target.value;
                              setEditState((prev) => prev ? { ...prev, securitiesCompany: label } : prev);
                            }}
                            style={selectStyle}
                          >
                            <option value="">선택</option>
                            {SECURITIES_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: row.securitiesCompany ? '#1A1A2E' : '#D1D5DB' }}>
                            {row.securitiesCompany || '-'}
                          </span>
                        )}
                      </td>

                      {/* 계좌유형 */}
                      <td style={tdStyle}>
                        {isEditing && row.accountId ? (
                          <select
                            value={editState!.accountType}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, accountType: e.target.value } : prev)}
                            style={selectStyle}
                          >
                            <option value="">선택</option>
                            {ACCOUNT_TYPE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: '#1E3A5F',
                              backgroundColor: '#EEF2F7',
                              padding: '2px 8px',
                              borderRadius: 5,
                            }}
                          >
                            {row.accountType ? getAccountTypeLabel(row.accountType) : '-'}
                          </span>
                        )}
                      </td>

                      {/* 계좌번호 */}
                      <td style={tdStyle}>
                        {isEditing && row.accountId ? (
                          <input
                            type="text"
                            value={editState!.accountNumber}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, accountNumber: e.target.value } : prev)}
                            style={inputStyle}
                            placeholder="계좌번호 입력"
                          />
                        ) : (
                          <span style={{ color: row.accountNumber ? '#374151' : '#D1D5DB', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                            {row.accountNumber || '미등록'}
                          </span>
                        )}
                      </td>

                      {/* 관리 버튼 */}
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 3, justifyContent: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={() => handleSaveEdit(row)} disabled={saving}
                              style={{ padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 700, color: '#fff', backgroundColor: saving ? '#9CA3AF' : '#1E3A5F', border: 'none', borderRadius: 5, cursor: saving ? 'not-allowed' : 'pointer' }}>
                              {saving ? '...' : '저장'}
                            </button>
                            <button onClick={cancelEdit}
                              style={{ padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 600, color: '#374151', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 5, cursor: 'pointer' }}>
                              취소
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 3, justifyContent: 'center', whiteSpace: 'nowrap' }}>
                            {row.isFirstForClient && (
                              <button onClick={() => startAddAccount(row.clientId)} title="계좌 추가"
                                style={{ padding: '3px 6px', fontSize: '0.6875rem', fontWeight: 600, color: '#059669', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 5, cursor: 'pointer' }}>
                                +계좌
                              </button>
                            )}
                            <button onClick={() => startEdit(row)} title="수정"
                              style={{ padding: '3px 6px', fontSize: '0.6875rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #CBD5E1', borderRadius: 5, cursor: 'pointer' }}>
                              수정
                            </button>
                            <button onClick={() => handleDeleteAccount(row)} title="삭제"
                              style={{ padding: '3px 6px', fontSize: '0.6875rem', fontWeight: 600, color: '#EF4444', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 5, cursor: 'pointer' }}>
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Inline add-account row */}
                    {addAccountClientId === row.clientId && row.isFirstForClient && (
                      <tr style={{ backgroundColor: '#F0FFF4' }}>
                        <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', fontSize: '0.75rem' }}>+</td>
                        <td style={{ ...tdStyle, color: '#059669', fontSize: '0.75rem', fontWeight: 600 }}>
                          ↳ 계좌 추가
                        </td>
                        <td style={tdStyle} />
                        <td style={tdStyle}>
                          <select
                            value={SECURITIES_OPTIONS.find((o) => addAccountForm.securitiesCompany.includes(o.label))?.value ?? ''}
                            onChange={(e) => {
                              const label = SECURITIES_OPTIONS.find((o) => o.value === e.target.value)?.label ?? '';
                              setAddAccountForm((f) => ({ ...f, securitiesCompany: label }));
                            }}
                            style={selectStyle}
                          >
                            <option value="">증권사</option>
                            {SECURITIES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={addAccountForm.accountType}
                            onChange={(e) => setAddAccountForm((f) => ({ ...f, accountType: e.target.value }))}
                            style={selectStyle}
                          >
                            {ACCOUNT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="text"
                            value={addAccountForm.accountNumber}
                            onChange={(e) => setAddAccountForm((f) => ({ ...f, accountNumber: e.target.value }))}
                            style={inputStyle}
                            placeholder="계좌번호"
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <button
                              onClick={handleSaveAddAccount}
                              disabled={addAccountSaving}
                              style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff', backgroundColor: addAccountSaving ? '#9CA3AF' : '#059669', border: 'none', borderRadius: 6, cursor: addAccountSaving ? 'not-allowed' : 'pointer' }}
                            >
                              {addAccountSaving ? '...' : '추가'}
                            </button>
                            <button
                              onClick={cancelAddAccount}
                              style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#374151', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 6, cursor: 'pointer' }}
                            >
                              취소
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}

                {/* New row (inline) */}
                {addingNew && (
                  <tr style={{ backgroundColor: '#F0FFF4' }}>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', fontSize: '0.75rem' }}>
                      *
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        placeholder="고객명 입력"
                        value={newRow.clientName}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, clientName: e.target.value }))}
                        style={inputStyle}
                        autoFocus
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        placeholder="010-0000-0000"
                        value={newRow.phone}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, phone: e.target.value }))}
                        style={{ ...inputStyle, fontSize: '0.75rem' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={
                          SECURITIES_OPTIONS.find((o) =>
                            newRow.securitiesCompany.includes(o.label)
                          )?.value ?? ''
                        }
                        onChange={(e) => {
                          const label = SECURITIES_OPTIONS.find((o) => o.value === e.target.value)?.label ?? '';
                          setNewRow((prev) => ({ ...prev, securitiesCompany: label }));
                        }}
                        style={selectStyle}
                      >
                        <option value="">선택</option>
                        {SECURITIES_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={newRow.accountType}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, accountType: e.target.value }))}
                        style={selectStyle}
                      >
                        {ACCOUNT_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        placeholder="계좌번호 입력"
                        value={newRow.accountNumber}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, accountNumber: e.target.value }))}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          onClick={handleSaveNewRow}
                          disabled={newSaving}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#fff',
                            backgroundColor: newSaving ? '#9CA3AF' : '#059669',
                            border: 'none',
                            borderRadius: 6,
                            cursor: newSaving ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {newSaving ? '...' : '저장'}
                        </button>
                        <button
                          onClick={() => {
                            setAddingNew(false);
                            setNewRow({ clientName: '', phone: '', accountType: 'irp', accountNumber: '', securitiesCompany: '' });
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#374151',
                            backgroundColor: '#F3F4F6',
                            border: '1px solid #E1E5EB',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 24px',
            borderTop: '1px solid #E1E5EB',
            flexShrink: 0,
            backgroundColor: '#FAFBFC',
          }}
        >
          <span style={{ fontSize: '0.8125rem', color: '#9CA3AF' }}>
            총 {filteredRows.length}개 행 표시 중
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                setAddingNew(true);
                setEditState(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '8px 16px',
                fontSize: '0.875rem',
                fontWeight: 700,
                color: '#fff',
                backgroundColor: '#1E3A5F',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              신규 등록
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '8px 18px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#374151',
                backgroundColor: '#F3F4F6',
                border: '1px solid #E1E5EB',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClientManagementModal;
