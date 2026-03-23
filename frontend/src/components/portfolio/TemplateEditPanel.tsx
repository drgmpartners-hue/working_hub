'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/common/Button';
import { authLib } from '@/lib/auth';
import { API_URL } from '@/lib/api-url';

export interface PortfolioItem {
  id: number;
  product_name: string;
  product_type: string;
  current_value: number;
  return_rate: number;
  weight?: number;
}

interface TemplateEditPanelProps {
  analysisId: number;
  onSaved?: (items: PortfolioItem[]) => void;
}

export function TemplateEditPanel({ analysisId, onSaved }: TemplateEditPanelProps) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    if (!analysisId) return;
    fetchItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  async function fetchItems() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/portfolios/${analysisId}/items`, {
        headers: { ...authLib.getAuthHeader() },
      });
      if (!res.ok) throw new Error('포트폴리오 항목을 불러오는 데 실패했습니다.');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleFieldChange(id: number, field: keyof PortfolioItem, value: string) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const numericFields: (keyof PortfolioItem)[] = ['current_value', 'return_rate', 'weight'];
        return {
          ...item,
          [field]: numericFields.includes(field) ? parseFloat(value) || 0 : value,
        };
      })
    );
  }

  async function handleSaveAll() {
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      await Promise.all(
        items.map((item) =>
          fetch(`${API_URL}/api/v1/portfolios/${analysisId}/items/${item.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...authLib.getAuthHeader(),
            },
            body: JSON.stringify({
              product_name: item.product_name,
              product_type: item.product_type,
              current_value: item.current_value,
              return_rate: item.return_rate,
              weight: item.weight,
            }),
          }).then((r) => {
            if (!r.ok) throw new Error(`항목 ${item.id} 저장 실패`);
            return r.json();
          })
        )
      );
      setSaveSuccess(true);
      onSaved?.(items);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    fontSize: '0.8125rem',
    border: '1px solid #E1E5EB',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    color: '#1A1A2E',
    outline: 'none',
    boxSizing: 'border-box',
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <div
          style={{
            width: 28,
            height: 28,
            border: '2px solid #E1E5EB',
            borderTopColor: '#1E3A5F',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 8,
          color: '#B91C1C',
          fontSize: '0.875rem',
        }}
      >
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '48px 0',
          textAlign: 'center',
          color: '#6B7280',
          fontSize: '0.875rem',
        }}
      >
        포트폴리오 항목이 없습니다. 먼저 데이터를 불러오세요.
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6B7280' }}>
          총 <strong style={{ color: '#1A1A2E' }}>{items.length}</strong>개 항목
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveSuccess && (
            <span
              style={{
                fontSize: '0.8125rem',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              저장 완료
            </span>
          )}
          <Button size="sm" variant="primary" loading={saving} onClick={handleSaveAll}>
            전체 저장
          </Button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #E1E5EB' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#F5F7FA' }}>
              {['상품명', '상품유형', '평가금액 (원)', '수익률 (%)', '비중 (%)'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: '#6B7280',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid #E1E5EB',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <tr
                  key={item.id}
                  onClick={() => setEditingId(item.id)}
                  style={{
                    borderBottom: '1px solid #E1E5EB',
                    cursor: 'pointer',
                    backgroundColor: isEditing ? 'rgba(46,139,139,0.04)' : 'transparent',
                    transition: 'background-color 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isEditing)
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        'rgba(74,144,217,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isEditing)
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                        'transparent';
                  }}
                >
                  {/* product_name */}
                  <td style={{ padding: '8px 14px' }}>
                    {isEditing ? (
                      <input
                        style={inputStyle}
                        value={item.product_name}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'product_name', e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span style={{ color: '#1A1A2E', fontWeight: 500 }}>
                        {item.product_name}
                      </span>
                    )}
                  </td>

                  {/* product_type */}
                  <td style={{ padding: '8px 14px' }}>
                    {isEditing ? (
                      <input
                        style={inputStyle}
                        value={item.product_type}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'product_type', e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          backgroundColor: '#EEF2F7',
                          color: '#1E3A5F',
                          fontWeight: 500,
                        }}
                      >
                        {item.product_type}
                      </span>
                    )}
                  </td>

                  {/* current_value */}
                  <td style={{ padding: '8px 14px' }}>
                    {isEditing ? (
                      <input
                        type="number"
                        style={inputStyle}
                        value={item.current_value}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'current_value', e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        {item.current_value.toLocaleString()}
                      </span>
                    )}
                  </td>

                  {/* return_rate */}
                  <td style={{ padding: '8px 14px' }}>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        style={inputStyle}
                        value={item.return_rate}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'return_rate', e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.8125rem',
                          color:
                            item.return_rate > 0
                              ? '#059669'
                              : item.return_rate < 0
                              ? '#DC2626'
                              : '#6B7280',
                          fontWeight: 600,
                        }}
                      >
                        {item.return_rate > 0 ? '+' : ''}
                        {item.return_rate.toFixed(2)}%
                      </span>
                    )}
                  </td>

                  {/* weight */}
                  <td style={{ padding: '8px 14px' }}>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        style={inputStyle}
                        value={item.weight ?? ''}
                        onChange={(e) =>
                          handleFieldChange(item.id, 'weight', e.target.value)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        {item.weight != null ? `${item.weight.toFixed(1)}%` : '-'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <p style={{ marginTop: 10, fontSize: '0.8125rem', color: '#6B7280' }}>
          * 다른 행을 클릭하면 편집 행이 전환됩니다. 수정 후 <strong>전체 저장</strong>을 눌러 저장하세요.
        </p>
      )}
    </div>
  );
}

export default TemplateEditPanel;
