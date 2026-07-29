# GM ETF Radar — v1 화면 명세 (관리자 콘솔)

- 버전: v2.0 스키마 / 작성일: 2026-07-29
- 근거: [GM_ETF_Radar_v1_Spec.md](./GM_ETF_Radar_v1_Spec.md) §4·§5, [GM_ETF_Radar_v1_Tasks.md](./GM_ETF_Radar_v1_Tasks.md)
- 원칙: 화면은 "무엇이 필요한지"만 선언(data_requirements) · 백엔드는 "어떻게 제공할지" 독립 결정
- 라우트 베이스: `/content/etf-radar`

---

## 도메인 리소스 (specs/domain 상당)

```yaml
version: "2.0"
resources:
  reports:
    fields:
      id: string
      title: string
      status: enum[DRAFT, G1_REVIEW, G2_REVIEW, PUBLISHED, ARCHIVED]
      target_markets: array[enum[KR, US]]
      theme_count_requested: int
      created_by: string
      created_at: datetime
      published_at: datetime?
      pdf_url: string?
      prev_report_id: string?
    operations: [list, get, create, update]

  report_stages:
    fields:
      id: string
      report_id: string            # → reports.id
      stage: enum[S1, S2, S3, S4, S5, S6]
      output_json: json
      prompt_version: string
      status: enum[PENDING, DONE, FAILED]
      created_at: datetime
    operations: [list, get]

  report_themes:
    fields:
      id: string
      report_id: string            # → reports.id
      market: enum[KR, US]
      name: string
      rank: int
      logic: string
      etf_products_json: json       # S5 실사 결과
      exit_conditions_json: json    # 2차 F3 시그널 원천 (관측가능 형태)
    operations: [list, get, update]
```

---

## 화면 목록 (index)

```yaml
screens:
  - { id: report-list,    name: 리포트 목록,      route: /content/etf-radar }
  - { id: report-create,  name: 생성 실행/진행,   route: /content/etf-radar/new }
  - { id: report-g1,      name: G1 테마 검토,     route: /content/etf-radar/[id]/g1 }
  - { id: report-g2,      name: G2 발행,          route: /content/etf-radar/[id]/g2 }
  - { id: report-viewer,  name: 리포트 뷰어,      route: /content/etf-radar/[id] }
flow: >
  report-list → report-create → (자동 S1~S4) → report-g1 → (자동 S5~S6) → report-g2 → report-viewer
```

---

## S-1 리포트 목록 (report-list)

```yaml
version: "2.0"
screen: { name: 리포트 목록, route: /content/etf-radar, layout: main }

data_requirements:
  - resource: reports
    needs: [id, title, status, target_markets, theme_count_requested, created_at, published_at]
    sort: { created_at: desc }

components:
  - id: header_bar
    type: toolbar
    position: top
    function: 제목 + [새 리포트 생성] 버튼(→ report-create)
  - id: report_table
    type: table
    position: main
    function: 리포트 행 목록 — 상태 배지·제목·시장·테마수·생성일. 행 클릭 → 상태별 이동
    data_source: { resource: reports }
    columns: [status_badge, title, target_markets, theme_count_requested, created_at]
  - id: status_badge
    type: badge
    function: DRAFT=회색 / G1_REVIEW=주황 / G2_REVIEW=파랑 / PUBLISHED=초록 / ARCHIVED=흐림

events:
  - trigger: 행 클릭
    action: status가 G1_REVIEW→g1 / G2_REVIEW→g2 / PUBLISHED→viewer / DRAFT|FAILED→create(진행)
  - trigger: 새 리포트 생성 클릭
    action: navigate report-create

tests:
  - { name: 초기 로드, when: 페이지 접속, then: [리포트 목록 표시, 상태 배지 색상 구분] }
  - { name: 빈 상태, when: 리포트 0건, then: ["아직 생성된 리포트가 없습니다" + 생성 버튼 강조] }
  - { name: 상태 라우팅, when: G1_REVIEW 행 클릭, then: [g1 검토 화면 이동] }
```

---

## S-2 생성 실행/진행 (report-create)

```yaml
version: "2.0"
screen: { name: 생성 실행/진행, route: /content/etf-radar/new, layout: main }

data_requirements:
  - resource: reports
    needs: [id, status]
    op: create               # 파라미터로 생성 트리거
  - resource: report_stages
    needs: [stage, status, created_at]
    filters: { report_id: "?id" }
    poll: 3s                 # 진행 상황 폴링

components:
  - id: param_form
    type: form
    position: main
    function: 대상 시장(KR/US 다중)·테마 수 입력 + [생성 시작]
    fields: [target_markets(checkbox), theme_count_requested(number, default 10)]
  - id: stage_progress
    type: stepper
    position: main
    function: S1~S4 단계 진행 표시(대기/진행/완료/실패). 폴링으로 갱신
    data_source: { resource: report_stages }
  - id: stage_fail_action
    type: inline-action
    function: STAGE FAILED 시 [해당 단계 재실행] 노출

events:
  - trigger: 생성 시작
    action: create reports → 파이프라인 비동기 실행 → stepper 폴링 시작
  - trigger: S4 완료(status=G1_REVIEW)
    action: navigate report-g1
  - trigger: 재실행
    action: 실패 지점부터 재구동

tests:
  - { name: 생성 시작, when: 파라미터 입력 후 시작, then: [report_id 생성, S1 진행 표시] }
  - { name: 진행 폴링, when: STAGE 완료됨, then: [stepper 단계 색상 갱신] }
  - { name: 실패 복구, when: STAGE FAILED, then: [재실행 버튼 노출, 재실행 시 재구동] }
  - { name: 자동 전이, when: S4 DONE, then: [G1 화면 자동 이동] }
```

---

## S-3 G1 테마 검토 (report-g1)

```yaml
version: "2.0"
screen: { name: G1 테마 검토, route: /content/etf-radar/[id]/g1, layout: sidebar-main }

data_requirements:
  - resource: reports
    needs: [id, title, status]
    filters: { id: "?id" }
  - resource: report_stages
    needs: [stage, output_json]
    filters: { report_id: "?id", stage: [S2, S3, S4] }   # 축출·레드팀·확정안
  - resource: report_themes
    needs: [id, market, name, rank, logic, exit_conditions_json]
    filters: { report_id: "?id" }

components:
  - id: theme_ranked_list
    type: list
    position: main
    function: S4 최종 테마안(3축 순위)·이탈조건 초안 표시, 순위 조정·되살리기(edit)
    data_source: { resource: report_themes }
  - id: culled_panel
    type: panel
    position: sidebar
    function: S2 축출 사유·재진입 조건 + S3 레드팀(bear case·조기경고지표) 전문
    data_source: { resource: report_stages }
  - id: gate_actions
    type: action-bar
    position: bottom
    function: [승인] / [테마 수정] / [S1부터 재실행]

events:
  - trigger: 승인
    action: POST g1(approve) → status G2 대기로 진행(S5·S6 자동), navigate 대기/진행
  - trigger: 테마 수정
    action: POST g1(edit, 수정 payload) → 재검토
  - trigger: 재실행
    action: POST g1(rerun) → status DRAFT, navigate report-create

tests:
  - { name: 검토 표시, when: G1 진입, then: [테마안·축출사유·레드팀 3영역 표시] }
  - { name: 승인 흐름, when: 승인 클릭, then: [S5·S6 자동 트리거, G2 대기로 이동] }
  - { name: 수정 반영, when: 테마 되살리기 후 저장, then: [수정된 테마안 재표시] }
  - { name: 재실행, when: 재실행 클릭, then: [DRAFT 전이, 생성 화면 이동] }
```

---

## S-4 G2 발행 (report-g2)

```yaml
version: "2.0"
screen: { name: G2 발행, route: /content/etf-radar/[id]/g2, layout: main }

data_requirements:
  - resource: reports
    needs: [id, title, status, pdf_url, prev_report_id]
    filters: { id: "?id" }
  - resource: report_stages
    needs: [stage, output_json]
    filters: { report_id: "?id", stage: [S5, S6] }        # 실사·렌더(변경요약 포함)

components:
  - id: report_preview
    type: document-preview
    position: main
    function: 렌더된 리포트 웹 미리보기 + PDF 미리보기(pdf_url)
    data_source: { resource: report_stages }
  - id: change_summary
    type: panel
    position: main
    function: 직전 리포트 대비 변경 요약(테마 진입/이탈/순위) — prev_report_id 있을 때만
  - id: publish_action
    type: action-bar
    position: bottom
    function: [발행 승인] (status → PUBLISHED, published_at 기록)

events:
  - trigger: 발행 승인
    action: POST g2(publish) → status PUBLISHED, navigate report-viewer

tests:
  - { name: 미리보기, when: G2 진입, then: [웹·PDF 미리보기 표시] }
  - { name: 변경요약, when: prev_report_id 존재, then: [변경 요약 섹션 표시] }
  - { name: 발행, when: 발행 승인, then: [PUBLISHED 전이, 뷰어 이동, published_at 기록] }
```

---

## S-5 리포트 뷰어 (report-viewer)

```yaml
version: "2.0"
screen: { name: 리포트 뷰어, route: /content/etf-radar/[id], layout: main }

data_requirements:
  - resource: reports
    needs: [id, title, status, pdf_url, published_at, target_markets]
    filters: { id: "?id" }
  - resource: report_themes
    needs: [id, market, name, rank, logic, etf_products_json]
    filters: { report_id: "?id" }

components:
  - id: report_web_view
    type: document
    position: main
    function: 발행 리포트 웹 뷰(테마·실사표·면책문구)
    data_source: { resource: report_themes }
  - id: pdf_download
    type: button
    position: top
    function: PDF 다운로드(pdf_url)
  - id: meta_bar
    type: info-bar
    position: top
    function: 제목·발행일·대상 시장·상태 배지

events:
  - trigger: PDF 다운로드 클릭
    action: pdf_url 다운로드

tests:
  - { name: 열람, when: 발행 리포트 진입, then: [웹 뷰·테마 실사표 표시] }
  - { name: 다운로드, when: PDF 다운로드, then: [PDF 파일 저장] }
  - { name: 미발행 접근, when: PUBLISHED 아님, then: [열람 불가 안내 or 해당 게이트로 유도] }
```

---

## 공통 요소 (shared)

```yaml
components:
  status_badge: { states: [DRAFT, G1_REVIEW, G2_REVIEW, PUBLISHED, ARCHIVED, FAILED] }
  gate_action_bar: { actions: [approve, edit, rerun, publish] }
  disclaimer_footer: { text: "본 자료는 정보 제공이며 투자자문·매매 지시가 아닙니다." }  # 전 화면·PDF 고정
types:
  ReportStatus: enum[DRAFT, G1_REVIEW, G2_REVIEW, PUBLISHED, ARCHIVED]
  Stage: enum[S1, S2, S3, S4, S5, S6]
  Market: enum[KR, US]
```

## 도메인 커버리지 검증

| 화면 | 사용 리소스 | 커버 필드 | 상태 |
|---|---|---|---|
| S-1 목록 | reports | status·title·markets·created_at | ✅ |
| S-2 생성 | reports(create)·report_stages | stage·status(poll) | ✅ |
| S-3 G1 | reports·report_stages(S2~S4)·report_themes | 축출·레드팀·테마안·이탈조건 | ✅ |
| S-4 G2 | reports·report_stages(S5~S6) | pdf_url·변경요약 | ✅ |
| S-5 뷰어 | reports·report_themes | pdf_url·실사(etf_products) | ✅ |

> 모든 화면 needs가 도메인 리소스 fields로 커버됨. 누락 없음.
> Stitch 목업 생성(Phase 5)은 이번 범위에서 생략(디자인은 기존 Navy 시스템 + Dr.GM 규격 준수).
