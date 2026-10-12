'use client';

/**
 * 펼친 목록·카드의 '접기' 버튼 (2026-10-12).
 * 펼친 내용이 길면 맨 아래 [접기]까지 한참 내려가야 했다 → 펼쳐 둔 동안 화면 아래에 따라다니고,
 * 누르면 접은 뒤 그 기업 카드 맨 위로 화면을 되돌린다(다음 기업을 바로 이어 볼 수 있게).
 * 부모 중에 overflow: hidden 이 있으면 따라다니지 않으니, 펼친 내용의 맨 끝(같은 카드 안)에 둔다.
 */
export function StickyClose({
  label,
  onClose,
  anchorId,
}: {
  label: string;
  onClose: () => void;
  /** 접은 뒤 화면을 맞출 카드의 id(없으면 이동하지 않음) */
  anchorId?: string;
}) {
  const close = () => {
    onClose();
    if (!anchorId) return;
    // 접혀서 높이가 줄어든 다음에 이동해야 위치가 맞는다
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(anchorId)?.scrollIntoView({ block: 'start', behavior: 'auto' })),
    );
  };
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 14,
        zIndex: 5,
        display: 'flex',
        justifyContent: 'center',
        marginTop: 10,
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        onClick={close}
        style={{
          pointerEvents: 'auto',
          padding: '9px 18px',
          borderRadius: 999,
          border: '1px solid rgba(56,189,248,.55)',
          background: 'rgba(15,23,42,.94)',
          color: '#E2E8F0',
          fontSize: 14,
          fontWeight: 700,
          boxShadow: '0 6px 18px rgba(0,0,0,.35)',
          cursor: 'pointer',
          maxWidth: '90%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        ▲ {label}
      </button>
    </div>
  );
}

export default StickyClose;
