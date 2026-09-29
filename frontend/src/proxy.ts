/**
 * 카톡 알림톡 [브리핑 보기] 버튼(승인된 v1 템플릿)의 주소는
 *   /content/company-report/briefing?date=#{날짜코드}  ·  ?month=#{월코드}
 * 로 고정돼 있다. 변수 자리에 날짜 대신 수신자별 열쇠값(날짜.수신자.만료일.서명)이 오면
 * 로그인 화면 대신 폰 전용 화면(/m/daily, /m/monthly)으로 보낸다. 보통 날짜(YYYY-MM-DD)는 그대로 통과.
 */
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const u = req.nextUrl;
  const d = u.searchParams.get('date') || '';
  const m = u.searchParams.get('month') || '';
  const kind = d.includes('.') ? 'daily' : m.includes('.') ? 'monthly' : null;
  if (!kind) return NextResponse.next();
  const url = u.clone();
  url.pathname = `/m/${kind}`;
  url.search = `?t=${encodeURIComponent(kind === 'daily' ? d : m)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/content/company-report/briefing'] };
