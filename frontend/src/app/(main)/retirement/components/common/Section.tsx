'use client';

/* ================================================================
   은퇴플랜 전 탭 공용 섹션 프레임
   ----------------------------------------------------------------
   '은퇴플랜 설계' 탭의 파란 헤더바 + 테두리 본문 구조를 표준으로 삼아
   은퇴플랜 · 연금수령 계획 · 투자흐름 탭에 동일하게 적용한다.
   (섹션 경계를 한눈에 구분하기 위한 것이므로 접기 기능은 두지 않는다.
    tab1의 현재/추천플랜처럼 이미 접기가 있는 곳은 right 슬롯으로 버튼을 넘긴다.)
   ================================================================ */

import type { CSSProperties, ReactNode } from 'react';

export const SEC_HEAD: CSSProperties = {
  background: 'linear-gradient(135deg, var(--blue-600) 0%, #2D5A8E 100%)',
  color: '#fff', padding: '14px 20px', borderRadius: '12px 12px 0 0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: '12px', fontWeight: 700, fontSize: '15px',
};

export const SEC_BODY: CSSProperties = {
  border: '1px solid var(--border-strong)', borderTop: 'none',
  borderRadius: '0 0 12px 12px', padding: '20px', backgroundColor: 'var(--bg-surface)',
};

/** 헤더 우측의 보조 설명 문구 (예: '현재플랜 vs 추천플랜', '단위: 원') */
export const SEC_NOTE: CSSProperties = {
  fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap',
};

interface SectionProps {
  title: ReactNode;
  /** 헤더 우측 슬롯 — 보조 문구, 토글, 초기화 버튼 등 */
  right?: ReactNode;
  /** 우측에 회색 보조 문구만 넣을 때 (right 보다 앞에 렌더링) */
  note?: ReactNode;
  id?: string;
  /** 루트 div 클래스 (tab2 인쇄 스타일 훅용) */
  className?: string;
  /** 헤더바 클래스 — tab2에서는 'no-print'를 넘겨 인쇄물 레이아웃을 유지한다 */
  headClassName?: string;
  /** false면 본문을 감추고 헤더 모서리를 전부 둥글게 (아코디언용) */
  open?: boolean;
  bodyStyle?: CSSProperties;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Section({
  title, right, note, id, className, headClassName, open = true, bodyStyle, style, children,
}: SectionProps) {
  return (
    <div id={id} className={className} style={style}>
      <div className={headClassName} style={open ? SEC_HEAD : { ...SEC_HEAD, borderRadius: '12px' }}>
        <span>{title}</span>
        {(note || right) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {note && <span style={SEC_NOTE}>{note}</span>}
            {right}
          </div>
        )}
      </div>
      {open && <div style={bodyStyle ? { ...SEC_BODY, ...bodyStyle } : SEC_BODY}>{children}</div>}
    </div>
  );
}

export default Section;
