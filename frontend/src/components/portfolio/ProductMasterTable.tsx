'use client';

import { useState } from 'react';
import { Button } from '@/components/common/Button';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ProductMaster {
  id: string;
  product_name: string;
  product_code?: string;
  risk_level?: string;
  region?: string;
  product_type?: string;
  created_at?: string;
  updated_at?: string;
}

interface ProductMasterTableProps {
  items: ProductMaster[];
  onUpdate: (id: string, data: Partial<ProductMaster>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

export const RISK_LEVELS = ['절대안정형', '안정형', '안정성장형', '성장형', '절대성장형'] as const;
export const REGIONS = ['국내', '미국', '글로벌', '베트남', '인도', '중국', '기타'] as const;
export const PRODUCT_TYPES = ['ETF', '펀드', '연금저축펀드', 'IRP펀드', 'MMF', '주식', '해외주식', '랩어카운트'] as const;

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#6B7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'left',
  backgroundColor: '#F8FAFC',
  borderBottom: '2px solid #E1E5EB',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '0.8125rem',
  color: '#1A1A2E',
  borderBottom: '1px solid #F1F5F9',
  verticalAlign: 'middle',
};

const editInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '0.8125rem',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  outline: 'none',
  color: '#1A1A2E',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 99,
  fontSize: '0.75rem',
  fontWeight: 600,
  backgroundColor: color + '1A',
  color: color,
  border: `1px solid ${color}40`,
});

function getRiskColor(risk?: string) {
  switch (risk) {
    case '절대안정형': return '#10B981';
    case '안정형': return '#3B82F6';
    case '안정성장형': return '#8B5CF6';
    case '성장형': return '#F59E0B';
    case '절대성장형': return '#EF4444';
    default: return '#9CA3AF';
  }
}

function getRegionColor(region?: string) {
  switch (region) {
    case '국내': return '#1E3A5F';
    case '미국': return '#7C3AED';
    case '글로벌': return '#0EA5E9';
    case '베트남': return '#EF4444';
    case '인도': return '#F97316';
    case '중국': return '#DC2626';
    default: return '#6B7280';
  }
}

/* ------------------------------------------------------------------ */
/*  Edit Row State                                                      */
/* ------------------------------------------------------------------ */

interface EditState {
  product_name: string;
  risk_level: string;
  region: string;
  product_type: string;
  product_code: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

type SortKey = 'risk_level' | 'region' | 'product_type';
type SortDir = 'asc' | 'desc';

const SORT_ORDERS: Record<SortKey, string[]> = {
  risk_level: ['절대안정형', '안정형', '안정성장형', '성장형', '절대성장형'],
  region: ['국내', '미국', '글로벌', '베트남', '인도', '중국', '기타'],
  product_type: ['ETF', '펀드', '연금저축펀드', 'IRP펀드', 'MMF', '주식', '해외주식', '랩어카운트'],
};

export function ProductMasterTable({ items, onUpdate, onDelete }: ProductMasterTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ product_name: '', risk_level: '', region: '', product_type: '', product_code: '' });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortedItems = sortKey
    ? [...items].sort((a, b) => {
        const order = SORT_ORDERS[sortKey];
        const av = order.indexOf(a[sortKey] ?? '');
        const bv = order.indexOf(b[sortKey] ?? '');
        const ai = av === -1 ? 999 : av;
        const bi = bv === -1 ? 999 : bv;
        return sortDir === 'asc' ? ai - bi : bi - ai;
      })
    : items;

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  function startEdit(item: ProductMaster) {
    setEditingId(item.id);
    setEditState({
      product_name: item.product_name,
      risk_level: item.risk_level ?? '',
      region: item.region ?? '',
      product_type: item.product_type ?? '',
      product_code: item.product_code ?? '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState({ product_name: '', risk_level: '', region: '', product_type: '', product_code: '' });
  }

  async function handleSave(id: string) {
    setSavingId(id);
    try {
      await onUpdate(id, {
        product_name: editState.product_name.trim() || undefined,
        risk_level: editState.risk_level || undefined,
        region: editState.region || undefined,
        product_type: editState.product_type || undefined,
        product_code: editState.product_code.trim() || undefined,
      });
      setEditingId(null);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`"${name}" 상품을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '60px 24px',
          textAlign: 'center',
          color: '#9CA3AF',
          fontSize: '0.9375rem',
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#D1D5DB"
          strokeWidth="1.5"
          style={{ margin: '0 auto 12px', display: 'block' }}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <p style={{ margin: 0, fontWeight: 500 }}>등록된 상품이 없습니다</p>
        <p style={{ margin: '4px 0 0', fontSize: '0.8125rem' }}>우측 상단 "신규 등록" 버튼을 눌러 추가하세요.</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 50, textAlign: 'center' }}>NO</th>
            <th style={thStyle}>상품명</th>
            <th style={{ ...thStyle, width: 130, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('risk_level')}>위험도{sortArrow('risk_level')}</th>
            <th style={{ ...thStyle, width: 110, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('region')}>지역{sortArrow('region')}</th>
            <th style={{ ...thStyle, width: 140, cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('product_type')}>상품유형{sortArrow('product_type')}</th>
            <th style={{ ...thStyle, width: 80 }}>종목코드</th>
            <th style={{ ...thStyle, width: 130, textAlign: 'center' }}>작업</th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, idx) => {
            const isEditing = editingId === item.id;
            const isSaving = savingId === item.id;
            const isDeleting = deletingId === item.id;

            return (
              <tr
                key={item.id}
                style={{
                  backgroundColor: isEditing ? '#FAFBFF' : idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                  transition: 'background-color 0.1s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isEditing) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F0F4FF';
                }}
                onMouseLeave={(e) => {
                  if (!isEditing)
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
                }}
              >
                {/* NO */}
                <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF', fontWeight: 600 }}>
                  {idx + 1}
                </td>

                {/* 상품명 */}
                <td style={{ ...tdStyle, fontWeight: 500, maxWidth: 260 }}>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editState.product_name}
                      onChange={(e) => setEditState((s) => ({ ...s, product_name: e.target.value }))}
                      style={editInputStyle}
                      autoFocus
                    />
                  ) : (
                    <span
                      title={item.product_name}
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.product_name}
                    </span>
                  )}
                </td>

                {/* 위험도 */}
                <td style={tdStyle}>
                  {isEditing ? (
                    <select
                      value={editState.risk_level}
                      onChange={(e) => setEditState((s) => ({ ...s, risk_level: e.target.value }))}
                      style={{ ...editInputStyle, cursor: 'pointer' }}
                    >
                      <option value="">선택 안 함</option>
                      {RISK_LEVELS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={badgeStyle(getRiskColor(item.risk_level))}>
                      {item.risk_level ?? '-'}
                    </span>
                  )}
                </td>

                {/* 지역 */}
                <td style={tdStyle}>
                  {isEditing ? (
                    <select
                      value={editState.region}
                      onChange={(e) => setEditState((s) => ({ ...s, region: e.target.value }))}
                      style={{ ...editInputStyle, cursor: 'pointer' }}
                    >
                      <option value="">선택 안 함</option>
                      {REGIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={badgeStyle(getRegionColor(item.region))}>
                      {item.region ?? '-'}
                    </span>
                  )}
                </td>

                {/* 상품유형 */}
                <td style={tdStyle}>
                  {isEditing ? (
                    <select
                      value={editState.product_type}
                      onChange={(e) => setEditState((s) => ({ ...s, product_type: e.target.value }))}
                      style={{ ...editInputStyle, cursor: 'pointer' }}
                    >
                      <option value="">선택 안 함</option>
                      {PRODUCT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: item.product_type ? '#1A1A2E' : '#C4C9D4' }}>
                      {item.product_type ?? '-'}
                    </span>
                  )}
                </td>

                {/* 종목코드 */}
                <td style={{ ...tdStyle, color: '#6B7280', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {isEditing ? (
                    <input
                      type="text"
                      placeholder="종목코드"
                      value={editState.product_code}
                      onChange={(e) => setEditState((s) => ({ ...s, product_code: e.target.value }))}
                      style={{ ...editInputStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}
                    />
                  ) : (
                    item.product_code ?? '-'
                  )}
                </td>

                {/* 작업 */}
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={isSaving}
                        onClick={() => handleSave(item.id)}
                      >
                        저장
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={isSaving}
                      >
                        취소
                      </Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => startEdit(item)}
                        disabled={!!editingId || isDeleting}
                      >
                        수정
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={isDeleting}
                        onClick={() => handleDelete(item.id, item.product_name)}
                        disabled={!!editingId && editingId !== item.id}
                      >
                        삭제
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ProductMasterTable;
