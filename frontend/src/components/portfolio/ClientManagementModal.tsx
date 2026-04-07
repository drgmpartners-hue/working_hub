'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface FieldOption {
  id: string;
  field_name: string;
  value: string;
  label: string;
  sort_order: number;
}

interface ClientAccount {
  id: string;
  client_id: string;
  account_type: string;
  account_number?: string;
  securities_company?: string;
  representative?: string;
}

interface Client {
  id: string;
  name: string;
  phone?: string;
  accounts: ClientAccount[];
}

interface FlatRow {
  clientId: string;
  clientName: string;
  accountId: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
  representative: string;
  isFirstForClient: boolean;
}

interface NewRow {
  clientName: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
  representative: string;
}

interface EditState {
  rowKey: string;
  clientName: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
  representative: string;
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
/*  Field Options Management Sub-Popup                                  */
/* ------------------------------------------------------------------ */

function FieldOptionPopup({
  fieldName,
  title,
  onClose,
  options,
  onReload,
}: {
  fieldName: string;
  title: string;
  onClose: () => void;
  options: FieldOption[];
  onReload: () => void;
}) {
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const val = newValue.trim() || newLabel.trim().toLowerCase().replace(/\s+/g, '_');
      const res = await fetch(`${API_URL}/api/v1/field-options/${fieldName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ field_name: fieldName, value: val, label: newLabel.trim(), sort_order: options.length }),
      });
      if (res.ok) {
        setNewValue('');
        setNewLabel('');
        onReload();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editLabel.trim()) return;
    setSaving(true);
    try {
      const val = editValue.trim() || editLabel.trim().toLowerCase().replace(/\s+/g, '_');
      await fetch(`${API_URL}/api/v1/field-options/${fieldName}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ value: val, label: editLabel.trim() }),
      });
      setEditId(null);
      onReload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('삭제하시겠습니까?')) return;
    await fetch(`${API_URL}/api/v1/field-options/${fieldName}/${id}`, {
      method: 'DELETE',
      headers: { ...authLib.getAuthHeader() },
    });
    onReload();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 420,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #E1E5EB' }}>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>{title} 관리</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4, borderRadius: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {options.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: '0.8125rem', padding: '20px 0' }}>
              등록된 항목이 없습니다.
            </div>
          )}
          {options.map((opt) => (
            <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F3F4F6' }}>
              {editId === opt.id ? (
                <>
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={{ ...inputStyle, flex: '0 0 80px', fontSize: '0.75rem' }}
                    placeholder="코드"
                  />
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    style={{ ...inputStyle, flex: 1, fontSize: '0.75rem' }}
                    placeholder="표시명"
                    autoFocus
                  />
                  <button onClick={() => handleUpdate(opt.id)} disabled={saving}
                    style={{ padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 700, color: '#fff', backgroundColor: '#1E3A5F', border: 'none', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    저장
                  </button>
                  <button onClick={() => setEditId(null)}
                    style={{ padding: '3px 8px', fontSize: '0.6875rem', fontWeight: 600, color: '#374151', backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    취소
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: '0 0 80px', fontSize: '0.75rem', color: '#9CA3AF', fontFamily: 'monospace' }}>{opt.value}</span>
                  <span style={{ flex: 1, fontSize: '0.8125rem', color: '#1A1A2E', fontWeight: 600 }}>{opt.label}</span>
                  <button onClick={() => { setEditId(opt.id); setEditValue(opt.value); setEditLabel(opt.label); }}
                    style={{ padding: '2px 6px', fontSize: '0.6875rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #CBD5E1', borderRadius: 4, cursor: 'pointer' }}>
                    수정
                  </button>
                  <button onClick={() => handleDelete(opt.id)}
                    style={{ padding: '2px 6px', fontSize: '0.6875rem', fontWeight: 600, color: '#EF4444', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, cursor: 'pointer' }}>
                    삭제
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #E1E5EB', backgroundColor: '#FAFBFC' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{ ...inputStyle, flex: '0 0 80px', fontSize: '0.75rem' }}
              placeholder="코드"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ ...inputStyle, flex: 1, fontSize: '0.75rem' }}
              placeholder="표시명 입력"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            />
            <button onClick={handleAdd} disabled={saving || !newLabel.trim()}
              style={{
                padding: '5px 14px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                backgroundColor: !newLabel.trim() ? '#9CA3AF' : '#059669',
                border: 'none', borderRadius: 6, cursor: !newLabel.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}>
              추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
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
    accountType: 'irp',
    accountNumber: '',
    securitiesCompany: '',
    representative: '',
  });
  const [newSaving, setNewSaving] = useState(false);

  /* Add account to existing client */
  const [addAccountClientId, setAddAccountClientId] = useState<string | null>(null);
  const [addAccountForm, setAddAccountForm] = useState({ accountType: 'irp', accountNumber: '', securitiesCompany: '', representative: '' });
  const [addAccountSaving, setAddAccountSaving] = useState(false);

  /* Field options */
  const [fieldOptions, setFieldOptions] = useState<Record<string, FieldOption[]>>({
    securities: [],
    account_type: [],
    representative: [],
  });
  const [optionPopup, setOptionPopup] = useState<{ fieldName: string; title: string } | null>(null);

  /* ---- load field options ---- */
  const DEFAULT_ACCOUNT_TYPES: { value: string; label: string; sort_order: number }[] = [
    { value: 'irp', label: 'IRP', sort_order: 1 },
    { value: 'pension', label: '연금저축', sort_order: 2 },
    { value: 'pension_hold', label: '연금저축(거치)', sort_order: 3 },
    { value: 'retirement', label: '퇴직연금', sort_order: 4 },
    { value: 'stock', label: '주식계좌', sort_order: 5 },
    { value: 'other', label: '기타계좌', sort_order: 6 },
  ];

  const loadFieldOptions = useCallback(async () => {
    const fields = ['securities', 'account_type', 'representative'];
    const results: Record<string, FieldOption[]> = {};
    await Promise.all(
      fields.map(async (f) => {
        try {
          const res = await fetch(`${API_URL}/api/v1/field-options/${f}`, {
            headers: { ...authLib.getAuthHeader() },
          });
          results[f] = res.ok ? await res.json() : [];
        } catch {
          results[f] = [];
        }
      })
    );

    // account_type: 정확히 6종만 유지 (불필요한 항목 삭제 + 누락 항목 생성)
    const allowedValues = new Set(DEFAULT_ACCOUNT_TYPES.map((d) => d.value));
    const existingValues = new Set(results.account_type.map((o) => o.value));

    // 불필요한 항목 삭제 (pension1, pension2, pension_saving 등)
    for (const opt of results.account_type) {
      if (!allowedValues.has(opt.value)) {
        try {
          await fetch(`${API_URL}/api/v1/field-options/account_type/${opt.id}`, {
            method: 'DELETE',
            headers: { ...authLib.getAuthHeader() },
          });
        } catch { /* silent */ }
      }
    }

    // 누락 항목 생성
    const missing = DEFAULT_ACCOUNT_TYPES.filter((d) => !existingValues.has(d.value));
    const created: FieldOption[] = [];
    for (const d of missing) {
      try {
        const res = await fetch(`${API_URL}/api/v1/field-options/account_type`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
          body: JSON.stringify({ field_name: 'account_type', ...d }),
        });
        if (res.ok) created.push(await res.json());
      } catch { /* silent */ }
    }

    // 허용된 항목만 유지
    results.account_type = [
      ...results.account_type.filter((o) => allowedValues.has(o.value)),
      ...created,
    ].sort((a, b) => a.sort_order - b.sort_order);

    setFieldOptions(results);
  }, []);

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
      // 구 계좌유형 마이그레이션 (pension1/pension2 → pension) 후 로드
      fetch(`${API_URL}/api/v1/clients/migrate-account-types`, {
        method: 'POST',
        headers: { ...authLib.getAuthHeader() },
      }).catch(() => {}).finally(() => {
        loadClients();
        loadFieldOptions();
      });
    }
  }, [isOpen, loadClients, loadFieldOptions]);

  /* ---- helpers for options ---- */
  const securitiesOptions = fieldOptions.securities;
  const accountTypeOptions = fieldOptions.account_type;
  const representativeOptions = fieldOptions.representative;

  function getAccountTypeLabel(value: string) {
    return accountTypeOptions.find((o) => o.value === value)?.label ?? value;
  }

  function getSecuritiesLabel(value: string) {
    return securitiesOptions.find((o) => o.value === value || o.label === value)?.label ?? value;
  }

  /* ---- build flat rows ---- */
  const flatRows: FlatRow[] = clients.flatMap((client) => {
    if (client.accounts.length === 0) {
      return [{
        clientId: client.id,
        clientName: client.name,
        accountId: '',
        accountType: '',
        accountNumber: '',
        securitiesCompany: '',
        representative: '',
        isFirstForClient: true,
      }];
    }
    return client.accounts.map((acc, i) => ({
      clientId: client.id,
      clientName: client.name,
      accountId: acc.id,
      accountType: acc.account_type,
      accountNumber: acc.account_number ?? '',
      securitiesCompany: acc.securities_company ?? '',
      representative: acc.representative ?? '',
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
      const secLabel = securitiesOptions.find((s) => s.value === filterSecurities)?.label ?? filterSecurities;
      if (!row.securitiesCompany.toLowerCase().includes(secLabel.toLowerCase()) &&
          !row.securitiesCompany.toLowerCase().includes(filterSecurities.toLowerCase())) return false;
    }
    return true;
  });

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
      accountType: row.accountType,
      accountNumber: row.accountNumber,
      securitiesCompany: row.securitiesCompany,
      representative: row.representative,
    });
  }

  function cancelEdit() {
    setEditState(null);
  }

  async function handleSaveEdit(row: FlatRow) {
    if (!editState) return;
    setSaving(true);
    try {
      const clientRes = await fetch(`${API_URL}/api/v1/clients/${row.clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ name: editState.clientName }),
      });
      if (!clientRes.ok) {
        const err = await clientRes.json().catch(() => ({}));
        alert(err?.detail || '고객 정보 저장 실패');
        return;
      }

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
              representative: editState.representative || undefined,
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
    setAddAccountForm({ accountType: 'irp', accountNumber: '', securitiesCompany: '', representative: '' });
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
            representative: addAccountForm.representative || undefined,
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
      const clientRes = await fetch(`${API_URL}/api/v1/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ name: newRow.clientName.trim() }),
      });
      if (!clientRes.ok) {
        const err = await clientRes.json().catch(() => ({}));
        alert(err?.detail || '고객 생성 실패');
        return;
      }
      const createdClient: Client = await clientRes.json();

      const accRes = await fetch(`${API_URL}/api/v1/clients/${createdClient.id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({
          account_type: newRow.accountType,
          account_number: newRow.accountNumber || undefined,
          securities_company: newRow.securitiesCompany || undefined,
          representative: newRow.representative || undefined,
        }),
      });
      if (!accRes.ok) {
        const err = await accRes.json().catch(() => ({}));
        alert(err?.detail || '계좌 생성 실패');
        return;
      }

      setNewRow({ clientName: '', accountType: 'irp', accountNumber: '', securitiesCompany: '', representative: '' });
      setAddingNew(false);
      await loadClients();
      onClientAdded?.();
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setNewSaving(false);
    }
  }

  /* ---- clickable header style ---- */
  const clickableThStyle: React.CSSProperties = {
    ...thStyle,
    cursor: 'pointer',
    position: 'relative',
    userSelect: 'none',
  };

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
          maxWidth: 920,
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
            계좌 정보 관리
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
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
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
              style={{ ...inputStyle, paddingLeft: 28, fontSize: '0.8125rem' }}
            />
          </div>

          <select
            value={filterAccountType}
            onChange={(e) => setFilterAccountType(e.target.value)}
            style={{ ...selectStyle, flex: '0 1 150px', minWidth: 130 }}
          >
            <option value="">계좌유형 전체</option>
            {accountTypeOptions.map((o) => (
              <option key={o.id} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select
            value={filterSecurities}
            onChange={(e) => setFilterSecurities(e.target.value)}
            style={{ ...selectStyle, flex: '0 1 150px', minWidth: 130 }}
          >
            <option value="">증권사 전체</option>
            {securitiesOptions.map((o) => (
              <option key={o.id} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button
            onClick={resetFilters}
            style={{
              padding: '5px 12px', fontSize: '0.8125rem', fontWeight: 600, color: '#6B7280',
              backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
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
                  <th
                    style={clickableThStyle}
                    onClick={() => setOptionPopup({ fieldName: 'securities', title: '증권사' })}
                    title="클릭하여 증권사 목록 관리"
                  >
                    증권사 <span style={{ fontSize: '0.625rem', opacity: 0.7 }}>&#9881;</span>
                  </th>
                  <th
                    style={clickableThStyle}
                    onClick={() => setOptionPopup({ fieldName: 'account_type', title: '계좌유형' })}
                    title="클릭하여 계좌유형 목록 관리"
                  >
                    계좌유형 <span style={{ fontSize: '0.625rem', opacity: 0.7 }}>&#9881;</span>
                  </th>
                  <th style={thStyle}>계좌번호</th>
                  <th
                    style={clickableThStyle}
                    onClick={() => setOptionPopup({ fieldName: 'representative', title: '투권인' })}
                    title="클릭하여 투권인 목록 관리"
                  >
                    투권인 <span style={{ fontSize: '0.625rem', opacity: 0.7 }}>&#9881;</span>
                  </th>
                  <th style={{ ...thStyle, width: 120, textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && !addingNew && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', padding: '32px 0' }}>
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
                    <tr style={{ backgroundColor: isEditing ? '#F0F4FF' : idx % 2 === 0 ? '#fff' : '#FAFBFC' }}>
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
                          row.isFirstForClient ? row.clientName : <span style={{ paddingLeft: 12, color: '#9CA3AF' }}>&#8627;</span>
                        )}
                      </td>

                      {/* 증권사 */}
                      <td style={tdStyle}>
                        {isEditing && row.accountId ? (
                          <select
                            value={
                              securitiesOptions.find((o) =>
                                editState!.securitiesCompany === o.label || editState!.securitiesCompany === o.value
                              )?.value ?? editState!.securitiesCompany
                            }
                            onChange={(e) => {
                              const label = securitiesOptions.find((o) => o.value === e.target.value)?.label ?? e.target.value;
                              setEditState((prev) => prev ? { ...prev, securitiesCompany: label } : prev);
                            }}
                            style={selectStyle}
                          >
                            <option value="">선택</option>
                            {securitiesOptions.map((o) => (
                              <option key={o.id} value={o.value}>{o.label}</option>
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
                            {accountTypeOptions.map((o) => (
                              <option key={o.id} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{
                            display: 'inline-block', fontSize: '0.75rem', fontWeight: 600, color: '#1E3A5F',
                            backgroundColor: '#EEF2F7', padding: '2px 8px', borderRadius: 5,
                          }}>
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

                      {/* 투권인 */}
                      <td style={tdStyle}>
                        {isEditing && row.accountId ? (
                          <select
                            value={editState!.representative}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, representative: e.target.value } : prev)}
                            style={selectStyle}
                          >
                            <option value="">선택</option>
                            {representativeOptions.map((o) => (
                              <option key={o.id} value={o.label}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: row.representative ? '#374151' : '#D1D5DB', fontSize: '0.8125rem' }}>
                            {row.representative || '-'}
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
                          &#8627; 계좌 추가
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={securitiesOptions.find((o) => addAccountForm.securitiesCompany === o.label)?.value ?? ''}
                            onChange={(e) => {
                              const label = securitiesOptions.find((o) => o.value === e.target.value)?.label ?? '';
                              setAddAccountForm((f) => ({ ...f, securitiesCompany: label }));
                            }}
                            style={selectStyle}
                          >
                            <option value="">증권사</option>
                            {securitiesOptions.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <select
                            value={addAccountForm.accountType}
                            onChange={(e) => setAddAccountForm((f) => ({ ...f, accountType: e.target.value }))}
                            style={selectStyle}
                          >
                            {accountTypeOptions.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
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
                        <td style={tdStyle}>
                          <select
                            value={addAccountForm.representative}
                            onChange={(e) => setAddAccountForm((f) => ({ ...f, representative: e.target.value }))}
                            style={selectStyle}
                          >
                            <option value="">투권인</option>
                            {representativeOptions.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                          </select>
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
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', fontSize: '0.75rem' }}>*</td>
                    <td style={tdStyle}>
                      <input type="text" placeholder="고객명 입력" value={newRow.clientName}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, clientName: e.target.value }))}
                        style={inputStyle} autoFocus />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={securitiesOptions.find((o) => newRow.securitiesCompany === o.label)?.value ?? ''}
                        onChange={(e) => {
                          const label = securitiesOptions.find((o) => o.value === e.target.value)?.label ?? '';
                          setNewRow((prev) => ({ ...prev, securitiesCompany: label }));
                        }}
                        style={selectStyle}
                      >
                        <option value="">선택</option>
                        {securitiesOptions.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <select value={newRow.accountType}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, accountType: e.target.value }))}
                        style={selectStyle}
                      >
                        {accountTypeOptions.map((o) => <option key={o.id} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input type="text" placeholder="계좌번호 입력" value={newRow.accountNumber}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, accountNumber: e.target.value }))}
                        style={inputStyle} />
                    </td>
                    <td style={tdStyle}>
                      <select value={newRow.representative}
                        onChange={(e) => setNewRow((prev) => ({ ...prev, representative: e.target.value }))}
                        style={selectStyle}
                      >
                        <option value="">선택</option>
                        {representativeOptions.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button onClick={handleSaveNewRow} disabled={newSaving}
                          style={{
                            padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                            backgroundColor: newSaving ? '#9CA3AF' : '#059669', border: 'none', borderRadius: 6,
                            cursor: newSaving ? 'not-allowed' : 'pointer',
                          }}>
                          {newSaving ? '...' : '저장'}
                        </button>
                        <button
                          onClick={() => {
                            setAddingNew(false);
                            setNewRow({ clientName: '', accountType: 'irp', accountNumber: '', securitiesCompany: '', representative: '' });
                          }}
                          style={{
                            padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#374151',
                            backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 6, cursor: 'pointer',
                          }}>
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
              onClick={() => { setAddingNew(true); setEditState(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '8px 16px', fontSize: '0.875rem', fontWeight: 700, color: '#fff',
                backgroundColor: '#1E3A5F', border: 'none', borderRadius: 8, cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              신규 등록
            </button>
            <button onClick={onClose}
              style={{
                padding: '8px 18px', fontSize: '0.875rem', fontWeight: 600, color: '#374151',
                backgroundColor: '#F3F4F6', border: '1px solid #E1E5EB', borderRadius: 8, cursor: 'pointer',
              }}>
              닫기
            </button>
          </div>
        </div>
      </div>

      {/* Field Options Popup */}
      {optionPopup && (
        <FieldOptionPopup
          fieldName={optionPopup.fieldName}
          title={optionPopup.title}
          options={fieldOptions[optionPopup.fieldName] || []}
          onClose={() => setOptionPopup(null)}
          onReload={loadFieldOptions}
        />
      )}
    </div>
  );
}

export default ClientManagementModal;
