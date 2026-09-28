'use client';

/** 기업 리포트 관리자 — 처음 지정(아직 없을 때) · 추가·해제(관리자만) */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/common/Card';
import { crGet, crPost, crPut } from '@/lib/companyReportApi';
import type { CrMe } from '@/lib/useCrMe';
import { ErrorBox, SectionTitle, inputStyle, mutedText } from './ui';

interface AdminRow {
  user_id: string;
  name: string;
  email: string;
  superuser: boolean;
}
interface Staff {
  ref_id: string;
  name: string;
  detail: string;
}

export function AdminCard({ me, onChanged }: { me: CrMe | null; onChanged: () => void }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([crGet<AdminRow[]>('/admins'), crGet<{ staff: Staff[] }>('/recipients')]);
      setAdmins(a);
      setStaff(r.staff);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, me?.is_admin]);

  const claim = async () => {
    try {
      await crPost('/admins/claim');
      onChanged();
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (ids: string[]) => {
    try {
      await crPut('/admins', { user_ids: ids });
      setPick('');
      void load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const listed = admins.filter((a) => !a.superuser).map((a) => a.user_id);

  if (me && !me.is_admin && me.can_claim) {
    return (
      <Card padding={16}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', color: 'var(--warning)', fontSize: 14 }}>
          <span>
            기업 리포트 관리자가 아직 없습니다. 관리자는 발송 켜기·수신자 지정·브리핑 승인·기업 완전 삭제를 할 수 있습니다.
          </span>
          <button type="button" className="wh-btn wh-btn-primary wh-btn-sm" onClick={() => void claim()}>
            내 계정을 관리자로 지정
          </button>
        </div>
        <ErrorBox message={error} />
      </Card>
    );
  }
  if (!me?.is_admin) {
    return (
      <Card padding={16}>
        <div style={mutedText}>
          설정 변경은 기업 리포트 관리자만 할 수 있습니다. 관리자: {admins.map((a) => a.name).join(', ') || '-'}
        </div>
      </Card>
    );
  }
  return (
    <Card padding={16}>
      <SectionTitle>기업 리포트 관리자</SectionTitle>
      <ErrorBox message={error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {admins.map((a) => (
          <span key={a.user_id} className="wh-badge info" style={{ fontSize: 13 }}>
            {a.name}
            {a.superuser && ' (시스템 관리자)'}
            {!a.superuser && a.user_id !== me.id && (
              <button
                type="button"
                aria-label={`${a.name} 관리자 해제`}
                onClick={() => void save(listed.filter((x) => x !== a.user_id))}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="관리자로 추가할 직원">
          <option value="">+ 관리자 추가</option>
          {staff
            .filter((s) => !admins.some((a) => a.user_id === s.ref_id))
            .map((s) => (
              <option key={s.ref_id} value={s.ref_id}>
                {s.name} ({s.detail})
              </option>
            ))}
        </select>
        {pick && (
          <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => void save([...listed, pick])}>
            추가
          </button>
        )}
      </div>
    </Card>
  );
}

export default AdminCard;
