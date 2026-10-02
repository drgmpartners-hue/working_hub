/**
 * 내 고객 관리 대시보드 — /dashboard
 * 수정_tasks P2-8: 예전엔 숫자·고객 이름이 모두 하드코딩된 샘플이었다. 이제 GET /api/v1/dashboard/summary 의 실제 데이터
 * (매니저 = 본인 담당 고객, 대표 = 전체)로 그린다. 레이아웃은 기존 handoff 'dash' 구조 그대로.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';
import { apiJson, isAbort } from '@/lib/apiFetch';

interface Summary {
  kpi: {
    clients: number;
    new_clients_week: number;
    aum: number;
    aum_change_pct: number | null;
    avg_return_rate: number | null;
    reservations_month: number;
    pending: number;
    accounts: number;
    accounts_with_snapshot: number;
  };
  aum_trend: { month: string; label: string; aum: number }[];
  alerts: { client_id: string | null; name: string; kind: 'neg' | 'warn' | 'info'; badge: string; message: string }[];
  alerts_total: number;
  account_types: { type: string; label: string; count: number }[];
  schedule: { time: string; title: string; sub: string }[];
  feed: { kind: 'client' | 'snapshot' | 'message' | 'reservation'; text: string; at: string }[];
}

const SEG_COLORS = ['#38BDF8', '#2563EB', '#10B981', '#A78BFA', '#F59E0B', '#64748B'];
const AVA_COLORS = { neg: '#EF4444', warn: '#F59E0B', info: '#38BDF8' } as const;
const FEED_STYLE: Record<Summary['feed'][number]['kind'], { bg: string; c: string; t: string }> = {
  client: { bg: 'rgba(167,139,250,.14)', c: '#A78BFA', t: '+' },
  snapshot: { bg: 'rgba(16,185,129,.12)', c: '#10B981', t: '✓' },
  message: { bg: 'rgba(37,99,235,.14)', c: '#3B82F6', t: '✉' },
  reservation: { bg: 'rgba(56,189,248,.12)', c: '#38BDF8', t: '☎' },
};

const chevron = (
  <svg className="go-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle' }}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/** 원 → '382.4억' / '9,500만' */
function won(v: number): { v: string; unit: string } {
  if (Math.abs(v) >= 1e8) return { v: `₩${(v / 1e8).toFixed(1)}`, unit: '억' };
  if (Math.abs(v) >= 1e4) return { v: `₩${Math.round(v / 1e4).toLocaleString('ko-KR')}`, unit: '만' };
  return { v: `₩${Math.round(v).toLocaleString('ko-KR')}`, unit: '원' };
}

function ago(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return '방금';
  if (diff < 60) return `${Math.round(diff)}분 전`;
  if (diff < 60 * 24) return `${Math.round(diff / 60)}시간 전`;
  if (diff < 60 * 24 * 2) return '어제';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 응답 모양 확인 — 서버가 예전 버전이거나 이상한 값을 주면 화면이 깨지지 않고 오류 문구를 보인다 */
function asSummary(d: unknown): Summary {
  const o = d as Partial<Summary> | null;
  if (!o || typeof o !== 'object' || !o.kpi || !Array.isArray(o.aum_trend)) throw new Error('대시보드 응답 형식이 맞지 않습니다.');
  return { ...o, alerts: o.alerts ?? [], account_types: o.account_types ?? [], schedule: o.schedule ?? [], feed: o.feed ?? [] } as Summary;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 공용 apiJson + AbortController: 화면을 떠나면 진행 중인 요청을 취소(수정_tasks P2-3)
  const ctrlRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const d = asSummary(await apiJson('/api/v1/dashboard/summary', { signal: ctrl.signal }));
      setData(d);
      setError(null);
    } catch (e) {
      if (isAbort(e)) return;
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    apiJson('/api/v1/dashboard/summary', { signal: ctrl.signal })
      .then((d) => setData(asSummary(d)))
      .catch((e: unknown) => {
        if (!isAbort(e)) setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      });
    return () => ctrl.abort();
  }, []);

  const name = user?.nickname || user?.email?.split('@')[0] || '어드바이저';
  const dateStr = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

  const maxAum = useMemo(() => Math.max(1, ...(data?.aum_trend ?? []).map((t) => t.aum)), [data]);
  const totalAcc = (data?.account_types ?? []).reduce((s, t) => s + t.count, 0);
  const segments = useMemo(() => {
    const C = 2 * Math.PI * 60;
    const types = data?.account_types ?? [];
    const lens = types.map((t) => (totalAcc > 0 ? (t.count / totalAcc) * C : 0));
    return types.map((t, i) => {
      const off = lens.slice(0, i).reduce((a, b) => a + b, 0);
      return { ...t, color: SEG_COLORS[i % SEG_COLORS.length], dash: `${lens[i]} ${C - lens[i]}`, off: -off, pct: totalAcc ? Math.round((t.count / totalAcc) * 100) : 0 };
    });
  }, [data, totalAcc]);

  const k = data?.kpi;
  const aumFmt = won(k?.aum ?? 0);
  const kpis = k
    ? [
        { k: '관리 고객', v: k.clients.toLocaleString('ko-KR'), unit: '명', d: k.new_clients_week ? `▲ 이번 주 +${k.new_clients_week}명` : '이번 주 신규 없음', kind: k.new_clients_week ? 'up' : 'flat' },
        {
          k: '담당 AUM', v: aumFmt.v, unit: aumFmt.unit,
          d: k.aum_change_pct == null ? `계좌 ${k.accounts_with_snapshot}/${k.accounts}개 분석 기준` : `${k.aum_change_pct >= 0 ? '▲' : '▼'} ${Math.abs(k.aum_change_pct)}% 전월`,
          kind: k.aum_change_pct == null ? 'flat' : k.aum_change_pct >= 0 ? 'up' : 'down',
        },
        {
          k: '평균 수익률', v: k.avg_return_rate == null ? '-' : `${k.avg_return_rate >= 0 ? '+' : ''}${k.avg_return_rate.toFixed(1)}`, unit: k.avg_return_rate == null ? '' : '%',
          d: '최신 분석 기준(평가손익/매입)', kind: k.avg_return_rate == null ? 'flat' : k.avg_return_rate >= 0 ? 'up' : 'down',
        },
        { k: '이번 달 통화 예약', v: String(k.reservations_month), unit: '건', d: '고객 포털 접수', kind: 'flat' },
        { k: '처리 대기', v: String(k.pending), unit: '건', d: '확인 안 한 통화 예약', kind: k.pending ? 'down' : 'flat' },
      ]
    : [];

  return (
    <div>
      <div className="block-head" style={{ paddingTop: 0 }}>
        <span className="section-tag">Dashboard</span>
        <h2>내 고객 관리 대시보드</h2>
        <p>담당 고객 현황을 한눈에 확인하세요.</p>
      </div>

      <div className="dash-shell">
        <div className="dash-head">
          <div className="dash-greet">
            <div className="hi">{dateStr}</div>
            <h3>안녕하세요, {name}님 👋</h3>
            <p>
              {data ? (
                <>
                  오늘 <b>통화 예약 {data.schedule.length}건</b>, <b>살펴볼 고객 {data.alerts_total}명</b>이 있습니다.
                </>
              ) : (
                '현황을 불러오는 중…'
              )}
            </p>
          </div>
          <div className="right">
            <button className="wh-btn wh-btn-ghost wh-btn-sm" type="button" onClick={() => void load()}>
              새로고침
            </button>
            <button className="wh-btn wh-btn-primary wh-btn-sm" type="button" onClick={() => router.push('/content/company-report')}>
              기업 리포트
            </button>
          </div>
        </div>

        <div className="dash-body">
          {error && (
            <div role="alert" style={{ padding: 14, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', marginBottom: 12 }}>
              대시보드를 불러오지 못했습니다: {error}{' '}
              <button className="wh-btn wh-btn-ghost wh-btn-sm" type="button" onClick={() => void load()}>
                다시 시도
              </button>
            </div>
          )}

          <div className="kpi-grid">
            {kpis.map((x) => (
              <div className="kpi" key={x.k}>
                <div className="head">{x.k}</div>
                <div className="v">
                  {x.v}
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>{x.unit}</span>
                </div>
                <div className={`d ${x.kind}`}>{x.d}</div>
              </div>
            ))}
          </div>

          <div className="dash-grid">
            <div className="dash-col">
              <div className="dcard">
                <div className="dcard-head">
                  <h4>
                    담당 AUM 추이 <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>· 최근 12개월 말 기준</span>
                  </h4>
                </div>
                <div className="dcard-body">
                  <div className="barchart">
                    {(data?.aum_trend ?? []).map((b) => (
                      <div className="bw" key={b.month} title={`${b.month}: ${won(b.aum).v}${won(b.aum).unit}`}>
                        <div className="bar" style={{ height: `${Math.max(2, (b.aum / maxAum) * 92)}%` }} />
                        <div className="bl">{b.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head">
                  <h4>주의가 필요한 고객{data && data.alerts_total > data.alerts.length ? ` (${data.alerts_total}명 중 ${data.alerts.length}명)` : ''}</h4>
                  <a className="link" onClick={() => router.push('/customer-management')}>
                    전체 보기 →
                  </a>
                </div>
                <div>
                  {data && data.alerts.length === 0 && (
                    <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>지금 살펴볼 고객이 없습니다.</div>
                  )}
                  {(data?.alerts ?? []).map((a, i) => (
                    <div className="alert-row" key={`${a.client_id}-${a.badge}-${i}`} onClick={() => router.push('/customer-management')}>
                      <span className="ava" style={{ background: AVA_COLORS[a.kind] }}>{(a.name || '?').slice(0, 1)}</span>
                      <span className="who">
                        <b>{a.name || '이름 없음'}</b>
                      </span>
                      <span className="msg">{a.message}</span>
                      <span className="act">
                        <span className={`wh-badge ${a.kind}`}>{a.badge}</span>
                        {chevron}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dash-col">
              <div className="dcard">
                <div className="dcard-head">
                  <h4>계좌 구성</h4>
                </div>
                <div className="dcard-body">
                  <div className="donut-wrap">
                    <div className="donut">
                      <svg width="148" height="148" viewBox="0 0 148 148">
                        <circle cx="74" cy="74" r="60" fill="none" stroke="#1C2740" strokeWidth="18" />
                        <g transform="rotate(-90 74 74)" fill="none" strokeWidth="18">
                          {segments.map((s) => (
                            <circle key={s.type} cx="74" cy="74" r="60" stroke={s.color} strokeDasharray={s.dash} strokeDashoffset={s.off} />
                          ))}
                        </g>
                      </svg>
                      <div className="center">
                        <b>{(k?.clients ?? 0).toLocaleString('ko-KR')}</b>
                        <small>총 고객</small>
                      </div>
                    </div>
                    <div className="donut-legend">
                      {segments.map((s) => (
                        <div className="dl-row" key={s.type}>
                          <span className="dot" style={{ background: s.color }} />
                          <span className="nm">{s.label}</span>
                          <span className="vv">{s.pct}%</span>
                          <span className="cnt">{s.count}계좌</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head">
                  <h4>오늘 일정</h4>
                </div>
                <div className="dcard-body">
                  <div className="sched">
                    {data && data.schedule.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>오늘 잡힌 통화 예약이 없습니다.</div>}
                    {(data?.schedule ?? []).map((s, i) => (
                      <div className="sched-row" key={`${s.time}-${i}`}>
                        <span className="time">{s.time}</span>
                        <span className="body">
                          <b>{s.title}</b>
                          <small>{s.sub}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head">
                  <h4>최근 활동</h4>
                </div>
                <div className="dcard-body">
                  <div className="feed">
                    {data && data.feed.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>최근 활동이 없습니다.</div>}
                    {(data?.feed ?? []).map((f, i) => (
                      <div className="feed-row" key={i}>
                        <span className="fi" style={{ background: FEED_STYLE[f.kind].bg, color: FEED_STYLE[f.kind].c }}>
                          {FEED_STYLE[f.kind].t}
                        </span>
                        <span className="ft">
                          {f.text}
                          <small>{ago(f.at)}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
