# 기업 리포트(투자기업 뉴스 브리핑) Tasks

- 기획서: [기업 리포트 기능 개발 기획서](https://claude.ai/code/artifact/65aa8f71-71c8-4256-8169-7c8f784fb07a) (v3, 결정 사항 31개 반영) · 로컬 사본 `docs/company_report/기획서_기업리포트.md`
- 메뉴: 콘텐츠 제작 > 기업 리포트 (`/content/company-report`), 기존 '테마 ETF 추천&관리' 삭제
- 브랜치: `feature/company-report` (main에서 분기, 단계별 PR)
- 규칙: 한 항목 구현 → 검증(typecheck·build·pytest·수동 확인) → 체크 → 다음 항목. 완료 시 `[x]`
- 태그: [BE] 백엔드 / [FE] 프론트 / [DB] 마이그레이션 / [OPS] 배포·크론 / [수동] 대표님·담당자 작업
- 표기: `(기획 N장)` = 기획서 해당 장

---

## P0 — 착수 전 준비 (개발과 병행)

- [ ] **P0-1** [수동] 알림톡 템플릿 B(데일리)·C(월간) SOLAPI 콘솔 심사 신청 — 문안은 `docs/company_report/alimtalk_templates.md` (기획 11장). 반려 시 간단안(A)으로 재신청
- [ ] **P0-2** [수동] 공공데이터포털 활용 신청: 특일 정보, 기상청 단기예보, 국민연금 가입 사업장, 국세청 사업자 상태조회 → `user_api_keys` provider `data_go_kr` 등록
- [ ] **P0-3** [수동] KIPRIS Plus 키 신청 → provider `kipris` 등록 (2단계에서 사용)
- [ ] **P0-4** [수동] 설정 화면에서 `claude`·`gemini`·`naver_search`·`dart`·`kis` 키 활성 확인
- [x] **P0-5** [BE] `user_api_keys.VALID_PROVIDERS`에 `data_go_kr`, `kipris` 추가 + 테스트 버튼 연결
- [ ] **P0-6** [OPS] 브랜치 `feature/company-report` 생성(완료), Railway Volume 마운트 경로 확인(파일 저장소)
- [x] **P0-7** [BE] `docs/company_report/` 폴더 생성, 알림톡 문안·프롬프트 초안 보관

---

## P1 — 데일리 MVP + 메뉴 정리 (약 1.5주)

### P1-A 메뉴·화면 뼈대
- [x] **P1-A1** [FE] `TopNav.tsx` '콘텐츠 제작'에서 '테마 ETF 추천&관리' 제거, '기업 리포트'(`/content/company-report`) 추가 (기획 10장)
- [x] **P1-A2** [FE] `home/page.tsx` 55행 바로가기 카드, `dashboard/page.tsx` 88행 버튼을 '기업 리포트'로 교체
- [x] **P1-A3** [FE] `app/(main)/content/etf-radar/` 삭제 (`docs/etf_report_manage`는 유지)
- [x] **P1-A4** [FE] `/content/company-report` 레이아웃: 상단 탭(투자기업 관리·기업 상세·브리핑·보고서 관리·기업DB·발송 설정) + 공통 검색창 자리. 기존 `.wh` 다크 테마·`common/Tab` 사용 (기획 4·10장)

### P1-B 데이터 모델
- [x] **P1-B1** [DB] `models/news_briefing.py`: `portfolio_companies`, `company_keywords`, `news_articles`(source·collected_via 포함), `news_briefings`, `briefing_recipients`, `briefing_send_logs`, `ai_review_logs`, `backfill_jobs` (기획 8장)
- [x] **P1-B2** [DB] Alembic `add_news_briefing_tables` (down_revision = 현재 head) + `pg_trgm` 확장 생성
- [x] **P1-B3** [BE] `models/__init__.py` 등록, `schemas/company_report.py` 요청·응답 스키마

### P1-C 공통 서비스
- [ ] **P1-C1** [BE] `services/llm_client.py`: Claude(Messages API, JSON 출력, 재시도, 토큰 기록)·Gemini 공용 호출. `report_service._call_claude_haiku` 호출부 교체
  - 진행: `llm_client.py` 완료(모든 호출 사용량 기록). 기존 `report_service._call_claude_haiku`는 기존 기능 영향 때문에 그대로 둠
- [x] **P1-C2** [BE] `services/company_report/cross_review.py`: Opus 작성 → Gemini 1차 → Claude 2차(새 호출) 엔진, 합의 안 된 문장 처리, `ai_review_logs` 저장 (기획 5장)
- [x] **P1-C3** [BE] 모델 ID `app_settings`(`report_main_model`, `report_review_model`, `briefing_summary_model`) 조회 헬퍼

### P1-D 기업 등록
- [x] **P1-D1** [BE] `dart_client` 확장: 회사명→corp_code 매핑(비상장 포함), 기업개황(`company.json`)
- [x] **P1-D2** [BE] `company_finder.py`: 검색어 → 후보 카드(DART·네이버·웹), `POST /companies/search-candidates`
- [x] **P1-D3** [BE] 키워드 제안(`/companies/keyword-suggest`)·검색 미리보기(`/companies/preview-search`)
- [x] **P1-D4** [BE] 기업 CRUD API (`/api/v1/company-report/companies`)
- [x] **P1-D5** [FE] 투자기업 목록 + [기업 추가] 모달: 검색어 → 후보 카드 → [반영]/[다시 찾기]/[직접 등록] → 키워드 칩·미리보기 → 내부 정보 → 저장

### P1-E 수집·요약·데일리
- [x] **P1-E1** [BE] `naver_news_client` 보강: `start` 페이지네이션, `pubDate` 파싱, 조합 검색
- [x] **P1-E2** [BE] `collector.py` + `dedup.py`: 필수어 수집, URL 정규화·중복, 제외어, 관련도 규칙 점수
- [x] **P1-E3** [BE] 기본 백필: 등록 직후 네이버·DART 6개월 (완성판·검증은 P2-G)
- [x] **P1-E4** [BE] `summarizer.py`: 기사 요약(Haiku, JSON: summary·tag·issue_type·relevance), 기업 한 줄
- [x] **P1-E5** [BE] `services/collectors/market_indices.py`: KIS 지수 시가·종가(`get_index_closes` 보강, 0001·1001) + yfinance(`^GSPC`,`^IXIC`,`^DJI`), 휴장일 처리
- [x] **P1-E6** [BE] `data_go_kr.py`: 특일 정보(발송일 판정), 기상청 단기예보(서울)
- [x] **P1-E7** [BE] `daily.py`: 기본정보(날짜·날씨·전일 증시·건수) → 종합브리핑 → 기업별 브리핑, 교차 검토, 08:20 미완료 시 단순 브리핑 대체
- [x] **P1-E8** [FE] 브리핑 화면(데일리 탭, 모바일 우선): 기본정보·증시 표, 종합브리핑, 기업별 카드, 날짜 이동, `?next=` 로그인 복귀

### P1-F 발송
- [x] **P1-F1** [BE] `solapi_service`: `send_bulk_alimtalk`(send-many), `disable_sms` 파라미터, `print` 제거, 템플릿 B 등록
- [x] **P1-F2** [BE] 발송·멱등성(`status=sent`), LMS 대체, `briefing_send_logs`, 승인 모드(`news_briefing_review_until`), 승인 API는 `is_superuser`만
- [x] **P1-F3** [BE] 수신자 API(직원 2~5명 선택), 테스트 발송(나에게)
- [ ] **P1-F4** [OPS] `scripts/run_news_briefing.py` (`daily-build`, `send`, `collect`) + Railway Cron 2개 (`0 22 * * 0-4`, `30 23 * * 0-4`)
  - 2026-10-01: 발송 설정 탭에 **자동 실행 상태(Railway Cron)** 카드 추가 — 배치가 돌 때마다 `cr_cron_last:<명령>` 기록, 예정 시각과 비교해 정상/멈춤 의심/실패/기록 없음 표시(`services/company_report/cron_status.py`). 화면 [지금 만들기]·[지금 발송]은 기록 안 함. 세 서비스(briefing-build·briefing-send·briefing-monthly)가 '정상'이 되면 체크
  - 진행: 스크립트 완료(`backend/scripts/run_news_briefing.py`, `summarize` 추가). Railway Cron 서비스 등록은 [수동]
- [ ] **P1-F5** [수동] 시범 운영 7일(승인 모드), 매일 브리핑 품질 확인

### P1 완료 기준
- [ ] 평일 08:30 지정 직원에게 교차 검토된 데일리 알림톡이 도착하고, 링크로 로그인 후 웹 브리핑이 열린다
- [ ] 기업 5곳 이상 등록, 6개월 기본 백필 완료, 오탐률 10% 이하(샘플 확인)

---

## P2 — 기업 상세·원장·기업DB·공공데이터·검색·백필 검증·설정 (약 2주)

> 2026-09-28 코드 완료. 실제 PostgreSQL E2E(`tests/company_report/test_e2e_pg.py`)와 화면 확인 완료. 실데이터 확인(완료 기준)은 배포 후.

- [x] **P2-1** [FE/BE] 기업 상세 > 기사 아카이브: 달력(기사 있는 날 점, 주의 날 색), 날짜 클릭 목록, 기간 선택, 필터, '관련 없음' (`/article-dates`, `/articles?date=`)
- [x] **P2-2** [BE] 기간 요약 API + `company_period_summaries` 캐시
- [x] **P2-3** [DB/BE] `company_facts`, `company_funding_rounds` + 기사에서 사실·투자 라운드 후보 자동 추출 (`facts.py`)
- [x] **P2-4** [FE] 기업 원장 탭: 유형별 타임라인, 투자유치 표, [확정]/[제외]/수정, 월간 요약 목록
  - 진행: 월간 요약 목록은 월간 요약 테이블을 만드는 P3에서 추가
- [x] **P2-5** [DB/BE] 기업DB: `company_files`, `services/storage.py`(Railway Volume), 파일명 규칙 `{기업명}_{종류}_{기간}_{버전}`, 업로드 자동 이름 변경 (기획 7-2)
- [x] **P2-6** [BE] 자동 파일: 기업카드 PDF, 월별 뉴스 모음 MD, 투자유치·사실 원장 엑셀
  - 진행: 월별 뉴스 MD·사실원장/투자유치 xlsx·기업카드 PDF·데일리 브리핑 PDF. 한글 PDF 폰트는 Dockerfile의 fonts-nanum. 파일은 Volume이 붙은 웹 서비스의 file_worker가 만든다(Cron 컨테이너는 표시만)
- [x] **P2-7** [FE] 기업DB 화면: 폴더 트리, 파일 목록, 필터(기업·폴더·기간·형식·자동/업로드·상태), 미리보기, 폴더 zip
- [x] **P2-8** [DB/BE] `company_public_data` + 국민연금 사업장·KIPRIS·사업자 상태 월 1회 스냅샷
- [x] **P2-9** [DB/BE] `search_index` + 저장 시 색인 갱신(`index_entity`/`remove_entity`), 기존 데이터 일괄 색인, `/search` API (기획 7-4)
- [x] **P2-10** [FE] 통합 검색: 모든 탭 상단 검색창, 결과 화면(종류별 탭·필터·하이라이트·정렬)
  - 진행: 결과 엑셀 내보내기·자주 쓰는 검색 저장·[AI로 정리]는 P5-6에서
- [x] **P2-11** [BE] 과거 데이터 구축 완성: 네이버 조합 검색, 구글 뉴스 RSS 주 단위 분할(100건 도달 시 일 단위), DART 기간, 웹 보강, 과거 월간 요약 생성 (기획 7-5)
  - 진행: '웹 보강'은 ③ 핵심 사건 대조에서 빠진 사건을 구글 RSS로 자동 보충하는 방식으로 구현. 과거 월간 요약 생성은 P3(월간 요약 테이블)에서
- [x] **P2-12** [BE] 백필 검증 ①~⑥: 기간 커버리지, 출처 간 대조·수집률 추정, 핵심 사건 점검(Claude·Gemini), DART 대조, 샘플 검수, 사실 추출 점검 → 판정·결과서 PDF
- [x] **P2-13** [FE] 수집 현황 패널: 월별 막대, 출처별 건수, 판정, [과거 데이터 가져오기], 진행률, 샘플 검수 화면
- [x] **P2-14** [FE] 발송 설정 화면: 수신자, 승인 기간, 날씨 지역, 모델, 출처 연결 상태, AI 사용량, SOLAPI 잔액
  - 진행: 날씨 지역·AI 사용량(추정 금액)·SOLAPI 잔액·저장소 사용량 추가
  - 진행: 1차 화면 완료(발송 켜기·승인 기간·수신자·템플릿 ID·모델·연결 상태·발송 기록). 날씨 지역 선택·AI 사용량·잔액은 남음
- [x] **P2-15** [BE] DART 공시 데일리 병합
- [ ] **P2-16** [수동] 구글 뉴스 RSS 날짜 구간 검색 실동작 확인(비공식 기능)

### P2 완료 기준
- [ ] 등록 기업 전체가 백필 검증 '충분' 또는 확인된 '보완 필요'
- [ ] 기업명·키워드로 기사·원장·파일이 통합 검색된다

---

## P3 — 월간 브리핑 (약 1주)

- [x] **P3-1** [DB] `company_monthly_digests`, `monthly_briefings` (마이그레이션 r5m6o7n8t9h0)
- [x] **P3-2** [BE] `monthly.py`: 기업별 월간 요약 → 월간 브리핑 5개 섹션(이달의 요약·포트폴리오 동향·기업별 정리+고객 설명 포인트·주의 기업·다음 달 체크포인트), 교차 검토, 삭제 30% 초과 시 보류 (기획 5장)
  - 진행: 기업별 요약은 동시 4개로 작성, 교차 검토는 기업 6곳씩 묶어서 진행. 보류(held)는 관리자가 [내용 확인 · 발송 허용]
- [x] **P3-3** [BE] 발송: 매월 1일 데일리와 함께 두 건(템플릿 C), 1일이 휴일이면 다음 영업일
  - 진행: `send` 배치가 데일리 뒤에 월간도 확인해서 보냄. 10일이 지나면 자동 발송하지 않음(관리자 [지금 발송]). 발송 설정에 '월간 켜기/끄기'
- [x] **P3-4** [OPS] Cron `0 18 * * *`(1일만 실행) + 지난 달 커버리지 점검 추가
  - 진행: 명령 `python scripts/run_news_briefing.py monthly`. 커버리지 점검 = 직전 3개월 평균 대비 기사가 크게 준 기업 표시. **Railway에 Cron 서비스 등록은 사용자 작업**
- [x] **P3-5** [FE] 월간 탭(차트 포함, 기존 recharts) + 기업 원장 탭 '월간 요약' 목록
- [ ] **P3-6** [수동] 지난 달 데이터로 시험 발송 — 브리핑 > 월간 > [지난 달 지금 만들기] → [나에게 테스트 발송]

---

## P3+ — 운영 중 개선 (2026-09-29)

- [x] 카톡 [브리핑 보기] → 로그인 없는 폰 전용 화면(`/m/daily`·`/m/monthly`, 문장별 [1][2] 원문 링크). 승인된 v1 템플릿 그대로,
  버튼 변수 자리에 수신자별 열쇠값(`mobile_link.py`, `mobile_view.py`, 프론트 `proxy.ts`). 문자 대체 발송은 본문 끝에 화면 주소
  - (보류) 본문에 링크를 나열하는 v2 안 — [번호]를 누를 수 없고 재검수 필요. 짧은 링크(`/r/코드`)는 남겨 둠
- [x] 사실 원장 자동 검증(`fact_verify.py`): 원문 대조(인용)·주체 확인·독립 출처 수·Gemini 검색 교차 확인·공시 → 자동 확정/제외. 단일 출처도 '단일 출처' 표시로 자동 확정(담당자 결정). 사람은 '출처 어긋남'만 확인
- [x] 기사 제목을 누르면 원문 화면을 그 자리에(iframe, 사이트가 막으면 본문 글)

## P4 — 반기 기업 종합보고서 (출력용, 약 2.5주)

> **권한 결정 (2026-09-30, 대표님 확정 — `docs/login_logic` D-2)**
> - 반기 기업 종합보고서는 **매니저도 만든다.** 매니저가 자기 고객의 가입 상품(투자 기업)에 맞춰 고객별로 뽑아야 하므로 관리자 전용 기능이 아니다.
> - 고객 기준으로 뽑을 때는 권한 규칙을 따른다: 매니저는 담당 고객만, 대표는 전체 (`app/core/permissions.py`의 `assert_client`·`scope_clients` 사용).
> - 브리핑 발송·수신자·발송 설정 같은 회사 차원 설정은 기존 기업 리포트 관리자 체계 유지. 대표(owner)는 항상 관리자로 인정됨.
> - 설계 시 P4-10 '관리자 승인' 단계가 매니저 생성 흐름을 막지 않도록 할 것(승인 필요 여부는 착수 시 대표님 확인).

- (2026-10-01) 담당자별 규칙: 기업 목록은 '추가한 계정' 방식(docs/login_logic P13). 반기 보고서는 고객에게 가므로 데일리·월간과 별도의 고객 수신자 명단이 필요
- (2026-10-01 대표님 결정) 매니저가 만든 반기 보고서는 **대표 승인 없이** 매니저가 독립적으로 검토·출력·발송한다. P4-10의 '관리자 승인'은 매니저 보고서에 걸지 않는다
- (2026-10-01 대표님 결정) 고객 전달은 **출력(PDF·DOCX)과 카톡 링크 발송 둘 다** 지원한다(필요는 바뀌므로). 발송 쪽은 고객별 수신자·발송 기록·새 알림톡 템플릿(심사) — P4-10에서
- [x] **P4-1** [DB] `company_documents`, `company_reports`(period_year·period_half·sales_note), `report_images`, `report_exports` — 마이그레이션 `e1r2p3t4h5y6`. 보고서는 자동 생성본(owner_user_id 없음) + 담당자가 고친 자기 버전(owner_user_id), 출력 기록에 고객(client_id)
- [x] **P4-2** [BE] 자료함 파서 7종(pdf·docx·md·pptx·hwpx·hwp·ppt) 텍스트·이미지 추출 + AI 문서 메모, 투자사 보고서 포함 (고객 개인 투자 금액·지분은 제외) — `doc_parser.py`(+xlsx·csv·txt), `documents.py`. 03_자료 업로드 시 자동 읽기, 스캔본 PDF 는 Claude 가 PDF 를 직접 읽음, AI 메모(종류·요약·핵심 사실·고객 개인 투자 정보 표시·공개 여부), 본문 검색 색인, 놓친 건 file_worker 가 재처리. 화면: 기업 상세 > 반기 보고서 탭 '자료함'
- [x] **P4-3** [OPS] LibreOffice 설치 여부 결정(Dockerfile 또는 별도 변환 워커) — **설치하지 않음**(이미지 수백 MB 증가·변환 워커 운영 부담). hwp 는 OLE 레코드 직접 해석(olefile), ppt 는 글자 레코드만 읽음. doc·xls(옛 형식)는 '새 형식으로 저장해 다시 올려 달라' 안내. 표·그림이 중요한 문서는 PDF·hwpx·pptx 권장(화면 안내)
- [x] **P4-4** [BE] 자료 요청 절차: 6월 말·12월 말 알림, 기업별 체크리스트 — `doc_requests.py`. 체크리스트 6항목(IR·재무·주주명부·투자사 보고서·보도자료·기타)은 app_settings `doc_request:{기업}:{2026H1}`, 자료함에 그 종류 문서가 올라오면 자동 '받음'. 6/30·12/30 09:00 그 기업을 목록에 둔 사람에게 문자 1통(발송 꺼짐이면 안 보냄). 화면: 반기 보고서 탭 '자료 요청'(6/15~7/31·12/15~1/31 안내 띠), 보고서 관리 안내 띠
- [x] **P4-5** [BE] `half_year.py`: 10개 항목 + 부록(링크), 웹 보강, 교차 검토, 영업 대화 노트, 문장 규칙(두괄식·고등학생 수준·출처 번호) (기획 6장) — 출처 P·G·F·R·M·A·D·X·W, 웹 보강(주소 없는 웹 사실은 버림), 초안(블록: 문단·표·타임라인), 교차 검토(Gemini 그라운딩 → Claude, 불합의는 노란 표시로 남김), 부록 자동 생성(인용 순 번호·비공개 자료 링크 없음), 검색 색인. API: `POST/GET /companies/{id}/reports`, `GET /reports/{id}`, `GET /report-images/{id}/file`. 화면 1차: 반기 보고서 탭 [보고서 만들기]·진행률·본문 보기
- [x] **P4-6** [BE] 이미지: 기본 차트 2종(투자유치 타임라인, 재무 추이 또는 사건 타임라인) + 후보 선정·캡션, 2~10개 제한, 기사 사진 사용 금지 — `charts.py`(matplotlib·나눔고딕), 자료함 그림 최대 12장을 Claude 가 보고 골라 항목·측션 지정(고객 개인 투자 정보가 있는 문서 그림 제외)
- [x] **P4-7** [BE] `exporters.py`: 인쇄용 PDF(A4, Dr.GM 브랜드, 링크 클릭)·DOCX, 기업DB `04_보고서` 자동 저장, 출력 기록 — reportlab(나눔고딕, 남색·금색 표지·한 장 요약·단계 막대·부록 링크·쪽 아래 연락처)·python-docx. `GET /reports/{id}/export?format=pdf|docx&client_id=`. 기업DB 저장은 공용 자동 생성본만(그 기업을 추가한 모든 매니저가 보는 폴더라 고객용·개인 수정본은 기록만). 고객용은 표지에 고객 이름, 쪽 아래 그 고객 담당자 연락처(내 고객만)
- [x] **P4-8** [BE] `report-content` API(고객자산관리 종합 보고서 연동용), 일괄 출력(zip) — `GET /companies/{id}/report-content?year&half`(요약 3줄·달라진 점·단계·재무, 내부 표시 뺌), `POST /reports/export-batch`(기업마다 '지금 쓸 보고서': 내 검토 완료본 → 내 검토 중 → 공용본, 없으면 zip 안 `_빠진_기업.txt`). `report_hub.py`
- [x] **P4-9** [FE] 기업 상세 > 반기 보고서 탭: 본문·이미지 / 문장별 출처·검토 결과, 편집, 버전, [검토 완료] — [고치기]: 문장·표 행 고치기/삭제/'확인함', 그림 넣기·빼기(2~10)·설명·항목. 공용본을 고치면 '내 버전'이 새로 생기고(공용본은 그대로), 검토 완료본을 고치면 새 버전(v+1). [검토 완료]는 확인 필요 문장이 남아도 막지 않고 개수를 묻는다. `report_edit.py`, `PATCH /reports/{id}/items/{item}`·`/images/{img}`, `POST /reports/{id}/finalize`
- [x] **P4-10** [FE] 보고서 관리: 반기별 진행 현황, ~~관리자 승인~~(대표 결정으로 없음), 출력, 출력 기록 — 보고서 관리 탭: 단계별 개수·기업별 단계·확인 필요·출력/발송 수, 대표는 매니저별 개인 버전도 봄, PDF/DOCX 한꺼번에(zip), 출력·발송 기록. 고객 발송: [고객에게 보내기](검토 완료한 내 버전만, 내 담당 고객만) → 알림톡 템플릿 D 승인 전에는 문자(LMS)로 링크, `briefing_send_logs`(report)·`report_exports`(link) 기록. 고객 폰 화면 `/m/report?t=`(로그인 없음, 서명 열쇠 180일, 내부 표시 뺌, 고른 그림만, PDF 저장, 담당자 연락처) — `report_share.py`
- [x] **P4-11** [OPS] Cron `0 17 30 1,7 *`(1/31·7/31 02:00 KST), 미승인 보고서 매주 월요일 알림 — `run_news_briefing.py half-year`(예약만; Cron 에는 그림 저장소가 없어 실제 작성은 웹 서비스 file_worker 가 30분마다 3건씩, 2시간 넘게 멈춘 것은 실패 처리), `report-reminders`(매주 월 09:00, '검토 완료' 안 한 보고서가 있는 사람에게 문자), `doc-requests`(6/30·12/30). 자동 실행 상태 카드에 3개 추가(드문 작업은 첫 예정일 전 '첫 실행 대기'). **Railway 에 Cron 서비스 3개를 만들어야 함**(report-half-year·report-doc-requests·report-reminders, `railway.cron.toml` 주석 참고)
- [ ] **P4-12** [수동] 품질 시험: 기업 3곳(비상장 2, 상장 1) 보고서를 전 문장 대조

---

## P5 — 고도화 (약 1.5주)

- [ ] **P5-1** [BE] 구글 알리미 RSS 보조 수집
- [ ] **P5-2** [BE] '관련 없음' 피드백 기반 제외어 추천, AI 관련도 재판정, 제목 유사도 그룹핑 개선
- [ ] **P5-3** [FE/BE] 엑셀 일괄 등록, URL 수동 추가
- [ ] **P5-4** [BE] DART 기업개황 주기 갱신, '주의' 기사 즉시 알림, 휴·폐업 이상 신호 알림
- [ ] **P5-5** [BE] 보존 정책 자동화(오탐 90일, 검토 로그 2년, 비활성 기업 파일 이동)
- [ ] **P5-6** [BE] 통합 검색 2단계: pgvector 가능 시 의미 검색, [AI로 정리], 검색 저장·엑셀
- [ ] **P5-7** [수동] 유료 기업정보·투자 DB 재검토(첫 반기 보고서 결과 기준)

---

## 개발 중 확인 항목

- [ ] Railway PostgreSQL에서 `CREATE EXTENSION IF NOT EXISTS vector;` 가능 여부 (P5 전)
- [ ] KIS 해외지수 조회 지원 여부 (yfinance 실패 대비) — 현재: 한국 지수만 KIS 대체 구현, 미국 지수는 실패 시 '조회 실패' 표시
- [x] 서버 시간대: Railway는 UTC. 기업 리포트 코드는 `timeutil.now_kst()`로 KST 저장·판단
- [ ] 구글 뉴스 RSS `after:`/`before:` 실동작 (P2-16)

## 테스트 (각 단계 공통, `backend/tests/api/` 패턴)

- 중복 제거·제외어 사례, 데일리 멱등성, 승인 기간 자동 전환, 발송일 판정(주말·공휴일), 교차 검토 불합의 처리
- 7개 형식 파서(샘플 파일), 미승인 보고서 출력 차단, 관리자 외 승인 차단, 이미지 2~10개 제한, 휴장일 증시 표시
- LLM·SOLAPI·외부 API는 목킹

- [x] Railway Volume은 한 서비스에만 붙음 → 기업DB 파일은 웹 서비스(file_worker)가 만들고, Cron은 `company_db_files_dirty_at` 표시만 남긴다
- [x] (기존 버그) 새로고침하면 로그인 화면으로 가던 문제: zustand v5 첫 렌더 서버 스냅샷 때문 → ProtectedRoute에서 실제 저장 상태로 판단하도록 수정
- [ ] 구글 뉴스 RSS·국민연금·KIPRIS·국세청 실응답 형식 확인(키 발급 후, 코드는 JSON/XML 모두 처리)
