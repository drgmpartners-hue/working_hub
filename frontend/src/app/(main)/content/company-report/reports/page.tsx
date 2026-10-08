'use client';

/**
 * 보고서 관리 (P4-10) — 반기별 진행 현황·일괄 출력·출력/발송 기록.
 * 매니저는 자기 목록의 기업, 대표는 전체(매니저별 개인 버전 진행도 함께). 대표 승인 절차는 없다(2026-10-01 결정):
 * 담당자가 [검토 완료]하면 바로 출력·고객 발송할 수 있다.
 * 검토 담당(2026-10-08): 대표가 기업마다 지정. 검토 담당이 [검토 완료]한 버전은 공식본이 되어 다른 담당자도 바로 보낸다.
 * 매주 월요일 검토 요청 알림은 검토 담당에게만 간다.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { ReportSendDialog } from '@/components/company-report/ReportSendDialog';
import { ErrorBox, SectionTitle, Spinner, fmtDate, inputStyle, mutedText } from '@/components/company-report/ui';
import { crDownload, crDownloadPost, crGet, crPut } from '@/lib/companyReportApi';
import { useAuthStore } from '@/stores/auth';

type Stage = 'none' | 'generating' | 'failed' | 'draft' | 'final';
interface Member {
  id: string;
  name: string;
  role?: string;
  reviewer?: boolean;
}
interface Row {
  company_id: string;
  company_name: string;
  listed: boolean;
  members: Member[];
  reviewers: Member[];
  official: { report_id: string; version: number; by_name?: string; at: string | null } | null;
  stage: Stage;
  generating: boolean;
  report: {
    id: string;
    status: 'draft' | 'final';
    version: number;
    mine: boolean;
    official: boolean;
    can_send: boolean;
    disputed: number;
    updated_at: string | null;
    exports: number;
    sends: number;
  } | null;
  others: { report_id: string; owner_user_id: string; owner_name?: string; status: string; version: number }[];
}
interface Overview {
  year: number;
  half: number;
  period_label: string;
  companies: Row[];
  counts: Partial<Record<Stage, number>>;
  doc_season: boolean;
  doc_period: { year: number; half: number; label: string };
}
interface ExportRow {
  id: string;
  report_id: string;
  version: number;
  format: 'pdf' | 'docx' | 'link' | 'zip';
  company_name: string;
  period_label: string;
  client_name: string | null;
  for_client: boolean;
  file_id: string | null;
  exported_by_name: string | null;
  exported_at: string | null;
}

const STAGE: Record<Stage, { label: string; cls: string }> = {
  none: { label: '아직 없음', cls: '' },
  generating: { label: '만드는 중', cls: 'info' },
  failed: { label: '실패', cls: 'neg' },
  draft: { label: '검토 중', cls: 'warn' },
  final: { label: '검토 완료', cls: 'pos' },
};
const FMT: Record<ExportRow['format'], string> = { pdf: 'PDF', docx: 'DOCX', link: '카톡 링크', zip: 'ZIP' };

function halves(): { year: number; half: number; label: string }[] {
  const now = new Date();
  let y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  let h = now.getMonth() >= 6 ? 1 : 2;
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push({ year: y, half: h, label: `${y}년 ${h === 1 ? '상반기' : '하반기'}` });
    if (h === 1) {
      y -= 1;
      h = 2;
    } else h = 1;
  }
  return out;
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '10px',
  fontSize: 13,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-soft)',
  verticalAlign: 'middle',
};

/** 대표 전용: 기업마다 검토 담당 고르기(그 기업을 추가한 사람 + 대표 본인) */
function ReviewerEditor({
  row,
  me,
  onSaved,
  onCancel,
}: {
  row: Row;
  me: { id: string; name: string };
  onSaved: (members: Member[], reviewers: Member[]) => void;
  onCancel: () => void;
}) {
  const cands = row.members.some((m) => m.id === me.id) ? row.members : [...row.members, { id: me.id, name: me.name }];
  const [sel, setSel] = useState<string[]>(row.reviewers.map((m) => m.id));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await crPut<{ members: Member[]; reviewers: Member[] }>(
        `/companies/${row.company_id}/report-reviewers`,
        { user_ids: sel },
      );
      onSaved(r.members, r.reviewers);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {cands.map((m) => (
          <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={sel.includes(m.id)}
              onChange={() => setSel((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}
            />
            {m.name}
            {m.id === me.id ? ' (나)' : ''}
          </label>
        ))}
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" disabled={saving} onClick={() => void save()}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" disabled={saving} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const options = useMemo(halves, []);
  const [pick, setPick] = useState(`${options[0].year}-${options[0].half}`);
  const [data, setData] = useState<Overview | null>(null);
  const [hist, setHist] = useState<ExportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<Stage | ''>('');
  const [tab, setTab] = useState<'status' | 'history'>('status');
  const [dialog, setDialog] = useState<{ id: string; title: string } | null>(null);
  const me = useAuthStore((st) => st.user);
  const isOwner = me?.role === 'owner';
  const [editRev, setEditRev] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const [year, half] = pick.split('-').map(Number);
    crGet<Overview>(`/reports-overview?year=${year}&half=${half}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setPicked([]);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [pick]);

  useEffect(() => {
    if (tab !== 'history' || hist) return;
    let alive = true;
    crGet<ExportRow[]>('/report-exports')
      .then((r) => alive && setHist(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [tab, hist]);

  const rows = (data?.companies || []).filter((r) => !stageFilter || r.stage === stageFilter);
  const readyIds = rows.filter((r) => r.report).map((r) => r.company_id);
  const allPicked = readyIds.length > 0 && readyIds.every((id) => picked.includes(id));

  const batch = async (fmt: 'pdf' | 'docx') => {
    if (!data || !picked.length) return;
    setBusy(true);
    setError(null);
    try {
      await crDownloadPost(
        '/reports/export-batch',
        { company_ids: picked, year: data.year, half: data.half, format: fmt },
        '반기보고서.zip',
      );
      setHist(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padding={16}>
        <SectionTitle
          right={
            <select
              aria-label="반기 선택"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}
            >
              {options.map((o) => (
                <option key={`${o.year}-${o.half}`} value={`${o.year}-${o.half}`}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        >
          보고서 관리
        </SectionTitle>
        <div style={{ ...mutedText, fontSize: 12, marginTop: -4 }}>
          반기 보고서는 1/31·7/31 새벽에 자동으로 만들어지고(기업마다 몇 분), 담당자가 기업 상세 &gt; 반기 보고서에서 고친 뒤
          [검토 완료]하면 출력·고객 발송을 할 수 있습니다. 기업마다 정한 <b>검토 담당</b>이 검토 완료한 버전은 공식본이 되어
          다른 담당자도 따로 검토하지 않고 고객에게 보낼 수 있습니다. 매주 월요일 검토 요청 알림은 검토 담당에게만 갑니다.
        </div>
        {data?.doc_season && (
          <div
            role="status"
            style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--warning-bg)', fontSize: 13 }}
          >
            {data.doc_period.label} 보고서 자료를 받을 때입니다. 기업마다 반기 보고서 탭의 &lsquo;자료 요청&rsquo; 체크리스트를 확인하세요.
          </div>
        )}
        {data && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            <button
              type="button"
              className={`wh-btn wh-btn-sm ${stageFilter === '' ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
              onClick={() => setStageFilter('')}
            >
              전체 {data.companies.length}
            </button>
            {(['final', 'draft', 'generating', 'failed', 'none'] as Stage[]).map((st) => (
              <button
                key={st}
                type="button"
                className={`wh-btn wh-btn-sm ${stageFilter === st ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
                onClick={() => setStageFilter(st)}
              >
                {STAGE[st].label} {data.counts[st] || 0}
              </button>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className={`wh-btn wh-btn-sm ${tab === 'status' ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
          onClick={() => setTab('status')}
        >
          진행 현황
        </button>
        <button
          type="button"
          className={`wh-btn wh-btn-sm ${tab === 'history' ? 'wh-btn-primary' : 'wh-btn-ghost'}`}
          onClick={() => setTab('history')}
        >
          출력·발송 기록
        </button>
      </div>
      <ErrorBox message={error} />

      {tab === 'status' ? (
        <Card padding={0}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
            <span style={{ ...mutedText, fontSize: 13 }}>{picked.length}곳 고름</span>
            <button
              type="button"
              className="wh-btn wh-btn-ghost wh-btn-sm"
              disabled={busy || !picked.length}
              onClick={() => void batch('pdf')}
            >
              {busy ? '만드는 중…' : 'PDF 한꺼번에(zip)'}
            </button>
            <button
              type="button"
              className="wh-btn wh-btn-ghost wh-btn-sm"
              disabled={busy || !picked.length}
              onClick={() => void batch('docx')}
            >
              DOCX 한꺼번에(zip)
            </button>
          </div>
          {data === null ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <div style={{ ...mutedText, padding: 24, textAlign: 'center' }}>
              {data.companies.length === 0 ? '목록에 기업이 없습니다. 투자기업 관리에서 먼저 기업을 추가하세요.' : '해당하는 기업이 없습니다.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label="완성된 보고서 모두 고르기"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? [] : readyIds)}
                      />
                    </th>
                    <th style={th}>기업</th>
                    <th style={th}>담당</th>
                    <th style={th}>단계</th>
                    <th style={th}>확인 필요</th>
                    <th style={th}>출력·발송</th>
                    <th style={th}>최근 수정</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.company_id}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          aria-label={`${r.company_name} 고르기`}
                          disabled={!r.report}
                          checked={picked.includes(r.company_id)}
                          onChange={() =>
                            setPicked((p) =>
                              p.includes(r.company_id) ? p.filter((x) => x !== r.company_id) : [...p, r.company_id],
                            )
                          }
                        />
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>
                        <Link href={`/content/company-report/companies/${r.company_id}?tab=report`}>{r.company_name}</Link>
                        {r.listed && (
                          <span className="wh-badge" style={{ marginLeft: 6, fontSize: 10 }}>
                            상장
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>
                        <div>{r.members.map((m) => m.name).join(', ') || '-'}</div>
                        <div style={{ marginTop: 2 }}>
                          {r.reviewers.length ? (
                            <span className="wh-badge info" style={{ fontSize: 10 }}>
                              검토 {r.reviewers.map((m) => m.name).join(', ')}
                            </span>
                          ) : (
                            <span style={{ ...mutedText, fontSize: 11 }}>검토 담당 없음</span>
                          )}
                          {isOwner && editRev !== r.company_id && (
                            <button
                              type="button"
                              className="wh-btn wh-btn-ghost wh-btn-sm"
                              style={{ marginLeft: 4, padding: '1px 6px', fontSize: 11 }}
                              onClick={() => setEditRev(r.company_id)}
                            >
                              검토 담당 지정
                            </button>
                          )}
                        </div>
                        {isOwner && me && editRev === r.company_id && (
                          <ReviewerEditor
                            row={r}
                            me={{ id: me.id, name: me.nickname || '대표' }}
                            onCancel={() => setEditRev(null)}
                            onSaved={(members, reviewers) => {
                              setData((d) =>
                                d && {
                                  ...d,
                                  companies: d.companies.map((x) => (x.company_id === r.company_id ? { ...x, members, reviewers } : x)),
                                },
                              );
                              setEditRev(null);
                            }}
                          />
                        )}
                      </td>
                      <td style={td}>
                        <span className={`wh-badge ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span>
                        {r.report && (
                          <span style={{ ...mutedText, fontSize: 11, marginLeft: 6 }}>
                            v{r.report.version}
                            {r.report.mine
                              ? ' 내 버전'
                              : r.report.official
                                ? ` 공식본${r.official?.by_name ? `(${r.official.by_name} 검토)` : ''}`
                                : ' 공용본'}
                          </span>
                        )}
                        {r.generating && r.stage !== 'generating' && (
                          <span style={{ ...mutedText, fontSize: 11, marginLeft: 6 }}>새 버전 만드는 중</span>
                        )}
                        {r.others.length > 0 && (
                          <div style={{ ...mutedText, fontSize: 11, marginTop: 2 }}>
                            {r.others
                              .map((o) => `${o.owner_name || '매니저'} v${o.version} ${o.status === 'final' ? '검토 완료' : '검토 중'}`)
                              .join(' · ')}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        {r.report ? (
                          r.report.disputed ? (
                            <b style={{ color: 'var(--warning)' }}>{r.report.disputed}개</b>
                          ) : (
                            '0'
                          )
                        ) : (
                          '-'
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {r.report ? `출력 ${r.report.exports} · 발송 ${r.report.sends}` : '-'}
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>{fmtDate(r.report?.updated_at ?? null, true)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {r.report && (
                          <>
                            <button
                              type="button"
                              className="wh-btn wh-btn-ghost wh-btn-sm"
                              disabled={busy}
                              onClick={() =>
                                void crDownload(`/reports/${r.report!.id}/export?format=pdf`, '보고서.pdf').catch(
                                  (e: Error) => setError(e.message),
                                )
                              }
                            >
                              PDF
                            </button>
                            {r.report.status === 'final' && r.report.can_send && (
                              <button
                                type="button"
                                className="wh-btn wh-btn-primary wh-btn-sm"
                                onClick={() =>
                                  setDialog({ id: r.report!.id, title: `${r.company_name} ${data.period_label} v${r.report!.version}` })
                                }
                              >
                                고객에게 보내기
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card padding={0}>
          {hist === null ? (
            <Spinner />
          ) : hist.length === 0 ? (
            <div style={{ ...mutedText, padding: 24, textAlign: 'center' }}>아직 출력·발송 기록이 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>시각</th>
                    <th style={th}>기업</th>
                    <th style={th}>반기</th>
                    <th style={th}>형식</th>
                    <th style={th}>고객</th>
                    <th style={th}>한 사람</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {hist.map((h) => (
                    <tr key={h.id}>
                      <td style={{ ...td, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(h.exported_at, true)}</td>
                      <td style={td}>{h.company_name}</td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {h.period_label} v{h.version}
                      </td>
                      <td style={td}>
                        <span className={`wh-badge ${h.format === 'link' ? 'info' : ''}`}>{FMT[h.format] || h.format}</span>
                      </td>
                      <td style={td}>{h.for_client ? h.client_name || '(다른 담당자 고객)' : '-'}</td>
                      <td style={{ ...td, fontSize: 12 }}>{h.exported_by_name || '-'}</td>
                      <td style={td}>
                        {h.file_id && (
                          <button
                            type="button"
                            className="wh-btn wh-btn-ghost wh-btn-sm"
                            onClick={() =>
                              void crDownload(`/db/files/${h.file_id}/download`, `보고서.${h.format}`).catch((e: Error) =>
                                setError(e.message),
                              )
                            }
                          >
                            파일
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {dialog && <ReportSendDialog reportId={dialog.id} title={dialog.title} mode="send" onClose={() => setDialog(null)} />}
    </div>
  );
}
