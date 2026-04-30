'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Modal } from '@/components/common/Modal';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Product {
  id: number;
  product_name: string;
  in_out: string | null;
  category: string | null;
  asset_class_1: string | null;
  asset_class_2: string | null;
  institution: string | null;
  period: string | null;
  risk_level: string | null;
  currency: string | null;
  total_expected_return: number | null;
  annual_expected_return: number | null;
  port_1: string | null;
  port_2: string | null;
  port_3: string | null;
  port_4: string | null;
  port_5: string | null;
  port_6: string | null;
  port_7: string | null;
  port_8: string | null;
  port_9: string | null;
  port_10: string | null;
  securities_company: string | null;
  investment_target: string | null;
  target_return_rate: number | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SelectOption {
  id: number;
  field_name: string;
  option_value: string;
  sort_order: number;
}

type ProductFormState = {
  product_name: string;
  in_out: string;
  category: string;
  asset_class_1: string;
  asset_class_2: string;
  institution: string;
  period: string;
  risk_level: string;
  currency: string;
  total_expected_return: string;
  annual_expected_return: string;
  port_1: string;
  port_2: string;
  port_3: string;
  port_4: string;
  port_5: string;
  port_6: string;
  port_7: string;
  port_8: string;
  port_9: string;
  port_10: string;
  is_active: boolean;
};

const EMPTY_FORM: ProductFormState = {
  product_name: '',
  in_out: '',
  category: '',
  asset_class_1: '',
  asset_class_2: '',
  institution: '',
  period: '',
  risk_level: '',
  currency: '',
  total_expected_return: '',
  annual_expected_return: '',
  port_1: '',
  port_2: '',
  port_3: '',
  port_4: '',
  port_5: '',
  port_6: '',
  port_7: '',
  port_8: '',
  port_9: '',
  port_10: '',
  is_active: true,
};

function productToForm(p: Product): ProductFormState {
  return {
    product_name: p.product_name ?? '',
    in_out: p.in_out ?? '',
    category: p.category ?? '',
    asset_class_1: p.asset_class_1 ?? '',
    asset_class_2: p.asset_class_2 ?? '',
    institution: p.institution ?? p.securities_company ?? '',
    period: p.period ?? '',
    risk_level: p.risk_level ?? '',
    currency: p.currency ?? '',
    total_expected_return: p.total_expected_return != null ? String(p.total_expected_return) : '',
    annual_expected_return: p.annual_expected_return != null ? String(p.annual_expected_return) : '',
    port_1: p.port_1 ?? '',
    port_2: p.port_2 ?? '',
    port_3: p.port_3 ?? '',
    port_4: p.port_4 ?? '',
    port_5: p.port_5 ?? '',
    port_6: p.port_6 ?? '',
    port_7: p.port_7 ?? '',
    port_8: p.port_8 ?? '',
    port_9: p.port_9 ?? '',
    port_10: p.port_10 ?? '',
    is_active: p.is_active,
  };
}

function formToBody(f: ProductFormState): Record<string, unknown> {
  return {
    product_name: f.product_name.trim(),
    in_out: f.in_out || null,
    category: f.category || null,
    asset_class_1: f.asset_class_1 || null,
    asset_class_2: f.asset_class_2 || null,
    institution: f.institution || null,
    period: f.period || null,
    risk_level: f.risk_level || null,
    currency: f.currency || null,
    total_expected_return: f.total_expected_return ? Number(f.total_expected_return) : null,
    annual_expected_return: f.annual_expected_return ? Number(f.annual_expected_return) : null,
    port_1: f.port_1 || null,
    port_2: f.port_2 || null,
    port_3: f.port_3 || null,
    port_4: f.port_4 || null,
    port_5: f.port_5 || null,
    port_6: f.port_6 || null,
    port_7: f.port_7 || null,
    port_8: f.port_8 || null,
    port_9: f.port_9 || null,
    port_10: f.port_10 || null,
    is_active: f.is_active,
  };
}

/* ------------------------------------------------------------------ */
/*  Fixed options                                                        */
/* ------------------------------------------------------------------ */

const PERIOD_OPTIONS = ['유동성(1년 이하)', '단기(3년 이하)', '중기(6년 이하)', '중장기(10년 이하)', '장기(10년 초과)'];
const RISK_OPTIONS = ['절대안정형', '안정형', '안정성장형', '성장형', '절대성장형'];
const CURRENCY_OPTIONS = ['₩', '$'];
const IN_OUT_OPTIONS = ['In', 'Out'];

/* Notion field mapping keys */
const NOTION_MAP_FIELDS: { k: string; l: string }[] = [
  { k: 'product_name', l: '상품명' },
  { k: 'in_out', l: 'In/Out' },
  { k: 'category', l: '카테고리' },
  { k: 'asset_class_1', l: '자산구분(1)' },
  { k: 'asset_class_2', l: '자산구분(2)' },
  { k: 'institution', l: '거래기관' },
  { k: 'period', l: '기간' },
  { k: 'risk_level', l: '투자위험' },
  { k: 'currency', l: '화폐' },
  { k: 'total_expected_return', l: '총기대수익률' },
  { k: 'annual_expected_return', l: '연기대수익률' },
  { k: 'port_1', l: '포트1' },
  { k: 'port_2', l: '포트2' },
  { k: 'port_3', l: '포트3' },
  { k: 'port_4', l: '포트4' },
  { k: 'port_5', l: '포트5' },
  { k: 'port_6', l: '포트6' },
  { k: 'port_7', l: '포트7' },
  { k: 'port_8', l: '포트8' },
  { k: 'port_9', l: '포트9' },
  { k: 'port_10', l: '포트10' },
];

const NOTION_KEY = 'notion_product_config';

/* ------------------------------------------------------------------ */
/*  Shared small components                                             */
/* ------------------------------------------------------------------ */

function Btn({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: '1px solid transparent',
    borderRadius: 6,
    fontWeight: 500,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.6 : 1,
    transition: 'background 0.15s, border-color 0.15s',
    padding: size === 'sm' ? '4px 10px' : '7px 16px',
    fontSize: size === 'sm' ? '0.75rem' : '0.875rem',
    whiteSpace: 'nowrap',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { backgroundColor: '#1E3A5F', color: '#fff', borderColor: '#1E3A5F' },
    secondary: { backgroundColor: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' },
    ghost: { backgroundColor: 'transparent', color: '#374151', borderColor: '#E1E5EB' },
    danger: { backgroundColor: '#FEF2F2', color: '#DC2626', borderColor: '#FCA5A5' },
  };
  return (
    <button
      style={{ ...base, ...variants[variant], ...style }}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? '...' : children}
    </button>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: 'blue' | 'red' | 'green' | 'gray' | 'navy' }) {
  const colors: Record<string, React.CSSProperties> = {
    blue: { backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' },
    red: { backgroundColor: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' },
    green: { backgroundColor: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' },
    gray: { backgroundColor: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' },
    navy: { backgroundColor: '#EFF6FF', color: '#1E3A5F', border: '1px solid #BFDBFE' },
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: '0.7rem',
        fontWeight: 600,
        ...colors[color],
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Select with "+ 추가" option                                         */
/* ------------------------------------------------------------------ */

interface SelectWithAddProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  onAddOption?: (v: string) => Promise<void>;
  style?: React.CSSProperties;
}

function SelectWithAdd({ value, onChange, options, placeholder, onAddOption, style }: SelectWithAddProps) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = [...options].sort((a, b) => a.localeCompare(b, 'ko'));

  useEffect(() => {
    if (adding) setTimeout(() => inputRef.current?.focus(), 50);
  }, [adding]);

  async function handleAdd() {
    const trimmed = newVal.trim();
    if (!trimmed || !onAddOption) return;
    setSaving(true);
    try {
      await onAddOption(trimmed);
      onChange(trimmed);
      setNewVal('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  function handleSelectChange(v: string) {
    if (v === '__add__') {
      setAdding(true);
      return;
    }
    onChange(v);
  }

  if (adding) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', ...style }}>
        <input
          ref={inputRef}
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
          placeholder="새 항목 입력"
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: '0.8125rem',
            border: '1px solid #3B82F6',
            borderRadius: 5,
            outline: 'none',
          }}
        />
        <button
          onClick={handleAdd}
          disabled={saving}
          style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: '#1E3A5F', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
        >
          {saving ? '...' : '추가'}
        </button>
        <button
          onClick={() => setAdding(false)}
          style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', borderRadius: 5, cursor: 'pointer' }}
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => handleSelectChange(e.target.value)}
      style={{
        width: '100%',
        padding: '5px 8px',
        fontSize: '0.8125rem',
        border: '1px solid #E1E5EB',
        borderRadius: 6,
        outline: 'none',
        color: value ? '#1A1A2E' : '#9CA3AF',
        backgroundColor: '#FFFFFF',
        cursor: 'pointer',
        ...style,
      }}
    >
      <option value="">{placeholder ?? '선택'}</option>
      {sorted.map(o => <option key={o} value={o}>{o}</option>)}
      {onAddOption && <option value="__add__">+ 추가</option>}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline select cell for editing                                      */
/* ------------------------------------------------------------------ */

function InlineSelect({
  value,
  onChange,
  options,
  onAddOption,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption?: (v: string) => Promise<void>;
}) {
  return (
    <SelectWithAdd
      value={value}
      onChange={onChange}
      options={options}
      onAddOption={onAddOption}
      style={{ minWidth: 80 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function WrapAccountsPage() {
  const router = useRouter();

  /* Products */
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Filters */
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAsset1, setFilterAsset1] = useState('');
  const [filterAsset2, setFilterAsset2] = useState('');
  const [freezeCols, setFreezeCols] = useState(true);

  /* Multi-column sorting */
  type SortDir = 'asc' | 'desc';
  const [sortKeys, setSortKeys] = useState<{ key: string; dir: SortDir }[]>([]);

  function handleSort(key: string, shiftKey: boolean) {
    setSortKeys(prev => {
      const existing = prev.findIndex(s => s.key === key);
      if (shiftKey) {
        // Multi-sort: add or toggle
        if (existing >= 0) {
          const next = [...prev];
          if (next[existing].dir === 'asc') next[existing] = { key, dir: 'desc' };
          else next.splice(existing, 1); // remove on 3rd click
          return next;
        }
        return [...prev, { key, dir: 'asc' }];
      } else {
        // Single sort
        if (existing >= 0 && prev.length === 1) {
          if (prev[0].dir === 'asc') return [{ key, dir: 'desc' }];
          return []; // remove
        }
        return [{ key, dir: 'asc' }];
      }
    });
  }

  function getSortIndicator(key: string): string {
    const s = sortKeys.find(sk => sk.key === key);
    if (!s) return '';
    const arrow = s.dir === 'asc' ? '▲' : '▼';
    return sortKeys.length > 1 ? `${arrow}${sortKeys.indexOf(s) + 1}` : arrow;
  }

  /* Select options from API */
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>([]);

  /* Row selection for bulk delete */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const visibleIds = filtered.map(p => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}건을 삭제하시겠습니까?`)) return;
    const token = authLib.getToken();
    if (!token) return;
    setBulkDeleting(true);
    let success = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/${id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) success++;
      } catch { /* ignore */ }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    alert(`${success}건 삭제 완료`);
    fetchProducts();
  }

  /* Inline editing */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ProductFormState>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  /* Add modal */
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ProductFormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  /* Delete confirm */
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* Notion */
  const [nStep, setNStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [nDbs, setNDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [nRows, setNRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [nSelectedRows, setNSelectedRows] = useState<Set<string>>(new Set());
  const [nBulkLoading, setNBulkLoading] = useState(false);
  const [nCols, setNCols] = useState<string[]>([]);
  const [nMap, setNMap] = useState<Record<string, string>>({});
  const [nLoading, setNLoading] = useState(false);
  const [nError, setNError] = useState<string | null>(null);
  const [nDbSearch, setNDbSearch] = useState('');
  const [nRowSearch, setNRowSearch] = useState('');
  const [nSelectedDbId, setNSelectedDbId] = useState('');
  const [nSelectedDbTitle, setNSelectedDbTitle] = useState('');

  /* Notion config persistence */
  function saveNotionConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
    try { localStorage.setItem(NOTION_KEY, JSON.stringify({ dbId, dbTitle, mapping })); } catch { /* ignore */ }
  }
  function loadNotionConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
    try { const r = localStorage.getItem(NOTION_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function clearNotionConfig() {
    try { localStorage.removeItem(NOTION_KEY); } catch { /* ignore */ }
  }

  /* ---- Derived option lists ---- */
  function getOpts(fieldName: string): string[] {
    return selectOptions
      .filter(o => o.field_name === fieldName)
      .sort((a, b) => a.option_value.localeCompare(b.option_value, 'ko'))
      .map(o => o.option_value);
  }

  const categoryOpts = getOpts('category');
  const asset1Opts = getOpts('asset_class_1');
  const asset2Opts = getOpts('asset_class_2');
  const institutionOpts = getOpts('institution');
  const portOpts = getOpts('port_company');

  /* ---- Fetch products ---- */
  const fetchProducts = useCallback(async () => {
    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API 오류: ${res.status}`);
      setProducts(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터 로드 오류');
    } finally {
      setLoading(false);
    }
  }, [router]);

  /* ---- Fetch select options ---- */
  const fetchOptions = useCallback(async () => {
    const token = authLib.getToken();
    if (!token) return;
    try {
      const fields = ['category', 'asset_class_1', 'asset_class_2', 'institution', 'port_company'];
      const results = await Promise.all(
        fields.map(f =>
          fetch(`${API_URL}/api/v1/retirement/wrap-accounts/options?field_name=${f}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.ok ? r.json() : [])
        )
      );
      setSelectOptions(results.flat());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchOptions();
  }, [fetchProducts, fetchOptions]);

  /* ---- Add select option ---- */
  async function addSelectOption(fieldName: string, value: string): Promise<void> {
    const token = authLib.getToken();
    if (!token) return;
    const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ field_name: fieldName, option_value: value, sort_order: 0 }),
    });
    if (!res.ok) throw new Error('옵션 추가 실패');
    const created: SelectOption = await res.json();
    setSelectOptions(prev => [...prev, created]);
  }

  /* ---- Filtered ---- */
  // 원본 인덱스 매핑 (No 유지용)
  const productsWithNo = products.map((p, i) => ({ ...p, _origNo: i + 1 }));

  const filtered = productsWithNo.filter(p => {
    if (filterStatus === 'active' && !p.is_active) return false;
    if (filterStatus === 'inactive' && p.is_active) return false;
    if (filterCategory && p.category !== filterCategory) return false;
    if (filterAsset1 && p.asset_class_1 !== filterAsset1) return false;
    if (filterAsset2 && p.asset_class_2 !== filterAsset2) return false;
    return true;
  }).sort((a, b) => {
    for (const { key, dir } of sortKeys) {
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      const aStr = av == null ? '' : String(av);
      const bStr = bv == null ? '' : String(bv);
      const aNum = Number(av);
      const bNum = Number(bv);
      let cmp = 0;
      if (!isNaN(aNum) && !isNaN(bNum) && aStr !== '' && bStr !== '') {
        cmp = aNum - bNum;
      } else {
        cmp = aStr.localeCompare(bStr, 'ko');
      }
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });

  // 필터 드롭다운용 유니크값
  const uniqueCategories = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => (a as string).localeCompare(b as string, 'ko'));
  const uniqueAsset1 = [...new Set(products.map(p => p.asset_class_1).filter(Boolean))].sort((a, b) => (a as string).localeCompare(b as string, 'ko'));
  const uniqueAsset2 = [...new Set(products.map(p => p.asset_class_2).filter(Boolean))].sort((a, b) => (a as string).localeCompare(b as string, 'ko'));

  /* ---- Inline Edit ---- */
  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditForm(productToForm(p));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (editingId == null) return;
    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }
    if (!editForm.product_name.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formToBody(editForm)),
      });
      if (!res.ok) throw new Error(`수정 실패: ${res.status}`);
      setEditingId(null);
      await fetchProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : '수정 오류');
    } finally {
      setEditSaving(false);
    }
  }

  function setEdit(field: keyof ProductFormState, value: string | boolean) {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }

  /* ---- Add ---- */
  function openAdd() {
    setAddForm(EMPTY_FORM);
    setAddError(null);
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!addForm.product_name.trim()) { setAddError('상품명은 필수입니다.'); return; }
    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }
    setAddLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formToBody(addForm)),
      });
      if (!res.ok) throw new Error(`등록 실패: ${res.status}`);
      setAddOpen(false);
      await fetchProducts();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '등록 오류');
    } finally {
      setAddLoading(false);
    }
  }

  function setAdd(field: keyof ProductFormState, value: string | boolean) {
    setAddForm(prev => ({ ...prev, [field]: value }));
  }

  /* ---- Delete ---- */
  async function handleDelete() {
    if (!deleteTarget) return;
    const token = authLib.getToken();
    if (!token) { router.push('/login'); return; }
    setDeleteLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);
      setDeleteTarget(null);
      await fetchProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 오류');
    } finally {
      setDeleteLoading(false);
    }
  }

  /* ---- Notion ---- */
  async function nFetchDbList() {
    setNLoading(true); setNError(null);
    try {
      const t = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail ?? '조회 실패'); }
      setNDbs(await res.json());
      setNStep('selectDb');
    } catch (e: unknown) { setNError(e instanceof Error ? e.message : '오류'); }
    finally { setNLoading(false); }
  }

  async function nOpenSelector() {
    const saved = loadNotionConfig();
    if (saved) {
      setNSelectedDbId(saved.dbId);
      setNSelectedDbTitle(saved.dbTitle);
      setNMap(saved.mapping);
      await nLoadRows(saved.dbId, saved.mapping);
    } else {
      await nFetchDbList();
    }
  }

  async function nLoadRows(dbId: string, savedMapping?: Record<string, string>) {
    setNLoading(true); setNError(null);
    setNSelectedDbId(dbId);
    try {
      const t = authLib.getToken();
      const [pR, rR] = await Promise.all([
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows`, { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (!pR.ok || !rR.ok) throw new Error('데이터 조회 실패');
      const props: { name: string }[] = await pR.json();
      const rows: { id: string; properties: Record<string, string> }[] = await rR.json();
      const cols = props.map(p => p.name);
      setNCols(cols);
      setNRows(rows);
      if (savedMapping) {
        setNMap(savedMapping);
      } else {
        const m: Record<string, string> = {};
        for (const f of NOTION_MAP_FIELDS) {
          const matching = cols.find(c => {
            const cl = c.toLowerCase();
            if (f.k === 'product_name') return cl.includes('상품') || cl.includes('product') || cl.includes('name');
            if (f.k === 'in_out') return cl === 'in/out' || cl === 'in_out';
            if (f.k === 'category') return cl.includes('카테고리') || cl.includes('category');
            if (f.k === 'asset_class_1') return cl.includes('자산구분') && (cl.includes('1') || cl.includes('(1)'));
            if (f.k === 'asset_class_2') return cl.includes('자산구분') && (cl.includes('2') || cl.includes('(2)'));
            if (f.k === 'institution') return cl.includes('기관') || cl.includes('증권') || cl.includes('거래');
            if (f.k === 'period') return cl.includes('기간') || cl.includes('period');
            if (f.k === 'risk_level') return cl.includes('위험') || cl.includes('risk');
            if (f.k === 'currency') return cl.includes('화폐') || cl.includes('currency');
            if (f.k === 'total_expected_return') return cl.includes('총기대') || cl.includes('total');
            if (f.k === 'annual_expected_return') return cl.includes('연기대') || cl.includes('annual');
            if (f.k.startsWith('port_')) {
              const num = f.k.replace('port_', '');
              return cl.includes(`포트${num}`) || cl.includes(`port${num}`) || cl === `포트 ${num}`;
            }
            return false;
          });
          m[f.k] = matching ?? '';
        }
        setNMap(m);
      }
      setNStep('mapping');
    } catch (e: unknown) { setNError(e instanceof Error ? e.message : '오류'); }
    finally { setNLoading(false); }
  }

  function nApply(row: { properties: Record<string, string> }) {
    const updates: Partial<ProductFormState> = {};
    for (const f of NOTION_MAP_FIELDS) {
      const col = nMap[f.k];
      if (col && row.properties[col]) {
        (updates as Record<string, string>)[f.k] = row.properties[col];
      }
    }
    setAddForm(prev => ({ ...prev, ...updates }));
    saveNotionConfig(nSelectedDbId, nSelectedDbTitle, nMap);
    setNStep('idle');
    setNRowSearch('');
  }

  function nToggleRow(id: string) {
    setNSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function nToggleAll(filtered: { id: string }[]) {
    const allIds = filtered.map(r => r.id);
    const allSelected = allIds.every(id => nSelectedRows.has(id));
    if (allSelected) {
      setNSelectedRows(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setNSelectedRows(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  function nMapRow(row: { properties: Record<string, string> }): Record<string, unknown> {
    const body: Record<string, unknown> = { product_name: '' };
    for (const f of NOTION_MAP_FIELDS) {
      const col = nMap[f.k];
      if (col && row.properties[col]) {
        const val = row.properties[col];
        if (f.k === 'total_expected_return' || f.k === 'annual_expected_return' || f.k === 'target_return_rate') {
          const num = parseFloat(val.replace(/[^0-9.\-]/g, ''));
          if (!isNaN(num)) body[f.k] = Math.round(num * 10000) / 100;
        } else {
          body[f.k] = val;
        }
      }
    }
    if (!body.product_name) body.product_name = Object.values(row.properties)[0] ?? '미지정';
    return body;
  }

  async function nBulkImport() {
    if (nSelectedRows.size === 0) return;
    const token = authLib.getToken();
    if (!token) return;
    setNBulkLoading(true);
    let success = 0;
    let fail = 0;
    const selectedItems = nRows.filter(r => nSelectedRows.has(r.id));
    for (const row of selectedItems) {
      try {
        const body = nMapRow(row);
        const res = await fetch(`${API_URL}/api/v1/retirement/wrap-accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (res.ok) success++; else fail++;
      } catch { fail++; }
    }
    setNBulkLoading(false);
    setNSelectedRows(new Set());
    alert(`${success}건 등록 완료${fail > 0 ? `, ${fail}건 실패` : ''}`);
    saveNotionConfig(nSelectedDbId, nSelectedDbTitle, nMap);
    setAddOpen(false);
    fetchProducts();
  }

  function nReset() {
    setNStep('idle'); setNDbs([]); setNRows([]); setNCols([]);
    setNError(null); setNDbSearch(''); setNRowSearch('');
    setNSelectedRows(new Set());
    clearNotionConfig();
  }

  /* ------------------------------------------------------------------ */
  /*  Render helpers                                                      */
  /* ------------------------------------------------------------------ */

  const cellStyle: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: '0.78rem',
    color: '#374151',
    borderBottom: '1px solid #E5E7EB',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
  };

  const thStyle: React.CSSProperties = {
    padding: '8px 8px',
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#E2E8F0',
    backgroundColor: '#1E3A5F',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  const inputCellStyle: React.CSSProperties = {
    width: '100%',
    padding: '3px 6px',
    fontSize: '0.78rem',
    border: '1px solid #3B82F6',
    borderRadius: 4,
    outline: 'none',
    minWidth: 0,
  };

  function renderCell(p: Product, col: string): React.ReactNode {
    const dash = <span style={{ color: '#CBD5E1' }}>-</span>;
    switch (col) {
      case 'checkbox':
        return (
          <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)}
            style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#1E3A5F' }} />
        );
      case 'in_out':
        if (!p.in_out) return dash;
        return <Badge color={p.in_out === 'In' ? 'blue' : 'red'}>{p.in_out}</Badge>;
      case 'institution':
        return p.institution ? <Badge color="navy">{p.institution}</Badge> : dash;
      case 'is_active':
        return <Badge color={p.is_active ? 'green' : 'gray'}>{p.is_active ? '활성' : '비활성'}</Badge>;
      case 'total_expected_return':
        return p.total_expected_return != null
          ? <span style={{ color: '#059669', fontWeight: 600 }}>{Number(p.total_expected_return).toFixed(1)}%</span>
          : dash;
      case 'annual_expected_return':
        return p.annual_expected_return != null
          ? <span style={{ color: '#059669', fontWeight: 600 }}>{Number(p.annual_expected_return).toFixed(1)}%</span>
          : dash;
      case 'product_name':
        return <span style={{ fontWeight: 600, color: '#1E3A5F' }}>{p.product_name}</span>;
      default: {
        const v = (p as unknown as Record<string, unknown>)[col];
        return v ? <span>{String(v)}</span> : dash;
      }
    }
  }

  function renderEditCell(col: string): React.ReactNode {
    const portNum = col.startsWith('port_') ? col.replace('port_', '') : null;
    switch (col) {
      case 'in_out':
        return (
          <select value={editForm.in_out} onChange={e => setEdit('in_out', e.target.value)} style={inputCellStyle}>
            <option value="">-</option>
            {IN_OUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'category':
        return <InlineSelect value={editForm.category} onChange={v => setEdit('category', v)} options={categoryOpts} onAddOption={v => addSelectOption('category', v)} />;
      case 'asset_class_1':
        return <InlineSelect value={editForm.asset_class_1} onChange={v => setEdit('asset_class_1', v)} options={asset1Opts} onAddOption={v => addSelectOption('asset_class_1', v)} />;
      case 'asset_class_2':
        return <InlineSelect value={editForm.asset_class_2} onChange={v => setEdit('asset_class_2', v)} options={asset2Opts} onAddOption={v => addSelectOption('asset_class_2', v)} />;
      case 'institution':
        return <InlineSelect value={editForm.institution} onChange={v => setEdit('institution', v)} options={institutionOpts} onAddOption={v => addSelectOption('institution', v)} />;
      case 'period':
        return (
          <select value={editForm.period} onChange={e => setEdit('period', e.target.value)} style={inputCellStyle}>
            <option value="">-</option>
            {PERIOD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'risk_level':
        return (
          <select value={editForm.risk_level} onChange={e => setEdit('risk_level', e.target.value)} style={inputCellStyle}>
            <option value="">-</option>
            {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'currency':
        return (
          <select value={editForm.currency} onChange={e => setEdit('currency', e.target.value)} style={inputCellStyle}>
            <option value="">-</option>
            {CURRENCY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'total_expected_return':
        return <input type="number" value={editForm.total_expected_return} onChange={e => setEdit('total_expected_return', e.target.value)} style={{ ...inputCellStyle, width: 72 }} />;
      case 'annual_expected_return':
        return <input type="number" value={editForm.annual_expected_return} onChange={e => setEdit('annual_expected_return', e.target.value)} style={{ ...inputCellStyle, width: 72 }} />;
      case 'product_name':
        return <input value={editForm.product_name} onChange={e => setEdit('product_name', e.target.value)} style={{ ...inputCellStyle, minWidth: 160 }} />;
      case 'is_active':
        return (
          <select value={editForm.is_active ? '1' : '0'} onChange={e => setEdit('is_active', e.target.value === '1')} style={inputCellStyle}>
            <option value="1">활성</option>
            <option value="0">비활성</option>
          </select>
        );
      default:
        if (portNum !== null) {
          const portKey = `port_${portNum}` as keyof ProductFormState;
          return <InlineSelect value={editForm[portKey] as string} onChange={v => setEdit(portKey, v)} options={portOpts} onAddOption={v => addSelectOption('port_company', v)} />;
        }
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Add form fields renderer                                            */
  /* ------------------------------------------------------------------ */

  function AddFormField({ fieldKey, label, required }: { fieldKey: keyof ProductFormState; label: string; required?: boolean }) {
    const lStyle: React.CSSProperties = {
      display: 'block',
      fontSize: '0.75rem',
      fontWeight: 600,
      color: '#6B7280',
      marginBottom: 3,
    };
    const iStyle: React.CSSProperties = {
      width: '100%',
      padding: '6px 10px',
      fontSize: '0.875rem',
      border: '1px solid #E1E5EB',
      borderRadius: 6,
      outline: 'none',
      boxSizing: 'border-box',
    };

    const renderInput = () => {
      switch (fieldKey) {
        case 'in_out':
          return (
            <select value={addForm.in_out} onChange={e => setAdd('in_out', e.target.value)} style={iStyle}>
              <option value="">선택</option>
              {IN_OUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        case 'category':
          return <SelectWithAdd value={addForm.category} onChange={v => setAdd('category', v)} options={categoryOpts} onAddOption={v => addSelectOption('category', v)} />;
        case 'asset_class_1':
          return <SelectWithAdd value={addForm.asset_class_1} onChange={v => setAdd('asset_class_1', v)} options={asset1Opts} onAddOption={v => addSelectOption('asset_class_1', v)} />;
        case 'asset_class_2':
          return <SelectWithAdd value={addForm.asset_class_2} onChange={v => setAdd('asset_class_2', v)} options={asset2Opts} onAddOption={v => addSelectOption('asset_class_2', v)} />;
        case 'institution':
          return <SelectWithAdd value={addForm.institution} onChange={v => setAdd('institution', v)} options={institutionOpts} onAddOption={v => addSelectOption('institution', v)} />;
        case 'period':
          return (
            <select value={addForm.period} onChange={e => setAdd('period', e.target.value)} style={iStyle}>
              <option value="">선택</option>
              {PERIOD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        case 'risk_level':
          return (
            <select value={addForm.risk_level} onChange={e => setAdd('risk_level', e.target.value)} style={iStyle}>
              <option value="">선택</option>
              {RISK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        case 'currency':
          return (
            <select value={addForm.currency} onChange={e => setAdd('currency', e.target.value)} style={iStyle}>
              <option value="">선택</option>
              {CURRENCY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        case 'total_expected_return':
          return <input type="number" value={addForm.total_expected_return} onChange={e => setAdd('total_expected_return', e.target.value)} placeholder="예: 15.5" style={iStyle} />;
        case 'annual_expected_return':
          return <input type="number" value={addForm.annual_expected_return} onChange={e => setAdd('annual_expected_return', e.target.value)} placeholder="예: 7.2" style={iStyle} />;
        case 'port_1': case 'port_2': case 'port_3': case 'port_4': case 'port_5':
        case 'port_6': case 'port_7': case 'port_8': case 'port_9': case 'port_10':
          return <SelectWithAdd value={addForm[fieldKey] as string} onChange={v => setAdd(fieldKey, v)} options={portOpts} onAddOption={v => addSelectOption('port_company', v)} />;
        case 'product_name':
          return <input value={addForm.product_name} onChange={e => setAdd('product_name', e.target.value)} placeholder="예: 삼성 글로벌 성장 랩" style={iStyle} />;
        default:
          return null;
      }
    };

    return (
      <div>
        <label style={lStyle}>{label}{required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}</label>
        {renderInput()}
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Table column definitions                                            */
  /* ------------------------------------------------------------------ */

  type ColDef = {
    key: string;
    header: string;
    width?: number | string;
    align?: 'left' | 'center' | 'right';
  };

  const columns: ColDef[] = [
    { key: 'checkbox', header: '', width: 30, align: 'center' },
    { key: 'no', header: 'No', width: 40, align: 'center' },
    { key: 'in_out', header: 'In/Out', width: 55, align: 'center' },
    { key: 'product_name', header: '상품명', width: undefined, align: 'left' },
    { key: 'category', header: '카테고리', width: 100, align: 'center' },
    { key: 'asset_class_1', header: '자산구분(1)', width: 90, align: 'center' },
    { key: 'asset_class_2', header: '자산구분(2)', width: 90, align: 'center' },
    { key: 'institution', header: '거래기관', width: 100, align: 'center' },
    { key: 'period', header: '기간', width: 130, align: 'center' },
    { key: 'risk_level', header: '투자위험', width: 90, align: 'center' },
    { key: 'currency', header: '화폐', width: 50, align: 'center' },
    { key: 'total_expected_return', header: '총기대수익률', width: 90, align: 'right' },
    { key: 'annual_expected_return', header: '연기대수익률', width: 90, align: 'right' },
    { key: 'port_1', header: '포트(1)', width: 90, align: 'center' },
    { key: 'port_2', header: '포트(2)', width: 90, align: 'center' },
    { key: 'port_3', header: '포트(3)', width: 90, align: 'center' },
    { key: 'port_4', header: '포트(4)', width: 90, align: 'center' },
    { key: 'port_5', header: '포트(5)', width: 90, align: 'center' },
    { key: 'port_6', header: '포트(6)', width: 90, align: 'center' },
    { key: 'port_7', header: '포트(7)', width: 90, align: 'center' },
    { key: 'port_8', header: '포트(8)', width: 90, align: 'center' },
    { key: 'port_9', header: '포트(9)', width: 90, align: 'center' },
    { key: 'port_10', header: '포트(10)', width: 90, align: 'center' },
    { key: 'is_active', header: '상태', width: 70, align: 'center' },
    { key: 'actions', header: '액션', width: 130, align: 'center' },
  ];

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  return (
    <>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            marginBottom: 10, color: '#6B7280', fontSize: '0.8125rem',
            textDecoration: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          대시보드로 돌아가기
        </Link>

        <div style={{ width: 32, height: 4, borderRadius: 2, background: 'linear-gradient(90deg,#3B82F6 0%,#1E3A5F 100%)', marginBottom: 10 }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, color: '#1E3A5F', letterSpacing: '-0.02em' }}>
              투자상품 관리
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#6B7280' }}>
              투자 상품을 등록하고 관리합니다.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={() => { setNStep('idle'); setNError(null); openAdd(); setTimeout(() => nOpenSelector(), 100); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Notion에서 가져오기
            </Btn>
            <Btn variant="primary" onClick={openAdd}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              상품 등록
            </Btn>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', backgroundColor: '#fff', borderRadius: 10, border: '1px solid #E1E5EB' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>상태</span>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          style={{ padding: '3px 8px', fontSize: 12, border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none', cursor: 'pointer' }}>
          <option value="all">전체</option><option value="active">활성</option><option value="inactive">비활성</option>
        </select>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>카테고리</span>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          style={{ padding: '3px 8px', fontSize: 12, border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none', cursor: 'pointer', maxWidth: 120 }}>
          <option value="">전체</option>{uniqueCategories.map(c => <option key={c} value={c!}>{c}</option>)}
        </select>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>자산(1)</span>
        <select value={filterAsset1} onChange={e => setFilterAsset1(e.target.value)}
          style={{ padding: '3px 8px', fontSize: 12, border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none', cursor: 'pointer', maxWidth: 120 }}>
          <option value="">전체</option>{uniqueAsset1.map(c => <option key={c} value={c!}>{c}</option>)}
        </select>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>자산(2)</span>
        <select value={filterAsset2} onChange={e => setFilterAsset2(e.target.value)}
          style={{ padding: '3px 8px', fontSize: 12, border: '1px solid #E1E5EB', borderRadius: 5, outline: 'none', cursor: 'pointer', maxWidth: 120 }}>
          <option value="">전체</option>{uniqueAsset2.map(c => <option key={c} value={c!}>{c}</option>)}
        </select>
        <button onClick={() => setFreezeCols(f => !f)}
          style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #D1D5DB', background: freezeCols ? '#EFF6FF' : '#fff', color: freezeCols ? '#1D4ED8' : '#6B7280', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
          {freezeCols ? '🔒 열 고정' : '🔓 고정 해제'}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={bulkDelete} disabled={bulkDeleting}
            style={{ marginLeft: 8, padding: '5px 14px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: bulkDeleting ? 'wait' : 'pointer', opacity: bulkDeleting ? 0.6 : 1 }}>
            {bulkDeleting ? '삭제 중...' : `선택 ${selectedIds.size}건 삭제`}
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: '#6B7280' }}>
          총 {filtered.length}개
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, color: '#DC2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Horizontal scrollable table */}
      <div style={{
        backgroundColor: '#fff',
        border: '1px solid #E1E5EB',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                {columns.map((col, ci) => {
                  const FREEZE_KEYS = ['checkbox', 'no', 'in_out', 'product_name'];
                  const FREEZE_LEFTS = [0, 30, 70, 125];
                  const isFrozen = freezeCols && FREEZE_KEYS.includes(col.key);
                  const frozenIdx = FREEZE_KEYS.indexOf(col.key);
                  return (
                    <th
                      key={col.key}
                      style={{
                        ...thStyle,
                        width: col.width,
                        minWidth: col.key === 'product_name' ? 150 : col.width,
                        textAlign: col.align ?? 'left',
                        borderRight: '1px solid rgba(255,255,255,0.1)',
                        ...(isFrozen ? {
                          position: 'sticky',
                          left: FREEZE_LEFTS[frozenIdx],
                          zIndex: 12,
                          boxShadow: frozenIdx === FREEZE_KEYS.length - 1 ? '2px 0 4px rgba(0,0,0,0.1)' : undefined,
                        } : {}),
                      }}
                    >
                      {col.key === 'checkbox' ? (
                        <input type="checkbox"
                          checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
                          onChange={toggleSelectAll}
                          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#fff' }} />
                      ) : col.key === 'actions' ? col.header : (
                        <span
                          onClick={(e) => handleSort(col.key, e.shiftKey)}
                          style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 3, justifyContent: col.align === 'center' ? 'center' : col.align === 'right' ? 'flex-end' : 'flex-start' }}
                          title="클릭: 정렬 / Shift+클릭: 복합 정렬"
                        >
                          {col.header}
                          {getSortIndicator(col.key) && (
                            <span style={{ fontSize: 9, color: '#FFD700', marginLeft: 2 }}>{getSortIndicator(col.key)}</span>
                          )}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} style={{ ...cellStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ ...cellStyle, textAlign: 'center', padding: 40, color: '#9CA3AF' }}>
                    등록된 투자 상품이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => {
                  const isEditing = editingId === p.id;
                  const rowBg = isEditing ? '#EFF6FF' : idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
                  return (
                    <tr key={p.id} style={{ backgroundColor: rowBg }}>
                      {columns.map(col => {
                        const align = col.align ?? 'left';
                        const FREEZE_KEYS = ['checkbox', 'no', 'in_out', 'product_name'];
                        const FREEZE_LEFTS = [0, 30, 70, 125];
                        const isFrozen = freezeCols && FREEZE_KEYS.includes(col.key);
                        const frozenIdx = FREEZE_KEYS.indexOf(col.key);
                        const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
                        const stickyStyle: React.CSSProperties = isFrozen ? {
                          position: 'sticky',
                          left: FREEZE_LEFTS[frozenIdx],
                          zIndex: 3,
                          backgroundColor: rowBg,
                          boxShadow: frozenIdx === FREEZE_KEYS.length - 1 ? '2px 0 4px rgba(0,0,0,0.06)' : undefined,
                        } : {};

                        if (col.key === 'no') {
                          return (
                            <td key="no" style={{ ...cellStyle, textAlign: 'center', width: col.width, color: '#9CA3AF', ...stickyStyle }}>
                              {(p as typeof p & { _origNo: number })._origNo}
                            </td>
                          );
                        }
                        if (col.key === 'actions') {
                          return (
                            <td key="actions" style={{ ...cellStyle, textAlign: 'center', width: col.width }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  <Btn variant="primary" size="sm" onClick={saveEdit} loading={editSaving}>저장</Btn>
                                  <Btn variant="ghost" size="sm" onClick={cancelEdit} disabled={editSaving}>취소</Btn>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  <Btn variant="secondary" size="sm" onClick={() => startEdit(p)}>수정</Btn>
                                  <Btn variant="danger" size="sm" onClick={() => setDeleteTarget(p)}>삭제</Btn>
                                </div>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={col.key}
                            style={{
                              ...cellStyle,
                              textAlign: align,
                              width: col.key === 'product_name' ? undefined : col.width,
                              minWidth: col.key === 'product_name' ? 150 : col.width,
                              whiteSpace: col.key === 'product_name' ? 'normal' : 'nowrap',
                              wordBreak: col.key === 'product_name' ? 'keep-all' : undefined,
                              ...stickyStyle,
                            }}
                          >
                            {isEditing && col.key !== 'no' && col.key !== 'checkbox'
                              ? renderEditCell(col.key)
                              : renderCell(p, col.key)
                            }
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Add Modal ---- */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="투자 상품 등록" maxWidth={680}>
        {/* Notion 가져오기 panel */}
        <div style={{ marginBottom: 16 }}>
          {nStep === 'idle' && (
            <button
              onClick={nOpenSelector}
              disabled={nLoading}
              style={{ width: '100%', padding: 9, borderRadius: 8, border: '1px dashed #CBD5E1', background: '#F8FAFC', color: '#374151', fontSize: 13, fontWeight: 500, cursor: nLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {nLoading ? '연결 중...' : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  Notion에서 데이터 가져오기
                </>
              )}
            </button>
          )}

          {nError && (
            <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#DC2626', display: 'flex', justifyContent: 'space-between' }}>
              <span>{nError}</span>
              <button onClick={nReset} style={{ background: 'none', border: 'none', color: '#DC2626', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>닫기</button>
            </div>
          )}

          {nStep === 'selectDb' && (
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '7px 10px', background: '#F0F4FA', fontSize: 12, fontWeight: 600, color: '#1E3A5F', display: 'flex', justifyContent: 'space-between' }}>
                <span>데이터베이스 선택</span>
                <button onClick={nReset} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}>취소</button>
              </div>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB' }}>
                <input type="text" placeholder="검색..." value={nDbSearch} onChange={e => setNDbSearch(e.target.value)}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {nLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>불러오는 중...</div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {nDbs.filter(d => !nDbSearch || d.title.toLowerCase().includes(nDbSearch.toLowerCase())).map(d => (
                    <button key={d.id}
                      onClick={() => { setNDbSearch(''); setNSelectedDbTitle(d.title); nLoadRows(d.id); }}
                      style={{ width: '100%', padding: '9px 10px', border: 'none', borderBottom: '1px solid #F3F4F6', background: '#fff', textAlign: 'left', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseOver={e => (e.currentTarget.style.background = '#F9FAFB')}
                      onMouseOut={e => (e.currentTarget.style.background = '#fff')}
                    >
                      <span>{d.icon ?? '📄'}</span>
                      <span style={{ fontWeight: 500 }}>{d.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {nStep === 'mapping' && (
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '7px 10px', background: '#F0F4FA', fontSize: 12, fontWeight: 600, color: '#1E3A5F', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>필드 매핑 + 상품 선택 {nSelectedDbTitle ? `(${nSelectedDbTitle})` : ''}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { clearNotionConfig(); setNRows([]); setNCols([]); nFetchDbList(); }}
                    style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11 }}>DB 변경</button>
                  <button onClick={nReset} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}>취소</button>
                </div>
              </div>
              {nLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>데이터 불러오는 중...</div>
              ) : (
                <>
                  <div style={{ padding: '8px 10px', background: '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
                    <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>Notion 컬럼 → 상품 필드 매핑</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                      {NOTION_MAP_FIELDS.map(f => (
                        <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                          <span style={{ width: 70, color: '#374151', fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.l}</span>
                          <select
                            value={nMap[f.k] ?? ''}
                            onChange={e => {
                              const updated = { ...nMap, [f.k]: e.target.value };
                              setNMap(updated);
                              if (nSelectedDbId) saveNotionConfig(nSelectedDbId, nSelectedDbTitle, updated);
                            }}
                            style={{ flex: 1, padding: '2px 4px', borderRadius: 4, border: '1px solid #D1D5DB', fontSize: 11, background: nMap[f.k] ? '#ECFDF5' : '#fff' }}
                          >
                            <option value="">--</option>
                            {nCols.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ padding: '6px 8px', borderBottom: '1px solid #E5E7EB' }}>
                    <input type="text" placeholder="상품 검색..." value={nRowSearch} onChange={e => setNRowSearch(e.target.value)}
                      style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ maxHeight: '240px', overflowY: 'scroll', border: '1px solid #E5E7EB', borderRadius: '0 0 4px 4px' }}>
                    {(() => {
                      const q = nRowSearch.toLowerCase().trim();
                      const fil = q ? nRows.filter(r => Object.values(r.properties).some(v => v?.toLowerCase().includes(q))) : nRows;
                      if (!fil.length) return <div style={{ padding: 14, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>{q ? '검색 결과 없음' : '데이터 없음'}</div>;
                      const allChecked = fil.length > 0 && fil.every(r => nSelectedRows.has(r.id));
                      return (<>
                        {/* 전체선택 헤더 */}
                        <div style={{ padding: '6px 10px', borderBottom: '1px solid #E5E7EB', background: '#F9FAFB', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
                          <input type="checkbox" checked={allChecked} onChange={() => nToggleAll(fil)}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#1E3A5F' }} />
                          <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>전체 선택 ({nSelectedRows.size}/{fil.length})</span>
                        </div>
                        {fil.map(r => {
                          const nameCol = nMap['product_name'];
                          const instCol = nMap['institution'];
                          const dn = nameCol ? (r.properties[nameCol] ?? '-') : Object.values(r.properties)[0] ?? '-';
                          const di = instCol ? (r.properties[instCol] ?? '') : '';
                          const checked = nSelectedRows.has(r.id);
                          return (
                            <div key={r.id}
                              style={{ width: '100%', padding: '7px 10px', borderBottom: '1px solid #F3F4F6', background: checked ? '#F0FDF4' : '#fff', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}
                              onClick={() => nToggleRow(r.id)}
                              onMouseOver={e => { if (!checked) e.currentTarget.style.background = '#FAFBFC'; }}
                              onMouseOut={e => { e.currentTarget.style.background = checked ? '#F0FDF4' : '#fff'; }}
                            >
                              <input type="checkbox" checked={checked} onChange={() => nToggleRow(r.id)}
                                onClick={e => e.stopPropagation()}
                                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#1E3A5F', flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: '#111827' }}>{dn}</span>
                              {di && <span style={{ color: '#6B7280', fontSize: 11 }}>{di}</span>}
                              <button onClick={(e) => { e.stopPropagation(); nApply(r); }}
                                style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 4, border: '1px solid #D1D5DB', background: '#fff', fontSize: 10, color: '#374151', cursor: 'pointer', flexShrink: 0 }}
                              >1건 입력</button>
                            </div>
                          );
                        })}
                      </>);
                    })()}
                  </div>
                  <div style={{ padding: '6px 10px', background: '#F0F4FA', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#6B7280' }}>총 {nRows.length}건{nSelectedRows.size > 0 && ` · ${nSelectedRows.size}건 선택`}</span>
                    {nSelectedRows.size > 0 && (
                      <button onClick={nBulkImport} disabled={nBulkLoading}
                        style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#1E3A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: nBulkLoading ? 'wait' : 'pointer', opacity: nBulkLoading ? 0.6 : 1 }}>
                        {nBulkLoading ? '등록 중...' : `선택 ${nSelectedRows.size}건 일괄 등록`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Form fields */}
        {addError && (
          <div style={{ marginBottom: 12, padding: '8px 12px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#DC2626', fontSize: '0.8125rem' }}>
            {addError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 12 }}>
          {/* product_name spans full width */}
          <div style={{ gridColumn: '1 / -1' }}>
            <AddFormField fieldKey="product_name" label="상품명" required />
          </div>
          <AddFormField fieldKey="in_out" label="In/Out" />
          <AddFormField fieldKey="category" label="카테고리" />
          <AddFormField fieldKey="asset_class_1" label="자산구분(1)" />
          <AddFormField fieldKey="asset_class_2" label="자산구분(2)" />
          <AddFormField fieldKey="institution" label="거래기관" />
          <AddFormField fieldKey="period" label="기간" />
          <AddFormField fieldKey="risk_level" label="투자위험" />
          <AddFormField fieldKey="currency" label="화폐" />
          <AddFormField fieldKey="total_expected_return" label="총기대수익률 (%)" />
          <AddFormField fieldKey="annual_expected_return" label="연기대수익률 (%)" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280' }}>포트폴리오 구성 (포트1~10)</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px 12px' }}>
            {(['port_1', 'port_2', 'port_3', 'port_4', 'port_5', 'port_6', 'port_7', 'port_8', 'port_9', 'port_10'] as const).map((pk, i) => (
              <AddFormField key={pk} fieldKey={pk} label={`포트(${i + 1})`} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4, borderTop: '1px solid #E5E7EB' }}>
          <Btn variant="ghost" onClick={() => setAddOpen(false)} disabled={addLoading}>취소</Btn>
          <Btn variant="primary" onClick={handleAdd} loading={addLoading}>저장</Btn>
        </div>
      </Modal>

      {/* ---- Delete Confirm Modal ---- */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="상품 삭제 확인" maxWidth={400}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: '#374151', lineHeight: 1.6 }}>
            <strong style={{ color: '#1A1A2E' }}>{deleteTarget?.product_name}</strong> 상품을 삭제하시겠습니까?
            <br />
            <span style={{ fontSize: '0.8125rem', color: '#EF4444' }}>이 작업은 되돌릴 수 없습니다.</span>
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>취소</Btn>
            <Btn variant="danger" onClick={handleDelete} loading={deleteLoading}>삭제</Btn>
          </div>
        </div>
      </Modal>
    </>
  );
}
