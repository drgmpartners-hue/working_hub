'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { ProductMasterTable, type ProductMaster, RISK_LEVELS, REGIONS } from '@/components/portfolio/ProductMasterTable';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '0.875rem',
  border: '1px solid #E1E5EB',
  borderRadius: 8,
  outline: 'none',
  color: '#1A1A2E',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

/* ------------------------------------------------------------------ */
/*  Add Modal Form State                                                */
/* ------------------------------------------------------------------ */

interface AddFormState {
  product_name: string;
  risk_level: string;
  region: string;
  product_type: string;
  product_code: string;
}

const EMPTY_FORM: AddFormState = {
  product_name: '',
  risk_level: '',
  region: '',
  product_type: '',
  product_code: '',
};

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function ProductMasterPage() {
  const [items, setItems] = useState<ProductMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Debounce search                                                   */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  /* ---------------------------------------------------------------- */
  /*  Fetch list                                                        */
  /* ---------------------------------------------------------------- */

  const fetchItems = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`${API_URL}/api/v1/product-master${params}`, {
        headers: authLib.getAuthHeader(),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems(debouncedQuery || undefined);
  }, [debouncedQuery, fetchItems]);

  /* ---------------------------------------------------------------- */
  /*  Update                                                            */
  /* ---------------------------------------------------------------- */

  async function handleUpdate(id: string, data: Partial<ProductMaster>) {
    const res = await fetch(`${API_URL}/api/v1/product-master/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `수정 실패 (${res.status})`);
    }
    const updated: ProductMaster = await res.json();
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
  }

  /* ---------------------------------------------------------------- */
  /*  Delete                                                            */
  /* ---------------------------------------------------------------- */

  async function handleDelete(id: string) {
    const res = await fetch(`${API_URL}/api/v1/product-master/${id}`, {
      method: 'DELETE',
      headers: authLib.getAuthHeader(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `삭제 실패 (${res.status})`);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  /* ---------------------------------------------------------------- */
  /*  Add (modal submit)                                                */
  /* ---------------------------------------------------------------- */

  async function handleAdd() {
    setFormError(null);
    if (!form.product_name.trim()) {
      setFormError('상품명은 필수 항목입니다.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = { product_name: form.product_name.trim() };
      if (form.risk_level) body.risk_level = form.risk_level;
      if (form.region) body.region = form.region;
      if (form.product_type) body.product_type = form.product_type;
      if (form.product_code) body.product_code = form.product_code;

      const res = await fetch(`${API_URL}/api/v1/product-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authLib.getAuthHeader() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = Array.isArray(err.detail)
          ? err.detail.map((e: { msg: string }) => e.msg).join(', ')
          : (err.detail ?? `등록 실패 (${res.status})`);
        throw new Error(detail);
      }
      const created: ProductMaster = await res.json();
      setItems((prev) => [created, ...prev]);
      setModalOpen(false);
      setForm(EMPTY_FORM);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  function openModal() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ padding: '24px 24px 40px', minHeight: '100vh', backgroundColor: '#F5F7FA' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#1E3A5F',
              letterSpacing: '-0.02em',
            }}
          >
            상품 마스터 관리
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
            상품명과 위험도 · 지역을 매핑하는 마스터 데이터를 관리합니다.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openModal}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          신규 등록
        </Button>
      </div>

      {/* Search bar + summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="상품명 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              ...inputStyle,
              paddingLeft: 34,
              border: '1px solid #E1E5EB',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 18,
                height: 18,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: '#9CA3AF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Count badge */}
        {!loading && (
          <span
            style={{
              fontSize: '0.8125rem',
              color: '#6B7280',
              backgroundColor: '#EEF2F7',
              padding: '4px 10px',
              borderRadius: 6,
              fontWeight: 500,
            }}
          >
            총 {items.length}개
          </span>
        )}
      </div>

      {/* Table Card */}
      <Card padding={0}>
        {loading ? (
          <div
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              color: '#9CA3AF',
              fontSize: '0.9375rem',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                border: '3px solid #E1E5EB',
                borderTopColor: '#1E3A5F',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
                margin: '0 auto 12px',
              }}
            />
            <p style={{ margin: 0 }}>불러오는 중...</p>
          </div>
        ) : error ? (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: '#EF4444',
              fontSize: '0.9375rem',
            }}
          >
            <p style={{ margin: 0, fontWeight: 500 }}>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchItems(debouncedQuery || undefined)}
              style={{ marginTop: 12 }}
            >
              다시 시도
            </Button>
          </div>
        ) : (
          <ProductMasterTable
            items={items}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setForm(EMPTY_FORM); setFormError(null); }}
        title="신규 상품 등록"
        maxWidth={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 상품명 */}
          <div>
            <label style={labelStyle}>
              상품명 <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="상품명을 입력하세요"
              value={form.product_name}
              onChange={(e) => setForm((s) => ({ ...s, product_name: e.target.value }))}
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* 위험도 */}
          <div>
            <label style={labelStyle}>위험도</label>
            <select
              value={form.risk_level}
              onChange={(e) => setForm((s) => ({ ...s, risk_level: e.target.value }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">선택 안 함</option>
              {RISK_LEVELS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* 지역 */}
          <div>
            <label style={labelStyle}>지역</label>
            <select
              value={form.region}
              onChange={(e) => setForm((s) => ({ ...s, region: e.target.value }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">선택 안 함</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* 2-col: 상품유형 + 종목코드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>상품유형</label>
              <input
                type="text"
                placeholder="ETF, 펀드, MMF..."
                value={form.product_type}
                onChange={(e) => setForm((s) => ({ ...s, product_type: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>종목코드</label>
              <input
                type="text"
                placeholder="예: 069500"
                value={form.product_code}
                onChange={(e) => setForm((s) => ({ ...s, product_code: e.target.value }))}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Form Error */}
          {formError && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 8,
                fontSize: '0.8125rem',
                color: '#DC2626',
              }}
            >
              {formError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => { setModalOpen(false); setForm(EMPTY_FORM); setFormError(null); }}
              disabled={submitting}
            >
              취소
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={submitting}
              onClick={handleAdd}
            >
              등록
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
