'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { authLib } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Customer {
  id: string;
  name: string;
  unique_code: string;
  birth_date: string | null;
  ssn_masked: string | null;
  phone: string | null;
  email: string | null;
}

interface FormData {
  name: string;
  birth_date: string;
  phone: string;
  email: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  birth_date: '',
  phone: '',
  email: '',
};

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function CustomerManagementPage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* search */
  const [searchQuery, setSearchQuery] = useState('');
  const [nameSort, setNameSort] = useState<'none' | 'asc' | 'desc'>('none'); // 기본 No. 순서, 고객명 정렬 토글

  /* modal */
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* Notion import */
  const NOTION_CUSTOMER_KEY = 'notion_customer_config';
  function saveNotionCustomerConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
    try { localStorage.setItem(NOTION_CUSTOMER_KEY, JSON.stringify({ dbId, dbTitle, mapping })); } catch { /* ignore */ }
  }
  function loadNotionCustomerConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
    try { const r = localStorage.getItem(NOTION_CUSTOMER_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function clearNotionCustomerConfig() {
    try { localStorage.removeItem(NOTION_CUSTOMER_KEY); } catch { /* ignore */ }
  }

  const [notionStep, setNotionStep] = useState<'idle' | 'selectDb' | 'mapping'>('idle');
  const [notionDbs, setNotionDbs] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [notionRows, setNotionRows] = useState<{ id: string; properties: Record<string, string> }[]>([]);
  const [notionColumns, setNotionColumns] = useState<string[]>([]);
  const [notionMapping, setNotionMapping] = useState<Record<string, string>>({ name: '', birth_date: '', phone: '', email: '' });
  const [notionSelectedDb, setNotionSelectedDb] = useState('');
  const [notionSelectedDbTitle, setNotionSelectedDbTitle] = useState('');
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionDbSearch, setNotionDbSearch] = useState('');
  const [notionRowSearch, setNotionRowSearch] = useState('');
  const [notionSelectedRows, setNotionSelectedRows] = useState<Set<string>>(new Set());
  const [notionBulkLoading, setNotionBulkLoading] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                            */
  /* ---------------------------------------------------------------- */

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('고객 목록을 불러오지 못했습니다.');
      const data: Customer[] = await res.json();
      setCustomers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  /* ---------------------------------------------------------------- */
  /*  Filtered list                                                    */
  /* ---------------------------------------------------------------- */

  const filteredBase = customers.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.unique_code.toLowerCase().includes(q)
    );
  });
  // 기본은 No.(원래) 순서, 고객명 정렬 선택 시 이름순
  const filtered = nameSort === 'none'
    ? filteredBase
    : [...filteredBase].sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, 'ko');
        return nameSort === 'asc' ? cmp : -cmp;
      });

  // Notion 행 검색 필터 (복수 선택·일괄 추가용)
  const notionFilteredRows = (() => {
    const q = notionRowSearch.toLowerCase().trim();
    return q
      ? notionRows.filter(row => Object.values(row.properties).some(v => v && v.toLowerCase().includes(q)))
      : notionRows;
  })();

  /* ---------------------------------------------------------------- */
  /*  Modal helpers                                                    */
  /* ---------------------------------------------------------------- */

  /* ── Notion helpers ── */
  async function fetchNotionDbList() {
    setNotionLoading(true);
    setNotionError(null);
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? 'Notion 데이터베이스 목록 조회 실패');
      }
      const dbs = await res.json();
      setNotionDbs(dbs);
      setNotionStep('selectDb');
    } catch (e: unknown) {
      setNotionError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setNotionLoading(false);
    }
  }

  async function loadNotionDbs() {
    // Check localStorage first - if saved config exists, skip DB selection
    const saved = loadNotionCustomerConfig();
    if (saved) {
      setNotionSelectedDb(saved.dbId);
      setNotionSelectedDbTitle(saved.dbTitle);
      setNotionMapping(saved.mapping);
      await loadNotionRows(saved.dbId, saved.mapping);
      return;
    }
    // '고객 DB' 자동 선택 (제목에 '고객 DB' 포함 우선, 없으면 '고객' 포함·상품가입정보 제외)
    setNotionLoading(true);
    setNotionError(null);
    let dbs: { id: string; title: string; icon: string | null }[];
    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/notion/databases`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail ?? 'Notion 데이터베이스 목록 조회 실패'); }
      dbs = await res.json();
      setNotionDbs(dbs);
    } catch (e: unknown) {
      setNotionError(e instanceof Error ? e.message : '오류 발생');
      setNotionLoading(false);
      return;
    }
    const target = dbs.find(d => d.title.includes('고객 DB'))
      ?? dbs.find(d => d.title.includes('고객') && !d.title.includes('상품가입정보'));
    if (target) {
      setNotionSelectedDbTitle(target.title);
      await loadNotionRows(target.id);   // loadNotionRows가 로딩·매핑·단계 처리
    } else {
      setNotionLoading(false);
      setNotionStep('selectDb');   // 고객 DB를 못 찾으면 수동 선택
    }
  }

  async function loadNotionRows(dbId: string, savedMapping?: Record<string, string>) {
    setNotionLoading(true);
    setNotionError(null);
    setNotionSelectedDb(dbId);
    try {
      const token = authLib.getToken();
      // 속성 목록 + 행 데이터 동시 조회
      const [propsRes, rowsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!propsRes.ok || !rowsRes.ok) throw new Error('데이터 조회 실패');
      const props: { name: string; type: string }[] = await propsRes.json();
      const rows: { id: string; properties: Record<string, string> }[] = await rowsRes.json();
      const cols = props.map(p => p.name);
      setNotionColumns(cols);
      setNotionRows(rows);

      let finalMapping: Record<string, string>;
      if (savedMapping) {
        // Use saved mapping if provided
        finalMapping = savedMapping;
      } else {
        // 자동 매핑: 표준 컬럼명(고객명·생년월일·연락처·이메일) 정확일치 우선, 없으면 키워드 추측
        const pickCol = (exact: string, keywords: string[]) => {
          if (cols.includes(exact)) return exact;
          const found = cols.find(c => keywords.some(k => c.toLowerCase().includes(k)));
          return found ?? '';
        };
        finalMapping = {
          name: pickCol('고객명', ['고객명', '이름', 'name']),
          birth_date: pickCol('생년월일', ['생년월일', '생년', 'birth', '생일']),
          phone: pickCol('연락처', ['연락처', '전화', 'phone', '핸드폰']),
          email: pickCol('이메일', ['이메일', 'email', '메일']),
        };
      }
      setNotionMapping(finalMapping);
      setNotionStep('mapping');
    } catch (e: unknown) {
      setNotionError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setNotionLoading(false);
    }
  }

  function applyNotionRow(row: { properties: Record<string, string> }) {
    setForm({
      name: row.properties[notionMapping.name] ?? '',
      birth_date: row.properties[notionMapping.birth_date] ?? '',
      phone: row.properties[notionMapping.phone] ?? '',
      email: row.properties[notionMapping.email] ?? '',
    });
    // Save config to localStorage when a row is applied
    saveNotionCustomerConfig(notionSelectedDb, notionSelectedDbTitle, notionMapping);
    setNotionStep('idle');
  }

  function toggleNotionRow(id: string) {
    setNotionSelectedRows(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // 선택한 Notion 행들을 고객으로 일괄 생성
  async function bulkAddNotionRows(rows: { id: string; properties: Record<string, string> }[]) {
    const selected = rows.filter(r => notionSelectedRows.has(r.id));
    if (selected.length === 0) return;
    setNotionBulkLoading(true);
    const token = authLib.getToken();
    // 기존 고객: 고객명 + 생년월일(YYYY-MM-DD) 로 중복 판정
    const existKeys = new Set(customers.map(c => `${(c.name || '').trim()}|${(c.birth_date || '').slice(0, 10)}`));
    let ok = 0, fail = 0, skipped = 0;
    const dupNames: string[] = [];
    for (const row of selected) {
      const name = (row.properties[notionMapping.name] ?? '').trim();
      if (!name) { skipped++; continue; }
      const birth = (row.properties[notionMapping.birth_date] ?? '').slice(0, 10);
      if (existKeys.has(`${name}|${birth}`)) { dupNames.push(name); continue; }   // 이미 등록된 고객 제외
      const body = {
        name,
        birth_date: (row.properties[notionMapping.birth_date] ?? '').trim() || null,
        phone: (row.properties[notionMapping.phone] ?? '').trim() || null,
        email: (row.properties[notionMapping.email] ?? '').trim() || null,
      };
      try {
        const res = await fetch(`${API_URL}/api/v1/clients`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (res.ok) { ok++; existKeys.add(`${name}|${birth}`); } else fail++;
      } catch { fail++; }
    }
    setNotionBulkLoading(false);
    saveNotionCustomerConfig(notionSelectedDb, notionSelectedDbTitle, notionMapping);
    setNotionSelectedRows(new Set());
    const dupMsg = dupNames.length > 0
      ? `\n\n중복 제외 ${dupNames.length}명(이름·생년월일 일치):\n${dupNames.join(', ')}`
      : '';
    alert(`${ok}명 추가 완료${fail > 0 ? `, ${fail}명 실패` : ''}${skipped > 0 ? `, ${skipped}명 스킵(고객명 없음)` : ''}${dupMsg}`);
    closeModal();
    await fetchCustomers();
  }

  function resetNotion() {
    setNotionStep('idle');
    setNotionDbs([]);
    setNotionRows([]);
    setNotionColumns([]);
    setNotionError(null);
    setNotionSelectedRows(new Set());
    clearNotionCustomerConfig();
  }

  function openAddModal() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetNotion();
    setModalOpen(true);
  }

  function openEditModal(c: Customer) {
    setEditTarget(c);
    setForm({
      name: c.name,
      birth_date: c.birth_date ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  /* ---------------------------------------------------------------- */
  /*  Submit                                                           */
  /* ---------------------------------------------------------------- */

  async function handleSubmit() {
    if (!form.name.trim()) {
      setFormError('고객명은 필수입니다.');
      return;
    }
    if (!form.birth_date) {
      setFormError('생년월일은 필수입니다.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const token = authLib.getToken();
      const body: Record<string, string | null> = {
        name: form.name.trim(),
        birth_date: form.birth_date || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };

      let res: Response;
      if (editTarget) {
        res = await fetch(`${API_URL}/api/v1/clients/${editTarget.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API_URL}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail ?? '저장에 실패했습니다.');
      }

      closeModal();
      await fetchCustomers();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Delete                                                           */
  /* ---------------------------------------------------------------- */

  async function handleDelete(c: Customer) {
    const confirmed = window.confirm(
      `${c.name}(${c.unique_code})을 삭제하시겠습니까?\n연결된 계좌 및 데이터도 함께 삭제됩니다.`
    );
    if (!confirmed) return;

    try {
      const token = authLib.getToken();
      const res = await fetch(`${API_URL}/api/v1/clients/${c.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('삭제에 실패했습니다.');
      await fetchCustomers();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '오류가 발생했습니다.');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ width: '100%' }}>
      {/* 대시보드로 돌아가기 */}
      <button
        onClick={() => router.push('/dashboard')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 0', fontSize: '0.8125rem', fontWeight: 500,
          color: 'var(--text-muted)', background: 'none', border: 'none',
          cursor: 'pointer', marginBottom: 8,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        대시보드로 돌아가기
      </button>

      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '28px',
        }}
      >
        <div>
          <div
            style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, var(--blue-600) 0%, var(--blue-400) 100%)',
              marginBottom: '12px',
            }}
          />
          <h1
            style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
            }}
          >
            고객 정보 관리
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: 'var(--text-muted)' }}>
            고객 기본 정보를 등록하고 다른 프로그램과 연동합니다.
          </p>
        </div>

      </div>

      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, maxWidth: '360px' }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="고객명 또는 고유번호 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 38px',
              borderRadius: '8px',
              border: '1px solid var(--border-strong)',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={openAddModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '9px 18px',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--blue-600)',
            color: '#fff',
            marginLeft: 'auto',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          고객 추가
        </button>

        {/* 템플릿 다운로드 */}
        <a
          href="/customer_template.xlsx"
          download="customer_template.xlsx"
          data-tooltip="업로드용 엑셀 템플릿 다운로드"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid var(--border-strong)', background: 'var(--bg-card)',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </a>

        {/* 엑셀 업로드 */}
        <input
          id="excel-upload-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const token = authLib.getToken();
            if (!token) return;
            const fd = new FormData();
            fd.append('file', file);
            try {
              const res = await fetch(`${API_URL}/api/v1/clients/upload-excel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
              });
              const data = await res.json();
              alert(`업로드 완료\n- 등록: ${data.created ?? 0}명\n- 중복 스킵: ${data.skipped ?? 0}명${data.skipped_names?.length ? `\n  ${data.skipped_names.join('\n  ')}` : ''}${data.errors?.length ? `\n- 오류:\n  ${data.errors.join('\n  ')}` : ''}`);
              fetchCustomers();
            } catch {
              alert('엑셀 업로드 중 오류가 발생했습니다.');
            }
            e.target.value = '';
          }}
        />
        <button
          data-tooltip="엑셀 파일로 고객 대량 등록"
          onClick={() => document.getElementById('excel-upload-input')?.click()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid var(--success)', background: 'var(--bg-card)',
            color: 'var(--success)', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>

        {/* 엑셀 다운로드 */}
        <button
          data-tooltip="고객 목록을 엑셀 파일로 다운로드"
          onClick={() => {
            const token = authLib.getToken();
            if (!token) return;
            const url = `${API_URL}/api/v1/clients/download-excel?token=${encodeURIComponent(token)}`;
            window.open(url, '_blank');
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, height: 38, borderRadius: '8px',
            border: '1px solid #6B7280', background: 'var(--bg-card)',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      {/* ── Table card ── */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: '12px',
          backgroundColor: 'var(--bg-card)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
            불러오는 중...
          </div>
        ) : error ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--danger)', fontSize: '14px' }}>
            {error}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                  {['No.', '고객명', '고유번호', '생년월일', '전화번호', '이메일', '관리'].map((h) => {
                    const sortable = h === '고객명';
                    return (
                    <th
                      key={h}
                      onClick={sortable ? () => setNameSort(s => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none')) : undefined}
                      title={sortable ? '클릭하여 고객명 정렬 (오름차순 → 내림차순 → 기본)' : undefined}
                      style={{
                        padding: '12px 14px',
                        textAlign: h === '관리' ? 'center' : 'left',
                        fontWeight: 600,
                        fontSize: '0.8125rem',
                        color: sortable && nameSort !== 'none' ? 'var(--blue-400)' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        cursor: sortable ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {h}{sortable && (nameSort === 'asc' ? ' ▲' : nameSort === 'desc' ? ' ▼' : ' ↕')}
                    </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{
                        padding: '48px 20px',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '14px',
                      }}
                    >
                      {searchQuery ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다. 고객을 추가해보세요.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c, idx) => (
                    <tr
                      key={c.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {c.name}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {c.unique_code}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        {c.birth_date ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        {c.phone ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        {c.email ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => openEditModal(c)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '7px',
                              border: '1px solid var(--border-strong)',
                              background: 'var(--bg-card)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(c)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '7px',
                              border: '1px solid rgba(239,68,68,0.35)',
                              background: 'var(--danger-bg)',
                              color: 'var(--danger)',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Footer count ── */}
      {!loading && !error && (
        <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--text-muted)', textAlign: 'right' }}>
          총 {filtered.length}명
          {searchQuery && customers.length !== filtered.length && ` (전체 ${customers.length}명 중)`}
        </p>
      )}

      {/* ================================================================ */}
      {/* Modal                                                              */}
      {/* ================================================================ */}

      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: '14px',
              padding: '28px',
              width: '100%',
              maxWidth: '720px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {editTarget ? '고객 정보 수정' : '고객 추가'}
              </h2>
              <button
                onClick={closeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* ── Notion에서 가져오기 ── */}
            {!editTarget && (
              <div style={{ marginBottom: '16px' }}>
                {notionStep === 'idle' && (
                  <button
                    onClick={loadNotionDbs}
                    disabled={notionLoading}
                    style={{
                      width: '100%', padding: '10px', borderRadius: '8px',
                      border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)',
                      color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500,
                      cursor: notionLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px', opacity: notionLoading ? 0.6 : 1,
                    }}
                  >
                    {notionLoading ? <><span className="notion-spinner" style={{ marginRight: 6 }} />Notion 연결 중...</> : <>📝 Notion에서 가져오기</>}
                  </button>
                )}

                {notionError && (
                  <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '6px', background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.35)', fontSize: '12px', color: 'var(--danger)' }}>
                    {notionError}
                    <button onClick={resetNotion} style={{ marginLeft: '8px', background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', fontSize: '12px' }}>닫기</button>
                  </div>
                )}

                {/* Step 1: DB 선택 */}
                {notionStep === 'selectDb' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '12px', fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Notion 데이터베이스 선택</span>
                      <button onClick={resetNotion} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>취소</button>
                    </div>
                    {/* DB 검색 */}
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                      <input
                        type="text"
                        placeholder="데이터베이스 검색..."
                        value={notionDbSearch}
                        onChange={e => setNotionDbSearch(e.target.value)}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12px', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    {notionLoading ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        <div style={{ marginBottom: '8px', fontSize: '20px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</div><br />
                        <span className="notion-spinner" style={{ marginRight: 6 }} />데이터 불러오는 중...
                        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                      </div>
                    ) : notionDbs.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                        접근 가능한 데이터베이스가 없습니다.<br />
                        <span style={{ fontSize: '11px' }}>Notion에서 페이지 [···] → [연결 추가]에서 통합을 연결해주세요.</span>
                      </div>
                    ) : (
                      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        {notionDbs
                          .filter(db => !notionDbSearch || db.title.toLowerCase().includes(notionDbSearch.toLowerCase()))
                          .map(db => (
                          <button
                            key={db.id}
                            onClick={() => { setNotionDbSearch(''); setNotionSelectedDbTitle(db.title); loadNotionRows(db.id); }}
                            style={{
                              width: '100%', padding: '10px 12px', border: 'none',
                              borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
                              textAlign: 'left', cursor: 'pointer', fontSize: '13px',
                              display: 'flex', alignItems: 'center', gap: '8px',
                            }}
                            onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                            onMouseOut={e => (e.currentTarget.style.background = 'var(--bg-card)')}
                          >
                            <span>{db.icon ?? '📄'}</span>
                            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{db.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: 필드 매핑 + 행 선택 */}
                {notionStep === 'mapping' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', fontSize: '12px', fontWeight: 600, color: 'var(--blue-400)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>필드 매핑 → 고객 선택{notionSelectedDbTitle ? ` (${notionSelectedDbTitle})` : ''}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => { clearNotionCustomerConfig(); setNotionRows([]); setNotionColumns([]); setNotionRowSearch(''); fetchNotionDbList(); }} style={{ background: 'none', border: 'none', color: 'var(--blue-400)', cursor: 'pointer', fontSize: '11px' }}>DB 변경</button>
                        <button onClick={resetNotion} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>취소</button>
                      </div>
                    </div>

                    {/* 로딩 */}
                    {notionLoading && (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}><span className="notion-spinner" style={{ marginRight: 6 }} />데이터 불러오는 중...</div>
                    )}

                    {!notionLoading && (<>
                      {/* 매핑 설정 */}
                      <div style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>Notion 컬럼 → 고객 필드 매핑 (자동 감지됨, 수정 가능)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          {[
                            { key: 'name', label: '고객명 *' },
                            { key: 'birth_date', label: '생년월일' },
                            { key: 'phone', label: '전화번호' },
                            { key: 'email', label: '이메일' },
                          ].map(f => (
                            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                              <span style={{ width: '60px', color: 'var(--text-secondary)', fontWeight: 500, flexShrink: 0 }}>{f.label}</span>
                              <select
                                value={notionMapping[f.key] ?? ''}
                                onChange={e => {
                                  const updated = { ...notionMapping, [f.key]: e.target.value };
                                  setNotionMapping(updated);
                                  if (notionSelectedDb) saveNotionCustomerConfig(notionSelectedDb, notionSelectedDbTitle, updated);
                                }}
                                style={{ flex: 1, padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-strong)', fontSize: '11px', color: 'var(--text-primary)', colorScheme: 'dark', backgroundColor: notionMapping[f.key] ? 'rgba(16,185,129,0.12)' : 'var(--bg-card)' }}
                              >
                                <option value="" style={{ backgroundColor: '#1a2332', color: '#e5e7eb' }}>-- 선택 --</option>
                                {notionColumns.map(c => <option key={c} value={c} style={{ backgroundColor: '#1a2332', color: '#e5e7eb' }}>{c}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 고객 검색 */}
                      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                        <input
                          type="text"
                          placeholder="고객 검색 (이름, 전화번호 등)..."
                          value={notionRowSearch}
                          onChange={e => setNotionRowSearch(e.target.value)}
                          style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-strong)', fontSize: '12px', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                        />
                      </div>

                      {/* 전체 선택 헤더 */}
                      {notionFilteredRows.length > 0 && (
                        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: '8px', position: 'sticky', top: 0, zIndex: 1 }}>
                          <input
                            type="checkbox"
                            checked={notionFilteredRows.length > 0 && notionFilteredRows.every(r => notionSelectedRows.has(r.id))}
                            onChange={() => {
                              const allSel = notionFilteredRows.every(r => notionSelectedRows.has(r.id));
                              setNotionSelectedRows(prev => {
                                const n = new Set(prev);
                                if (allSel) notionFilteredRows.forEach(r => n.delete(r.id));
                                else notionFilteredRows.forEach(r => n.add(r.id));
                                return n;
                              });
                            }}
                            style={{ width: 15, height: 15, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>전체 선택 ({notionSelectedRows.size}/{notionFilteredRows.length})</span>
                        </div>
                      )}

                      {/* 행 목록 (체크박스 복수 선택) */}
                      <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                        {notionRows.length === 0 ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>데이터가 없습니다.</div>
                        ) : notionFilteredRows.length === 0 ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>검색 결과가 없습니다.</div>
                        ) : notionFilteredRows.map(row => {
                          const dn = notionMapping.name ? (row.properties[notionMapping.name] ?? '-') : Object.values(row.properties)[0] ?? '-';
                          const db2 = notionMapping.birth_date ? (row.properties[notionMapping.birth_date] ?? '') : '';
                          const dp = notionMapping.phone ? (row.properties[notionMapping.phone] ?? '') : '';
                          const de = notionMapping.email ? (row.properties[notionMapping.email] ?? '') : '';
                          const checked = notionSelectedRows.has(row.id);
                          return (
                            <div
                              key={row.id}
                              onClick={() => toggleNotionRow(row.id)}
                              style={{
                                width: '100%', padding: '9px 12px',
                                borderBottom: '1px solid var(--border)',
                                background: checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)',
                                cursor: 'pointer', fontSize: '12px',
                                display: 'flex', alignItems: 'center', gap: '10px',
                              }}
                              onMouseOver={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-surface)'; }}
                              onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.background = checked ? 'rgba(16,185,129,0.1)' : 'var(--bg-card)'; }}
                            >
                              <input type="checkbox" checked={checked} onChange={() => toggleNotionRow(row.id)} onClick={e => e.stopPropagation()}
                                style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: '70px' }}>{dn}</span>
                              {db2 && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{db2}</span>}
                              {dp && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{dp}</span>}
                              {de && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{de}</span>}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          총 {notionRows.length}건 · {notionSelectedRows.size > 0 ? `${notionSelectedRows.size}명 추가 예정` : '체크하여 여러 명 한번에 추가'}
                        </span>
                        <button
                          onClick={() => bulkAddNotionRows(notionFilteredRows)}
                          disabled={notionBulkLoading || notionSelectedRows.size === 0}
                          style={{ padding: '7px 16px', borderRadius: '7px', border: 'none', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
                            background: (notionBulkLoading || notionSelectedRows.size === 0) ? 'var(--bg-card)' : 'var(--blue-600)',
                            color: (notionBulkLoading || notionSelectedRows.size === 0) ? 'var(--text-muted)' : '#fff',
                            cursor: (notionBulkLoading || notionSelectedRows.size === 0) ? 'not-allowed' : 'pointer' }}
                        >
                          {notionBulkLoading ? '추가 중...' : `선택 ${notionSelectedRows.size}명 추가`}
                        </button>
                      </div>
                    </>)}
                  </div>
                )}
              </div>
            )}

            {/* Unique code (edit mode) */}
            {editTarget && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>고유번호</label>
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)',
                    fontSize: '0.875rem',
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                  }}
                >
                  {editTarget.unique_code}
                  <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>(서버 자동 생성, 변경 불가)</span>
                </div>
              </div>
            )}

            {/* 고객명 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>
                고객명 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 생년월일 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>
                생년월일 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 전화번호 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>전화번호</label>
              <input
                type="text"
                placeholder="010-0000-0000"
                value={form.phone}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9]/g, '');
                  if (val.length > 11) val = val.slice(0, 11);
                  if (val.length <= 3) {
                    setForm((f) => ({ ...f, phone: val }));
                  } else if (val.length <= 7) {
                    setForm((f) => ({ ...f, phone: `${val.slice(0, 3)}-${val.slice(3)}` }));
                  } else {
                    setForm((f) => ({ ...f, phone: `${val.slice(0, 3)}-${val.slice(3, 7)}-${val.slice(7)}` }));
                  }
                }}
                style={inputStyle}
              />
            </div>

            {/* 이메일 */}
            <div style={{ marginBottom: '8px' }}>
              <label style={labelStyle}>이메일</label>
              <input
                type="email"
                placeholder="example@email.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                style={inputStyle}
              />
            </div>

            {/* 안내 메모 */}
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '16px' }}>
              ※ &apos;주식, 펀드 관리&apos; 이용 시 전화번호와 이메일이 반드시 필요합니다.
            </p>

            {/* Form error */}
            {formError && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'var(--danger-bg)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  fontSize: '0.8125rem',
                  color: 'var(--danger)',
                }}
              >
                {formError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={closeModal}
                disabled={submitting}
                style={{
                  padding: '9px 20px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '9px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--blue-600)',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  minWidth: '80px',
                }}
              >
                {submitting ? '저장 중...' : editTarget ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared style objects                                               */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border-strong)',
  fontSize: '0.875rem',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
  background: 'var(--bg-card)',
};
