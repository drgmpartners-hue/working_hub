'use client';

import { useState, useEffect } from 'react';
import { CallReservationForm } from './CallReservationForm';
import { API_URL } from '@/lib/api-url';

interface SuggestionHolding {
  holding_id: string;
  product_name: string;
  product_code: string | null;
  product_type: string | null;
  risk_level: string | null;
  region: string | null;
  current_weight: number;
  suggested_weight: number;
  evaluation_amount: number | null;
  purchase_amount?: number | null;
  return_amount?: number | null;
  return_rate?: number | null;
  current_price?: number | null;
  reference_price?: number | null;
  quantity?: number | null;
  is_new?: boolean;
}

interface SuggestionData {
  id: string;
  account_id: string;
  snapshot_id: string;
  ai_comment: string | null;
  expires_at: string;
  is_expired: boolean;
  holdings: SuggestionHolding[];
}

interface SuggestionPanelProps {
  token: string;
  suggestId: string;
  portalJwt: string;
  selectedAccountId?: string;
  autoLoad?: boolean;  // true = 계좌별 최신 suggestion 자동 로드
}

interface AccountSuggestionInfo {
  account_id: string;
  account_type: string;
  account_number: string;
  securities_company: string;
  dates: { suggestion_id: string; snapshot_id: string; created_at: string | null; has_ai_comment: boolean }[];
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/* AI 코멘트에서 [포트폴리오 분석]과 [변경 분석] 분리 */
function splitAiComment(comment: string | null): { analysis: string; change: string } {
  if (!comment) return { analysis: '', change: '' };
  const changeIdx = comment.indexOf('[변경 분석]');
  if (changeIdx === -1) return { analysis: comment, change: '' };
  const analysis = comment.substring(0, changeIdx).replace('[포트폴리오 분석]', '').trim();
  const change = comment.substring(changeIdx).replace('[변경 분석]', '').trim();
  return { analysis, change };
}

/* AI 코멘트 렌더링 - 줄바꿈과 구조 유지 */
const hasHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);

function AiCommentBlock({ text, title, bgColor, borderColor, titleColor }: {
  text: string; title: string; bgColor: string; borderColor: string; titleColor: string;
}) {
  if (!text) return null;
  const isHtml = hasHtml(text);
  return (
    <div style={{ backgroundColor: bgColor, border: `1px solid ${borderColor}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', backgroundColor: borderColor + '33', borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <p style={{ fontSize: 13, fontWeight: 700, color: titleColor, margin: 0 }}>{title}</p>
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {isHtml ? (
          <div style={{ fontSize: 14, color: '#1E1B4B', lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: text }} />
        ) : (
          <div style={{ fontSize: 14, color: '#1E1B4B', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{text}</div>
        )}
      </div>
    </div>
  );
}

export function SuggestionPanel({ token, suggestId, portalJwt, selectedAccountId, autoLoad }: SuggestionPanelProps) {
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reserved, setReserved] = useState(false);
  const [accountSuggestions, setAccountSuggestions] = useState<AccountSuggestionInfo[]>([]);
  const [activeSuggestId, setActiveSuggestId] = useState(suggestId);

  // autoLoad 모드: 계좌별 suggestions 목록 로드
  useEffect(() => {
    if (!autoLoad || !portalJwt) return;
    const loadSuggestionList = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/suggestions`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) {
          const data: AccountSuggestionInfo[] = await res.json();
          setAccountSuggestions(data);
          // 선택된 계좌의 최신 suggestion 자동 선택
          const acctInfo = data.find((a) => a.account_id === selectedAccountId);
          if (acctInfo && acctInfo.dates.length > 0) {
            setActiveSuggestId(acctInfo.dates[0].suggestion_id);
          } else if (data.length > 0 && data[0].dates.length > 0) {
            setActiveSuggestId(data[0].dates[0].suggestion_id);
          }
        }
      } catch { /* ignore */ }
    };
    loadSuggestionList();
  }, [autoLoad, portalJwt, token]);

  // 계좌 변경 시 해당 계좌의 최신 suggestion 로드
  useEffect(() => {
    if (!autoLoad || !selectedAccountId) return;
    const acctInfo = accountSuggestions.find((a) => a.account_id === selectedAccountId);
    if (acctInfo && acctInfo.dates.length > 0) {
      setActiveSuggestId(acctInfo.dates[0].suggestion_id);
    } else {
      setActiveSuggestId('');
      setSuggestion(null);
    }
  }, [selectedAccountId, accountSuggestions, autoLoad]);

  // suggestion 데이터 로드
  useEffect(() => {
    const idToLoad = activeSuggestId || suggestId;
    if (!idToLoad || !portalJwt) {
      setLoading(false);
      return;
    }
    const fetchSuggestion = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `${API_URL}/api/v1/client-portal/${token}/suggestion/${idToLoad}`,
          { headers: { Authorization: `Bearer ${portalJwt}` } }
        );
        if (res.ok) setSuggestion(await res.json());
        else setError('');
      } catch { setError('네트워크 오류가 발생했습니다.'); }
      finally { setLoading(false); }
    };
    fetchSuggestion();
  }, [token, activeSuggestId, suggestId, portalJwt]);

  if (loading) {
    return (
      <div style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 14, border: '1px solid #E5E7EB' }}>
        제안 내용을 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: '#FEF2F2', borderRadius: 16, padding: 24, textAlign: 'center', color: '#DC2626', fontSize: 14, border: '1px solid #FECACA' }}>
        {error}
      </div>
    );
  }

  if (!suggestion) {
    if (autoLoad) {
      return (
        <div style={{ backgroundColor: '#F9FAFB', borderRadius: 16, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 14, border: '1px solid #E5E7EB' }}>
          이 계좌에 저장된 변경 제안 보고서가 없습니다.
        </div>
      );
    }
    return null;
  }

  // Hide suggestion panel when the user is viewing a different account tab (legacy mode)
  if (!autoLoad && selectedAccountId && suggestion.account_id && selectedAccountId !== suggestion.account_id) {
    return null;
  }

  if (suggestion.is_expired) {
    return (
      <div style={{ backgroundColor: '#F9FAFB', borderRadius: 16, padding: 24, textAlign: 'center', border: '1px solid #E5E7EB' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏰</div>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#374151', marginBottom: 8 }}>제안 기간이 만료되었습니다</p>
        <p style={{ fontSize: 13, color: '#9CA3AF' }}>새로운 포트폴리오 제안은 담당자에게 문의해주세요.</p>
      </div>
    );
  }

  if (reserved) {
    return (
      <div style={{ backgroundColor: '#F0FDF4', borderRadius: 16, padding: 32, textAlign: 'center', border: '1px solid #BBF7D0' }}>
        <div style={{ width: 64, height: 64, backgroundColor: '#059669', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28, color: '#fff' }}>✓</div>
        <p style={{ fontSize: 17, fontWeight: 700, color: '#065F46', marginBottom: 8 }}>예약이 완료되었습니다</p>
        <p style={{ fontSize: 14, color: '#047857', lineHeight: 1.6 }}>담당자가 선택하신 시간에<br />연락드릴 예정입니다.</p>
      </div>
    );
  }

  // AI 코멘트 분리
  const { analysis: aiAnalysis, change: aiChange } = splitAiComment(suggestion.ai_comment);

  // 신규 상품 판별
  const isNewItem = (h: SuggestionHolding) => {
    const isDeposit = (h.product_name ?? '').includes('예수금') || (h.product_name ?? '').includes('자동운용상품');
    if (isDeposit) return false;
    return h.is_new === true || (h.current_weight === 0 && h.suggested_weight > 0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* AI 포트폴리오 분석 코멘트 (현재 포트폴리오) */}
      <AiCommentBlock
        text={aiAnalysis}
        title="AI 포트폴리오 분석"
        bgColor="#FFFBEB"
        borderColor="#FDE68A"
        titleColor="#92400E"
      />

      {/* 포트폴리오 변경 제안 헤더 */}
      <div style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #E5E7EB', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A9B 100%)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>포트폴리오 변경 제안</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
            만료일: {new Date(suggestion.expires_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 수정 포트폴리오 테이블 */}
          {suggestion.holdings.length > 0 && (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 10, border: '1px solid #E5E7EB' }}>
              <table style={{ width: '100%', minWidth: 650, borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F0F4FF' }}>
                    {['상품명', '평가금액', '수익률', '현재비중', '수정비중', 'Sell/Buy', '기준가', '좌수'].map((h, i) => (
                      <th key={h} style={{
                        padding: '10px 8px', textAlign: i === 0 ? 'left' : 'center', fontSize: 11,
                        fontWeight: 600, color: '#4338CA', whiteSpace: 'nowrap', borderBottom: '1px solid #C7D2FE',
                        ...(i === 0 ? { position: 'sticky' as const, left: 0, backgroundColor: '#F0F4FF', zIndex: 1, minWidth: 110 } : {}),
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const totalEval = suggestion.holdings.reduce((s, x) => s + (x.evaluation_amount ?? 0), 0);
                    let totalEvalSum = 0;
                    let totalSellBuy = 0;

                    const rows = suggestion.holdings.map((h, idx) => {
                      const curW = h.current_weight;
                      const sugW = h.suggested_weight;
                      const isNewProduct = isNewItem(h);

                      // Sell/Buy = (총평가 × 수정비중) - 현재평가금액
                      const afterAmt = Math.round(totalEval * sugW);
                      const rawSellBuy = afterAmt - (h.evaluation_amount ?? 0);
                      // 절대값이 50,000원 미만이면 0으로 처리 (소량 잔차 무시)
                      const sellBuyAmt = Math.abs(rawSellBuy) < 50000 ? 0 : rawSellBuy;
                      totalEvalSum += (h.evaluation_amount ?? 0);
                      totalSellBuy += sellBuyAmt;

                      let sellBuyLabel = '-';
                      let sellBuyColor = '#9CA3AF';
                      if (sellBuyAmt > 0) {
                        sellBuyLabel = `Buy ${fmt(sellBuyAmt)}`;
                        sellBuyColor = '#059669';
                      } else if (sellBuyAmt < 0) {
                        sellBuyLabel = `Sell ${fmt(Math.abs(sellBuyAmt))}`;
                        sellBuyColor = '#DC2626';
                      }

                      const changed = Math.abs(sellBuyAmt) > 0;
                      const newBg = isNewProduct ? '#F0F7FF' : changed ? '#FFFBEB' : 'transparent';

                      return (
                        <tr key={h.holding_id} style={{
                          borderBottom: '1px solid #F3F4F6',
                          backgroundColor: newBg,
                        }}>
                          <td style={{ padding: '10px 8px', color: '#111827', fontSize: 11, lineHeight: 1.4, position: 'sticky', left: 0, backgroundColor: newBg === 'transparent' ? '#fff' : newBg, zIndex: 1, minWidth: 110 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {h.product_name}
                              {isNewProduct && (
                                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, backgroundColor: '#DBEAFE', color: '#1D4ED8', fontWeight: 700, whiteSpace: 'nowrap' }}>신규</span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: '#374151' }}>
                            {fmt(h.evaluation_amount ?? 0)}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 600, color: (h.return_rate ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                            {(h.return_rate ?? 0) >= 0 ? '+' : ''}{(h.return_rate ?? 0).toFixed(2)}%
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#6B7280' }}>
                            {isNewProduct ? '-' : `${(curW * 100).toFixed(1)}%`}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: '#1E3A5F' }}>
                            {(sugW * 100).toFixed(1)}%
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600, color: sellBuyColor, whiteSpace: 'nowrap', fontSize: 11 }}>
                            {sellBuyLabel}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: '#374151' }}>
                            {(h.reference_price || h.current_price) ? fmt(h.reference_price || h.current_price || 0) : '-'}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: '#374151' }}>
                            {(() => {
                              const price = h.reference_price || h.current_price;
                              if (!price || price <= 0 || sellBuyAmt === 0) return '-';
                              const isFund = ((h.product_type ?? '') + (h.product_name ?? '')).includes('펀드') || ((h.product_type ?? '') + (h.product_name ?? '')).includes('신탁');
                              const raw = isFund ? Math.abs(sellBuyAmt) * 1000 / price : Math.abs(sellBuyAmt) / price;
                              const shares = sellBuyAmt > 0 ? Math.ceil(raw) : -Math.ceil(raw);
                              return fmt(shares);
                            })()}
                          </td>
                        </tr>
                      );
                    });

                    // 합계 행
                    rows.push(
                      <tr key="__total__" style={{ backgroundColor: '#F0F4FF', borderTop: '2px solid #C7D2FE', fontWeight: 700 }}>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: '#1E3A5F', position: 'sticky', left: 0, backgroundColor: '#F0F4FF', zIndex: 1 }}>합계</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: '#1E3A5F', fontSize: 12 }}>{fmt(totalEvalSum)}</td>
                        <td style={{ padding: '10px 8px' }}></td>
                        <td style={{ padding: '10px 8px' }}></td>
                        <td style={{ padding: '10px 8px' }}></td>
                        <td style={{ padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: 11, color: totalSellBuy >= 0 ? '#059669' : '#DC2626' }}>
                          {totalSellBuy >= 0 ? '+' : ''}{fmt(totalSellBuy)}
                        </td>
                        <td style={{ padding: '10px 8px' }}></td>
                        <td style={{ padding: '10px 8px' }}></td>
                      </tr>
                    );

                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* AI 포트폴리오 변경 분석 */}
          <AiCommentBlock
            text={aiChange}
            title="AI 포트폴리오 변경 분석"
            bgColor="#F0F4FF"
            borderColor="#C7D2FE"
            titleColor="#4338CA"
          />

          {/* 투자 책임 주의사항 */}
          <div style={{ padding: '4px 0' }}>
            <p style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.6, margin: 0 }}>
              ※ 본 자료는 참고용 정보이며, 투자에 대한 최종 판단과 책임은 고객 본인에게 있습니다.
            </p>
          </div>

          {/* 통화 예약 - 추후 활성화 */}
          {/* <CallReservationForm suggestId={suggestId} onSuccess={() => setReserved(true)} /> */}
        </div>
      </div>
    </div>
  );
}

export default SuggestionPanel;
