'use client';

/** notifyError() 알림을 화면 오른쪽 위에 쌓아 보여 준다(8초 뒤 자동으로 닫힘). 수정_tasks P2-2 */
import { useEffect, useState } from 'react';
import { NOTIFY_EVENT, type NotifyDetail } from '@/lib/notify';

interface Item extends NotifyDetail {
  id: number;
}

let seq = 0;

export function ErrorToaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<NotifyDetail>).detail;
      if (!d?.message) return;
      const id = ++seq;
      setItems((prev) => (prev.some((x) => x.message === d.message) ? prev : [...prev.slice(-3), { ...d, id }]));
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 8000);
    };
    window.addEventListener(NOTIFY_EVENT, on);
    return () => window.removeEventListener(NOTIFY_EVENT, on);
  }, []);

  if (!items.length) return null;
  return (
    <div
      className="no-print"
      role="alert"
      aria-live="assertive"
      style={{ position: 'fixed', top: 76, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.5,
            color: '#fff',
            background: it.kind === 'error' ? '#B91C1C' : '#1E3A5F',
            boxShadow: '0 6px 20px rgba(0,0,0,.25)',
          }}
        >
          <span style={{ flex: 1 }}>{it.message}</span>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
            style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default ErrorToaster;
