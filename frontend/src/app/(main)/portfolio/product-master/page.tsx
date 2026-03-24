'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Modal } from '@/components/common/Modal';
import { ProductMasterTable, type ProductMaster, RISK_LEVELS, REGIONS, PRODUCT_TYPES } from '@/components/portfolio/ProductMasterTable';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

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
  const router = useRouter();
  const [items, setItems] = useState<ProductMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  /* Filters */
  const [filterRisk, setFilterRisk] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterType, setFilterType] = useState('');
  const hasFilter = !!(filterRisk || filterRegion || filterType);

  function resetFilters() {
    setFilterRisk('');
    setFilterRegion('');
    setFilterType('');
  }

  const filteredItems = items.filter((item) => {
    if (filterRisk && item.risk_level !== filterRisk) return false;
    if (filterRegion && item.region !== filterRegion) return false;
    if (filterType && item.product_type !== filterType) return false;
    return true;
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* Stock search autocomplete */
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState<Array<{ code: string; name: string; nav: number; price: number; type: string }>>([]);
  const [stockSearching, setStockSearching] = useState(false);
  const stockSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /* Stock search handler */
  function handleStockSearch(query: string) {
    setStockQuery(query);
    setForm((s) => ({ ...s, product_name: query }));
    if (stockSearchTimer.current) clearTimeout(stockSearchTimer.current);
    if (!query.trim() || query.trim().length < 2) {
      setStockResults([]);
      return;
    }
    stockSearchTimer.current = setTimeout(async () => {
      setStockSearching(true);
      try {
        const res = await fetch(`${API_URL}/api/v1/stock-search?q=${encodeURIComponent(query)}&limit=10`, {
          headers: authLib.getAuthHeader(),
        });
        if (res.ok) {
          const data = await res.json();
          setStockResults(data.results ?? []);
        }
      } catch { /* silent */ }
      finally { setStockSearching(false); }
    }, 400);
  }

  function handleStockSelect(item: { code: string; name: string; type: string }) {
    setForm((s) => ({
      ...s,
      product_name: item.name,
      product_code: item.code,
      product_type: item.type,
    }));
    setStockQuery(item.name);
    setStockResults([]);
  }

  function openModal() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setStockQuery('');
    setStockResults([]);
    setModalOpen(true);
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ padding: '24px 24px 40px', minHeight: '100vh', backgroundColor: '#F5F7FA' }}>
      {/* Back to Dashboard */}
      <button
        onClick={() => router.push('/dashboard')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          marginBottom: 12,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#6B7280',
          fontSize: '0.8125rem',
          padding: 0,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#1A1A2E')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#6B7280')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        대시보드로 돌아가기
      </button>

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
      </div>

      {/* Search bar + filters + 신규등록 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
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

        {/* Filters */}
        <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)}
          style={{ padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: filterRisk ? '#1A1A2E' : '#9CA3AF', cursor: 'pointer', backgroundColor: filterRisk ? '#EFF6FF' : '#fff' }}>
          <option value="">위험도</option>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}
          style={{ padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: filterRegion ? '#1A1A2E' : '#9CA3AF', cursor: 'pointer', backgroundColor: filterRegion ? '#EFF6FF' : '#fff' }}>
          <option value="">지역</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: '7px 10px', fontSize: '0.8125rem', border: '1px solid #E1E5EB', borderRadius: 8, outline: 'none', color: filterType ? '#1A1A2E' : '#9CA3AF', cursor: 'pointer', backgroundColor: filterType ? '#EFF6FF' : '#fff' }}>
          <option value="">상품유형</option>
          {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {hasFilter && (
          <button onClick={resetFilters}
            style={{ padding: '7px 14px', fontSize: '0.8125rem', fontWeight: 600, color: '#EF4444', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, cursor: 'pointer' }}>
            필터해제
          </button>
        )}

        {/* Count badge */}
        {!loading && (
          <span style={{ fontSize: '0.8125rem', color: '#6B7280', backgroundColor: '#EEF2F7', padding: '4px 10px', borderRadius: 6, fontWeight: 500 }}>
            {hasFilter ? `${filteredItems.length}/${items.length}개` : `총 ${items.length}개`}
          </span>
        )}

        {/* 신규 등록 (오른쪽 끝) */}
        <Button variant="primary" size="sm" onClick={openModal} style={{ marginLeft: 'auto' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          신규 등록
        </Button>
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
            items={filteredItems}
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
          {/* 상품명 (with stock search autocomplete) */}
          <div style={{ position: 'relative' }}>
            <label style={labelStyle}>
              상품명 <span style={{ color: '#EF4444' }}>*</span>
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8, color: '#9CA3AF' }}>
                2글자 이상 입력 시 ETF 자동 검색 |{' '}
                <a
                  href="https://www.nhsec.com/index.jsp"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="NH투자증권 > 금융상품 > 펀드 > 펀드검색"
                  style={{ color: '#2563EB', textDecoration: 'underline', fontWeight: 500 }}
                >
                  펀드 검색(NH투자증권)
                </a>
              </span>
            </label>
            <input
              type="text"
              placeholder="상품명을 입력하세요 (예: KODEX, TIGER, 미국배당...)"
              value={stockQuery || form.product_name}
              onChange={(e) => handleStockSearch(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            {stockSearching && (
              <div style={{ position: 'absolute', right: 10, top: 28, color: '#9CA3AF', fontSize: '0.75rem' }}>검색 중...</div>
            )}
            {stockResults.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  backgroundColor: '#fff',
                  border: '1px solid #E1E5EB',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  maxHeight: 260,
                  overflowY: 'auto',
                  marginTop: 4,
                }}
              >
                {stockResults.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => handleStockSelect(item)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderBottom: '1px solid #F3F4F6',
                      fontSize: '0.8125rem',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F5F7FA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#1A1A2E' }}>{item.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                        <span style={{ fontFamily: 'monospace' }}>{item.code}</span>
                        <span style={{ margin: '0 6px', color: '#D1D5DB' }}>|</span>
                        <span>{item.type}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1E3A5F', fontSize: '0.8125rem' }}>
                        {item.price?.toLocaleString('ko-KR')}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: '#9CA3AF' }}>
                        NAV {item.nav?.toLocaleString('ko-KR')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
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
              <select
                value={form.product_type}
                onChange={(e) => setForm((s) => ({ ...s, product_type: e.target.value }))}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">선택 안 함</option>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
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
