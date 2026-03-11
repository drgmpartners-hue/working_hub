'use client';

import { Table, TableColumn } from '@/components/common/Table';
import { Button } from '@/components/common/Button';
import { authLib } from '@/lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface CommissionResult {
  id: number;
  employee_name: string;
  employee_id?: string;
  base_amount?: number;
  bonus_amount?: number;
  deduction_amount?: number;
  total_amount: number;
  status?: string;
  [key: string]: unknown;
}

interface CalculationResultTableProps {
  calcId: number | null;
  results: CommissionResult[];
  loading: boolean;
  onDownload?: (resultId: number) => void;
}

function formatCurrency(val: unknown): string {
  if (val == null) return '-';
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ko-KR') + '원';
}

export function CalculationResultTable({
  calcId,
  results,
  loading,
  onDownload,
}: CalculationResultTableProps) {
  const handleDownloadPDF = async (resultId: number) => {
    if (!calcId) return;
    try {
      const resp = await fetch(
        `${API_URL}/api/v1/commissions/${calcId}/results/${resultId}/download`,
        { headers: authLib.getAuthHeader() }
      );
      if (!resp.ok) throw new Error('다운로드 실패');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commission_${resultId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('PDF 다운로드에 실패했습니다.');
    }
    onDownload?.(resultId);
  };

  const columns: TableColumn<CommissionResult>[] = [
    {
      key: 'employee_name',
      header: '성명',
      width: 120,
    },
    {
      key: 'employee_id',
      header: '직원 ID',
      width: 100,
      render: (val) => (val as string) || '-',
    },
    {
      key: 'base_amount',
      header: '기본 수당',
      align: 'right',
      numeric: true,
      render: (val) => formatCurrency(val),
    },
    {
      key: 'bonus_amount',
      header: '보너스',
      align: 'right',
      numeric: true,
      render: (val) => formatCurrency(val),
    },
    {
      key: 'deduction_amount',
      header: '공제',
      align: 'right',
      numeric: true,
      render: (val) => formatCurrency(val),
    },
    {
      key: 'total_amount',
      header: '최종 수당',
      align: 'right',
      numeric: true,
      render: (val) => (
        <span style={{ fontWeight: 700, color: '#1E3A5F' }}>{formatCurrency(val)}</span>
      ),
    },
    {
      key: 'id',
      header: 'PDF',
      align: 'center',
      width: 80,
      render: (_val, row) =>
        calcId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDownloadPDF(row.id)}
            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </Button>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {results.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
            총 {results.length}건
          </span>
          <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
            합계:{' '}
            <strong style={{ color: '#1E3A5F' }}>
              {formatCurrency(results.reduce((s, r) => s + r.total_amount, 0))}
            </strong>
          </span>
        </div>
      )}

      <Table<CommissionResult>
        columns={columns}
        data={results}
        rowKey="id"
        loading={loading}
        emptyMessage="계산 결과가 없습니다. 파일을 업로드하고 계산을 실행하세요."
      />
    </div>
  );
}

export default CalculationResultTable;
