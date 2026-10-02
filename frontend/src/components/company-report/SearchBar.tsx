'use client';

/** 기업 리포트 공통 검색창 — 기업명 자동완성·최근 검색어. 기업 상세에서는 그 기업으로 필터 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { crGet } from '@/lib/companyReportApi';
import { loadJSON, saveJSON } from '@/lib/storage';

const RECENT_KEY = 'cr_recent_searches';

// 사용자·서버별 저장, 깨진 값은 비움(수정_tasks P2-6)
const isStrList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function readRecent(): string[] {
  return loadJSON<string[]>(RECENT_KEY, isStrList, RECENT_KEY) ?? [];
}

export function saveRecent(q: string) {
  saveJSON(RECENT_KEY, [q, ...readRecent().filter((x) => x !== q)].slice(0, 8));
}

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sugs, setSugs] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyMatch = pathname.match(/\/content\/company-report\/companies\/([0-9a-f-]{36})/);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setSugs([]);
      return;
    }
    timer.current = setTimeout(() => {
      crGet<{ id: string; name: string; is_active: boolean }[]>(`/search/suggest?q=${encodeURIComponent(q.trim())}`)
        .then(setSugs)
        .catch(() => setSugs([]));
    }, 200);
  }, [q]);

  const go = (text: string) => {
    const t = text.trim();
    if (!t) return;
    saveRecent(t);
    setOpen(false);
    const qs = new URLSearchParams({ q: t });
    if (companyMatch) qs.append('company', companyMatch[1]);
    router.push(`/content/company-report/search?${qs}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
      style={{ display: 'flex', gap: 8, position: 'relative' }}
      role="search"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={companyMatch ? '이 기업에서 검색' : '기업명·키워드 통합 검색'}
        aria-label="통합 검색"
        style={{
          width: 260,
          padding: '8px 12px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid var(--border)',
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
      <button type="submit" className="wh-btn wh-btn-ghost wh-btn-sm">
        검색
      </button>
      {open && (sugs.length > 0 || (!q && recent.length > 0)) && (
        <div
          style={{
            position: 'absolute',
            top: 42,
            left: 0,
            width: 260,
            zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.3)',
            padding: 4,
          }}
        >
          {sugs.length > 0 ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>기업</div>
              {sugs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/content/company-report/companies/${s.id}`);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, borderRadius: 6 }}
                >
                  {s.name} {!s.is_active && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(비활성)</span>}
                </button>
              ))}
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>최근 검색어</div>
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQ(r);
                    go(r);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, borderRadius: 6 }}
                >
                  {r}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </form>
  );
}

export default SearchBar;
