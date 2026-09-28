'use client';

/** 기업DB — 왼쪽 기업 폴더 트리(가나다순, 활성/비활성), 오른쪽 파일 목록 (기획 4장 ⑤, 7-2) */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/common/Card';
import { FileBrowser } from '@/components/company-report/FileBrowser';
import { fmtSize } from '@/components/company-report/types';
import { ErrorBox, Spinner, inputStyle, mutedText } from '@/components/company-report/ui';
import { crGet } from '@/lib/companyReportApi';

interface TreeCompany {
  id: string;
  name: string;
  folder_name: string;
  is_active: boolean;
  counts: Record<string, number>;
  total: number;
}
interface Tree {
  portfolio: { name: string; total: number };
  companies: TreeCompany[];
  storage: { bytes: number; files: number; persistent: boolean };
}

function DbInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sel = params.get('company') || (params.get('portfolio') ? '_portfolio' : '');
  const [tree, setTree] = useState<Tree | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    crGet<Tree>('/db/tree')
      .then(setTree)
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const choose = (id: string) => {
    if (!id) router.push(pathname);
    else if (id === '_portfolio') router.push(`${pathname}?portfolio=1`);
    else router.push(`${pathname}?company=${id}`);
  };

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (tree?.companies || []).filter((c) => !f || c.name.toLowerCase().includes(f) || c.folder_name.toLowerCase().includes(f));
  }, [tree, filter]);
  const active = list.filter((c) => c.is_active);
  const inactive = list.filter((c) => !c.is_active);
  const selected = tree?.companies.find((c) => c.id === sel);

  const Row = ({ id, label, count, muted }: { id: string; label: string; count: number; muted?: boolean }) => (
    <button
      type="button"
      onClick={() => choose(id)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        width: '100%',
        padding: '7px 10px',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        background: sel === id ? 'rgba(59,130,246,.15)' : 'transparent',
        color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: 13,
        textAlign: 'left',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {label}</span>
      <span style={{ ...mutedText, fontSize: 12 }}>{count}</span>
    </button>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'start' }} className="cr-db">
      <style>{`@media (max-width: 860px){ .cr-db{ grid-template-columns: 1fr !important; } }`}</style>
      <Card padding={12}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="기업 폴더 찾기" style={{ ...inputStyle, marginBottom: 8 }} aria-label="기업 폴더 찾기" />
        {!tree ? (
          <Spinner />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '70vh', overflowY: 'auto' }}>
            <Row id="" label="전체 파일" count={tree.companies.reduce((a, c) => a + c.total, 0) + tree.portfolio.total} />
            <Row id="_portfolio" label={tree.portfolio.name} count={tree.portfolio.total} />
            <div style={{ ...mutedText, fontSize: 11, padding: '8px 10px 2px' }}>활성 기업 {active.length}</div>
            {active.map((c) => (
              <Row key={c.id} id={c.id} label={c.folder_name} count={c.total} />
            ))}
            {inactive.length > 0 && <div style={{ ...mutedText, fontSize: 11, padding: '8px 10px 2px' }}>비활성 기업 {inactive.length}</div>}
            {inactive.map((c) => (
              <Row key={c.id} id={c.id} label={c.folder_name} count={c.total} muted />
            ))}
          </div>
        )}
        {tree && (
          <div style={{ ...mutedText, fontSize: 11, borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            저장소 {fmtSize(tree.storage.bytes)} · 파일 {tree.storage.files}개
            {!tree.storage.persistent && <div style={{ color: 'var(--warning)', marginTop: 4 }}>⚠ 영구 저장소(Volume)가 연결되지 않아 재배포 때 파일이 지워질 수 있습니다.</div>}
          </div>
        )}
      </Card>
      <div style={{ minWidth: 0 }}>
        <ErrorBox message={error} />
        {sel === '_portfolio' ? (
          <FileBrowser portfolio title="_포트폴리오 공통 (데일리·월간 브리핑)" onChanged={load} />
        ) : sel ? (
          <FileBrowser key={sel} companyId={sel} title={`${selected?.folder_name || ''} 폴더`} onChanged={load} />
        ) : (
          <FileBrowser title="전체 파일" onChanged={load} />
        )}
      </div>
    </div>
  );
}

export default function DbPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DbInner />
    </Suspense>
  );
}
