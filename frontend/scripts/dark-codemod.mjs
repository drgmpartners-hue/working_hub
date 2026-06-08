/**
 * Dark theme codemod — 속성 인지형(property-aware) 인라인 색상 → 디자인 토큰 치환.
 *
 * 사용: node scripts/dark-codemod.mjs <file1> <file2> ...
 *
 * 원칙: '디자인 토큰 시트'를 철저히 따른다 — 모든 색은 :root 토큰 변수로 치환.
 *  - `KEY: '값'` 형태의 JS 스타일 속성만 대상 (JSX 속성 stroke="..."/fill="..." 은 미대상).
 *  - background/backgroundColor → 배경/표면/시맨틱-bg/솔리드, color → 텍스트/시맨틱, border/outline → 보더/시맨틱-보더.
 *  - 스타일 객체의 fill/stroke → 차트 안전을 위해 건드리지 않음.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* 시맨틱 솔리드(텍스트/솔리드 배경/보더 공통) */
const SEMANTIC = {
  // danger
  '#ef4444': 'var(--danger)', '#dc2626': 'var(--danger)', '#b91c1c': 'var(--danger)',
  '#e53e3e': 'var(--danger)', '#f87171': 'var(--danger)', '#d32f2f': 'var(--danger)', '#c53030': 'var(--danger)',
  // success
  '#10b981': 'var(--success)', '#059669': 'var(--success)', '#16a34a': 'var(--success)',
  '#22c55e': 'var(--success)', '#15803d': 'var(--success)', '#047857': 'var(--success)', '#2f855a': 'var(--success)',
  // warning
  '#f59e0b': 'var(--warning)', '#d97706': 'var(--warning)', '#ca8a04': 'var(--warning)',
  '#b45309': 'var(--warning)', '#92400e': 'var(--warning)', '#eab308': 'var(--warning)',
  // blue (info/action)
  '#3b82f6': 'var(--blue-400)', '#2563eb': 'var(--blue-500)', '#1d4ed8': 'var(--blue-600)',
  '#4a90d9': 'var(--blue-400)', '#60a5fa': 'var(--blue-400)', '#1e40af': 'var(--blue-600)',
};

const BG = {
  // 표면 단계
  '#fff': 'var(--bg-card)', '#ffffff': 'var(--bg-card)',
  '#f9fafb': 'var(--bg-surface)', '#f5f7fa': 'var(--bg-surface)', '#fafbfc': 'var(--bg-surface)',
  '#f3f4f6': 'var(--bg-surface)', '#f8fafc': 'var(--bg-surface)', '#f8fafb': 'var(--bg-surface)', '#fcfcfd': 'var(--bg-surface)',
  '#eef2f7': 'var(--bg-card-2)', '#f1f5f9': 'var(--bg-card-2)', '#f0f2f5': 'var(--bg-card-2)',
  '#1e3a5f': 'var(--blue-600)',
  // 시맨틱 연한 배경(tint)
  '#fef2f2': 'var(--danger-bg)', '#fee2e2': 'var(--danger-bg)', '#fecaca': 'var(--danger-bg)',
  '#fff5f5': 'var(--danger-bg)', '#fdf2f2': 'var(--danger-bg)', '#fde8e8': 'var(--danger-bg)', '#fef1f1': 'var(--danger-bg)',
  '#fffbeb': 'var(--warning-bg)', '#fef3c7': 'var(--warning-bg)', '#fffaf0': 'var(--warning-bg)', '#fefce8': 'var(--warning-bg)', '#fdf6e3': 'var(--warning-bg)',
  '#f0fdf4': 'var(--success-bg)', '#ecfdf5': 'var(--success-bg)', '#d1fae5': 'var(--success-bg)', '#dcfce7': 'var(--success-bg)', '#f0fff4': 'var(--success-bg)',
  '#eff6ff': 'rgba(56,189,248,0.12)', '#dbeafe': 'rgba(56,189,248,0.16)', '#ebf5f5': 'rgba(56,189,248,0.10)', '#e0f2fe': 'rgba(56,189,248,0.14)',
  ...SEMANTIC, // 솔리드 시맨틱 배경
};

const TEXT = {
  '#1a1a2e': 'var(--text-primary)', '#111827': 'var(--text-primary)', '#1f2937': 'var(--text-primary)',
  '#0f172a': 'var(--text-primary)', '#1e293b': 'var(--text-primary)', '#0b1220': 'var(--text-primary)',
  '#374151': 'var(--text-secondary)', '#4b5563': 'var(--text-secondary)', '#334155': 'var(--text-secondary)', '#475569': 'var(--text-secondary)',
  '#6b7280': 'var(--text-muted)', '#9ca3af': 'var(--text-muted)', '#64748b': 'var(--text-muted)',
  '#94a3b8': 'var(--text-muted)', '#9aa7bd': 'var(--text-muted)', '#a0aec0': 'var(--text-muted)',
  '#1e3a5f': 'var(--blue-400)',
  ...SEMANTIC, // 시맨틱 텍스트
};

const BORDER_TINT = {
  '#fecaca': 'rgba(239,68,68,0.35)', '#fca5a5': 'rgba(239,68,68,0.35)', '#fee2e2': 'rgba(239,68,68,0.3)', '#f8b4b4': 'rgba(239,68,68,0.35)',
  '#fde68a': 'rgba(245,158,11,0.35)', '#fcd34d': 'rgba(245,158,11,0.35)', '#fef3c7': 'rgba(245,158,11,0.3)',
  '#a7f3d0': 'rgba(16,185,129,0.35)', '#86efac': 'rgba(16,185,129,0.35)', '#bbf7d0': 'rgba(16,185,129,0.3)', '#6ee7b7': 'rgba(16,185,129,0.35)',
  '#bfdbfe': 'rgba(56,189,248,0.35)', '#93c5fd': 'rgba(56,189,248,0.35)',
};
const BORDER = {
  '#e1e5eb': 'var(--border)', '#e5e7eb': 'var(--border)', '#f3f4f6': 'var(--border)',
  '#eef2f7': 'var(--border)', '#f1f5f9': 'var(--border)', '#e2e8f0': 'var(--border)', '#edf2f7': 'var(--border)',
  '#d1d5db': 'var(--border-strong)', '#cbd5e1': 'var(--border-strong)', '#9ca3af': 'var(--border-strong)',
  '#1e3a5f': 'var(--blue-500)',
  ...BORDER_TINT,
  ...SEMANTIC, // 솔리드 시맨틱 보더
};

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function mapValue(value, table) {
  return value.replace(HEX, (h) => table[h.toLowerCase()] ?? h);
}

function categoryFor(key) {
  const k = key.toLowerCase();
  if (k === 'background' || k === 'backgroundcolor') return BG;
  if (k === 'color' || k === 'caretcolor') return TEXT;
  if (k.startsWith('border') || k.startsWith('outline')) return BORDER;
  if (k === 'fill' || k === 'stroke') return null; // 차트/아이콘 안전
  return undefined; // 기타 속성(boxShadow 등): 손대지 않음
}

const PROP = /([A-Za-z][A-Za-z0-9]*)(\s*:\s*)(['"])([^'"]*?)\3/g;

function transform(src) {
  let count = 0;
  const out = src.replace(PROP, (m, key, sep, q, val) => {
    const table = categoryFor(key);
    if (!table) return m;
    if (!val.includes('#')) return m;
    const next = mapValue(val, table);
    if (next !== val) count++;
    return `${key}${sep}${q}${next}${q}`;
  });
  return { out, count };
}

const files = process.argv.slice(2);
if (!files.length) { console.error('파일 경로를 지정하세요.'); process.exit(1); }
let total = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const { out, count } = transform(src);
  if (count > 0) writeFileSync(f, out, 'utf8');
  total += count;
  console.log(`${count.toString().padStart(4)}  ${f}`);
}
console.log(`---\n총 ${total}건 치환`);
