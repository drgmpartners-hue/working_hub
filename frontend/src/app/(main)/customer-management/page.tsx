'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { isNotionConfig, loadJSON, notionDbGone, removeKey, saveJSON } from '@/lib/storage';
import { authLib } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth';
import { OwnerClientActions } from '@/components/customer/OwnerClientActions';
import { ClientAccountsPanel } from '@/components/customer/ClientAccountsPanel';
import { ClientManagementModal } from '@/components/portfolio/ClientManagementModal';
import { ManagerSelectField, managerMissing } from '@/components/customer/ManagerSelectField';

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
  /** 담당 매니저 — 대표 화면에서만 표시 (docs/login_logic P7-3) */
  manager?: { id: string; nickname: string } | null;
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
  /* 대표 전용: 담당자 필터 (?manager_id= 로 관리 화면에서 넘어올 수 있음) */
  const isOwner = useAuthStore((st) => st.user?.role === 'owner');
  const [managerFilter, setManagerFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('manager_id') || '';
  });
  const [managers, setManagers] = useState<{ id: string; nickname: string; is_active: boolean }[]>([]);
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
  // 고객 추가 담당자 (docs/login_logic P10): 대표는 고르고, 매니저는 본인 고정(서버도 고정)
  const [newManagerId, setNewManagerId] = useState('');
  // 엑셀 대량 등록: 대표는 먼저 담당자를 고른다
  const [excelPick, setExcelPick] = useState(false);
  // 증권계좌를 펼친 고객(한 번에 한 명)
  const [openAccountsId, setOpenAccountsId] = useState<string | null>(null);
  // 계좌정보 관리(전체 고객 계좌를 한 표에서) — 주식, 펀드 관리에서 옮겨 옴(2026-10-08). ?accounts=1 로 바로 열 수 있다
  const [accountsModalOpen, setAccountsModalOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('accounts') === '1';
  });
  const [excelManagerId, setExcelManagerId] = useState('');

  /* Notion import */
  // 사용자·서버별로 따로 저장, 깨진 값은 자동 초기화(수정_tasks P2-6)
  const NOTION_CUSTOMER_KEY = 'notion_customer_config';
  function saveNotionCustomerConfig(dbId: string, dbTitle: string, mapping: Record<string, string>) {
    saveJSON(NOTION_CUSTOMER_KEY, { dbId, dbTitle, mapping });
  }
  function loadNotionCustomerConfig(): { dbId: string; dbTitle: string; mapping: Record<string, string> } | null {
    return loadJSON(NOTION_CUSTOMER_KEY, isNotionConfig, NOTION_CUSTOMER_KEY);
  }
  function clearNotionCustomerConfig() {
    removeKey(NOTION_CUSTOMER_KEY);
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
  // 노션 담당자 거르기(2026-10-01): 고른 담당자의 이름이 노션 '담당자(main)'에 있는 고객만 가져온다
  const myNickname = useAuthStore((st) => st.user?.nickname ?? '');
  const [notionAssignee, setNotionAssignee] = useState<{ column: string; name: string } | null>(null);
  const assigneeName = isOwner ? (managers.find((m) => m.id === newManagerId)?.nickname ?? '') : myNickname;

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                            */
  /* ---------------------------------------------------------------- */

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = authLib.getToken();
      const qs = managerFilter ? `?manager_id=${encodeURIComponent(managerFilter)}` : '';
      const res = await fetch(`${API_URL}/api/v1/clients${qs}`, {
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
  }, [managerFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // 대표만: 담당자 드롭다운용 계정 목록
  useEffect(() => {
    if (!isOwner) return;
    fetch(`${API_URL}/api/v1/managers`, { headers: authLib.getAuthHeader() })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setManagers(Array.isArray(rows) ? rows : []))
      .catch(() => setManagers([]));
  }, [isOwner]);

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
    if (!assigneeName) {
      setNotionError('담당자를 먼저 선택하세요. 담당자를 정해야 노션에서 그 담당자의 고객만 가져올 수 있습니다.');
      return;
    }
    // Check localStorage first - if saved config exists, skip DB selection
    const saved = loadNotionCustomerConfig();
    if (saved) {
      setNotionSelectedDb(saved.dbId);
      setNotionSelectedDbTitle(saved.dbTitle);
      setNotionMapping(saved.mapping);
      if ((await loadNotionRows(saved.dbId, saved.mapping)) !== 'stale') return;
      // 저장된 DB 를 더는 열 수 없거나 칸 이름이 바뀜 → 저장 설정을 지우고 처음부터 자동 선택
      clearNotionCustomerConfig();
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

  /** 'stale' = 저장해 둔 설정이 맞지 않음(DB 접근 불가·칸 없음) — 호출한 쪽이 설정을 초기화한다 */
  async function loadNotionRows(dbId: string, savedMapping?: Record<string, string>): Promise<'ok' | 'error' | 'stale'> {
    setNotionLoading(true);
    setNotionError(null);
    setNotionSelectedDb(dbId);
    try {
      const token = authLib.getToken();
      if (!assigneeName) throw new Error('담당자를 먼저 선택하세요.');
      // 속성 목록 → '담당자(main)' 칸을 찾고, 그 담당자 이름의 행만 조회(서버가 한 번 더 확인)
      const propsRes = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/properties`, { headers: { Authorization: `Bearer ${token}` } });
      if (!propsRes.ok) {
        if (savedMapping && (await notionDbGone(propsRes))) return 'stale';
        throw new Error('데이터 조회 실패');
      }
      const props: { name: string; type: string }[] = await propsRes.json();
      const cols = props.map(p => p.name);
      if (savedMapping && Object.values(savedMapping).some(c => c && !cols.includes(c))) return 'stale';
      const assigneeCol = cols.find(c => c.replace(/\s/g, '') === '담당자(main)')
        ?? cols.find(c => c.includes('담당자') && c.toLowerCase().includes('main'))
        ?? cols.find(c => c.includes('담당자'));
      if (!assigneeCol) {
        throw new Error(`'${notionSelectedDbTitle || '선택한 DB'}'에 '담당자(main)' 칸이 없어 가져올 수 없습니다. 노션 고객 DB를 고르세요.`);
      }
      const qs = new URLSearchParams({ assignee_property: assigneeCol, assignee: assigneeName });
      const rowsRes = await fetch(`${API_URL}/api/v1/notion/databases/${dbId}/rows?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!rowsRes.ok) {
        const d = await rowsRes.json().catch(() => ({}));
        throw new Error(typeof d?.detail === 'string' ? d.detail : '데이터 조회 실패');
      }
      const rows: { id: string; properties: Record<string, string> }[] = await rowsRes.json();
      if (rows.length === 0) {
        throw new Error(`노션 '${assigneeCol}'이(가) '${assigneeName}'인 고객이 없습니다. Working Hub 계정 이름과 노션 담당자 이름이 같아야 가져올 수 있습니다.`);
      }
      setNotionAssignee({ column: assigneeCol, name: assigneeName });
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
      return 'ok';
    } catch (e: unknown) {
      setNotionError(e instanceof Error ? e.message : '오류 발생');
      return 'error';
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
    const miss = managerMissing(isOwner, newManagerId);
    if (miss) { setNotionError(`${miss} (창 맨 위 담당자)`); return; }
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
        ...(isOwner ? { manager_id: newManagerId } : {}),
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

  /** 담당자를 바꾸면 이미 불러온 노션 고객(이전 담당자 것)은 버린다 */
  function changeNewManager(id: string) {
    setNewManagerId(id);
    if (id !== newManagerId) {
      setNotionStep('idle');
      setNotionRows([]);
      setNotionSelectedRows(new Set());
      setNotionAssignee(null);
      setNotionError(null);
    }
  }

  function resetNotion() {
    setNotionAssignee(null);
    setNotionStep('idle');
    setNotionDbs([]);
    setNotionRows([]);
    setNotionColumns([]);
    setNotionError(null);
    setNotionSelectedRows(new Set());
    clearNotionCustomerConfig();
  }

  function openAddModal() {
    setNewManagerId('');
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
    if (!editTarget) {
      const miss = managerMissing(isOwner, newManagerId);
      if (miss) {
        setFormError(miss);
        return;
      }
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
          body: JSON.stringify(isOwner ? { ...body, manager_id: newManagerId } : body),
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

        {/* 대표 전용: 담당자 필터 */}
        {isOwner && (
          <select
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
            title="담당자별로 보기 (대표 전용)"
            style={{
              height: 38, padding: '0 12px', borderRadius: '8px',
              border: '1px solid var(--border-strong)', background: 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: '0.875rem',
            }}
          >
            <option value="">담당자 전체</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}{m.is_active ? '' : ' (비활성)'}
              </option>
            ))}
          </select>
        )}

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

        <button
          onClick={() => setAccountsModalOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 16px', borderRadius: '8px',
            border: '1px solid var(--border-strong)', background: 'var(--bg-card)',
            color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          계좌정보 관리
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
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const token = authLib.getToken();
            if (!token) return;
            const fd = new FormData();
            fd.append('file', file);
            if (isOwner && excelManagerId) fd.append('manager_id', excelManagerId);
            try {
              const res = await fetch(`${API_URL}/api/v1/clients/upload-excel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: fd,
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                alert(typeof data?.detail === 'string' ? data.detail : `엑셀 업로드에 실패했습니다. (${res.status})`);
                e.target.value = '';
                return;
              }
              setExcelPick(false);
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
          onClick={() => {
            if (isOwner) {
              setExcelManagerId('');
              setExcelPick(true); // 대표: 담당자를 먼저 고른 뒤 파일 선택
            } else {
              document.getElementById('excel-upload-input')?.click();
            }
          }}
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

        {excelPick && (
          <div
            onClick={() => setExcelPick(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          >
            <div
              onClick={(ev) => ev.stopPropagation()}
              style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
            >
              <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>엑셀로 고객 대량 등록</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>파일 안의 고객을 모두 아래 담당자로 등록합니다.</p>
              <ManagerSelectField value={excelManagerId} onChange={setExcelManagerId} labelStyle={labelStyle} inputStyle={inputStyle} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="wh-btn wh-btn-ghost wh-btn-sm" onClick={() => setExcelPick(false)}>취소</button>
                <button
                  className="wh-btn wh-btn-primary wh-btn-sm"
                  disabled={!excelManagerId}
                  onClick={() => document.getElementById('excel-upload-input')?.click()}
                >
                  파일 선택
                </button>
              </div>
            </div>
          </div>
        )}

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
                  {['No.', '고객명', ...(isOwner ? ['담당자'] : []), '고유번호', '생년월일', '전화번호', '이메일', '관리'].map((h) => {
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
                      colSpan={isOwner ? 9 : 8}
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
                    <Fragment key={c.id}>
                    <tr
                      style={{
                        borderBottom: openAccountsId === c.id ? 'none' : '1px solid var(--border)',
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
                      {isOwner && (
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {c.manager?.nickname ?? <span style={{ color: '#D1D5DB' }}>-</span>}
                        </td>
                      )}
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
                          {/* 증권계좌: [계좌정보 관리]와 같은 데이터를 고객 줄 바로 아래에 펼친다 */}
                          <button
                            onClick={() => setOpenAccountsId((v) => (v === c.id ? null : c.id))}
                            aria-expanded={openAccountsId === c.id}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '7px',
                              border: `1px solid ${openAccountsId === c.id ? 'var(--blue-400)' : 'var(--border-strong)'}`,
                              background: openAccountsId === c.id ? 'var(--bg-card-2)' : 'var(--bg-card)',
                              color: openAccountsId === c.id ? 'var(--blue-400)' : 'var(--text-secondary)',
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            증권계좌 {openAccountsId === c.id ? '▲' : '▼'}
                          </button>
                          {isOwner && <OwnerClientActions client={c} managers={managers} onChanged={fetchCustomers} />}
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
                    {openAccountsId === c.id && (
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={isOwner ? 9 : 8} style={{ padding: 0 }}>
                          <ClientAccountsPanel clientId={c.id} clientName={c.name} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
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

            {/* ── 담당자 (맨 위 고정: Notion 가져오기·직접 입력 모두 이 담당자로 등록) ── */}
            {!editTarget && (
              <ManagerSelectField value={newManagerId} onChange={changeNewManager} labelStyle={labelStyle} inputStyle={inputStyle} />
            )}

            {/* ── Notion에서 가져오기 ── */}
            {!editTarget && (
              <div style={{ marginBottom: '16px' }}>
                {notionStep === 'idle' && (
                  <button
                    onClick={loadNotionDbs}
                    disabled={notionLoading || !assigneeName}
                    title={assigneeName ? `노션 '담당자(main)'가 ${assigneeName}인 고객만 가져옵니다` : '담당자를 먼저 선택하세요'}
                    style={{
                      width: '100%', padding: '10px', borderRadius: '8px',
                      border: '1px dashed var(--border-strong)', background: 'var(--bg-surface)',
                      color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500,
                      cursor: notionLoading ? 'wait' : !assigneeName ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px', opacity: notionLoading || !assigneeName ? 0.6 : 1,
                    }}
                  >
                    {notionLoading
                      ? <><span className="notion-spinner" style={{ marginRight: 6 }} />Notion 연결 중...</>
                      : assigneeName
                        ? <>📝 Notion에서 가져오기 ({assigneeName} 담당 고객만)</>
                        : <>📝 Notion에서 가져오기 — 담당자를 먼저 선택하세요</>}
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
                      <span>
                        필드 매핑 → 고객 선택{notionSelectedDbTitle ? ` (${notionSelectedDbTitle})` : ''}
                        {notionAssignee && (
                          <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontWeight: 500 }}>
                            · {notionAssignee.column} = {notionAssignee.name} {notionRows.length}명
                          </span>
                        )}
                      </span>
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
                          onClick={() => bulkAddNotionRows(notionRows)}
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

      <ClientManagementModal
        isOpen={accountsModalOpen}
        onClose={() => {
          setAccountsModalOpen(false);
          setOpenAccountsId(null); // 펼쳐 둔 증권계좌는 다시 열 때 새로 불러온다
        }}
        onClientAdded={fetchCustomers}
      />
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
