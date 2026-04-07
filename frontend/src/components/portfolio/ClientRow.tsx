'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types (shared with page)                                            */
/* ------------------------------------------------------------------ */

interface ClientAccount {
  id: string;
  client_id: string;
  account_type: string;
  account_number?: string;
  securities_company?: string;
  monthly_payment?: number;
}

interface Client {
  id: string;
  name: string;
  unique_code?: string;
  memo?: string;
  accounts: ClientAccount[];
}

interface ClientRowData {
  clientId: string;
  clientName: string;
  accountId: string;
  accountType: string;
  accountNumber: string;
  securitiesCompany: string;
  imageFile: File | null;
  imagePreview: string;
  snapshotDate: string;
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface ClientRowProps {
  index: number;
  clients: Client[];
  data: ClientRowData;
  onChange: (data: ClientRowData) => void;
  onRemove: () => void;
}

/* ------------------------------------------------------------------ */
/*  Edit modal types                                                    */
/* ------------------------------------------------------------------ */

interface EditAccountRow {
  id: string;
  account_type: string;
  account_number: string;
  securities_company: string;
}

interface EditClientData {
  clientId: string;
  name: string;
  accounts: EditAccountRow[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  irp: 'IRP',
  pension: '연금저축',
  pension_hold: '연금저축(거치)',
  retirement: '퇴직연금',
  stock: '주식계좌',
  other: '기타계좌',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.8125rem',
  border: '1px solid #E1E5EB',
  borderRadius: 8,
  outline: 'none',
  color: '#1A1A2E',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6B7280',
  marginBottom: 4,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
};

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ClientRow({ index, clients, data, onChange, onRemove }: ClientRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteZoneRef = useRef<HTMLDivElement>(null);

  /* ---------- client dropdown state ---------- */
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientPage, setClientPage] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 10;

  // 중복 이름 제거: 같은 이름의 고객은 하나만 표시 (모든 계좌를 합침)
  const uniqueClients = (() => {
    const nameMap = new Map<string, Client>();
    for (const c of clients) {
      const existing = nameMap.get(c.name);
      if (existing) {
        // 동일 이름 → 계좌가 더 많은 쪽을 기준 ID로 사용, 계좌 합침
        const mergedAccounts = [...existing.accounts, ...c.accounts.filter(
          (a) => !existing.accounts.some((ea) => ea.id === a.id)
        )];
        if (c.accounts.length > existing.accounts.length) {
          nameMap.set(c.name, { ...c, accounts: mergedAccounts });
        } else {
          existing.accounts = mergedAccounts;
        }
      } else {
        nameMap.set(c.name, { ...c, accounts: [...c.accounts] });
      }
    }
    return Array.from(nameMap.values());
  })();

  // 검색 필터 + 페이지네이션
  const filteredClients = uniqueClients.filter((c) =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );
  const totalPages = Math.ceil(filteredClients.length / PAGE_SIZE);
  const pagedClients = filteredClients.slice(clientPage * PAGE_SIZE, (clientPage + 1) * PAGE_SIZE);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  /* ---------- edit modal state ---------- */
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editClientData, setEditClientData] = useState<EditClientData | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  /* ---------- helpers ---------- */

  function update(patch: Partial<ClientRowData>) {
    onChange({ ...data, ...patch });
  }

  function handleClientSelect(clientId: string) {
    if (!clientId) {
      update({ clientId: '', clientName: '', accountId: '', accountType: '' as any, accountNumber: '', securitiesCompany: '' });
      return;
    }
    const client = uniqueClients.find((c) => c.id === clientId);
    if (!client) return;

    // 첫 번째 계좌를 자동 선택
    const firstAccount = client.accounts[0];

    update({
      clientId: client.id,
      clientName: client.name,
      accountType: firstAccount?.account_type ?? 'irp',
      accountId: firstAccount?.id ?? '',
      accountNumber: firstAccount?.account_number ?? '',
      securitiesCompany: firstAccount?.securities_company ?? '',
    });
    setDropdownOpen(false);
  }

  function handleAccountTypeChange(accountType: string) {
    const client = uniqueClients.find((c) => c.id === data.clientId);
    const matchingAccount = client?.accounts.find((a) => a.account_type === accountType);
    update({
      accountType: accountType as any,
      accountId: matchingAccount?.id ?? '',
      accountNumber: matchingAccount?.account_number ?? '',
      securitiesCompany: matchingAccount?.securities_company ?? '',
    });
  }

  function processImageFile(file: File) {
    const preview = URL.createObjectURL(file);
    update({ imageFile: file, imagePreview: preview });
  }

  // 항상 최신 processImageFile을 참조하는 ref (stale closure 방지)
  const processImageFileRef = useRef(processImageFile);
  useEffect(() => {
    processImageFileRef.current = processImageFile;
  });

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFileRef.current(file);
            break;
          }
        }
      }
    },
    []
  );

  // window 레벨 paste 이벤트: 이미지가 없을 때 어디서 Ctrl+V 해도 동작
  const imagePreviewRef = useRef(data.imagePreview);
  useEffect(() => {
    imagePreviewRef.current = data.imagePreview;
  }, [data.imagePreview]);

  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (imagePreviewRef.current) return; // 이미 이미지 있으면 무시
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFileRef.current(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  }

  function removeImage() {
    if (data.imagePreview) URL.revokeObjectURL(data.imagePreview);
    update({ imageFile: null, imagePreview: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ---------- edit modal handlers ---------- */

  function openEditModal() {
    const client = clients.find((c) => c.id === data.clientId);
    if (!client) return;
    setEditClientData({
      clientId: client.id,
      name: client.name,
      accounts: client.accounts.map((a) => ({
        id: a.id,
        account_type: a.account_type,
        account_number: a.account_number ?? '',
        securities_company: a.securities_company ?? '',
      })),
    });
    setEditModalOpen(true);
  }

  async function handleEditSave() {
    if (!editClientData) return;
    setEditSaving(true);
    try {
      // 1. Update client name
      const clientRes = await fetch(`${API_URL}/api/v1/clients/${editClientData.clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify({ name: editClientData.name }),
      });
      if (!clientRes.ok) {
        const err = await clientRes.json().catch(() => ({}));
        alert(err?.detail || '고객 정보 저장 실패');
        return;
      }

      // 2. Update each account
      for (const acc of editClientData.accounts) {
        const accRes = await fetch(
          `${API_URL}/api/v1/clients/${editClientData.clientId}/accounts/${acc.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
            body: JSON.stringify({
              account_number: acc.account_number || undefined,
              securities_company: acc.securities_company || undefined,
            }),
          }
        );
        if (!accRes.ok) {
          const err = await accRes.json().catch(() => ({}));
          alert(err?.detail || `계좌 저장 실패 (${ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type})`);
          return;
        }
      }

      // 3. Update local row data to reflect name change
      onChange({ ...data, clientName: editClientData.name });
      setEditModalOpen(false);

      // 4. Trigger parent refresh by calling onChange - parent should reload clients
      // The parent's loadClients will be called if onChange triggers it;
      // for now just close the modal and let user refresh
    } catch {
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setEditSaving(false);
    }
  }

  /* ---------- render ---------- */

  const isExistingClient = !!data.clientId;
  const currentClient = uniqueClients.find((c) => c.id === data.clientId);
  const currentAccount = currentClient?.accounts.find((a) => a.id === data.accountId)
    ?? currentClient?.accounts.find((a) => a.account_type === data.accountType);

  return (
    <>
      <Card padding={16} style={{ position: 'relative' }}>
        {/* Row header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: '#1E3A5F',
              backgroundColor: '#EEF2F7',
              padding: '3px 10px',
              borderRadius: 6,
            }}
          >
            고객 {index + 1}
          </span>
          <Button variant="ghost" size="sm" onClick={onRemove} style={{ color: '#EF4444', padding: '4px 8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            삭제
          </Button>
        </div>

        {/* 2-column layout: 왼쪽 고객정보 + 오른쪽 이미지 캡쳐 */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* 왼쪽: 고객 정보 */}
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            {/* Line 1: 고객명 + (신규고객명) + 계좌유형 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: '1 1 120px', minWidth: 110, position: 'relative' }} ref={dropdownRef}>
                <label style={labelStyle}>고객명</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {/* 커스텀 드롭다운 트리거 */}
                  <button type="button"
                    onClick={() => { setDropdownOpen(!dropdownOpen); setClientPage(0); }}
                    style={{
                      ...inputStyle, cursor: 'pointer', flex: 1, padding: '6px 8px', fontSize: '0.75rem',
                      textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      color: data.clientName ? '#1A1A2E' : '#9CA3AF',
                    }}>
                    <span>{data.clientName || '고객을 선택하세요'}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {isExistingClient && (
                    <button type="button" onClick={openEditModal} title="고객 정보 수정"
                      style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E1E5EB', borderRadius: 6, backgroundColor: '#F9FAFB', cursor: 'pointer', color: '#6B7280' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* 드롭다운 패널 */}
                {dropdownOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    marginTop: 4, backgroundColor: '#fff', border: '1px solid #E1E5EB',
                    borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
                    minWidth: 200,
                  }}>
                    {/* 검색창 */}
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #E1E5EB' }}>
                      <input type="text" placeholder="고객명 검색..."
                        value={clientSearch}
                        onChange={(e) => { setClientSearch(e.target.value); setClientPage(0); }}
                        style={{ ...inputStyle, padding: '5px 8px', fontSize: '0.75rem' }}
                        autoFocus />
                    </div>

                    {/* 선택 해제 */}
                    <button type="button"
                      onClick={() => { handleClientSelect(''); setDropdownOpen(false); }}
                      style={{
                        width: '100%', padding: '6px 10px', fontSize: '0.75rem', textAlign: 'left',
                        border: 'none', backgroundColor: !data.clientId ? '#EEF2F7' : 'transparent',
                        cursor: 'pointer', color: '#9CA3AF',
                      }}>
                      -- 선택 해제 --
                    </button>

                    {/* 고객 목록 */}
                    {pagedClients.length === 0 ? (
                      <div style={{ padding: '10px', fontSize: '0.75rem', color: '#9CA3AF', textAlign: 'center' }}>
                        검색 결과 없음
                      </div>
                    ) : (
                      pagedClients.map((c) => (
                        <button type="button" key={c.id}
                          onClick={() => handleClientSelect(c.id)}
                          style={{
                            width: '100%', padding: '6px 10px', fontSize: '0.75rem', textAlign: 'left',
                            border: 'none', cursor: 'pointer',
                            backgroundColor: data.clientId === c.id ? '#EEF2F7' : 'transparent',
                            color: '#1A1A2E', display: 'flex', justifyContent: 'space-between',
                          }}
                          onMouseEnter={(e) => { if (data.clientId !== c.id) (e.currentTarget).style.backgroundColor = '#F9FAFB'; }}
                          onMouseLeave={(e) => { if (data.clientId !== c.id) (e.currentTarget).style.backgroundColor = 'transparent'; }}>
                          <span>{c.unique_code ? `${c.name}(${c.unique_code})` : c.name}</span>
                          <span style={{ color: '#9CA3AF', fontSize: '0.6875rem' }}>
                            {c.accounts.length}개 계좌
                          </span>
                        </button>
                      ))
                    )}

                    {/* 페이지네이션 */}
                    {totalPages > 1 && (
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 8px', borderTop: '1px solid #E1E5EB', fontSize: '0.6875rem', color: '#6B7280',
                      }}>
                        <button type="button" disabled={clientPage === 0}
                          onClick={() => setClientPage((p) => p - 1)}
                          style={{ border: 'none', background: 'none', cursor: clientPage === 0 ? 'default' : 'pointer', color: clientPage === 0 ? '#D1D5DB' : '#1E3A5F', fontWeight: 600, fontSize: '0.6875rem' }}>
                          이전
                        </button>
                        <span>{clientPage + 1} / {totalPages}</span>
                        <button type="button" disabled={clientPage >= totalPages - 1}
                          onClick={() => setClientPage((p) => p + 1)}
                          style={{ border: 'none', background: 'none', cursor: clientPage >= totalPages - 1 ? 'default' : 'pointer', color: clientPage >= totalPages - 1 ? '#D1D5DB' : '#1E3A5F', fontWeight: 600, fontSize: '0.6875rem' }}>
                          다음
                        </button>
                      </div>
                    )}

                    {/* 총 인원 */}
                    <div style={{ padding: '3px 10px', borderTop: '1px solid #F3F4F6', fontSize: '0.625rem', color: '#9CA3AF', textAlign: 'right' }}>
                      총 {filteredClients.length}명
                    </div>
                  </div>
                )}
              </div>
              <div style={{ flex: '0 1 130px', minWidth: 100 }}>
                <label style={labelStyle}>계좌 유형</label>
                <select value={data.accountType}
                  onChange={(e) => handleAccountTypeChange(e.target.value as string)}
                  style={{ ...inputStyle, cursor: 'pointer', padding: '6px 8px', fontSize: '0.75rem' }}>
                  {isExistingClient && currentClient ? (
                    <>
                      <option value="">계좌를 선택하세요</option>
                      {currentClient.accounts.map((a) => (
                        <option key={a.id} value={a.account_type}>
                          {ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="">고객을 먼저 선택</option>
                  )}
                </select>
              </div>
            </div>

            {/* Line 2: 증권사명 + 계좌번호 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: '0 1 120px', minWidth: 100 }}>
                <label style={labelStyle}>증권사명</label>
                {isExistingClient && currentAccount ? (
                  <div style={{ padding: '6px 8px', fontSize: '0.75rem', color: '#374151', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB' }}>
                    {currentAccount.securities_company || '-'}
                  </div>
                ) : (
                  <input type="text" placeholder="예: NH투자증권"
                    value={data.securitiesCompany} onChange={(e) => update({ securitiesCompany: e.target.value })}
                    style={{ ...inputStyle, padding: '6px 8px', fontSize: '0.75rem' }} />
                )}
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>계좌번호</label>
                {isExistingClient && currentAccount ? (
                  <div style={{ padding: '6px 8px', fontSize: '0.75rem', color: '#374151', border: '1px solid #E1E5EB', borderRadius: 8, backgroundColor: '#F9FAFB' }}>
                    {currentAccount.account_number || '미등록'}
                  </div>
                ) : (
                  <input type="text" placeholder="예: 123-456-789"
                    value={data.accountNumber} onChange={(e) => update({ accountNumber: e.target.value })}
                    style={{ ...inputStyle, padding: '6px 8px', fontSize: '0.75rem' }} />
                )}
              </div>
            </div>

            {/* 계좌유형 선택으로 자동 매칭됨 */}
          </div>

          {/* 오른쪽: 이미지 캡쳐 영역 */}
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <label style={labelStyle}>증권사 화면 캡처</label>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

            {data.imagePreview ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.imagePreview} alt="업로드된 이미지"
                  style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 8, border: '1px solid #E1E5EB', objectFit: 'contain', display: 'block' }} />
                <button onClick={removeImage} title="이미지 제거"
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#EF4444', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>
                  ×
                </button>
              </div>
            ) : (
              <div ref={pasteZoneRef} tabIndex={0} onPaste={handlePaste}
                onClick={() => pasteZoneRef.current?.focus()}
                style={{ border: '2px dashed #CBD5E1', borderRadius: 8, padding: '16px 12px', textAlign: 'center', cursor: 'default', backgroundColor: '#FAFBFC', transition: 'border-color 0.15s, background-color 0.15s', userSelect: 'none' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1E3A5F'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#EEF2F7'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; (e.currentTarget as HTMLDivElement).style.backgroundColor = '#FAFBFC'; }}
                onFocus={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#1E3A5F'; }}
                onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1'; }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" style={{ margin: '0 auto 6px', display: 'block' }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                </svg>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#6B7280', fontWeight: 500 }}>Ctrl+V로 이미지 붙여넣기</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.6875rem', color: '#9CA3AF' }}>PNG, JPG, GIF 지원</p>
                <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  style={{ marginTop: 8, padding: '4px 12px', fontSize: '0.6875rem', fontWeight: 600, color: '#1E3A5F', backgroundColor: '#EEF2F7', border: '1px solid #CBD5E1', borderRadius: 6, cursor: 'pointer' }}>
                  파일 선택
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Edit Client Modal                                                    */}
      {/* ------------------------------------------------------------------ */}
      {editModalOpen && editClientData && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.45)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditModalOpen(false); }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 14,
              padding: 28,
              width: '100%',
              maxWidth: 480,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1A1A2E' }}>
                고객 정보 수정
              </h3>
              <button
                onClick={() => setEditModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* 고객명 */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>고객명</label>
              <input
                type="text"
                value={editClientData.name}
                onChange={(e) => setEditClientData((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                style={inputStyle}
              />
            </div>

            {/* 계좌 목록 */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ ...labelStyle, marginBottom: 10 }}>계좌 정보</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {editClientData.accounts.map((acc, i) => (
                  <div
                    key={acc.id}
                    style={{
                      padding: 14,
                      border: '1px solid #E1E5EB',
                      borderRadius: 10,
                      backgroundColor: '#F9FAFB',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1E3A5F', marginBottom: 10 }}>
                      {ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ ...labelStyle, marginBottom: 3 }}>계좌번호</label>
                        <input
                          type="text"
                          placeholder="계좌번호"
                          value={acc.account_number}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditClientData((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                accounts: prev.accounts.map((a, idx) =>
                                  idx === i ? { ...a, account_number: val } : a
                                ),
                              };
                            });
                          }}
                          style={inputStyle}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ ...labelStyle, marginBottom: 3 }}>증권사명</label>
                        <input
                          type="text"
                          placeholder="예: 삼성증권"
                          value={acc.securities_company}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditClientData((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                accounts: prev.accounts.map((a, idx) =>
                                  idx === i ? { ...a, securities_company: val } : a
                                ),
                              };
                            });
                          }}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setEditModalOpen(false)}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#374151',
                  backgroundColor: '#F3F4F6',
                  border: '1px solid #E1E5EB',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                style={{
                  padding: '9px 20px',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  color: '#fff',
                  backgroundColor: editSaving ? '#9CA3AF' : '#1E3A5F',
                  border: 'none',
                  borderRadius: 8,
                  cursor: editSaving ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                {editSaving ? (
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {editSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ClientRow;
