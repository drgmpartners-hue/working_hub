/**
 * 카톡 브리핑의 짧은 기사 링크: https://working-hub.vercel.app/r/{code}
 * 로그인 없이 백엔드로 넘기고, 백엔드가 원문 기사 주소로 보낸다.
 */
import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api-url';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const safe = (code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  const target = new URL(`${API_URL}/api/v1/company-report/r/${safe}`, req.url);
  return NextResponse.redirect(target, 302);
}
