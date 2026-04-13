# Wrap Retirement (랩 은퇴설계) TRD

## 1. 기술 스택

> 기존 Working Hub와 동일한 스택을 사용하여 통합 운영

### 프론트엔드
| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 16 | App Router 기반 SSR/CSR |
| React | 19 | UI 컴포넌트 |
| Tailwind CSS | 4 | 스타일링 |
| Zustand | latest | 상태 관리 (고객 선택 상태 등) |
| Recharts / Chart.js | latest | 복리 성장 그래프, 비교 차트 |

### 백엔드
| 기술 | 버전 | 용도 |
|------|------|------|
| FastAPI | latest | REST API |
| SQLAlchemy | 2.x | ORM (async) |
| asyncpg | latest | PostgreSQL 비동기 드라이버 |
| Alembic | latest | DB 마이그레이션 |
| Claude/Gemini API | latest | AI 가이드 기능 |

### 데이터베이스
| 기술 | 용도 |
|------|------|
| PostgreSQL | 메인 DB (기존 Hub DB 공유) |

### 인프라
| 기술 | 용도 |
|------|------|
| Railway | Backend + PostgreSQL |
| Vercel | Frontend 배포 |

---

## 2. 아키텍처

### Hub 통합 구조
```
Working Hub (기존)
├── Frontend (Next.js)
│   ├── (main)/dashboard/          # 기존 대시보드
│   ├── (main)/retirement/         # 🆕 Wrap Retirement
│   │   ├── page.tsx               # 메인 (탭 컨테이너)
│   │   ├── components/
│   │   │   ├── CustomerSelector.tsx
│   │   │   ├── Tab1_DesiredPlan.tsx
│   │   │   ├── Tab2_InvestmentFlow.tsx
│   │   │   ├── Tab3_RetirementPlan.tsx
│   │   │   ├── Tab4_InteractiveCalc.tsx
│   │   │   └── Tab5_PensionPlan.tsx
│   │   └── hooks/
│   │       ├── useRetirementCalc.ts
│   │       └── useCompoundInterest.ts
│   └── (main)/data-management/
│       └── wrap-accounts/          # 🆕 랩어카운트 관리
│           └── page.tsx
│
├── Backend (FastAPI)
│   ├── app/routers/
│   │   ├── retirement.py           # 🆕 은퇴설계 API
│   │   ├── investment_records.py   # 🆕 투자기록 API
│   │   └── wrap_accounts.py        # 🆕 랩어카운트 관리 API
│   ├── app/models/
│   │   ├── retirement_plan.py      # 🆕 은퇴플랜 모델
│   │   ├── investment_record.py    # 🆕 투자기록 모델
│   │   └── wrap_account.py         # 🆕 랩어카운트 모델
│   └── app/services/
│       ├── compound_calc.py        # 🆕 복리 계산 서비스
│       └── ai_retirement_guide.py  # 🆕 AI 가이드 서비스
│
└── Database (PostgreSQL)
    └── 기존 DB에 새 테이블 추가
```

### API 구조
```
/api/v1/retirement/
├── plans/                    # 은퇴플랜 CRUD
│   ├── GET    /              # 고객별 플랜 목록
│   ├── POST   /              # 새 플랜 생성
│   ├── GET    /{id}          # 플랜 상세
│   ├── PUT    /{id}          # 플랜 수정
│   └── DELETE /{id}          # 플랜 삭제
│
├── desired-plans/            # 희망 은퇴플랜 (1번탭)
│   ├── GET    /{customer_id} # 고객별 희망플랜 조회
│   └── PUT    /{customer_id} # 희망플랜 저장
│
├── investment-records/       # 투자기록 (2번탭)
│   ├── GET    /              # 투자기록 목록 (필터: 고객, 연도, 상태)
│   ├── POST   /              # 투자기록 추가
│   ├── PUT    /{id}          # 투자기록 수정
│   ├── DELETE /{id}          # 투자기록 삭제
│   └── GET    /annual-flow/{customer_id}/{year}  # 연간 투자흐름표
│
├── simulation/               # 시뮬레이션 (3,4번탭)
│   ├── POST   /calculate     # 은퇴플랜 시뮬레이션 계산
│   └── POST   /interactive   # 인터랙티브 계산 (실제 데이터 반영)
│
├── ai-guide/                 # AI 가이드 (4번탭)
│   └── POST   /              # AI 조정 가이드 요청
│
├── pension/                  # 연금수령 계획 (5번탭)
│   ├── POST   /calculate     # 연금수령 계산 (종신/확정/상속)
│   └── GET    /{customer_id} # 저장된 연금계획 조회
│
└── wrap-accounts/            # 랩어카운트 관리
    ├── GET    /              # 상품 목록
    ├── POST   /              # 상품 등록
    ├── PUT    /{id}          # 상품 수정
    └── DELETE /{id}          # 상품 삭제
```

---

## 3. 보안 요구사항

| 항목 | 내용 |
|------|------|
| 인증 | Hub 기존 JWT 인증 체계 공유 |
| 인가 | 로그인한 직원만 접근 가능 (동일 권한) |
| 데이터 보호 | 고객 금융 데이터 암호화 저장 |
| API 보안 | 모든 API에 인증 미들웨어 적용 |

---

## 4. 성능 요구사항

| 항목 | 기준 |
|------|------|
| 복리 계산 응답 | < 500ms (100년치 연도별 계산) |
| AI 가이드 응답 | < 10s (LLM API 호출 포함) |
| 투자기록 조회 | < 1s (고객별 전체 기록) |
| 그래프 렌더링 | < 300ms |

---

## 5. 핵심 계산 로직

### 복리 계산 (compound interest)
```
FV = PV × (1 + r)^n + PMT × {(1 + r)^n - 1} / r

FV: 미래가치 (목표 은퇴자금)
PV: 현재가치 (일시납 금액)
r: 연수익률
n: 납입기간 (년)
PMT: 연적립금액
```

### 연간 투자흐름 계산
```
연간평가금액 = 전년도평가금액 + 일시납금액 + 연적립금액 + 연간총수익 - 인출금액
연간총수익 = (전년도평가금액 + 일시납금액 + 연적립금액) × 연수익률
연수익률 = (연말평가금액 - 연초평가금액 - 추가납입) / (연초평가금액 + 추가납입)
```

### 연금수령 계산 (지급방법별)
```
종신형: 은퇴자금 / 기대여명 × 연금계수
확정형: 은퇴자금 / 확정지급기간
상속형: 은퇴자금 × 이자율 (원금 보존)
```
