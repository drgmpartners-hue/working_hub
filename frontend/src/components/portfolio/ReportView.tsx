'use client';

import { forwardRef, useState, useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Holding {
  id: string;
  seq?: number;
  product_name: string;
  product_code?: string;
  product_type?: string;
  risk_level?: string;
  region?: string;
  quantity?: number;
  purchase_price?: number;
  current_price?: number;
  purchase_amount?: number;
  evaluation_amount?: number;
  return_amount?: number;
  return_rate?: number;
  weight?: number;
  reference_price?: number;
  total_deposit?: number;
  total_withdrawal?: number;
}

interface ReportData {
  snapshot: {
    id: string;
    snapshot_date: string;
    deposit_amount?: number;
    total_purchase?: number;
    total_evaluation?: number;
    total_return?: number;
    total_return_rate?: number;
  };
  account: {
    id: string;
    account_type: string;
    account_number?: string;
    securities_company?: string;
    monthly_payment?: number;
  };
  holdings: Holding[];
  history: { date: string; return_rate?: number }[];
  ai_comment?: string;
  ai_change_comment?: string;
}

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

interface ReportViewProps {
  reportData: ReportData | null;
  clientName: string;
  modifiedWeights: Record<string, number>;
  extraHoldings?: Holding[];
  onWeightChange: (holdingId: string, value: number) => void;
  aiComment?: string;
  onAiCommentChange?: (val: string) => void;
  aiChangeComment?: string;
  onAiChangeCommentChange?: (val: string) => void;
  onGenerateAiComment?: () => void;
  onGenerateAiChangeComment?: () => void;
  aiCommentLoading?: boolean;
  aiChangeCommentLoading?: boolean;
  managerNote?: string;
  onManagerNoteChange?: (val: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const REGION_COLORS: Record<string, string> = {
  국내: '#1E3A5F',
  미국: '#3B82F6',
  글로벌: '#10B981',
  베트남: '#F59E0B',
  인도: '#EF4444',
  중국: '#8B5CF6',
  기타: '#9CA3AF',
};

const RISK_COLORS: Record<string, string> = {
  절대안정형: '#3B82F6',
  안정형: '#10B981',
  성장형: '#F59E0B',
  절대성장형: '#EF4444',
};

const FALLBACK_COLORS = ['#1E3A5F', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const fmt = (n?: number) => (n != null ? n.toLocaleString('ko-KR') : '-');

const accountTypeLabel = (t: string) =>
  ({ irp: 'IRP', pension: '연금저축', pension1: '연금저축', pension2: '연금저축', pension_saving: '연금저축(적립)', pension_hold: '연금저축(거치)', retirement: '퇴직연금' } as Record<string, string>)[t] || t;

const returnRateColor = (rate?: number) => {
  if (rate == null) return '#374151';
  if (rate > 0) return '#10B981';
  if (rate < 0) return '#EF4444';
  return '#374151';
};

const getColorForKey = (key: string, colorMap: Record<string, string>, idx: number) =>
  colorMap[key] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        marginTop: 4,
      }}
    >
      <span
        style={{
          width: 4,
          height: 18,
          backgroundColor: '#1E3A5F',
          borderRadius: 2,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1A1A2E' }}>
        {children}
      </span>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        marginTop: 8,
      }}
    >
      <span style={{ color: '#1E3A5F', fontWeight: 700 }}>●</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
        {children}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Comment Block                                                    */
/* ------------------------------------------------------------------ */

interface AiCommentBlockProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  onGenerate?: () => void;
  loading?: boolean;
  managerNote?: string;
  onManagerNoteChange?: (val: string) => void;
}

function formatHtml(html: string): string {
  // 태그 앞에 줄바꿈 추가 (블록 레벨 태그)
  let formatted = html
    .replace(/>\s*</g, '>\n<')  // 태그 사이 줄바꿈
    .replace(/(<br\s*\/?>)/gi, '$1\n')  // <br> 뒤 줄바꿈
    .replace(/(<\/?(b|strong|span|ul|li|ol|p|div|h[1-6])[^>]*>)/gi, '\n$1')  // 블록 태그 앞 줄바꿈
    .replace(/\n{3,}/g, '\n\n')  // 3줄 이상 → 2줄로
    .trim();
  // 들여쓰기 처리
  const lines = formatted.split('\n');
  let indent = 0;
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result.push(''); continue; }
    if (/^<\/(ul|ol|div|li)>/i.test(trimmed)) indent = Math.max(0, indent - 1);
    result.push('  '.repeat(indent) + trimmed);
    if (/^<(ul|ol|div|li)\b/i.test(trimmed) && !trimmed.includes('</')) indent++;
  }
  return result.join('\n');
}

function compactHtml(html: string): string {
  // 편집 후 불필요한 공백/줄바꿈 제거 (원래 형태로 복원)
  return html
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('');
}

function AiCommentBlock({ label, value, onChange, onGenerate, loading, managerNote, onManagerNoteChange }: AiCommentBlockProps) {
  const [htmlEditMode, setHtmlEditMode] = useState(false);
  const [htmlEditValue, setHtmlEditValue] = useState('');

  function toggleHtmlEdit() {
    if (!htmlEditMode) {
      // 일반 → HTML 수정: 포매팅해서 보여주기
      setHtmlEditValue(formatHtml(value));
    } else {
      // HTML 수정 → 일반: compact로 복원 후 반영
      onChange(compactHtml(htmlEditValue));
    }
    setHtmlEditMode(!htmlEditMode);
  }

  return (
    <div style={{ marginTop: 4 }}>
      <SubTitle>{label}</SubTitle>

      {/* 담당자 입력란 (AI 변경 코멘트용) — 다운로드 시 숨김 */}
      {onManagerNoteChange != null && (
        <div
          data-no-print="true"
          style={{
            border: '1px solid #E1E5EB',
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: '#FFFBEB',
            marginBottom: 8,
          }}
        >
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #FDE68A', backgroundColor: '#FEF3C7' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400E' }}>
              담당자 의견 (선택사항) — 비중 조절 근거, 매도/매수 이유 등을 입력하면 AI가 참고하여 전문적으로 재편집합니다.
            </span>
          </div>
          <textarea
            value={managerNote ?? ''}
            onChange={(e) => onManagerNoteChange(e.target.value)}
            placeholder="예: 미국 빅테크 비중 축소 → 트럼프 관세 리스크 확대, 인도 시장 확대 → 제조업 이전 수혜 기대..."
            rows={3}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '0.8125rem',
              color: '#374151',
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif",
            }}
          />
        </div>
      )}

      <div
        style={{
          border: '1px solid #E1E5EB',
          borderRadius: 8,
          overflow: 'hidden',
          backgroundColor: '#FAFBFC',
        }}
      >
        {/* Toolbar — 다운로드 시 숨김 */}
        {onGenerate && (
          <div
            data-no-print="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid #E1E5EB',
              backgroundColor: '#F5F7FA',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: '#6B7280' }}>
              직접 수정 가능합니다.
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {value && (
                <button
                  onClick={toggleHtmlEdit}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: htmlEditMode ? '#DC2626' : '#6B7280',
                    backgroundColor: htmlEditMode ? '#FEF2F2' : '#F3F4F6',
                    border: `1px solid ${htmlEditMode ? '#FECACA' : '#E1E5EB'}`,
                    borderRadius: 5,
                    cursor: 'pointer',
                  }}
                >
                  {htmlEditMode ? '일반 보기' : 'HTML 수정'}
                </button>
              )}
              <button
                onClick={onGenerate}
                disabled={loading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#fff',
                  backgroundColor: loading ? '#9CA3AF' : '#1E3A5F',
                  border: 'none',
                  borderRadius: 5,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s',
                }}
              >
                {loading ? (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      border: '1.5px solid #fff',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                )}
                {loading ? 'AI 생성 중...' : 'AI 코멘트 생성'}
              </button>
            </div>
          </div>
        )}
        {/* 기본: 일반 보기 (HTML 렌더링 + contentEditable) / HTML 수정: raw textarea */}
        {htmlEditMode ? (
          <textarea
            value={htmlEditValue}
            onChange={(e) => setHtmlEditValue(e.target.value)}
            placeholder="HTML 코드를 직접 수정할 수 있습니다."
            rows={12}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '0.8125rem',
              color: '#374151',
              backgroundColor: '#FEFCE8',
              border: 'none',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.6,
              boxSizing: 'border-box',
              fontFamily: "'Consolas', 'Monaco', monospace",
            }}
          />
        ) : (
          <div
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: value || '<span style="color:#9CA3AF">AI 코멘트를 입력하거나 위 버튼으로 자동 생성하세요.</span>' }}
            onBlur={(e) => {
              const html = (e.target as HTMLDivElement).innerHTML;
              // placeholder 텍스트가 아닌 경우에만 업데이트
              if (!html.includes('AI 코멘트를 입력하거나')) onChange(html);
              else if (html !== value) onChange(html);
            }}
            style={{
              padding: '12px',
              fontSize: '0.8125rem',
              color: '#374151',
              lineHeight: 1.7,
              fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif",
              minHeight: 80,
              outline: 'none',
              cursor: 'text',
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WeightEditor — 포트폴리오 변경 안내 테이블                           */
/* ------------------------------------------------------------------ */

interface WeightEditorProps {
  holdings: Holding[];
  totalEval: number;
  modifiedWeights: Record<string, number>;
  onWeightChange: (holdingId: string, value: number) => void;
  thStyle: React.CSSProperties;
  thLeftStyle: React.CSSProperties;
  tdStyle: React.CSSProperties;
  tdLeftStyle: React.CSSProperties;
  totalRowStyle: React.CSSProperties;
  readOnly?: boolean;
}

function WeightEditor({
  holdings,
  totalEval,
  modifiedWeights,
  onWeightChange,
  thStyle,
  thLeftStyle,
  tdStyle,
  tdLeftStyle,
  totalRowStyle,
  readOnly = false,
}: WeightEditorProps) {
  const totalModified = Object.values(modifiedWeights).reduce((s, v) => s + v, 0);
  const hasModified = Object.keys(modifiedWeights).length > 0;
  const isValid = Math.abs(totalModified - 100) < 0.01;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'center', width: 36 }}>NO</th>
              <th style={thLeftStyle}>상품명</th>
              <th style={thStyle}>기준가</th>
              <th style={thStyle}>평가금액</th>
              <th style={thStyle}>수익률</th>
              <th style={thStyle}>현재비중</th>
              <th style={{ ...thStyle, backgroundColor: '#1E3A5F', color: '#fff', borderLeft: '2px solid #1E3A5F' }}>수정비중</th>
              <th style={{ ...thStyle, backgroundColor: '#1E3A5F', color: '#fff' }}>변경후금액</th>
              <th style={{ ...thStyle, backgroundColor: '#1E3A5F', color: '#fff' }}>Sell/Buy</th>
              <th style={{ ...thStyle, backgroundColor: '#1E3A5F', color: '#fff' }}>좌수</th>
            </tr>
          </thead>
          <tbody>
            {[...holdings].sort((a, b) => {
              const aIsRow1 = (a.product_name ?? '').includes('자동운용상품') || (a.product_name ?? '').includes('예수금') ? 0 : 1;
              const bIsRow1 = (b.product_name ?? '').includes('자동운용상품') || (b.product_name ?? '').includes('예수금') ? 0 : 1;
              return aIsRow1 - bIsRow1;
            }).map((h, idx) => {
              const modW = modifiedWeights[h.id];
              const changedAmt =
                modW != null && totalEval > 0
                  ? Math.round((totalEval * modW) / 100)
                  : null;
              const diffAmt =
                changedAmt != null && h.evaluation_amount != null
                  ? changedAmt - h.evaluation_amount
                  : null;
              const isRow1Product = h.product_name === '예수금/자동운용상품(고유계정대)' || h.product_name === '자동운용상품(고유계정대)' || h.product_name === '예수금';
              const isNew = h.id.startsWith('virtual_') && !isRow1Product;
              const rowBg = isNew ? '#F0FDF4' : 'transparent';
              return (
                <tr
                  key={h.id}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = isNew ? '#DCFCE7' : '#F9FAFB'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = rowBg; }}
                  style={{ transition: 'background-color 0.1s ease', backgroundColor: rowBg }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
                    {h.seq ?? idx + 1}
                  </td>
                  <td style={tdLeftStyle}>
                    <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {h.product_name}
                      {isNew && (
                        <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>신규</span>
                      )}
                    </div>
                    {h.product_type && (
                      <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 1 }}>
                        {h.product_type}
                        {h.region ? ` · ${h.region}` : ''}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{fmt(h.reference_price)}</td>
                  <td style={tdStyle}>{fmt(h.evaluation_amount)}</td>
                  <td style={{ ...tdStyle, color: returnRateColor(h.return_rate), fontWeight: 600 }}>
                    {h.return_rate != null
                      ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                  <td style={tdStyle}>
                    {(() => {
                      if (h.weight != null) return `${(h.weight * 100).toFixed(1)}%`;
                      if (totalEval > 0 && (h.evaluation_amount ?? 0) > 0) return `${((h.evaluation_amount! / totalEval) * 100).toFixed(1)}%`;
                      return '-';
                    })()}
                  </td>
                  <td style={{ ...tdStyle, padding: '6px 8px', borderLeft: '2px solid #1E3A5F' }}>
                    {readOnly ? (() => {
                      const isRow1 = (h.product_name ?? '').includes('자동운용상품') || (h.product_name ?? '').includes('예수금');
                      const isFullSell = modW === 0 && (h.evaluation_amount ?? 0) > 0 && !isRow1;
                      return (
                        <span style={{ fontWeight: 600, color: isFullSell ? '#EF4444' : '#1E3A5F' }}>
                          {modW != null
                            ? (isFullSell ? '전액매도' : `${modW.toFixed(1)}%`)
                            : '-'}
                        </span>
                      );
                    })() : (
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      placeholder="-"
                      value={modW ?? ''}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        onWeightChange(h.id, isNaN(v) ? 0 : v);
                      }}
                      style={{
                        width: 68,
                        padding: '4px 6px',
                        fontSize: '0.8125rem',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        textAlign: 'right',
                        outline: 'none',
                        color: '#1E3A5F',
                        fontWeight: 600,
                        boxSizing: 'border-box',
                      }}
                    />
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: changedAmt != null ? 600 : undefined }}>
                    {changedAmt != null ? `${fmt(changedAmt)}원` : '-'}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: diffAmt != null ? 600 : undefined,
                      color: diffAmt != null ? returnRateColor(diffAmt) : '#374151',
                    }}
                  >
                    {diffAmt != null
                      ? `${diffAmt > 0 ? '+' : ''}${fmt(diffAmt)}`
                      : '-'}
                  </td>
                  <td style={{ ...tdStyle, color: (() => {
                    if (diffAmt == null || !h.reference_price || h.reference_price <= 0) return '#374151';
                    return diffAmt < 0 ? '#EF4444' : '#374151';
                  })() }}>
                    {(() => {
                      if (diffAmt == null || !h.reference_price || h.reference_price <= 0) return '-';
                      const isFund = (h.product_type ?? '').includes('펀드');
                      const raw = isFund ? diffAmt * 1000 / h.reference_price : diffAmt / h.reference_price;
                      const shares = raw > 0 ? Math.ceil(raw) : -Math.ceil(Math.abs(raw));
                      return shares !== 0 ? shares.toLocaleString('ko-KR') : '-';
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ ...totalRowStyle, textAlign: 'left' }}>
                합계
              </td>
              <td style={totalRowStyle}>
                {holdings.every((h) => h.weight != null)
                  ? `${(holdings.reduce((s, h) => s + (h.weight ?? 0), 0) * 100).toFixed(1)}%`
                  : '-'}
              </td>
              {/* 수정비중 합계 — 100% 아닐 때 빨간색 */}
              <td
                style={{
                  ...totalRowStyle,
                  color: hasModified ? (isValid ? '#10B981' : '#EF4444') : '#1A1A2E',
                  borderLeft: '2px solid #1E3A5F',
                }}
              >
                {hasModified ? (
                  <span>
                    {totalModified.toFixed(1)}%
                    {!isValid && (
                      <span style={{ fontSize: '0.6875rem', marginLeft: 4 }}>
                        (합계 100% 필요)
                      </span>
                    )}
                  </span>
                ) : (
                  '-'
                )}
              </td>
              <td style={totalRowStyle}>
                {hasModified && totalEval > 0
                  ? `${fmt(
                      Math.round(
                        Object.values(modifiedWeights).reduce((s, v) => s + (totalEval * v) / 100, 0)
                      )
                    )}원`
                  : '-'}
              </td>
              <td style={totalRowStyle}>-</td>
              <td style={totalRowStyle}>-</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 합계 경고 메시지 — 웹에서만 표시 */}
      {hasModified && !isValid && (
        <div
          data-no-print="true"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            backgroundColor: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: '0.8125rem', color: '#DC2626', fontWeight: 500 }}>
            수정비중 합계가 {totalModified.toFixed(1)}%입니다. 100%가 되도록 입력하세요.
          </span>
        </div>
      )}
      {hasModified && isValid && (
        <div
          data-no-print="true"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            backgroundColor: '#ECFDF5',
            border: '1px solid #A7F3D0',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          <span style={{ fontSize: '0.8125rem', color: '#059669', fontWeight: 500 }}>
            수정비중 합계가 100%입니다.
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ReportView (forwardRef for html2canvas)                             */
/* ------------------------------------------------------------------ */

const ReportView = forwardRef<HTMLDivElement, ReportViewProps>(
  ({
    reportData,
    clientName,
    modifiedWeights,
    extraHoldings = [],
    onWeightChange,
    aiComment = '',
    onAiCommentChange,
    aiChangeComment = '',
    onAiChangeCommentChange,
    onGenerateAiComment,
    onGenerateAiChangeComment,
    aiCommentLoading = false,
    aiChangeCommentLoading = false,
    managerNote = '',
    onManagerNoteChange,
  }, ref) => {
    const [historyRange, setHistoryRange] = useState<'3m' | '6m' | '1y'>('6m');

    /* ---------- computed data ---------- */

    const holdings = reportData?.holdings ?? [];
    const snap = reportData?.snapshot ?? null;
    const account = reportData?.account ?? null;
    const totalEval = snap?.total_evaluation ?? 0;

    // 지역분산 pie data
    const regionData = useMemo(() => {
      const map: Record<string, number> = {};
      holdings.forEach((h) => {
        const key = h.region || '기타';
        map[key] = (map[key] ?? 0) + (h.evaluation_amount ?? 0);
      });
      return Object.entries(map)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    }, [holdings]);

    // 위험도분산 pie data
    const riskData = useMemo(() => {
      const map: Record<string, number> = {};
      holdings.forEach((h) => {
        const key = h.risk_level || '등급미상';
        map[key] = (map[key] ?? 0) + (h.evaluation_amount ?? 0);
      });
      return Object.entries(map)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }));
    }, [holdings]);

    // history filter
    const historyData = useMemo(() => {
      if (!reportData?.history) return [];
      const all = [...reportData.history].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const cutoff = new Date();
      if (historyRange === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
      else if (historyRange === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
      else cutoff.setFullYear(cutoff.getFullYear() - 1);
      return all.filter((d) => new Date(d.date) >= cutoff);
    }, [reportData, historyRange]);

    /* ---------- styles ---------- */

    const thStyle: React.CSSProperties = {
      padding: '8px 10px',
      fontSize: '0.75rem',
      fontWeight: 600,
      color: '#6B7280',
      textAlign: 'right',
      backgroundColor: '#F5F7FA',
      borderBottom: '1px solid #E1E5EB',
      whiteSpace: 'nowrap',
    };
    const thLeftStyle: React.CSSProperties = { ...thStyle, textAlign: 'left' };
    const tdStyle: React.CSSProperties = {
      padding: '8px 10px',
      fontSize: '0.8125rem',
      color: '#374151',
      textAlign: 'right',
      borderBottom: '1px solid #F3F4F6',
      whiteSpace: 'nowrap',
    };
    const tdLeftStyle: React.CSSProperties = {
      ...tdStyle,
      textAlign: 'left',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
      minWidth: 120,
    };
    const totalRowStyle: React.CSSProperties = {
      ...tdStyle,
      fontWeight: 700,
      color: '#1A1A2E',
      backgroundColor: '#F5F7FA',
    };

    /* ---------- empty state ---------- */

    if (!reportData) {
      return (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: '#9CA3AF',
            fontSize: '0.875rem',
            border: '1px solid #E1E5EB',
            borderRadius: 12,
            backgroundColor: '#FFFFFF',
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D1D5DB"
            strokeWidth="1"
            style={{ margin: '0 auto 16px', display: 'block' }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="12" x2="15" y2="12" />
            <line x1="9" y1="16" x2="15" y2="16" />
          </svg>
          <p style={{ margin: 0, fontWeight: 600 }}>보고서를 생성하세요</p>
          <p style={{ margin: '6px 0 0', fontSize: '0.8125rem' }}>
            계좌와 날짜를 선택하고 &quot;보고서 생성&quot; 버튼을 클릭하세요.
          </p>
        </div>
      );
    }

    /* ---------- null guard ---------- */

    if (!snap || !account) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
          보고서 데이터가 올바르지 않습니다.
        </div>
      );
    }

    /* ---------- render ---------- */

    const pageStyle: React.CSSProperties = {
      backgroundColor: '#FFFFFF',
      padding: '32px',
      fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif",
      maxWidth: '900px',
      margin: '0 auto',
      boxSizing: 'border-box',
    };

    const pageDividerStyle: React.CSSProperties = {
      height: 20,
      backgroundColor: '#E5E7EB',
      margin: '0 auto',
      maxWidth: '900px',
    };

    return (
      <div
        ref={ref}
        style={{
          fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif",
          maxWidth: '900px',
          margin: '0 auto',
        }}
      >
        {/* ==================== PAGE 1 ==================== */}
        <div data-pdf-page="1" style={pageStyle}>

        {/* ===== 1. 헤더 ===== */}
        <div
          style={{
            borderBottom: '3px solid #1E3A5F',
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: 4, fontWeight: 500 }}>
                {account?.securities_company || '증권사'}
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: '1.375rem',
                  fontWeight: 800,
                  color: '#1E3A5F',
                  letterSpacing: '-0.5px',
                }}
              >
                세액공제 투자상품 종합보고서
              </h1>
              <div style={{ marginTop: 4, fontSize: '0.8125rem', color: '#6B7280' }}>
                고객명: <strong style={{ color: '#1A1A2E' }}>{clientName}</strong>
                &nbsp;·&nbsp;{accountTypeLabel(account?.account_type ?? '')}
                {account?.account_number ? <>&nbsp;·&nbsp;{account.account_number}</> : null}
              </div>
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#9CA3AF', textAlign: 'right' }}>
              <div>작성일: {new Date().toISOString().slice(0, 10).replace(/-/g, '.')}</div>
              <div>조회일: {snap.snapshot_date?.replace(/-/g, '.')}</div>
            </div>
          </div>
        </div>

        {/* ===== 2. 개요 — 자금현황 테이블 ===== */}
        <div style={{ marginBottom: 28 }}>
          <SectionTitle>개요</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  {['조회일', '월납입액', '예수금', '납입원금', '평가금액', '수익금액', '총수익률'].map(
                    (h) => (
                      <th key={h} style={thLeftStyle}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdLeftStyle}>{snap.snapshot_date}</td>
                  <td style={tdLeftStyle}>
                    {account?.monthly_payment ? `${fmt(account.monthly_payment)}원` : '-'}
                  </td>
                  <td style={tdLeftStyle}>{snap.deposit_amount != null ? `${fmt(snap.deposit_amount)}원` : '-'}</td>
                  <td style={tdLeftStyle}>{snap.total_purchase != null ? `${fmt(snap.total_purchase)}원` : '-'}</td>
                  <td style={{ ...tdLeftStyle, fontWeight: 600 }}>{snap.total_evaluation != null ? `${fmt(snap.total_evaluation)}원` : '-'}</td>
                  <td
                    style={{
                      ...tdLeftStyle,
                      color: returnRateColor(snap.total_return),
                      fontWeight: 600,
                    }}
                  >
                    {snap.total_return != null
                      ? `${snap.total_return > 0 ? '+' : ''}${fmt(snap.total_return)}원`
                      : '-'}
                  </td>
                  <td
                    style={{
                      ...tdLeftStyle,
                      color: returnRateColor(snap.total_return_rate),
                      fontWeight: 700,
                    }}
                  >
                    {snap.total_return_rate != null
                      ? `${snap.total_return_rate > 0 ? '+' : ''}${snap.total_return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 섹션 1: 포트폴리오 확인 ===== */}
        <div style={{ border: '1px solid #D1D5DB', borderRadius: 10, marginBottom: 28 }}>
          <div style={{ padding: '12px 16px', backgroundColor: '#111827', borderRadius: '10px 10px 0 0' }}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
              1. 포트폴리오 확인 — {accountTypeLabel(account?.account_type ?? '')}
            </span>
          </div>
          <div style={{ padding: '20px 16px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'center', width: 36 }}>NO</th>
                  <th style={thLeftStyle}>상품명</th>
                  <th style={thStyle}>위험도</th>
                  <th style={thStyle}>매입금액</th>
                  <th style={thStyle}>평가금액</th>
                  <th style={thStyle}>평가손익</th>
                  <th style={thStyle}>수익률</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h, idx) => (
                  <tr
                    key={h.id}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#F9FAFB'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'; }}
                    style={{ transition: 'background-color 0.1s ease' }}
                  >
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#9CA3AF' }}>
                      {h.seq ?? idx + 1}
                    </td>
                    <td style={tdLeftStyle}>
                      <div style={{ fontWeight: 500 }}>{h.product_name}</div>
                      {h.product_type && (
                        <div style={{ fontSize: '0.6875rem', color: '#9CA3AF', marginTop: 1 }}>
                          {h.product_type}
                          {h.region ? ` · ${h.region}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {h.risk_level ? (
                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 4,
                            ...(h.risk_level === '절대성장형'
                              ? { backgroundColor: '#FEF2F2', color: '#DC2626' }
                              : h.risk_level === '성장형'
                              ? { backgroundColor: '#FFFBEB', color: '#D97706' }
                              : h.risk_level === '안정형'
                              ? { backgroundColor: '#ECFDF5', color: '#059669' }
                              : { backgroundColor: '#EFF6FF', color: '#2563EB' }),
                          }}
                        >
                          {h.risk_level}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={tdStyle}>{fmt(h.purchase_amount)}</td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{fmt(h.evaluation_amount)}</td>
                    <td style={{ ...tdStyle, color: returnRateColor(h.return_amount) }}>
                      {h.return_amount != null
                        ? `${h.return_amount > 0 ? '+' : ''}${fmt(h.return_amount)}`
                        : '-'}
                    </td>
                    <td style={{ ...tdStyle, color: returnRateColor(h.return_rate), fontWeight: 600 }}>
                      {h.return_rate != null
                        ? `${h.return_rate > 0 ? '+' : ''}${h.return_rate.toFixed(2)}%`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ ...totalRowStyle, textAlign: 'left' }}>
                    합계
                  </td>
                  <td style={totalRowStyle}>{fmt(snap.total_purchase)}</td>
                  <td style={totalRowStyle}>{fmt(snap.total_evaluation)}</td>
                  <td style={{ ...totalRowStyle, color: returnRateColor(snap.total_return) }}>
                    {snap.total_return != null
                      ? `${snap.total_return > 0 ? '+' : ''}${fmt(snap.total_return)}`
                      : '-'}
                  </td>
                  <td style={{ ...totalRowStyle, color: returnRateColor(snap.total_return_rate) }}>
                    {snap.total_return_rate != null
                      ? `${snap.total_return_rate > 0 ? '+' : ''}${snap.total_return_rate.toFixed(2)}%`
                      : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        </div>{/* 섹션 1 닫기 */}

        </div>{/* PAGE 1 끝 */}

        <div style={pageDividerStyle} />

        {/* ==================== PAGE 2 ==================== */}
        <div data-pdf-page="2" style={pageStyle}>

        {/* ===== 섹션 2: 포트폴리오 분석 ===== */}
        <div style={{ border: '1px solid #D1D5DB', borderRadius: 10, marginBottom: 28 }}>
          <div style={{ padding: '12px 16px', backgroundColor: '#111827', borderRadius: '10px 10px 0 0' }}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
              2. 포트폴리오 분석
            </span>
          </div>
          <div style={{ padding: '20px 16px' }}>

        {/* ===== 5. 차트 (지역분산 + 위험도분산) ===== */}
        {(regionData.length > 0 || riskData.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {/* 지역분산 */}
            <div>
              <SubTitle>지역 분산</SubTitle>
              {regionData.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie
                        data={regionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {regionData.map((entry, i) => (
                          <Cell key={entry.name} fill={getColorForKey(entry.name, REGION_COLORS, i)} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: unknown) => [`${typeof v === 'number' ? v.toLocaleString('ko-KR') : v}원`, '평가금액']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {regionData.map((entry, i) => {
                      const total = regionData.reduce((s, d) => s + d.value, 0);
                      const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                      const color = getColorForKey(entry.name, REGION_COLORS, i);
                      return (
                        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
                          <span style={{ fontSize: '0.75rem', color: '#374151' }}>{entry.name}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1A1A2E', marginLeft: 'auto', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
                  데이터 없음
                </div>
              )}
            </div>

            {/* 위험도 분산 */}
            <div>
              <SubTitle>위험도 분산</SubTitle>
              {riskData.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie
                        data={riskData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {riskData.map((entry, i) => (
                          <Cell key={entry.name} fill={getColorForKey(entry.name, RISK_COLORS, i)} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: unknown) => [`${typeof v === 'number' ? v.toLocaleString('ko-KR') : v}원`, '평가금액']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {riskData.map((entry, i) => {
                      const total = riskData.reduce((s, d) => s + d.value, 0);
                      const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                      const color = getColorForKey(entry.name, RISK_COLORS, i);
                      return (
                        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
                          <span style={{ fontSize: '0.75rem', color: '#374151' }}>{entry.name}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1A1A2E', marginLeft: 'auto', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '0.875rem' }}>
                  데이터 없음
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 6. 수익률 그래프 ===== */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <SubTitle>수익률 추이</SubTitle>
            <div style={{ display: 'flex', gap: 0, border: '1px solid #E1E5EB', borderRadius: 8, overflow: 'hidden' }}>
              {(['3m', '6m', '1y'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setHistoryRange(r)}
                  style={{
                    padding: '5px 12px',
                    border: 'none',
                    backgroundColor: historyRange === r ? '#1E3A5F' : 'transparent',
                    color: historyRange === r ? '#fff' : '#6B7280',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {r === '3m' ? '3개월' : r === '6m' ? '6개월' : '1년'}
                </button>
              ))}
            </div>
          </div>
          {historyData.length === 0 ? (
            <div
              style={{
                height: 160,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9CA3AF',
                fontSize: '0.875rem',
                border: '1px solid #F3F4F6',
                borderRadius: 8,
              }}
            >
              이력 데이터가 없습니다.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historyData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  formatter={(v: unknown) => [`${typeof v === 'number' ? v.toFixed(2) : v}%`, '수익률']}
                  labelStyle={{ fontSize: '0.75rem' }}
                />
                <Line
                  type="monotone"
                  dataKey="return_rate"
                  stroke="#1E3A5F"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#1E3A5F' }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ===== 7. AI 분석 코멘트 ===== */}
        <div style={{ marginBottom: 28 }}>
          <AiCommentBlock
            label="AI 분석 코멘트"
            value={aiComment}
            onChange={onAiCommentChange ?? (() => {})}
            onGenerate={onGenerateAiComment}
            loading={aiCommentLoading}
          />
        </div>

        </div>
        </div>{/* 섹션 2 닫기 */}

        </div>{/* PAGE 2 끝 */}

        <div style={pageDividerStyle} />

        {/* ==================== PAGE 3 ==================== */}
        <div data-pdf-page="3" style={pageStyle}>

        {/* ===== 섹션 3: 포트폴리오 변경 안내 ===== */}
        <div style={{ border: '1px solid #D1D5DB', borderRadius: 10, marginBottom: 28, marginTop: 0 }}>
          <div style={{ padding: '12px 16px', backgroundColor: '#111827', borderRadius: '10px 10px 0 0' }}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>
              3. 포트폴리오 변경 안내
            </span>
          </div>
          <div style={{ padding: '20px 16px' }}>

        {Object.keys(modifiedWeights).length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9CA3AF' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>
              저장된 수정 포트폴리오가 없습니다.
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#9CA3AF', lineHeight: 1.6 }}>
              [2. 데이터 확인] 탭에서 수정 포트폴리오를 작성하고 저장한 후<br />
              이 보고서를 다시 생성해주세요.
            </p>
          </div>
        ) : (
          <WeightEditor
            holdings={[...holdings, ...extraHoldings]}
            totalEval={totalEval}
            modifiedWeights={modifiedWeights}
            onWeightChange={() => {}}
            thStyle={thStyle}
            thLeftStyle={thLeftStyle}
            tdStyle={tdStyle}
            tdLeftStyle={{ ...tdLeftStyle, fontSize: '0.75rem' }}
            totalRowStyle={totalRowStyle}
            readOnly
          />
        )}
        </div>
        </div>{/* 섹션 3 닫기 */}

        </div>{/* PAGE 3 끝 */}

        {/* ==================== PAGE 4 ==================== */}
        {Object.keys(modifiedWeights).length > 0 && (
          <>
            <div style={pageDividerStyle} />

            <div data-pdf-page="4" style={pageStyle}>

            {/* ===== 섹션 4: 포트폴리오 변경 분석 리포트 (에디토리얼) ===== */}
            <div style={{ marginBottom: 28 }}>
              {/* 매거진 헤더 */}
              <div style={{ borderBottom: '3px solid #1E3A5F', paddingBottom: 16, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: '0.6875rem', color: '#94A3B8', fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                      Portfolio Rebalancing Report
                    </div>
                    <h2 style={{ margin: '4px 0 0', fontSize: '1.5rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.5px' }}>
                      포트폴리오 변경 분석
                    </h2>
                    <div style={{ marginTop: 4, fontSize: '0.8125rem', color: '#6B7280' }}>
                      {clientName} · {accountTypeLabel(account?.account_type ?? '')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#94A3B8' }}>
                    <div>기준일 {snap.snapshot_date?.replace(/-/g, '.')}</div>
                    <div>작성일 {new Date().toISOString().slice(0, 10).replace(/-/g, '.')}</div>
                  </div>
                </div>
              </div>

              {/* 구분선 */}
              <div style={{ height: 1, backgroundColor: '#E2E8F0', marginBottom: 24 }} />

              {/* 본문 — AI 변경 분석 */}
              <div style={{ marginBottom: 20 }}>
                <AiCommentBlock
                  label=""
                  value={aiChangeComment}
                  onChange={onAiChangeCommentChange ?? (() => {})}
                  onGenerate={onGenerateAiChangeComment}
                  loading={aiChangeCommentLoading}
                  managerNote={managerNote}
                  onManagerNoteChange={onManagerNoteChange}
                />
              </div>

            </div>

            {/* Footer */}
            <div
              style={{
                marginTop: 28,
                paddingTop: 14,
                borderTop: '1px solid #E1E5EB',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '0.6875rem',
                color: '#9CA3AF',
              }}
            >
              <span>본 보고서는 참고 자료이며 투자 결과에 대한 책임은 투자자 본인에게 있습니다.</span>
              <span>Working Hub Manager</span>
            </div>

            </div>{/* PAGE 4 끝 */}
          </>
        )}

        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
);

ReportView.displayName = 'ReportView';

export default ReportView;
