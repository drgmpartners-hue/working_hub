'use client';

import { useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';

/* ------------------------------------------------------------------ */
/*  Types (shared with page)                                            */
/* ------------------------------------------------------------------ */

interface ClientAccount {
  id: string;
  client_id: string;
  account_type: 'irp' | 'pension1' | 'pension2';
  account_number?: string;
  securities_company?: string;
  monthly_payment?: number;
}

interface Client {
  id: string;
  name: string;
  memo?: string;
  accounts: ClientAccount[];
}

interface ClientRowData {
  clientId: string;
  clientName: string;
  accountId: string;
  accountType: 'irp' | 'pension1' | 'pension2';
  accountNumber: string;
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
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  irp: 'IRP',
  pension1: '연금저축1',
  pension2: '연금저축2',
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

  /* ---------- helpers ---------- */

  function update(patch: Partial<ClientRowData>) {
    onChange({ ...data, ...patch });
  }

  function handleClientSelect(clientId: string) {
    if (clientId === '__new__') {
      update({ clientId: '', clientName: '', accountId: '', accountNumber: '' });
      return;
    }
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    // find matching account by current accountType
    const matchingAccount = client.accounts.find(
      (a) => a.account_type === data.accountType
    );

    update({
      clientId: client.id,
      clientName: client.name,
      accountId: matchingAccount?.id ?? '',
      accountNumber: matchingAccount?.account_number ?? '',
    });
  }

  function handleAccountTypeChange(accountType: 'irp' | 'pension1' | 'pension2') {
    if (data.clientId) {
      const client = clients.find((c) => c.id === data.clientId);
      const matchingAccount = client?.accounts.find((a) => a.account_type === accountType);
      update({
        accountType,
        accountId: matchingAccount?.id ?? '',
        accountNumber: matchingAccount?.account_number ?? '',
      });
    } else {
      update({ accountType });
    }
  }

  function processImageFile(file: File) {
    const preview = URL.createObjectURL(file);
    update({ imageFile: file, imagePreview: preview });
  }

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFile(file);
            break;
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, onChange]
  );

  // window 레벨 paste 이벤트: 이미지가 없을 때 어디서 Ctrl+V 해도 동작
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (data.imagePreview) return; // 이미 이미지 있으면 무시
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.imagePreview]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  }

  function removeImage() {
    if (data.imagePreview) URL.revokeObjectURL(data.imagePreview);
    update({ imageFile: null, imagePreview: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ---------- render ---------- */

  const isExistingClient = !!data.clientId;
  const currentClient = clients.find((c) => c.id === data.clientId);

  return (
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

      {/* Row 1: 고객명 + 계좌유형 + 조회일 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 160px',
          gap: 12,
          marginBottom: 12,
        }}
      >
        {/* 고객 선택/입력 */}
        <div>
          <label style={labelStyle}>고객명</label>
          <select
            value={data.clientId || '__new__'}
            onChange={(e) => handleClientSelect(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="__new__">-- 신규 고객 --</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {/* 신규 고객 이름 직접 입력 */}
          {!isExistingClient && (
            <input
              type="text"
              placeholder="고객 이름 입력"
              value={data.clientName}
              onChange={(e) => update({ clientName: e.target.value })}
              style={{ ...inputStyle, marginTop: 6 }}
            />
          )}
          {isExistingClient && currentClient && (
            <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#6B7280' }}>
              계좌 {currentClient.accounts.length}개 보유
            </div>
          )}
        </div>

        {/* 계좌 유형 */}
        <div>
          <label style={labelStyle}>계좌 유형</label>
          <select
            value={data.accountType}
            onChange={(e) => handleAccountTypeChange(e.target.value as 'irp' | 'pension1' | 'pension2')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {/* 기존 고객 계좌 선택 */}
          {isExistingClient && currentClient && currentClient.accounts.length > 1 && (
            <select
              value={data.accountId}
              onChange={(e) => update({ accountId: e.target.value })}
              style={{ ...inputStyle, marginTop: 6, cursor: 'pointer' }}
            >
              <option value="">계좌 선택</option>
              {currentClient.accounts
                .filter((a) => a.account_type === data.accountType)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_number || '번호 미등록'} ({a.securities_company || '-'})
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* 조회일 */}
        <div>
          <label style={labelStyle}>조회일</label>
          <input
            type="date"
            value={data.snapshotDate}
            onChange={(e) => update({ snapshotDate: e.target.value })}
            style={{ ...inputStyle, cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* Row 2: 계좌번호 */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>계좌번호 (선택)</label>
        <input
          type="text"
          placeholder="계좌번호 입력 (예: 123-456-789)"
          value={data.accountNumber}
          onChange={(e) => update({ accountNumber: e.target.value })}
          style={inputStyle}
        />
      </div>

      {/* Row 3: 이미지 붙여넣기 */}
      <div>
        <label style={labelStyle}>증권사 화면 캡처</label>

        {/* hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {data.imagePreview ? (
          /* 이미지 미리보기 */
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.imagePreview}
              alt="업로드된 이미지"
              style={{
                maxWidth: '100%',
                maxHeight: 200,
                borderRadius: 8,
                border: '1px solid #E1E5EB',
                objectFit: 'contain',
                display: 'block',
              }}
            />
            <button
              onClick={removeImage}
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: '#EF4444',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                lineHeight: 1,
              }}
              title="이미지 제거"
            >
              ×
            </button>
          </div>
        ) : (
          /* 붙여넣기 영역 */
          <div
            ref={pasteZoneRef}
            tabIndex={0}
            onPaste={handlePaste}
            onClick={() => pasteZoneRef.current?.focus()}
            style={{
              border: '2px dashed #CBD5E1',
              borderRadius: 8,
              padding: '24px 16px',
              textAlign: 'center',
              cursor: 'default',
              backgroundColor: '#FAFBFC',
              transition: 'border-color 0.15s ease, background-color 0.15s ease',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#1E3A5F';
              (e.currentTarget as HTMLDivElement).style.backgroundColor = '#EEF2F7';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1';
              (e.currentTarget as HTMLDivElement).style.backgroundColor = '#FAFBFC';
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#1E3A5F';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = '#CBD5E1';
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="1.5"
              style={{ margin: '0 auto 8px', display: 'block' }}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280', fontWeight: 500 }}>
              Ctrl+V로 이미지를 붙여넣으세요
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#9CA3AF' }}>
              PNG, JPG, GIF 등 이미지 파일 지원
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              style={{
                marginTop: 10,
                padding: '5px 14px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#1E3A5F',
                backgroundColor: '#EEF2F7',
                border: '1px solid #CBD5E1',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              파일 선택
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default ClientRow;
