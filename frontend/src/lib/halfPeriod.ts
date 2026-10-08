/**
 * 반기 표시 (2026-10-08) — 반기 보고서가 어느 기간 자료인지 날짜까지 보여 준다.
 * 상반기 1/1~6/30, 하반기 7/1~12/31.
 */
export function halfLabel(year: number, half: number): string {
  return `${year}년 ${half === 1 ? '상반기' : '하반기'}`;
}

/** 예: 2026.01.01 ~ 2026.06.30 */
export function halfRange(year: number, half: number): string {
  return half === 1 ? `${year}.01.01 ~ ${year}.06.30` : `${year}.07.01 ~ ${year}.12.31`;
}

/** 드롭다운용: 2026년 상반기 (1/1~6/30) */
export function halfOption(year: number, half: number): string {
  return `${halfLabel(year, half)} (${half === 1 ? '1/1~6/30' : '7/1~12/31'})`;
}

/** 날짜(YYYY-MM-DD)가 속한 반기 */
export function halfOf(iso: string): { year: number; half: number } | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return { year: Number(m[1]), half: Number(m[2]) <= 6 ? 1 : 2 };
}
