'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Customer {
  id: string;
  name: string;
  unique_code: string;
  birth_date: string | null;
  ssn_masked: string | null;
  phone: string | null;
  email: string | null;
}

interface FormData {
  name: string;
  birth_date: string;
  phone: string;
  email: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  birth_date: '',
  phone: '',
  email: '',
};

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function CustomerManagementPage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* search */
  const [searchQuery, setSearchQuery] = useState('');

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                            */
  /* ---------------------------------------------------------------- */

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('고객 목록을 불러오지 못했습니다.');
      const data: Customer[] = await res.json();
      setCustomers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  /* ---------------------------------------------------------------- */
  /*  Filtered list                                                    */
  /* ---------------------------------------------------------------- */

  const filtered = customers.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.unique_code.toLowerCase().includes(q)
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Modal helpers                                                    */
  /* ---------------------------------------------------------------- */

  function openAddModal() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(c: Customer) {
    setEditTarget(c);
    setForm({
      name: c.name,
      birth_date: c.birth_date ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  /* ---------------------------------------------------------------- */
  /*  Submit                                                           */
  /* ---------------------------------------------------------------- */

  async function handleSubmit() {
    if (!form.name.trim()) {
      setFormError('고객명은 필수입니다.');
      return;
    }
    if (!form.birth_date) {
      setFormError('생년월일은 필수입니다.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const token = authLib.getToken();
      const body: Record<string, string | null> = {
        name: form.name.trim(),
        birth_date: form.birth_date || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };

      let res: Response;
      if (editTarget) {
        res = await fetch(`${API_URL}/api/v1/clients/${editTarget.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API_URL}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? '저장에 실패했습니다.');
      }

      closeModal();
      await fetchCustomers();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Delete                                                           */
  /* ---------------------------------------------------------------- */

  async function handleDelete(c: Customer) {
    const confirmed = window.confirm(
      `${c.name}(${c.unique_code})을 삭제하시겠습니까?\n연결된 계좌 및 데이터도 함께 삭제됩니다.`
    );
    if (!confirmed) return;

    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/clients/${c.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('삭제에 실패했습니다.');
      await fetchCustomers();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '오류가 발생했습니다.');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* 대시보드로 돌아가기 */}
      <button
        onClick={() => router.push('/dashboard')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 0', fontSize: '0.8125rem', fontWeight: 500,
          color: '#6B7280', background: 'none', border: 'none',
          cursor: 'pointer', marginBottom: 8,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        대시보드로 돌아가기
      </button>

      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '28px',
        }}
      >
        <div>
          <div
            style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, #1E3A5F 0%, #4A90D9 100%)',
              marginBottom: '12px',
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 800,
              color: '#1A1A2E',
              letterSpacing: '-0.5px',
            }}
          >
            고객 정보 관리
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: '#6B7280' }}>
            고객 기본 정보를 등록하고 다른 프로그램과 연동합니다.
          </p>
        </div>

      </div>

      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="고객명 또는 고유번호 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              borderRadius: '8px',
              border: '1px solid #D1D5DB',
              fontSize: '0.875rem',
              color: '#111827',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={openAddModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '9px 18px',
            borderRadius: '8px',
            border: 'none',
            background: '#1E3A5F',
            color: '#fff',
            marginLeft: 'auto',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          고객 추가
        </button>

        {/* 템플릿 다운로드 */}
        <a
          href="/customer_template.xlsx"
          download="customer_template.xlsx"
          data-tooltip="업로드용 엑셀 템플릿 다운로드"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid #D1D5DB', background: '#fff',
            color: '#9CA3AF', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </a>

        {/* 엑셀 업로드 */}
        <input
          id="excel-upload-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const token = authLib.getToken();
            if (!token) return;
            const fd = new FormData();
            fd.append('file', file);
            try {
              const res = await fetch(`${API_URL}/api/v1/clients/upload-excel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
              });
              const data = await res.json();
              alert(`업로드 완료\n- 등록: ${data.created ?? 0}명\n- 중복 스킵: ${data.skipped ?? 0}명${data.skipped_names?.length ? `\n  ${data.skipped_names.join('\n  ')}` : ''}${data.errors?.length ? `\n- 오류:\n  ${data.errors.join('\n  ')}` : ''}`);
              fetchCustomers();
            } catch {
              alert('엑셀 업로드 중 오류가 발생했습니다.');
            }
            e.target.value = '';
          }}
        />
        <button
          data-tooltip="엑셀 파일로 고객 대량 등록"
          onClick={() => document.getElementById('excel-upload-input')?.click()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid #059669', background: '#fff',
            color: '#059669', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>

        {/* 엑셀 다운로드 */}
        <button
          data-tooltip="고객 목록을 엑셀 파일로 다운로드"
          onClick={() => {
            const token = authLib.getToken();
            if (!token) return;
            const url = `${API_URL}/api/v1/clients/download-excel?token=${encodeURIComponent(token)}`;
            window.open(url, '_blank');
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid #6B7280', background: '#fff',
            color: '#6B7280', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      {/* ── Table card ── */}
      <div
        style={{
          border: '1px solid #E1E5EB',
          borderRadius: '12px',
          backgroundColor: '#fff',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#6B7280', fontSize: '14px' }}>
            불러오는 중...
          </div>
        ) : error ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#DC2626', fontSize: '14px' }}>
            {error}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E1E5EB' }}>
                  {['No.', '고객명', '고유번호', '생년월일', '전화번호', '이메일', '관리'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '12px 14px',
                        textAlign: h === '관리' ? 'center' : 'left',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                        color: '#374151',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: '48px 20px',
                        textAlign: 'center',
                        color: '#9CA3AF',
                        fontSize: '14px',
                      }}
                    >
                      {searchQuery ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다. 고객을 추가해보세요.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c, idx) => (
                    <tr
                      key={c.id}
                      style={{
                        borderBottom: '1px solid #F3F4F6',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F9FAFB')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px 14px', color: '#9CA3AF', fontSize: '0.8125rem' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: '#111827' }}>
                        {c.name}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#374151', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {c.unique_code}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#374151' }}>
                        {c.birth_date ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#374151' }}>
                        {c.phone ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#374151' }}>
                        {c.email ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => openEditModal(c)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '7px',
                              border: '1px solid #D1D5DB',
                              background: '#fff',
                              color: '#374151',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(c)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '7px',
                              border: '1px solid #FECACA',
                              background: '#FFF5F5',
                              color: '#DC2626',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Footer count ── */}
      {!loading && !error && (
        <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: '#9CA3AF', textAlign: 'right' }}>
          총 {filtered.length}명
          {searchQuery && customers.length !== filtered.length && ` (전체 ${customers.length}명 중)`}
        </p>
      )}

      {/* ================================================================ */}
      {/* Modal                                                              */}
      {/* ================================================================ */}

      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '14px',
              padding: '28px',
              width: '100%',
              maxWidth: '480px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                {editTarget ? '고객 정보 수정' : '고객 추가'}
              </h2>
              <button
                onClick={closeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9CA3AF',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Unique code (edit mode) */}
            {editTarget && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>고유번호</label>
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #E5E7EB',
                    background: '#F8FAFC',
                    fontSize: '0.875rem',
                    color: '#6B7280',
                    fontFamily: 'monospace',
                  }}
                >
                  {editTarget.unique_code}
                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#9CA3AF' }}>(서버 자동 생성, 변경 불가)</span>
                </div>
              </div>
            )}

            {/* 고객명 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>
                고객명 <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 생년월일 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>
                생년월일 <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 전화번호 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>전화번호</label>
              <input
                type="text"
                placeholder="010-0000-0000"
                value={form.phone}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9]/g, '');
                  if (val.length > 11) val = val.slice(0, 11);
                  if (val.length <= 3) {
                    setForm((f) => ({ ...f, phone: val }));
                  } else if (val.length <= 7) {
                    setForm((f) => ({ ...f, phone: `${val.slice(0, 3)}-${val.slice(3)}` }));
                  } else {
                    setForm((f) => ({ ...f, phone: `${val.slice(0, 3)}-${val.slice(3, 7)}-${val.slice(7)}` }));
                  }
                }}
                style={inputStyle}
              />
            </div>

            {/* 이메일 */}
            <div style={{ marginBottom: '8px' }}>
              <label style={labelStyle}>이메일</label>
              <input
                type="email"
                placeholder="example@email.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 안내 메모 */}
            <p style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '8px', marginBottom: '16px' }}>
              ※ &apos;증권사 투자 상품 관리기&apos; 이용 시 전화번호와 이메일이 반드시 필요합니다.
            </p>

            {/* Form error */}
            {formError && (
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
                {formError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={closeModal}
                disabled={submitting}
                style={{
                  padding: '9px 20px',
                  borderRadius: '8px',
                  border: '1px solid #D1D5DB',
                  background: '#fff',
                  color: '#374151',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '9px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#1E3A5F',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  minWidth: '80px',
                }}
              >
                {submitting ? '저장 중...' : editTarget ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared style objects                                               */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
};

const inputStyle: React.CSSProperties = {
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
