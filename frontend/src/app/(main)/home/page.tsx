/**
 * 메인 홈 (로그인 후, 상단 네비 '메인') — /home
 * 공개 랜딩(/)과 동일한 PASONA 흐름 + 미래공학 다크 테마.
 * CTA/카드는 내부 라우트로 연결 (로그인 사용자용).
 */
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth';

/* ---------- icons ---------- */
const I = {
  scatter: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>),
  clock: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  calc: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h8M8 14h2M8 18h2M14 14h2v4h-2z" /></svg>),
  alert: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>),
  hub: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" /></svg>),
  bolt: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>),
  spark: (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>),
  users: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>),
  grid: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>),
  chart: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 3v18h18" /><path d="M7 14l3-3 4 4 5-6" /></svg>),
  gear: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>),
  receipt: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>),
  doc: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>),
  shield: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>),
  trend: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>),
  image: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>),
  arrow: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>),
};

const PROBLEMS = [
  { ic: I.scatter, t: '도구가 흩어져 있다', d: '엑셀·메신저·증권사 HTS·노션을 하루 종일 오가며 같은 데이터를 옮겨 적습니다.' },
  { ic: I.calc, t: '정산은 매번 수작업', d: 'Dr.GM·증권사 수당을 손으로 계산하고 또 검산합니다. 한 번의 실수가 신뢰를 흔듭니다.' },
  { ic: I.clock, t: '콘텐츠 만들 시간이 없다', d: '고객 보고서·카드뉴스를 만들려면 야근. 정작 영업·상담 시간이 줄어듭니다.' },
  { ic: I.alert, t: '데이터에 즉답 못 한다', d: '"제 수익률 어때요?" 질문에 자료를 뒤지느라 즉시 답하지 못합니다.' },
];

const SOLUTIONS = [
  { ic: I.hub, t: '하나로 통합된 데이터', d: '고객·계좌·포트폴리오가 한곳에. 입력 한 번이면 분석·보고서·포털까지 자동 연결됩니다.' },
  { ic: I.bolt, t: '정산·분석 자동화', d: '엑셀 업로드만으로 수당이 계산되고, 수익률·순자산 추이가 즉시 시각화됩니다.' },
  { ic: I.spark, t: '원클릭 콘텐츠 & 포털', d: 'AI로 보고서·카드뉴스를 생성하고, 고객에게 상시조회·변경제안 링크를 바로 발송합니다.' },
];

const PROGRAMS = [
  { ic: I.users, t: '고객 정보 관리', d: '프로필·계좌·고유번호', href: '/customer-management' },
  { ic: I.grid, t: '증권사 상품 관리', d: '상품 마스터', href: '/portfolio/product-master' },
  { ic: I.chart, t: '투자상품 관리', d: '상품 등록·관리', href: '/data-management/wrap-accounts' },
  { ic: I.doc, t: '투자 상품 관리기', d: '수익률·리밸런싱', href: '/portfolio/irp' },
  { ic: I.gear, t: 'Dr.GM 수당정산', d: '자동 계산', href: '/commission/dr-gm' },
  { ic: I.receipt, t: '증권사 수당정산', d: '정산·검증', href: '/commission/securities' },
  { ic: I.shield, t: '은퇴플랜 관리', d: '현금흐름 설계', href: '/retirement' },
  { ic: I.trend, t: '주식·ETF 추천', d: 'AI 추천', href: '/investment/stock-recommend' },
  { ic: I.image, t: '콘텐츠 제작', d: '카드뉴스·보고서', href: '/content/card-news' },
];

const STATS = [
  { n: '40%↓', l: '반복 업무 시간 절감' },
  { n: '9', l: '통합 업무 프로그램' },
  { n: '1-Click', l: '보고서·콘텐츠 생성' },
  { n: '24/7', l: '고객 상시조회 포털' },
];

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const name = user?.nickname || user?.email?.split('@')[0] || '';

  return (
    <div className="wh-page">
      {/* ===== HERO ===== */}
      <section className="hero" style={{ borderRadius: 0 }}>
        <div className="hero-bg">
          <video autoPlay muted loop playsInline preload="auto" poster="/brand/hero-poster.png">
            <source src="/brand/hero.mp4" type="video/mp4" />
          </video>
          <div className="ov-glow" />
          <div className="ov-grad" />
          <div className="ov-vig" />
        </div>
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="section-tag eyebrow">Working Hub · 어드바이저 워크스페이스</span>
            <h1>흩어진 업무 도구,<br /><span className="grad">하나로 끝내다.</span></h1>
            <p>고객 관리·포트폴리오 분석·수당 정산·콘텐츠 제작을 하나로 연결합니다. 도구를 오가는 시간을 없애 가장 잘하는 일에 집중하세요{name ? `, ${name}님` : ''}.</p>
            <div className="hero-cta">
              <button className="wh-btn wh-btn-primary" type="button" onClick={() => router.push('/dashboard')}>대시보드로 이동 {I.arrow}</button>
              <button className="wh-btn wh-btn-ghost" type="button" onClick={() => router.push('/portfolio/irp')}>업무 시작하기</button>
            </div>
            <div className="hero-values">
              <div className="hv"><span className="ic">{I.clock}</span><span className="tx"><b>업무시간 40%↓</b><span>정산·리포트 자동화</span></span></div>
              <div className="hv"><span className="ic">{I.trend}</span><span className="tx"><b>데이터 기반 제안</b><span>수익률·리밸런싱</span></span></div>
              <div className="hv"><span className="ic">{I.shield}</span><span className="tx"><b>고객 신뢰</b><span>상시조회·정산 추적</span></span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PROBLEM ===== */}
      <section className="lp-section lp-center">
        <div className="block-head">
          <span className="section-tag">Problem</span>
          <h2>혹시, 이런 적 없으신가요?</h2>
          <p>어드바이저의 하루는 상담보다 ‘업무 처리’로 더 바쁩니다.</p>
        </div>
        <div className="lp-grid c4">
          {PROBLEMS.map((p) => (
            <div className="lp-card" key={p.t}>
              <div className="ic">{p.ic}</div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== AGITATION ===== */}
      <section className="lp-section tight lp-center">
        <span className="section-tag" style={{ marginBottom: 'var(--sp-5)' }}>Why it matters</span>
        <p className="lp-agitate">
          반복 업무에 묶이는 시간은 결국 <span className="hl">고객에게서 뺏는 시간</span>입니다.<br />
          정산 실수 한 번은 신뢰를 무너뜨리고, 느린 응대는 고객을 떠나게 합니다.
        </p>
      </section>

      {/* ===== SOLUTION ===== */}
      <section className="lp-section lp-center">
        <div className="block-head">
          <span className="section-tag">Solution</span>
          <h2>Working Hub가 반복을 대신합니다.</h2>
          <p>흩어진 도구를 하나로 잇고, 손이 가던 일을 자동으로 처리합니다.</p>
        </div>
        <div className="lp-grid c3">
          {SOLUTIONS.map((s) => (
            <div className="lp-card" key={s.t}>
              <div className="ic">{s.ic}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== PROGRAMS ===== */}
      <section className="lp-section lp-center">
        <div className="block-head">
          <span className="section-tag">Programs</span>
          <h2>업무 프로그램</h2>
          <p>9개의 업무 프로그램이 하나의 워크스페이스로 연결됩니다. 카드를 선택해 바로 진입하세요.</p>
        </div>
        <div className="lp-grid c3">
          {PROGRAMS.map((p) => (
            <Link className="lp-prog" key={p.t} href={p.href}>
              <span className="pic">{p.ic}</span>
              <span><b>{p.t}</b><small>{p.d}</small></span>
            </Link>
          ))}
        </div>
      </section>

      {/* ===== NARROWING ===== */}
      <section className="lp-section tight lp-center">
        <div className="block-head">
          <span className="section-tag">Why Working Hub</span>
          <h2>숫자로 증명되는 효율</h2>
        </div>
        <div className="lp-grid c4">
          {STATS.map((s) => (
            <div className="lp-stat" key={s.l}>
              <div className="n">{s.n}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== ACTION (CTA) ===== */}
      <section className="lp-section">
        <div className="lp-cta">
          <h2>오늘 업무, 더 가볍게 시작하세요.</h2>
          <p>담당 고객 현황은 대시보드에서, 포트폴리오 분석은 투자 상품 관리기에서.</p>
          <div className="row">
            <button className="wh-btn wh-btn-primary" type="button" onClick={() => router.push('/dashboard')}>대시보드로 이동 {I.arrow}</button>
            <button className="wh-btn wh-btn-ghost" type="button" onClick={() => router.push('/portfolio/irp')}>투자 상품 관리기</button>
          </div>
        </div>
      </section>
      <div style={{ height: 'var(--sp-12)' }} />
    </div>
  );
}
