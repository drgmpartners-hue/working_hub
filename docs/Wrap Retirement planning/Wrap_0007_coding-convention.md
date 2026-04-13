# Wrap Retirement (랩 은퇴설계) 코딩 컨벤션

> 기존 Hub 코딩 컨벤션(docs/planning/07-coding-convention.md)을 기반으로 은퇴설계 모듈 전용 규칙 추가

---

## 1. 파일 구조

### 프론트엔드 (Next.js) - 추가 구조

```
frontend/src/
├── app/(main)/
│   ├── retirement/                        # 🆕 Wrap Retirement
│   │   ├── page.tsx                       # 메인 페이지 (탭 컨테이너)
│   │   ├── components/
│   │   │   ├── CustomerSelector.tsx       # 고객 선택 바
│   │   │   ├── TabNavigation.tsx          # 탭 네비게이션
│   │   │   ├── tab1/                      # 희망 은퇴플랜
│   │   │   │   ├── DesiredPlanTab.tsx
│   │   │   │   ├── DesiredAmountInput.tsx
│   │   │   │   └── CompoundGrowthChart.tsx
│   │   │   ├── tab2/                      # 투자흐름
│   │   │   │   ├── InvestmentFlowTab.tsx
│   │   │   │   ├── AnnualFlowTable.tsx
│   │   │   │   ├── InvestmentRecordTable.tsx
│   │   │   │   ├── AddRecordModal.tsx
│   │   │   │   └── TimelineView.tsx
│   │   │   ├── tab3/                      # 은퇴플랜
│   │   │   │   ├── RetirementPlanTab.tsx
│   │   │   │   ├── BasicInfoForm.tsx
│   │   │   │   └── ProjectionChart.tsx
│   │   │   ├── tab4/                      # 인터랙티브 계산기
│   │   │   │   ├── InteractiveCalcTab.tsx
│   │   │   │   ├── ComparisonChart.tsx
│   │   │   │   ├── DeviationDisplay.tsx
│   │   │   │   └── AIGuideResult.tsx
│   │   │   └── tab5/                      # 연금수령 계획
│   │   │       ├── PensionPlanTab.tsx
│   │   │       ├── PensionTypeSelector.tsx
│   │   │       └── LifecycleChart.tsx
│   │   ├── hooks/
│   │   │   ├── useRetirementCalc.ts       # 복리 계산 훅
│   │   │   ├── useCompoundInterest.ts     # 복리 공식
│   │   │   ├── useInvestmentRecords.ts    # 투자기록 CRUD
│   │   │   └── useRetirementStore.ts      # 은퇴설계 Zustand store
│   │   └── utils/
│   │       ├── compoundCalc.ts            # 복리 계산 유틸
│   │       ├── formatCurrency.ts          # 금액 포맷 (천단위 콤마)
│   │       └── retirementTypes.ts         # TypeScript 타입 정의
│   │
│   └── data-management/
│       └── wrap-accounts/                 # 🆕 랩어카운트 관리
│           ├── page.tsx
│           └── components/
│               └── WrapAccountTable.tsx
│
├── components/common/                     # 기존 공통 컴포넌트 재사용
│   ├── Table.tsx
│   ├── Modal.tsx
│   ├── Tab.tsx
│   └── ...
```

### 백엔드 (FastAPI) - 추가 구조

```
backend/app/
├── routers/
│   ├── retirement.py                      # 🆕 은퇴플랜 API
│   ├── investment_records.py              # 🆕 투자기록 API
│   └── wrap_accounts.py                   # 🆕 랩어카운트 API
├── models/
│   ├── retirement_plan.py                 # 🆕 은퇴플랜 모델
│   ├── investment_record.py               # 🆕 투자기록 모델
│   ├── wrap_account.py                    # 🆕 랩어카운트 모델
│   └── customer_retirement_profile.py     # 🆕 고객 은퇴프로필
├── schemas/
│   ├── retirement.py                      # 🆕 은퇴설계 Pydantic 스키마
│   ├── investment_record.py               # 🆕 투자기록 스키마
│   └── wrap_account.py                    # 🆕 랩어카운트 스키마
├── services/
│   ├── compound_calc.py                   # 🆕 복리 계산 서비스
│   ├── retirement_simulation.py           # 🆕 시뮬레이션 서비스
│   └── ai_retirement_guide.py             # 🆕 AI 가이드 서비스
└── tests/
    ├── test_compound_calc.py              # 🆕 복리 계산 테스트
    ├── test_retirement_api.py             # 🆕 은퇴플랜 API 테스트
    └── test_investment_records.py         # 🆕 투자기록 API 테스트
```

---

## 2. 네이밍 규칙

### 기존 Hub 규칙 계승
| 대상 | 규칙 | 예시 |
|------|------|------|
| 변수 | camelCase | `investmentAmount`, `returnRate` |
| 컴포넌트 | PascalCase | `InvestmentRecordTable`, `ComparisonChart` |
| 상수 | UPPER_SNAKE_CASE | `MAX_RETIREMENT_AGE`, `DEFAULT_RETURN_RATE` |
| API 라우터 | snake_case | `retirement_plans`, `investment_records` |
| DB 테이블 | snake_case | `retirement_plans`, `wrap_accounts` |
| DB 컬럼 | snake_case | `annual_return_rate`, `evaluation_amount` |

### 은퇴설계 도메인 용어 통일
| 한글 | 영문 변수명 | DB 컬럼명 |
|------|-----------|----------|
| 일시납금액 | lumpSumAmount | lump_sum_amount |
| 연적립금액 | annualSavings | annual_savings |
| 총납입금액 | totalContribution | total_contribution |
| 연간총수익 | annualTotalReturn | annual_total_return |
| 연간평가금액 | annualEvaluation | annual_evaluation |
| 연수익률 | annualReturnRate | annual_return_rate |
| 인출금액 | withdrawalAmount | withdrawal_amount |
| 목표은퇴자금 | targetRetirementFund | target_retirement_fund |
| 이격률 | deviationRate | deviation_rate |
| 운용중 | ing | ing |
| 종결 | exit | exit |

---

## 3. 복리 계산 관련 규칙

### 정확성 필수
- 금액 단위: **만원** (정수, BIGINT)
- 수익률: **%** (소수점 2자리, DECIMAL(5,2))
- 프론트엔드: 표시용 포맷만 처리 (천단위 콤마)
- 백엔드: 모든 계산 로직 수행 (프론트엔드 계산 금지)
- 테스트: 엑셀 수식 결과와 대조 검증 필수

### 계산 서비스 패턴
```python
# backend/app/services/compound_calc.py
class CompoundCalculator:
    @staticmethod
    def future_value(pv: int, rate: float, years: int, pmt: int = 0) -> int:
        """복리 미래가치 계산 (만원 단위, 정수 반환)"""
        pass

    @staticmethod
    def yearly_projections(params: RetirementParams) -> list[YearlyProjection]:
        """연도별 예상 평가금액 계산"""
        pass
```

---

## 4. API 응답 규칙

### 기존 Hub 규칙 계승
```python
# 성공
{"status": "success", "data": {...}}

# 에러
{"status": "error", "detail": "에러 메시지"}
```

### 계산 결과 응답
```python
# 시뮬레이션 결과
{
    "status": "success",
    "data": {
        "yearly_projections": [...],
        "summary": {
            "target_fund": 120000,
            "achievable_fund": 118500,
            "achievement_rate": 98.75
        }
    }
}
```

---

## 5. Git 커밋 메시지

기존 Hub Conventional Commits 규칙 계승:

```
feat(retirement): 3번탭 은퇴플랜 시뮬레이션 구현
fix(retirement): 복리 계산 소수점 반올림 오류 수정
feat(investment): 투자기록 연결상품 추적 기능 추가
feat(wrap-account): 랩어카운트 관리 CRUD 구현
test(retirement): 복리 계산 엑셀 대조 테스트 추가
```

스코프: `retirement`, `investment`, `wrap-account`, `pension`

---

## 6. 테스트 규칙

### 복리 계산 테스트 (최우선)
- 엑셀 수식 결과와 1원 단위까지 대조
- 경계값 테스트: 0%, 100%, 음수 수익률
- 장기 시뮬레이션: 50년 이상 계산 정확성

### API 테스트
- 각 탭별 CRUD 기본 테스트
- 데이터 흐름 테스트: 1번탭 저장 → 3번탭 반영 확인
- 고객 변경 시 데이터 격리 확인
