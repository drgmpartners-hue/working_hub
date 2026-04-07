/**
 * 숫자를 천단위 콤마 포맷으로 변환 (만원 단위)
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return '-';
  return Math.round(value).toLocaleString('ko-KR');
}

/**
 * 문자열 숫자 입력값을 천단위 콤마 포맷으로 변환
 */
export function formatInputCurrency(raw: string): string {
  // 숫자와 콤마만 허용
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('ko-KR');
}

/**
 * 천단위 콤마가 포함된 문자열을 숫자로 변환
 */
export function parseCurrency(formatted: string): number {
  const digits = formatted.replace(/,/g, '');
  const num = Number(digits);
  return isNaN(num) ? 0 : num;
}
