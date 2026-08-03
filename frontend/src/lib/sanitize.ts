/**
 * HTML sanitize 헬퍼 — 외부(고객 포털 등)에 노출되는 화면에서
 * dangerouslySetInnerHTML로 렌더하는 모든 문자열은 반드시 이걸 거친다.
 * (AI 생성 코멘트에 직원 자유입력이 섞여 저장형 XSS가 가능했던 문제의 방어선)
 */
import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return '';   // SSR에서는 렌더하지 않음
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
    ALLOWED_ATTR: ['style', 'colspan', 'rowspan'],
  });
}
