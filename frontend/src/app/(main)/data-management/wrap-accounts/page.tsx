'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Table, type TableColumn } from '@/components/common/Table';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Input } from '@/components/common/Input';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface WrapAccountResponse {
  id: number;
  product_name: string;
  securities_company: string;
  investment_target: string | null;
  target_return_rate: number | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AccountFormState {
  product_name: string;
  securities_company: string;
  investment_target: string;
  target_return_rate: string;
  description: string;
}

const EMPTY_FORM: AccountFormState = {
  product_name: '',
  securities_company: '',
  investment_target: '',
  target_return_rate: '',
  description: '',
};

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#6B7280',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  marginBottom: 8,
};

/* ------------------------------------------------------------------ */
/*  Status Badge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        backgroundColor: active ? '#ECFDF5' : '#F3F4F6',
        color: active ? '#059669' : '#6B7280',
        border: `1px solid ${active ? '#A7F3D0' : '#E5E7EB'}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: active ? '#10B981' : '#9CA3AF',
          flexShrink: 0,
        }}
      />
      {active ? '활성' : '비활성'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Confirm Deactivate Dialog                                           */
/* ------------------------------------------------------------------ */

interface ConfirmDialogProps {
  open: boolean;
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

function ConfirmDeactivateDialog({ open, itemName, onConfirm, onCancel, loading }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title="비활성화 확인" maxWidth={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151', lineHeight: 1.6 }}>
          <strong style={{ color: '#1A1A2E' }}>{itemName}</strong> 상품을 비활성화하시겠습니까?
          <br />
          <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>비활성화된 상품은 목록에서 숨겨질 수 있습니다.</span>
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
            취소
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={loading}>
            비활성화
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Account Form (used in both Add and Edit modals)                    */
/* ------------------------------------------------------------------ */

interface AccountFormProps {
  form: AccountFormState;
  onChange: (field: keyof AccountFormState, value: string) => void;
  errors: Partial<Record<keyof AccountFormState, string>>;
}

function AccountForm({ form, onChange, errors }: AccountFormProps) {
  return (
    <div style={fieldGroupStyle}>
      <Input
        label="상품명 *"
        value={form.product_name}
        onChange={(e) => onChange('product_name', e.target.value)}
        error={errors.product_name}
        placeholder="예: 삼성 글로벌 성장 랩"
      />
      <Input
        label="증권사 *"
        value={form.securities_company}
        onChange={(e) => onChange('securities_company', e.target.value)}
        error={errors.securities_company}
        placeholder="예: 삼성증권"
      />
      <Input
        label="투자대상"
        value={form.investment_target}
        onChange={(e) => onChange('investment_target', e.target.value)}
        placeholder="예: 국내 주식, 글로벌 ETF"
      />
      <Input
        label="목표수익률 (%)"
        type="number"
        value={form.target_return_rate}
        onChange={(e) => onChange('target_return_rate', e.target.value)}
        placeholder="예: 8.5"
        style={{ WebkitAppearance: 'none' } as React.CSSProperties}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={labelStyle}>설명</label>
        <textarea
          value={form.description}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder="상품 설명을 입력하세요"
          rows={3}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '0.875rem',
            border: '1px solid #E1E5EB',
            borderRadius: 8,
            outline: 'none',
            color: '#1A1A2E',
            backgroundColor: '#FFFFFF',
            resize: 'vertical',
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            lineHeight: 1.5,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function WrapAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<WrapAccountResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Filter */
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  /* Add Modal */
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AccountFormState>(EMPTY_FORM);
  const [addErrors, setAddErrors] = useState<Partial<Record<keyof AccountFormState, string>>>({});
  const [addLoading, setAddLoading] = useState(false);

  /* Edit Modal */
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WrapAccountResponse | null>(null);
  const [editForm, setEditForm] = useState<AccountFormState>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<Partial<Record<keyof AccountFormState, string>>>({});
  const [editLoading, setEditLoading] = useState(false);

  /* Deactivate Confirm */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<WrapAccountResponse | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  /* ---- Fetch ---- */
  const fetchAccounts = useCallback(async () => {
    const token = authLib.getToken();
    if (!token) {
      router.push('/login');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API 오류: ${res.status}`);
      const data: WrapAccountResponse[] = await res.json();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  /* ---- Filtered data ---- */
  const filteredAccounts = accounts.filter((a) => {
    if (filterStatus === 'active') return a.is_active;
    if (filterStatus === 'inactive') return !a.is_active;
    return true;
  });

  /* ---- Validate ---- */
  function validateForm(form: AccountFormState): Partial<Record<keyof AccountFormState, string>> {
    const errs: Partial<Record<keyof AccountFormState, string>> = {};
    if (!form.product_name.trim()) errs.product_name = '상품명은 필수입니다.';
    if (!form.securities_company.trim()) errs.securities_company = '증권사는 필수입니다.';
    if (form.target_return_rate && isNaN(Number(form.target_return_rate))) {
      errs.target_return_rate = '숫자를 입력해주세요.';
    }
    return errs;
  }

  /* ---- Add ---- */
  function openAdd() {
    setAddForm(EMPTY_FORM);
    setAddErrors({});
    setAddOpen(true);
  }

  async function handleAdd() {
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) {
      setAddErrors(errs);
      return;
    }

    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }

    setAddLoading(true);
    try {
      const body: Record<string, unknown> = {
        product_name: addForm.product_name.trim(),
        securities_company: addForm.securities_company.trim(),
      };
      if (addForm.investment_target.trim()) body.investment_target = addForm.investment_target.trim();
      if (addForm.target_return_rate) body.target_return_rate = Number(addForm.target_return_rate);
      if (addForm.description.trim()) body.description = addForm.description.trim();

      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`등록 실패: ${res.status}`);
      setAddOpen(false);
      await fetchAccounts();
    } catch (err) {
      setAddErrors({ product_name: err instanceof Error ? err.message : '등록 중 오류가 발생했습니다.' });
    } finally {
      setAddLoading(false);
    }
  }

  /* ---- Edit ---- */
  function openEdit(account: WrapAccountResponse) {
    setEditTarget(account);
    setEditForm({
      product_name: account.product_name,
      securities_company: account.securities_company,
      investment_target: account.investment_target ?? '',
      target_return_rate: account.target_return_rate != null ? String(account.target_return_rate) : '',
      description: account.description ?? '',
    });
    setEditErrors({});
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editTarget) return;
    const errs = validateForm(editForm);
    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      return;
    }

    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }

    setEditLoading(true);
    try {
      const body: Record<string, unknown> = {
        product_name: editForm.product_name.trim(),
        securities_company: editForm.securities_company.trim(),
        investment_target: editForm.investment_target.trim() || null,
        target_return_rate: editForm.target_return_rate ? Number(editForm.target_return_rate) : null,
        description: editForm.description.trim() || null,
      };

      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/${editTarget.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`수정 실패: ${res.status}`);
      setEditOpen(false);
      await fetchAccounts();
    } catch (err) {
      setEditErrors({ product_name: err instanceof Error ? err.message : '수정 중 오류가 발생했습니다.' });
    } finally {
      setEditLoading(false);
    }
  }

  /* ---- Deactivate ---- */
  function openConfirm(account: WrapAccountResponse) {
    setConfirmTarget(account);
    setConfirmOpen(true);
  }

  async function handleDeactivate() {
    if (!confirmTarget) return;
    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }

    setConfirmLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/${confirmTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`비활성화 실패: ${res.status}`);
      setConfirmOpen(false);
      await fetchAccounts();
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmLoading(false);
    }
  }

  /* ---- Table columns ---- */
  const columns: TableColumn<WrapAccountResponse>[] = [
    {
      key: 'index',
      header: '#',
      align: 'center',
      width: 48,
      render: (_v, _r, i) => (
        <span style={{ color: '#6B7280', fontSize: '0.8125rem' }}>{i + 1}</span>
      ),
    },
    {
      key: 'product_name',
      header: '상품명',
      render: (v) => (
        <span style={{ fontWeight: 500, color: '#1A1A2E' }}>{v as string}</span>
      ),
    },
    {
      key: 'securities_company',
      header: '증권사',
      render: (v) => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: '0.8125rem',
            backgroundColor: '#EFF6FF',
            color: '#1D4ED8',
            fontWeight: 500,
          }}
        >
          {v as string}
        </span>
      ),
    },
    {
      key: 'investment_target',
      header: '투자대상',
      render: (v) => (
        <span style={{ color: v ? '#374151' : '#9CA3AF', fontSize: '0.875rem' }}>
          {(v as string | null) ?? '-'}
        </span>
      ),
    },
    {
      key: 'target_return_rate',
      header: '목표수익률',
      align: 'right',
      numeric: true,
      render: (v) => {
        if (v == null) return <span style={{ color: '#9CA3AF' }}>-</span>;
        return (
          <span style={{ color: '#059669', fontWeight: 600 }}>
            {(v as number).toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: 'is_active',
      header: '상태',
      align: 'center',
      render: (v) => <StatusBadge active={v as boolean} />,
    },
    {
      key: 'actions',
      header: '액션',
      align: 'center',
      width: 160,
      render: (_v, row) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openEdit(row)}
            style={{ minWidth: 56 }}
          >
            수정
          </Button>
          {row.is_active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openConfirm(row)}
              style={{ minWidth: 72, color: '#EF4444', borderColor: '#FCA5A5' }}
            >
              비활성화
            </Button>
          )}
        </div>
      ),
    },
  ];

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '1.375rem',
                fontWeight: 700,
                color: '#1E3A5F',
                letterSpacing: '-0.02em',
              }}
            >
              랩어카운트 관리
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              랩어카운트 상품을 등록하고 관리합니다.
            </p>
          </div>
          <Button variant="primary" onClick={openAdd}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            상품 등록
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          padding: '12px 16px',
          backgroundColor: '#FFFFFF',
          borderRadius: 10,
          border: '1px solid #E1E5EB',
        }}
      >
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#6B7280' }}>상태 필터</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          style={{
            padding: '5px 10px',
            fontSize: '0.875rem',
            border: '1px solid #E1E5EB',
            borderRadius: 6,
            outline: 'none',
            color: '#1A1A2E',
            backgroundColor: '#FFFFFF',
            cursor: 'pointer',
          }}
        >
          <option value="all">전체</option>
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
        </select>

        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.8125rem',
            color: '#6B7280',
          }}
        >
          총 {filteredAccounts.length}개
        </span>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 8,
            color: '#DC2626',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <Table<WrapAccountResponse>
        columns={columns}
        data={filteredAccounts}
        rowKey="id"
        loading={loading}
        emptyMessage="등록된 랩어카운트 상품이 없습니다."
      />

      {/* ---- Add Modal ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="랩어카운트 상품 등록"
        maxWidth={500}
      >
        <AccountForm form={addForm} onChange={(f, v) => setAddForm((p) => ({ ...p, [f]: v }))} errors={addErrors} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addLoading}>
            취소
          </Button>
          <Button variant="primary" onClick={handleAdd} loading={addLoading}>
            저장
          </Button>
        </div>
      </Modal>

      {/* ---- Edit Modal ---- */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="랩어카운트 상품 수정"
        maxWidth={500}
      >
        <AccountForm form={editForm} onChange={(f, v) => setEditForm((p) => ({ ...p, [f]: v }))} errors={editErrors} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editLoading}>
            취소
          </Button>
          <Button variant="primary" onClick={handleEdit} loading={editLoading}>
            저장
          </Button>
        </div>
      </Modal>

      {/* ---- Confirm Deactivate ---- */}
      <ConfirmDeactivateDialog
        open={confirmOpen}
        itemName={confirmTarget?.product_name ?? ''}
        onConfirm={handleDeactivate}
        onCancel={() => setConfirmOpen(false)}
        loading={confirmLoading}
      />
    </>
  );
}
