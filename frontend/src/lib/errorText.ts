/**
 * 서버 오류(detail)를 사람이 읽는 한국어 문장으로.
 *
 * FastAPI 는 입력값 검사(422)에 실패하면 detail 을 '목록'으로 보낸다:
 *   [{ loc: ['body', 'savings_period'], msg: 'Input should be greater than or equal to 1', type: 'greater_than_equal', ctx: { ge: 1 } }]
 * 이걸 그대로 String() 하면 "[object Object]" 가 된다(2026-10-26 은퇴플랜 저장 오류). 여기서 한 줄씩 풀어 준다.
 * 비어 있으면 '' — 호출하는 쪽에서 `errorText(x) || '저장 실패'` 처럼 기본 문구를 붙인다.
 */

/** 자주 쓰는 입력칸 이름(서버 필드 → 화면 이름). 없는 필드는 영문 이름 그대로. */
export const FIELD_LABELS: Record<string, string> = {
  monthly_desired_amount: '월 연금액',
  retirement_age: '희망 은퇴나이',
  desired_retirement_age: '희망 은퇴나이',
  current_age: '현재 나이(고객 생년월일)',
  plan_start_age: '플랜 시작 나이',
  savings_period: '적립기간',
  savings_period_years: '적립기간',
  holding_period_years: '거치기간',
  annual_savings: '연 적립액',
  annual_savings_amount: '연 적립액',
  retirement_period_years: '연금 수령 기간',
  inflation_rate: '물가상승률',
  pension_return_rate: '연금수익률',
  expected_return_rate: '투자수익률',
  existing_return_rate: '현재플랜 투자수익률',
  recommended_return_rate: '추천플랜 투자수익률',
  recommended_pension_rate: '추천플랜 연금수익률',
  plan_start_year: '플랜 시작연도',
  email: '이메일',
  password: '비밀번호',
  name: '이름',
  phone: '휴대폰 번호',
  birth_date: '생년월일',
};

type Item = { loc?: unknown[]; msg?: unknown; type?: unknown; ctx?: Record<string, unknown>; input?: unknown };

function fieldName(loc: unknown[] | undefined): string {
  if (!Array.isArray(loc)) return '';
  const parts = loc.filter((p) => p !== 'body' && p !== 'query' && p !== 'path' && typeof p !== 'number');
  const last = String(parts[parts.length - 1] ?? '');
  return FIELD_LABELS[last] ?? last;
}

function reason(it: Item): string {
  const c = it.ctx ?? {};
  switch (it.type) {
    case 'missing': return '값이 비어 있습니다';
    case 'greater_than_equal': return `${c.ge} 이상이어야 합니다`;
    case 'greater_than': return `${c.gt}보다 커야 합니다(0이나 빈칸은 안 됩니다)`;
    case 'less_than_equal': return `${c.le} 이하여야 합니다`;
    case 'less_than': return `${c.lt}보다 작아야 합니다`;
    case 'int_parsing':
    case 'int_type': return '정수(숫자)로 입력해야 합니다';
    case 'int_from_float': return '소수점 없는 정수여야 합니다';
    case 'float_parsing':
    case 'float_type': return '숫자로 입력해야 합니다';
    case 'string_too_long': return `${c.max_length}자 이하로 입력해야 합니다`;
    case 'string_too_short': return `${c.min_length}자 이상 입력해야 합니다`;
    case 'value_error': return String(it.msg ?? '').replace(/^Value error, /, '');
    default: return typeof it.msg === 'string' ? it.msg : '형식이 맞지 않습니다';
  }
}

export function errorText(detail: unknown): string {
  if (detail == null || detail === '') return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const lines = detail.map((d) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        const it = d as Item;
        const f = fieldName(it.loc);
        return f ? `${f}: ${reason(it)}` : reason(it);
      }
      return String(d);
    }).filter(Boolean);
    return lines.length > 1 ? `입력값을 확인해 주세요\n${lines.map((l) => `• ${l}`).join('\n')}` : lines[0] ?? '';
  }
  if (typeof detail === 'object') {
    const o = detail as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.msg === 'string') return o.msg;
    if ('detail' in o) return errorText(o.detail);
    try { return JSON.stringify(detail); } catch { return ''; }
  }
  return String(detail);
}
