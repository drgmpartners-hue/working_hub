/**
 * 수익률 값을 '% 단위 숫자'로 맞춘다 (12 = 12%). 수정_tasks P1-18.
 *
 * 단위를 추측하지 않고 출처가 알려 주는 것만 따른다.
 * - 글자에 '%' 가 붙어 있으면 그 숫자 그대로 ("12%", "12.5 %" → 12, 12.5)
 * - Notion 숫자 속성이 '퍼센트' 형식이면 값이 소수(0.12)로 오므로 ×100
 * - 엑셀 셀이 % 서식이면 보이는 글자("12.00%")를 넘겨 받는다 → 첫 규칙
 * - 그 밖의 숫자는 이미 % 단위로 본다(화면·엑셀 머리글이 '(%)')
 */
export function toPercent(val: unknown, opts: { fraction?: boolean } = {}): number | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const num = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  if (Number.isNaN(num)) return null;
  const value = s.includes('%') ? num : opts.fraction ? num * 100 : num;
  return Math.round(value * 100) / 100;
}
