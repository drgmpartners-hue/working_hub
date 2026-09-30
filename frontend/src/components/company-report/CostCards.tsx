'use client';

/** 발송 설정 — ① AI 비용(단계별, 오늘·누적·일평균·예상 월) ② 비용 종합(AI + SOLAPI, 일/월/분기/연) */
import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet } from '@/lib/companyReportApi';
import { ErrorBox, SectionTitle, Spinner, mutedText } from './ui';

export interface StageRow {
  key: string;
  label: string;
  kind: 'daily' | 'monthly' | 'irregular';
  models: string[];
  calls: number;
  searches: number;
  usd: number;
  avg_calls: number;
  avg_usd: number;
  est_month_usd: number;
  today_calls: number;
  today_usd: number;
}
export interface StageReport {
  since: string | null;
  days: number;
  krw_rate: number;
  stages: StageRow[];
  total: {
    usd: number;
    avg_usd: number;
    est_month_usd: number;
    today_usd: number;
    calls: number;
    today_calls: number;
  };
  before_usd: number;
}

const th: CSSProperties = {
  textAlign: 'right',
  padding: '7px 6px',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 12,
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  textAlign: 'right',
  padding: '7px 6px',
  color: 'var(--text-secondary)',
  fontSize: 13,
  borderBottom: '1px solid var(--border-soft)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const won = (usd: number, rate: number) => `${Math.round(usd * rate).toLocaleString('ko-KR')}원`;
const usdTxt = (v: number) => (v >= 0.995 || v === 0 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const shortModel = (m: string) =>
  m
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^gemini-/, 'gemini ')
    .replace(/-preview$/, '');
const KIND: Record<string, string> = { daily: '', monthly: '월 1회', irregular: '필요할 때' };

/** ① 단계별 AI 비용 */
export function StageCostCard({ r }: { r?: StageReport | null }) {
  if (!r) return null;
  const rate = r.krw_rate || 1400;
  const Money = ({ v, strong }: { v: number; strong?: boolean }) => (
    <span
      title={usdTxt(v)}
      style={strong ? { color: 'var(--text-primary)', fontWeight: 700 } : undefined}
    >
      {won(v, rate)}
    </span>
  );
  return (
    <Card padding={16}>
      <SectionTitle
        right={
          <span style={mutedText}>
            {r.since ? `${r.since}부터 ${r.days}일` : '기록 없음'} · 환율{' '}
            {Math.round(rate).toLocaleString('ko-KR')}원
          </span>
        }
      >
        AI 비용(단계별)
      </SectionTitle>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>단계</th>
              <th style={{ ...th, textAlign: 'left' }}>사용 AI</th>
              <th style={th}>오늘</th>
              <th style={th}>누적(실제)</th>
              <th style={th}>일평균 호출</th>
              <th style={th}>일평균 비용</th>
              <th style={th}>예상 월 비용</th>
            </tr>
          </thead>
          <tbody>
            {r.stages.map((x) => (
              <tr key={x.key} style={{ opacity: x.calls ? 1 : 0.5 }}>
                <td style={{ ...td, textAlign: 'left', color: 'var(--text-primary)' }}>
                  {x.label}
                  {KIND[x.kind] && (
                    <span style={{ ...mutedText, fontSize: 11, marginLeft: 6 }}>
                      {KIND[x.kind]}
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'left', fontSize: 12 }}>
                  {x.models.length ? x.models.map(shortModel).join(', ') : '-'}
                  {x.searches > 0 && (
                    <span style={{ ...mutedText, fontSize: 11 }}>
                      {' '}
                      · 검색 {x.searches.toLocaleString('ko-KR')}회
                    </span>
                  )}
                </td>
                <td style={td}>
                  {x.today_calls ? (
                    <>
                      <Money v={x.today_usd} />{' '}
                      <span style={{ ...mutedText, fontSize: 11 }}>({x.today_calls}회)</span>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td style={td}>{x.calls ? <Money v={x.usd} /> : '-'}</td>
                <td style={td}>{x.calls ? `${x.avg_calls.toLocaleString('ko-KR')}회` : '-'}</td>
                <td style={td}>{x.calls ? <Money v={x.avg_usd} /> : '-'}</td>
                <td style={td}>{x.calls ? <Money v={x.est_month_usd} strong /> : '-'}</td>
              </tr>
            ))}
            <tr>
              <td
                style={{ ...td, textAlign: 'left', color: 'var(--text-primary)', fontWeight: 700 }}
                colSpan={2}
              >
                합계
              </td>
              <td style={td}>
                <Money v={r.total.today_usd} strong />
              </td>
              <td style={td}>
                <Money v={r.total.usd} strong />
              </td>
              <td style={td}>{r.days ? `${(r.total.calls / r.days).toFixed(1)}회` : '-'}</td>
              <td style={td}>
                <Money v={r.total.avg_usd} strong />
              </td>
              <td style={{ ...td, color: 'var(--cyan-400)', fontWeight: 800 }}>
                {won(r.total.est_month_usd, rate)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ ...mutedText, fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
        공개 단가로 계산한 추정치입니다(토큰 + 웹·구글 검색 건당 요금, Gemini 구글 검색은 매달
        5,000회 무료). 금액에 마우스를 올리면 달러가 보입니다. 예상 월 비용: 매일 도는 단계는
        일평균×30, 월간은 한 달 실제, 필요할 때만 도는 단계는 최근 30일 실제.
        {r.before_usd > 0 &&
          ` 단계별 기록을 시작하기 전 사용분 ${won(r.before_usd, rate)}(${usdTxt(r.before_usd)})은 아래 '비용 종합'에 월 단위로 들어 있습니다.`}
      </div>
    </Card>
  );
}

interface HistoryRow {
  period: string;
  ai_krw: number;
  solapi_krw: number;
  total_krw: number;
  sends: number;
  messages: number;
  test_messages: number;
  alimtalk: number;
  lms: number;
  per_send_krw: number | null;
  per_message_krw: number | null;
}
interface History {
  unit: string;
  krw_rate: number;
  prices: Record<string, number>;
  items: HistoryRow[];
  total: {
    ai_krw: number;
    solapi_krw: number;
    total_krw: number;
    sends: number;
    messages: number;
    test_messages: number;
    per_send_krw: number | null;
  };
}

const UNITS: [string, string][] = [
  ['day', '일'],
  ['month', '월'],
  ['quarter', '분기'],
  ['year', '연'],
];
const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`;

/** ② 비용 종합: AI + SOLAPI, 발송 횟수, 1회당 평균 */
export function CostHistoryCard() {
  const [unit, setUnit] = useState('month');
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setH(await crGet<History>(`/costs?unit=${unit}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [unit]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card padding={16}>
      <SectionTitle
        right={
          <span style={{ display: 'flex', gap: 4 }}>
            {UNITS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`wh-btn wh-btn-sm ${unit === k ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
                onClick={() => setUnit(k)}
              >
                {label}
              </button>
            ))}
          </span>
        }
      >
        비용 종합(AI + 알림톡·문자)
      </SectionTitle>
      <ErrorBox message={error} />
      {loading ? (
        <Spinner />
      ) : !h || h.items.length === 0 ? (
        <div style={mutedText}>기록이 없습니다.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>기간</th>
                  <th style={th}>AI</th>
                  <th style={th}>알림톡·문자</th>
                  <th style={th}>합계</th>
                  <th style={th}>브리핑 발송</th>
                  <th style={th}>메시지</th>
                  <th style={th}>발송 1회당</th>
                  <th style={th}>메시지 1건당</th>
                </tr>
              </thead>
              <tbody>
                {h.items.map((x) => (
                  <tr key={x.period}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--text-primary)' }}>
                      {x.period}
                    </td>
                    <td style={td}>{n0(x.ai_krw)}</td>
                    <td style={td} title={`알림톡 ${x.alimtalk}건 · 문자 ${x.lms}건`}>
                      {n0(x.solapi_krw)}
                    </td>
                    <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 700 }}>
                      {n0(x.total_krw)}
                    </td>
                    <td style={td}>{x.sends ? `${x.sends}회` : '-'}</td>
                    <td style={td}>
                      {x.messages + x.test_messages ? `${x.messages + x.test_messages}건` : '-'}
                      {x.test_messages > 0 && (
                        <span style={{ ...mutedText, fontSize: 11 }}>
                          {' '}
                          (테스트 {x.test_messages})
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, color: 'var(--cyan-400)', fontWeight: 700 }}>
                      {n0(x.per_send_krw)}
                    </td>
                    <td style={td}>{n0(x.per_message_krw)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    style={{
                      ...td,
                      textAlign: 'left',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                    }}
                  >
                    전체
                  </td>
                  <td style={td}>{n0(h.total.ai_krw)}</td>
                  <td style={td}>{n0(h.total.solapi_krw)}</td>
                  <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 800 }}>
                    {n0(h.total.total_krw)}
                  </td>
                  <td style={td}>{h.total.sends}회</td>
                  <td style={td}>{h.total.messages + h.total.test_messages}건</td>
                  <td style={{ ...td, color: 'var(--cyan-400)', fontWeight: 800 }}>
                    {n0(h.total.per_send_krw)}
                  </td>
                  <td style={td} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ ...mutedText, fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
            브리핑 발송 = 데일리·월간 브리핑을 수신자에게 한 번 보낸 횟수(테스트 제외). 발송 1회당 =
            그 기간 전체 비용(AI + 발송비) ÷ 브리핑 발송 횟수. 알림톡 {h.prices.alimtalk ?? 13}원 ·
            문자(LMS) {h.prices.lms ?? 45}원(SOLAPI 기본 단가, VAT 별도), AI는 환율{' '}
            {Math.round(h.krw_rate).toLocaleString('ko-KR')}원으로 환산.
          </div>
        </>
      )}
    </Card>
  );
}
