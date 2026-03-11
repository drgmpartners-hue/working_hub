# Working Hub Manager 디자인 시스템

## 1. 디자인 원칙

| 원칙 | 설명 |
|------|------|
| 전문성 | 금융/자산관리 회사에 어울리는 신뢰감 있는 디자인 |
| 일관성 | 모든 프로그램에서 동일한 컴포넌트와 스타일 적용 |
| 효율성 | 업무 도구이므로 화려함보다 명확한 정보 전달 우선 |
| 확장성 | 새 프로그램 추가 시 기존 디자인 시스템 재사용 |

---

## 2. 색상 팔레트

### 기본 색상
| 용도 | 색상 | 코드 | 사용처 |
|------|------|------|--------|
| Primary | Navy Blue | #1E3A5F | 헤더, 주요 버튼, 강조 |
| Primary Light | Light Blue | #4A90D9 | 호버, 활성 상태 |
| Secondary | Teal | #2E8B8B | 보조 버튼, 링크, 아이콘 |
| Accent | Gold | #D4A847 | 중요 알림, 배지, 하이라이트 |

### 중성 색상
| 용도 | 색상 | 코드 |
|------|------|------|
| Background | White | #FFFFFF |
| Surface | Light Gray | #F5F7FA |
| Border | Gray | #E1E5EB |
| Text Primary | Dark Gray | #1A1A2E |
| Text Secondary | Medium Gray | #6B7280 |
| Text Disabled | Light Gray | #9CA3AF |

### 상태 색상
| 상태 | 색상 | 코드 |
|------|------|------|
| Success | Green | #10B981 |
| Warning | Amber | #F59E0B |
| Error | Red | #EF4444 |
| Info | Blue | #3B82F6 |

---

## 3. 타이포그래피

### 서체
| 용도 | 서체 | Fallback |
|------|------|----------|
| 한글 | Pretendard | Noto Sans KR, sans-serif |
| 영문/숫자 | Inter | -apple-system, sans-serif |
| 코드/데이터 | JetBrains Mono | monospace |

### 크기 체계
| 레벨 | 크기 | 행간 | 용도 |
|------|------|------|------|
| Display | 32px | 40px | 페이지 타이틀 |
| H1 | 24px | 32px | 섹션 제목 |
| H2 | 20px | 28px | 카드 제목, 탭 제목 |
| H3 | 16px | 24px | 서브 제목 |
| Body | 14px | 20px | 본문 텍스트 |
| Caption | 12px | 16px | 보조 텍스트, 레이블 |
| Small | 11px | 14px | 힌트, 날짜 |

### 굵기
| 이름 | 값 | 용도 |
|------|-----|------|
| Regular | 400 | 본문 |
| Medium | 500 | 강조 본문, 레이블 |
| SemiBold | 600 | 제목, 버튼 |
| Bold | 700 | 페이지 타이틀, 숫자 강조 |

---

## 4. 컴포넌트

### Button
| 타입 | 스타일 | 용도 |
|------|--------|------|
| Primary | Navy 배경 + White 텍스트 | 주요 행동 (다음, 저장, 다운로드) |
| Secondary | White 배경 + Navy 테두리 | 보조 행동 (이전, 취소) |
| Ghost | 투명 배경 + Teal 텍스트 | 텍스트 링크형 버튼 |
| Danger | Red 배경 + White 텍스트 | 삭제, 위험 행동 |
| Disabled | Gray 배경 + Light Gray 텍스트 | 비활성 |

### Input
| 타입 | 스타일 |
|------|--------|
| Default | Border Gray + White 배경 |
| Focus | Border Primary + White 배경 |
| Error | Border Red + 에러 메시지 표시 |
| Disabled | Background Light Gray |

### Card (대시보드 프로그램 카드)
| 속성 | 값 |
|------|-----|
| 배경 | White |
| 테두리 | 1px solid #E1E5EB |
| 그림자 | 0 2px 4px rgba(0,0,0,0.05) |
| 호버 | 그림자 강화 + border Primary |
| Border Radius | 12px |
| 패딩 | 20px |

### Tab (프로그램 내부 탭)
| 상태 | 스타일 |
|------|--------|
| 활성 | Primary 텍스트 + 하단 2px Primary 보더 |
| 비활성 | Text Secondary + 보더 없음 |
| 호버 | Text Primary + 하단 1px Gray 보더 |

### Table (데이터 테이블)
| 요소 | 스타일 |
|------|--------|
| 헤더 | Surface 배경 + SemiBold 텍스트 |
| 행 | White 배경 + Border Bottom |
| 행 호버 | Surface 배경 |
| 숫자 | Monospace + 오른쪽 정렬 |

---

## 5. 간격 시스템

| 토큰 | 값 | 용도 |
|------|-----|------|
| xs | 4px | 아이콘 간격 |
| sm | 8px | 인라인 요소 간격 |
| md | 16px | 컴포넌트 내부 패딩 |
| lg | 24px | 섹션 간격 |
| xl | 32px | 카드 간격 |
| 2xl | 48px | 페이지 섹션 간격 |

---

## 6. 레이아웃

### 페이지 구조
```
┌──────────────────────────────────────────┐
│  헤더 (64px)                              │
│  로고 | 홈 | 프로그램명    프로필 | 로그아웃 │
├──────────────────────────────────────────┤
│                                          │
│  메인 콘텐츠                              │
│  max-width: 1280px                       │
│  padding: 24px                           │
│                                          │
└──────────────────────────────────────────┘
```

### 반응형 브레이크포인트
| 이름 | 크기 | 비고 |
|------|------|------|
| Mobile | < 768px | 단일 컬럼 |
| Tablet | 768px ~ 1024px | 2컬럼 그리드 |
| Desktop | > 1024px | 3-4컬럼 그리드 (주요 사용 환경) |

---

## 7. 브랜드 콘텐츠 디자인 (콘텐츠 제작용)

> 콘텐츠 제작 시 자동 적용되는 회사 브랜드 설정

### 설정 항목
| 항목 | 설명 |
|------|------|
| 회사 로고 | 콘텐츠 상단/하단에 자동 삽입 |
| 기본 컬러 | 콘텐츠 배경/강조색으로 적용 |
| 보조 컬러 | 서브 요소에 적용 |
| 서체 | 콘텐츠 텍스트에 적용 |
| 스타일 가이드 | 카드뉴스/보고서/표지별 레이아웃 규칙 |

### 관리 방식
- brand_settings 테이블에서 관리
- 관리자가 설정 변경 시 이후 생성되는 모든 콘텐츠에 반영
