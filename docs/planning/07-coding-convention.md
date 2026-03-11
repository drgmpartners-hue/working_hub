# Working Hub Manager 코딩 컨벤션

## 1. 프로젝트 구조

### 프론트엔드 (Next.js)

```
frontend/
├── src/
│   ├── app/                        # App Router
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx
│   │   ├── (main)/
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── commission/
│   │   │   │   ├── dr-gm/
│   │   │   │   │   └── page.tsx
│   │   │   │   └── securities/
│   │   │   │       └── page.tsx
│   │   │   ├── portfolio/
│   │   │   │   └── irp/
│   │   │   │       └── page.tsx
│   │   │   ├── investment/
│   │   │   │   └── stock-recommend/
│   │   │   │       └── page.tsx
│   │   │   └── content/
│   │   │       ├── card-news/
│   │   │       │   └── page.tsx
│   │   │       ├── report/
│   │   │       │   └── page.tsx
│   │   │       └── cover-promo/
│   │   │           └── page.tsx
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── common/                 # 공통 컴포넌트
│   │   │   ├── Header.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Tab.tsx
│   │   │   ├── FileUpload.tsx
│   │   │   └── Modal.tsx
│   │   ├── dashboard/              # 대시보드 전용
│   │   │   ├── CategoryGroup.tsx
│   │   │   └── ProgramCard.tsx
│   │   ├── commission/             # 수당정산 전용
│   │   ├── portfolio/              # 포트폴리오 전용
│   │   ├── investment/             # 투자 분석 전용
│   │   └── content/                # 콘텐츠 제작 전용
│   ├── hooks/                      # 커스텀 훅
│   ├── lib/                        # 유틸리티
│   │   ├── api.ts                  # API 클라이언트
│   │   └── auth.ts                 # 인증 유틸
│   ├── stores/                     # 상태 관리
│   └── types/                      # 타입 정의
├── public/
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### 백엔드 (FastAPI)

```
backend/
├── app/
│   ├── main.py                     # FastAPI 앱 엔트리
│   ├── config.py                   # 설정
│   ├── database.py                 # DB 연결
│   ├── models/                     # SQLAlchemy 모델
│   │   ├── user.py
│   │   ├── commission.py
│   │   ├── portfolio.py
│   │   ├── stock.py
│   │   ├── content.py
│   │   └── brand.py
│   ├── schemas/                    # Pydantic 스키마
│   │   ├── user.py
│   │   ├── commission.py
│   │   ├── portfolio.py
│   │   ├── stock.py
│   │   └── content.py
│   ├── routers/                    # API 라우터
│   │   ├── auth.py
│   │   ├── commission.py
│   │   ├── portfolio.py
│   │   ├── stock.py
│   │   └── content.py
│   ├── services/                   # 비즈니스 로직
│   │   ├── auth_service.py
│   │   ├── commission_service.py
│   │   ├── portfolio_service.py
│   │   ├── stock_service.py
│   │   ├── content_service.py
│   │   ├── crawler_service.py
│   │   ├── ai_service.py
│   │   ├── excel_service.py
│   │   └── pdf_service.py
│   ├── utils/                      # 유틸리티
│   └── middleware/                  # 미들웨어
│       └── auth.py
├── alembic/                        # 마이그레이션
├── tests/
├── requirements.txt
└── pyproject.toml
```

---

## 2. 네이밍 규칙

### 프론트엔드 (TypeScript/React)

| 대상 | 규칙 | 예시 |
|------|------|------|
| 변수 | camelCase | `userName`, `isLoading` |
| 함수 | camelCase | `fetchData`, `handleClick` |
| 컴포넌트 | PascalCase | `Header`, `ProgramCard` |
| 상수 | UPPER_SNAKE_CASE | `API_BASE_URL`, `MAX_FILE_SIZE` |
| 타입/인터페이스 | PascalCase | `User`, `CommissionResult` |
| 파일 (컴포넌트) | PascalCase.tsx | `Header.tsx`, `FileUpload.tsx` |
| 파일 (유틸/훅) | camelCase.ts | `api.ts`, `useAuth.ts` |
| CSS 클래스 | Tailwind 유틸리티 | `className="flex items-center"` |

### 백엔드 (Python)

| 대상 | 규칙 | 예시 |
|------|------|------|
| 변수 | snake_case | `user_name`, `is_active` |
| 함수 | snake_case | `fetch_data`, `calculate_commission` |
| 클래스 | PascalCase | `User`, `CommissionService` |
| 상수 | UPPER_SNAKE_CASE | `DATABASE_URL`, `SECRET_KEY` |
| 파일 | snake_case.py | `auth_service.py`, `commission.py` |
| API 경로 | kebab-case | `/api/commission/dr-gm` |

---

## 3. API 규칙

### 엔드포인트 패턴
```
GET    /api/{resource}          # 목록 조회
POST   /api/{resource}          # 생성
GET    /api/{resource}/{id}     # 단일 조회
PUT    /api/{resource}/{id}     # 수정
DELETE /api/{resource}/{id}     # 삭제
POST   /api/{resource}/{action} # 특수 행동
```

### 응답 형식
```json
{
  "success": true,
  "data": {},
  "message": "성공",
  "error": null
}
```

### 에러 응답
```json
{
  "success": false,
  "data": null,
  "message": "에러 메시지",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": []
  }
}
```

---

## 4. Lint / Formatter

### 프론트엔드
| 도구 | 설정 |
|------|------|
| ESLint | next/core-web-vitals + typescript |
| Prettier | singleQuote: true, semi: true, tabWidth: 2 |
| TypeScript | strict: true |

### 백엔드
| 도구 | 설정 |
|------|------|
| Ruff | PEP 8 기반, line-length: 100 |
| mypy | strict 모드 |

---

## 5. Git 커밋 메시지

### Conventional Commits
```
<type>(<scope>): <description>

[optional body]
```

### 타입
| 타입 | 설명 |
|------|------|
| feat | 새 기능 |
| fix | 버그 수정 |
| docs | 문서 수정 |
| style | 코드 포맷팅 (기능 변경 없음) |
| refactor | 리팩토링 |
| test | 테스트 추가/수정 |
| chore | 빌드, 설정 변경 |

### 스코프 예시
```
feat(commission): Dr.GM 수당 계산 로직 추가
fix(portfolio): IRP 수익률 계산 오류 수정
feat(content): 카드뉴스 AI 생성 기능 구현
chore(deps): FastAPI 버전 업데이트
```

---

## 6. 브랜치 전략

```
main            # 배포 브랜치
├── develop     # 개발 통합 브랜치
│   ├── feat/commission-dr-gm     # 기능 브랜치
│   ├── feat/content-card-news
│   ├── fix/portfolio-calc-error
│   └── ...
```

| 브랜치 | 용도 |
|--------|------|
| main | 안정 배포 버전 |
| develop | 개발 통합 |
| feat/* | 기능 개발 |
| fix/* | 버그 수정 |
| hotfix/* | 긴급 수정 |
