'use client';

import { Card } from '@/components/common/Card';

/** 아직 구현되지 않은 탭 자리 표시 (tasks_news_report.md 단계 표기) */
export function ComingSoon({ title, phase, desc }: { title: string; phase: string; desc: string }) {
  return (
    <Card>
      <div style={{ padding: '32px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{desc}</p>
        <span className="wh-badge">{phase} 개발 예정</span>
      </div>
    </Card>
  );
}

export default ComingSoon;
