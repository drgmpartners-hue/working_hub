'use client';

import { ReactNode } from 'react';

/* ===== Column definition ===== */
export interface TableColumn<T = Record<string, unknown>> {
  key: string;
  header: ReactNode;
  /** Render cell content. If omitted, the raw value is displayed */
  render?: (value: unknown, row: T, index: number) => ReactNode;
  /** Text alignment (default: left) */
  align?: 'left' | 'center' | 'right';
  /** If true, renders with a monospace font */
  numeric?: boolean;
  /** Optional min/max width */
  width?: number | string;
}

interface TableProps<T = Record<string, unknown>> {
  columns: TableColumn<T>[];
  data: T[];
  /** Unique key field in data rows */
  rowKey?: keyof T | ((row: T, index: number) => string | number);
  loading?: boolean;
  emptyMessage?: string;
}

function getRowKey<T>(
  row: T,
  index: number,
  rowKey?: keyof T | ((row: T, i: number) => string | number)
): string | number {
  if (!rowKey) return index;
  if (typeof rowKey === 'function') return rowKey(row, index);
  return (row[rowKey] as string | number) ?? index;
}

export function Table<T = Record<string, unknown>>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyMessage = 'No data available.',
}: TableProps<T>) {
  return (
    <div
      style={{
        width: '100%',
        overflowX: 'auto',
        borderRadius: 10,
        border: '1px solid #E1E5EB',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          color: '#1A1A2E',
        }}
      >
        {/* Head */}
        <thead>
          <tr style={{ backgroundColor: '#F5F7FA' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: '10px 14px',
                  textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  color: '#6B7280',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderBottom: '1px solid #E1E5EB',
                  whiteSpace: 'nowrap',
                  width: col.width,
                  minWidth: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: '40px 0', textAlign: 'center', color: '#6B7280' }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    width: 24,
                    height: 24,
                    border: '2px solid #E1E5EB',
                    borderTopColor: '#1E3A5F',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: '40px 0', textAlign: 'center', color: '#6B7280', fontStyle: 'italic' }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <TableRow key={getRowKey(row, rowIndex, rowKey)} row={row} columns={columns} rowIndex={rowIndex} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ===== Internal row component (handles hover) ===== */
function TableRow<T>({
  row,
  columns,
  rowIndex,
}: {
  row: T;
  columns: TableColumn<T>[];
  rowIndex: number;
}) {
  return (
    <tr
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(74,144,217,0.04)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent';
      }}
      style={{ borderBottom: '1px solid #E1E5EB', transition: 'background-color 0.12s ease' }}
    >
      {columns.map((col) => {
        const rawValue = (row as Record<string, unknown>)[col.key];
        const content = col.render ? col.render(rawValue, row, rowIndex) : (rawValue as ReactNode);

        return (
          <td
            key={col.key}
            style={{
              padding: '10px 14px',
              textAlign: col.align ?? (col.numeric ? 'right' : 'left'),
              fontFamily: col.numeric ? 'var(--font-geist-mono, monospace)' : undefined,
              fontSize: col.numeric ? '0.8125rem' : undefined,
              verticalAlign: 'middle',
            }}
          >
            {content}
          </td>
        );
      })}
    </tr>
  );
}

export default Table;
