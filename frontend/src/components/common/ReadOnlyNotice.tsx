'use client';

/** 공용 마스터 화면의 매니저용 안내 (docs/login_logic P7-4). 수정은 대표만 가능. */
export function ReadOnlyNotice({ what = '이 화면' }: { what?: string }) {
  return (
    <div
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(56,189,248,.10)',
        color: 'var(--cyan-400)',
        fontSize: 13,
      }}
    >
      {what}은(는) 회사 공용 자료라 조회만 할 수 있습니다. 등록·수정·삭제가 필요하면 대표에게 요청하세요.
    </div>
  );
}

export default ReadOnlyNotice;
