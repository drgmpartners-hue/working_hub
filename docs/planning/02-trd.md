# Working Hub Manager TRD

## 1. 기술 스택

### 결정 방식
- **사용자 레벨**: L3 (경험자)
- **결정 방식**: AI 추천 + 사용자 선택

### 1.1 프론트엔드

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | Next.js | 풀스택 가능, 파일기반 라우팅으로 다수 프로그램 구성 적합 |
| 언어 | TypeScript | 타입 안전성, 대규모 프로젝트 유지보수 |
| 스타일링 | Tailwind CSS | 빠른 개발, 일관성 |
| 상태관리 | Zustand or React Context | 프로그램별 독립 상태 관리 |

### 1.2 백엔드

| 항목 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | FastAPI (Python) | AI/크롤링/엑셀/PDF 처리 Python 생태계 활용 |
| 언어 | Python 3.11+ | 타입 힌트, asyncio |
| ORM | SQLAlchemy | PostgreSQL 연동, 마이그레이션 |
| 마이그레이션 | Alembic | SQLAlchemy 연동 |

### 1.3 데이터베이스

| 항목 | 선택 | 이유 |
|------|------|------|
| RDBMS | PostgreSQL | 금융 데이터 안정성, 복잡한 쿼리, JSONB |

### 1.4 AI 연동

| 항목 | 선택 | 이유 |
|------|------|------|
| LLM #1 | Claude API (Anthropic) | 텍스트 분석/생성 강점 |
| LLM #2 | Gemini API (Google) | 멀티모달, 이미지 처리 |
| 설정 | API 키 사전 설정, 사용자가 선택하여 사용 | 유연성 |

### 1.5 크롤링/데이터 처리

| 항목 | 선택 | 이유 |
|------|------|------|
| 웹 크롤링 | Playwright | 동적 페이지 지원, 헤드리스 |
| 엑셀 처리 | openpyxl | 읽기/쓰기 모두 지원 |
| PDF 생성 | ReportLab / WeasyPrint | 보고서/명세서 PDF 출력 |
| 이미지 생성 | Pillow + AI API | 카드뉴스/표지 이미지 |

### Decision Log

| 결정 | 대안 | 선택 이유 |
|------|------|----------|
| Next.js | React+Vite, Vue+Nuxt | 파일기반 라우팅으로 다수 프로그램 페이지 구성 용이 |
| FastAPI | NestJS, Django | Python AI/크롤링 생태계 활용, 자동 API 문서 |
| PostgreSQL | MySQL, Supabase | 금융 데이터 정확성/안정성, JSONB 지원 |
| Claude+Gemini | OpenAI만 | 사용자 요청 - 복수 AI 선택 사용 |

---

## 2. 아키텍처

### 전체 구조

```
[Client: Next.js]
    ↓ HTTP/REST
[API: FastAPI]
    ├── [PostgreSQL] - 데이터 저장
    ├── [Playwright] - 웹 크롤링
    ├── [Claude/Gemini API] - AI 분석/생성
    ├── [openpyxl] - 엑셀 처리
    └── [ReportLab] - PDF 생성
```

### 아키텍처 패턴
- **Monolith (초기)**: 빠른 개발을 위해 단일 서비스로 시작
- **모듈러 구조**: 프로그램별 모듈 분리 (향후 마이크로서비스 전환 가능)

### API 통신
- Next.js → FastAPI: REST API
- 인증: JWT 토큰 기반

---

## 3. 보안 요구사항

| 항목 | 내용 |
|------|------|
| 인증 | JWT 기반 로그인 (모든 직원 동일 권한) |
| 비밀번호 | bcrypt 해싱 |
| API 키 보관 | 환경 변수 (.env), 서버 사이드 전용 |
| 데이터 전송 | HTTPS 필수 |
| 금융 데이터 | 서버 사이드에서만 처리, 클라이언트 노출 최소화 |
| 크롤링 자격증명 | 암호화 저장, 서버에서만 접근 |

---

## 4. 성능 요구사항

| 항목 | 목표 |
|------|------|
| 페이지 로딩 | < 3초 |
| API 응답 | < 2초 (일반), < 10초 (크롤링/AI) |
| 엑셀 처리 | < 30초 (1,000행 기준) |
| PDF 생성 | < 10초 |
| AI 콘텐츠 생성 | < 30초 |
| 동시 접속 | 20명 (회사 내부 사용) |

---

## 5. 개발 환경

| 항목 | 버전 |
|------|------|
| Node.js | 20 LTS |
| Python | 3.11+ |
| PostgreSQL | 16+ |
| Next.js | 15+ |
| FastAPI | 0.110+ |
| 패키지 관리 | npm (FE), pip/poetry (BE) |
