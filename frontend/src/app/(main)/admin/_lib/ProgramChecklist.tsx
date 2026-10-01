'use client';

/** 매니저 사용 프로그램 고르기 (docs/login_logic P11). 메뉴 묶음별 체크박스 + [모두 선택]/[모두 해제]. */
import { PROGRAMS, PROGRAM_KEYS, programLabel } from '@/lib/programs';

const GROUPS = Array.from(new Set(PROGRAMS.map((p) => p.group)));

export function ProgramChecklist({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : PROGRAM_KEYS.filter((x) => x === k || value.includes(x)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
        사용할 프로그램 {value.length}/{PROGRAM_KEYS.length}
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => onChange([...PROGRAM_KEYS])}>모두 선택</button>
        <button type="button" className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => onChange([])}>모두 해제</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {GROUPS.map((g) => (
          <fieldset key={g} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px 10px', margin: 0 }}>
            <legend style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 4px' }}>{g}</legend>
            {PROGRAMS.filter((p) => p.group === g).map((p) => (
              <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--text-primary)', padding: '3px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={value.includes(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

/** 목록 칸에 보일 한 줄 요약 */
export function programSummary(allowed: string[] | null | undefined, isOwner: boolean): string {
  if (isOwner || allowed == null) return '전체';
  if (allowed.length === 0) return '없음';
  if (allowed.length === PROGRAM_KEYS.length) return '전체';
  const first = programLabel(allowed[0]);
  return allowed.length === 1 ? first : `${first} 외 ${allowed.length - 1}개`;
}
