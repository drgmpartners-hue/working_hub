'use client';

/**
 * 기업 상세 > 반기 보고서 > 자료 요청 체크리스트 (P4-4).
 * 6월 말·12월 말에 자료 요청 문자가 가고, 담당자는 받은 자료를 여기서 표시한다.
 * 기업DB '03_자료'에 그 종류 문서가 올라오면 자동으로 '받음(자동)'.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { ErrorBox, SectionTitle, Spinner, fmtDate, inputStyle, mutedText } from '@/components/company-report/ui';
import { crGet, crPatch } from '@/lib/companyReportApi';

interface Item {
  key: string;
  label: string;
  done: boolean;
  manual: boolean;
  auto_files: string[];
  note: string;
  updated_at: string | null;
}
interface Checklist {
  year: number;
  half: number;
  period_label: string;
  items: Item[];
  done: number;
  total: number;
  requested_at: string | null;
  season: boolean;
}

export function DocRequestPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    crGet<Checklist>(`/companies/${companyId}/doc-requests`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setOpen((o) => (o === null ? d.season && d.done < d.total : o));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [companyId]);

  const save = async (key: string, body: { done?: boolean; note?: string }) => {
    if (!data) return;
    try {
      setData(
        await crPatch<Checklist>(
          `/companies/${companyId}/doc-requests?year=${data.year}&half=${data.half}`,
          { key, ...body },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && !data) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;
  return (
    <Card padding={16}>
      <SectionTitle
        right={
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? '접기' : '펼치기'}
          </button>
        }
      >
        자료 요청 — {data.period_label}{' '}
        <span className={`wh-badge ${data.done === data.total ? 'pos' : 'warn'}`} style={{ marginLeft: 6 }}>
          {data.done}/{data.total} 받음
        </span>
      </SectionTitle>
      {data.season && data.done < data.total && (
        <div
          role="status"
          style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--warning-bg)', fontSize: 13, marginBottom: 8 }}
        >
          보고서 자료를 받을 때입니다. 회사에 아래 자료를 요청하고, 받은 파일은 기업DB &lsquo;03_자료&rsquo;에 올려 주세요.
          {data.requested_at && ` (요청 알림 ${fmtDate(data.requested_at)})`}
        </div>
      )}
      <ErrorBox message={error} />
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.key} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <td style={{ padding: '6px 4px', width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label={`${it.label} 받음`}
                    checked={it.done}
                    disabled={it.done && !it.manual}
                    title={it.done && !it.manual ? '자료함에 올라온 문서로 자동 표시됨' : undefined}
                    onChange={(e) => void save(it.key, { done: e.target.checked })}
                  />
                </td>
                <td style={{ padding: '6px 4px' }}>
                  {it.label}
                  {it.auto_files.length > 0 && (
                    <div style={{ ...mutedText, fontSize: 11 }}>자료함: {it.auto_files.join(', ')}</div>
                  )}
                </td>
                <td style={{ padding: '6px 4px', width: '38%' }}>
                  <input
                    aria-label={`${it.label} 메모`}
                    placeholder="메모(예: 메일로 받음)"
                    defaultValue={it.note}
                    onBlur={(e) => e.target.value !== it.note && void save(it.key, { note: e.target.value })}
                    style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default DocRequestPanel;
