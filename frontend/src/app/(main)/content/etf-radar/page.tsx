'use client';

/**
 * 테마 ETF 추천&관리 (GM ETF Radar)
 * v1 = 리포트 제작 프로그램. 현재는 플레이스홀더이며, 기획 문서(docs/etf_report_manage)의
 * v1 Tasks에 따라 순차 구현 예정.
 */
export default function EtfRadarPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue-400)', margin: '0 0 8px' }}>
        테마 ETF 추천&관리
      </h1>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 20px' }}>
        테마 ETF 리서치 리포트를 반자동으로 생성하고, 발행 리포트의 시그널을 추적·관리하는 기능입니다.
      </p>
      <div style={{
        display: 'inline-block', padding: '10px 18px', borderRadius: 10,
        border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-card)',
        fontSize: 13, color: 'var(--text-muted)', fontWeight: 600,
      }}>
        🚧 준비 중 — 1차(리포트 제작) 개발 예정
      </div>
    </div>
  );
}
