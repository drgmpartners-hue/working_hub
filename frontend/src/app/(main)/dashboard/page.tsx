/**
 * 내 고객 관리 대시보드 — /dashboard
 * handoff 'dash' 샘플 구조 (KPI · AUM 추이 · 주의 고객 · 세그먼트 · 일정 · 활동).
 * ⚠️ 데이터는 샘플(플레이스홀더) — 추후 실데이터 연동 예정.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

/* ---------- sample data ---------- */
const KPIS = [
  { ic: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>), k: '관리 고객', v: '1,284', unit: '명', d: '▲ 이번 주 +8명', kind: 'up' },
  { ic: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>), k: '담당 AUM', v: '₩382.4', unit: '억', d: '▲ 2.4% 전월', kind: 'up' },
  { ic: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>), k: '평균 수익률', v: '+12.4', unit: '%', d: '▲ 1.8%p YTD', kind: 'up' },
  { ic: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>), k: '이번 달 신규 상담', v: '32', unit: '건', d: '▲ 18% 전월', kind: 'up' },
  { ic: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>), k: '처리 대기', v: '14', unit: '건', d: '어제 대비 −3건', kind: 'flat' },
];

const BARS = [
  { h: 52, l: '7' }, { h: 55, l: '8' }, { h: 51, l: '9' }, { h: 58, l: '10' },
  { h: 62, l: '11' }, { h: 60, l: '12' }, { h: 66, l: '1' }, { h: 64, l: '2' },
  { h: 71, l: '3' }, { h: 75, l: '4' }, { h: 80, l: '5' }, { h: 92, l: '6' },
];

const ALERTS = [
  { ava: '최', bg: '#F59E0B', name: '최은지', sub: 'Wrap 계좌', msg: <>자산배분이 목표 대비 <b>8%p 이탈</b> — 리밸런싱 검토 필요</>, badge: '리밸런싱', kind: 'warn' },
  { ava: '한', bg: '#EF4444', name: '한지우', sub: '대체투자', msg: <>평가손실 <b>−6.1%</b>, 위험 구간 진입 — 상담 권장</>, badge: '위험', kind: 'neg' },
  { ava: '김', bg: '#38BDF8', name: '김도현', sub: '채권형 펀드', msg: <>상품 <b>만기 D-5</b> — 재투자 상담 일정 필요</>, badge: '만기 임박', kind: 'info' },
  { ava: '송', bg: '#A78BFA', name: '송지아', sub: 'ETF 포트폴리오', msg: <>최근 <b>90일 미접촉</b> — 정기 점검 연락 권장</>, badge: '연락 필요', kind: 'warn' },
];

const SEGMENTS = [
  { seg: 'VIP', color: '#38BDF8', pct: '12%', cnt: '154명', dash: '45.2 331.8', off: '0' },
  { seg: '우량', color: '#2563EB', pct: '28%', cnt: '360명', dash: '105.6 271.4', off: '-45.2' },
  { seg: '일반', color: '#64748B', pct: '44%', cnt: '564명', dash: '165.9 211.1', off: '-150.8' },
  { seg: '신규', color: '#10B981', pct: '16%', cnt: '206명', dash: '60.3 316.7', off: '-316.7' },
];

const SCHEDULE = [
  { t: '10:00', b: '김서연 고객 분기 리뷰', s: '강남센터 3F 상담실 · 대면' },
  { t: '13:30', b: '박준호 신규 Wrap 가입 상담', s: '화상 미팅' },
  { t: '15:00', b: '포트폴리오 리밸런싱 검토', s: '대상 3건 · 승인 대기' },
  { t: '17:00', b: '증권사 수당정산 마감 확인', s: 'D-3' },
];

const FEED = [
  { bg: 'rgba(16,185,129,.12)', c: '#10B981', icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.2-8.5" /><path d="M22 4L12 14.01l-3-3" /></svg>), ft: <><b>이도윤</b> 고객 포트폴리오 리밸런싱 완료</>, time: '12분 전' },
  { bg: 'rgba(56,189,248,.12)', c: '#38BDF8', icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="5 12 12 19 19 12" /></svg>), ft: <><b>최은지</b> 고객 ₩1.2억 추가 입금</>, time: '1시간 전' },
  { bg: 'rgba(37,99,235,.14)', c: '#3B82F6', icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>), ft: <>‘AI 반도체’ 추천 리포트 발행</>, time: '3시간 전' },
  { bg: 'rgba(167,139,250,.14)', c: '#A78BFA', icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>), ft: <>신규 고객 <b>윤하늘</b> 등록 완료</>, time: '어제' },
];

const chevron = (<svg className="go-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle' }}><polyline points="9 18 15 12 9 6" /></svg>);

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');

  const name = user?.nickname || user?.email?.split('@')[0] || '어드바이저';
  const today = new Date();
  const dateStr = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(today);

  return (
    <div>
      <div className="block-head" style={{ paddingTop: 0 }}>
        <span className="section-tag">Dashboard</span>
        <h2>내 고객 관리 대시보드</h2>
        <p>담당 고객 현황을 한눈에 확인하세요. <span style={{ color: 'var(--text-muted)' }}>(샘플 데이터 — 실데이터 연동 예정)</span></p>
      </div>

      <div className="dash-shell">
        {/* Head */}
        <div className="dash-head">
          <div className="dash-greet">
            <div className="hi">{dateStr}</div>
            <h3>안녕하세요, {name}님 👋</h3>
            <p>오늘 <b>예약 미팅 3건</b>, <b>조치가 필요한 고객 4명</b>이 있습니다.</p>
          </div>
          <div className="right">
            <div className="period">
              <button className={period === 'today' ? 'active' : ''} onClick={() => setPeriod('today')}>오늘</button>
              <button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>이번 주</button>
              <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>이번 달</button>
            </div>
            <button className="wh-btn wh-btn-primary wh-btn-sm" type="button" onClick={() => router.push('/content/etf-radar')}>테마 ETF 리포트</button>
          </div>
        </div>

        <div className="dash-body">
          {/* KPI */}
          <div className="kpi-grid">
            {KPIS.map((k) => (
              <div className="kpi" key={k.k}>
                <div className="head"><span className="ic">{k.ic}</span>{k.k}</div>
                <div className="v">{k.v}<span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>{k.unit}</span></div>
                <div className={`d ${k.kind}`}>{k.d}</div>
              </div>
            ))}
          </div>

          {/* main grid */}
          <div className="dash-grid">
            {/* LEFT */}
            <div className="dash-col">
              <div className="dcard">
                <div className="dcard-head">
                  <h4>담당 AUM 추이 <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>· 최근 12개월</span></h4>
                  <a className="link">자세히 →</a>
                </div>
                <div className="dcard-body">
                  <div className="barchart">
                    {BARS.map((b, i) => (
                      <div className="bw" key={i}><div className="bar" style={{ height: `${b.h}%` }} /><div className="bl">{b.l}</div></div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head">
                  <h4>주의가 필요한 고객</h4>
                  <a className="link" onClick={() => router.push('/customer-management')}>전체 보기 →</a>
                </div>
                <div>
                  {ALERTS.map((a) => (
                    <div className="alert-row" key={a.name} onClick={() => router.push('/customer-management')}>
                      <span className="ava" style={{ background: a.bg }}>{a.ava}</span>
                      <span className="who"><b>{a.name}</b><small>{a.sub}</small></span>
                      <span className="msg">{a.msg}</span>
                      <span className="act"><span className={`wh-badge ${a.kind}`}>{a.badge}</span>{chevron}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div className="dash-col">
              <div className="dcard">
                <div className="dcard-head"><h4>고객 세그먼트</h4></div>
                <div className="dcard-body">
                  <div className="donut-wrap">
                    <div className="donut">
                      <svg width="148" height="148" viewBox="0 0 148 148">
                        <circle cx="74" cy="74" r="60" fill="none" stroke="#1C2740" strokeWidth="18" />
                        <g transform="rotate(-90 74 74)" fill="none" strokeWidth="18">
                          {SEGMENTS.map((s) => (
                            <circle key={s.seg} cx="74" cy="74" r="60" stroke={s.color} strokeDasharray={s.dash} strokeDashoffset={s.off} />
                          ))}
                        </g>
                      </svg>
                      <div className="center"><b>1,284</b><small>총 고객</small></div>
                    </div>
                    <div className="donut-legend">
                      {SEGMENTS.map((s) => (
                        <div className="dl-row" key={s.seg}><span className="dot" style={{ background: s.color }} /><span className="nm">{s.seg}</span><span className="vv">{s.pct}</span><span className="cnt">{s.cnt}</span></div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head"><h4>오늘 일정</h4><a className="link">캘린더 →</a></div>
                <div className="dcard-body">
                  <div className="sched">
                    {SCHEDULE.map((s) => (
                      <div className="sched-row" key={s.t}><span className="time">{s.t}</span><span className="body"><b>{s.b}</b><small>{s.s}</small></span></div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dcard">
                <div className="dcard-head"><h4>최근 활동</h4></div>
                <div className="dcard-body">
                  <div className="feed">
                    {FEED.map((f, i) => (
                      <div className="feed-row" key={i}><span className="fi" style={{ background: f.bg, color: f.c }}>{f.icon}</span><span className="ft">{f.ft}<small>{f.time}</small></span></div>
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
