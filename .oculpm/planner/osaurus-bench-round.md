---
oculpm_plan: v1
id: osaurus-bench-round
title: "Osaurus 벤치마크 라운드 — 자동화 · 출처 · 테마 · 컨텍스트 경제학 · 선언적 설정"
status: active
created: 2026-08-31
updated: 2026-09-01
owner: claude-code
---

Osaurus(osaurus.ai — Swift/MLX 로컬 AI 하네스)를 조사해 ocul-pm 이 가져올 설계 15개를
확정하고 구현한다. 설계 SSOT 는 [`docs/20260831_osaurus-bench/`](../../docs/20260831_osaurus-bench/00-master-plan.md).

기능을 그대로 옮기지 않는다 — **구조와 UX 규약만** 기록기 맥락으로 번역한다.
Osaurus 의 "볼트 감시 → 편집이 멎으면 자동 커밋" 은 여기서 "작업 폴더 감시 →
손이 멎으면 일지 초안" 이 된다. 같은 기계, 다른 산출물.

순서: Phase 0→1→2→3 은 순차(0 의 잡 러너·발동 출처 위에 1·2 가 얹히고 3 이 그걸
드러낸다). Phase 4~7 은 서로 독립이라 병렬 가능. Phase 8(랜딩)은 반드시 마지막 —
없는 기능을 미리 광고하는 것 자체가 정직성 위반이다.

릴리스 매핑(실제): v2.26.0=P0+P1 · v2.27.0=P2+P3(P2 가 미태그였다) · v2.28.0=P4 ·
v2.29.0=P5 · v2.30.0=P6 · v2.31.0=P7. Phase 경계마다 5면을 채워 릴리스한다.

**마이그레이션 번호는 계획 시점에 예약한다** (병렬 Phase 충돌 방지):
033=automation(P0) · 034=project_theme(P4) · 035=context_recall(P5). 새 테이블이
필요해지면 이 줄에 먼저 추가하고 쓴다. 번호는 이미 비연속이다(010·025 결번) —
연속성이 아니라 유일성만 지킨다.

**모든 신규 코드가 지키는 게이트**: `lint:i18n`(UI 문자열은 전부 `t()` — 새 탭
3개가 한글을 직접 쓰면 막힌다) · `lint:bindings`(프런트는 `call` 래퍼, 백엔드는
`AppError{code,detail}` 이고 에러에 UI 언어 금지) · `lint:storage`(localStorage 는
`WorkspaceContext` 만 — 테마·자동화 상태를 여기 넣고 싶어지겠지만 금지).

## Phase 0 — 자동화의 토대 {#foundation}
- [x] Core Model 슬롯 — `core_provider`/`core_model` 설정 키 + LlmTab 「배경 작업 모델」 섹션, failover 체인 적용 {#core-model}
- [x] 기존 배경 작업 2종 이관 — `reconcile.rs`·`journal_draft.rs` 를 `core_*` 로. **조용한 정지 금지**: 자동화가 켜져 있으면 `default_*` 를 1회 시드(동작 변화 0) + 안내 카드 {#core-model-migrate}
- [x] `SessionKind::Schedule`/`Automation` + `sched-`/`auto-` 접두 — `manual-`/`mcp-` 와 동일 모양(`kind()` 분기 + `workday()` arm). `<workday>-sNN` 은 Unknown 으로 떨어져 금지 {#session-id-sources}
- [x] 잡 러너 `oculpm/automation/runner.rs` — try_lock 동시 1건·밀린 건 드롭+사유·취소 가능·redact 이중 방어·강등하되 소실 없음 {#job-runner}
- [x] 자동화 저장소 — `.oculpm/automation/{schedules,watchers}/<id>.md` frontmatter 파서/writer, 원자 쓰기·멱등(동일 바이트면 무기록) {#automation-store}
- [x] `033_automation.sql` — `automation_state`·`automation_runs` + 정의 파일 사라지면 상태 행 고아 정리 {#automation-migration}
- [x] `AutomationConfig` — `config.toml [automation]`(schedules·watchers·daily_run_budget), `#[serde(default)]`, `schema_version` 불변 {#automation-config}

## Phase 1 — Schedules (시간 자동화) {#schedules}
- [x] 빈도 모델 8종(once·minutes·hourly·daily·weekly·monthly·yearly·cron) + **신규 의존성 `cron`**, 다음 시각 계산은 순수 함수(월말·윤년·DST 테이블 테스트) {#schedule-frequency}
- [x] 스케줄 CRUD 커맨드 + bindings — 목록·생성·수정·삭제·일시중지/재개 {#schedule-crud}
- [x] 집행 루프 — 앱 생명주기 tick, `next_run_at` 도달 시 러너 enqueue, 전역 스위치와 개별 enabled 의 AND {#schedule-run}
- [x] 놓친 실행 따라잡기 — **최대 1회만**, `note="missed catch-up"` 표시, 일일 예산 초과 시 포기+사유 기록 {#schedule-catchup}
- [x] 설정 → 자동화 탭 — 카드 목록(다음/마지막 실행 요약) + ⋯메뉴(편집·지금 실행·기록·일시중지·삭제, 삭제는 `useConfirm()`) {#automation-tab}
- [x] 실행 기록(History) — `automation_runs` 역순 + 산출 일지로 `NAV_BUS.openEntity` 점프 {#run-history}
- [x] 에디터 2-pane + 지시문 작성 도움말 — "이 지시문이 그대로 모델에게 갑니다" {#schedule-editor}
- [x] 씨앗 3종 제안 — 주간 개발 요약(금 17:00)·아침 브리핑(매일 09:00)·월간 회고(1일 09:00), 비활성 상태로 {#seed-schedules}

## Phase 2 — Watchers · 반응성 티어 {#watchers}
- [x] 반응성 티어 6단(fast 200ms·balanced 1s·patient 3s·relaxed 60s·deferred 5m·extended 10m) — `debounce_ms` 는 커스텀 하위호환 유지 {#responsiveness-tiers}
- [x] settle-then-act 타이머 — relaxed 이상은 OS 워처가 아니라 러너 쪽 정착 타이머로(긴 디바운스의 이벤트 적체·유실 회피) {#settle-timer}
- [x] 워처 자동화 정의 → 러너 위임 — 정착 시 잡 enqueue, 정의는 `.oculpm/automation/watchers/` {#watcher-automation}
- [x] 정착 트리거 일지 초안 — 훅 AgentExit 외 두 번째 경로. 에이전트 우선·강등 보존·결정적 composer·redact 전부 유지 {#settle-journal-draft}
- [x] 두 초안 경로 중복 방지 — 정착 트리거는 창 안에 **어떤 일지든**(자필·`auto:*`) 있으면 스킵. 두 경로가 같은 중복 키 `(project_id, 구간)` 공유, 진 쪽은 사유 기록 {#draft-dedupe}
- [x] `auto_reconcile` 을 워처 자동화로 흡수 — 별도 트리거 경로 은퇴, 러너 하나로 수렴 {#reconcile-absorb}
- [x] 증폭 루프 가드 — journal/planner/automation/index 를 **트리거 원인에서 제외**(UI emit 판정과 분리) + 최소 간격(티어×2) + 일일 예산 {#loop-guard}
- [x] 멱등 가이드 + 트러블슈팅 문구 3종(안 돈다·너무 자주 돈다·결과가 이상하다)을 에디터·진단에서 같은 말로 {#idempotent-guidance}

## Phase 3 — 출처와 상태를 보이게 {#provenance}
- [x] 소스 파생 순수 함수 `sourceOf(sessionId, agentId)` — 직접·에이전트·자동 초안·스케줄·감시·MCP·백필·들여옴 8종 {#source-derive}
- [x] 소스 배지 — 일지 카드·오늘 피드·ACP 세션·검색 결과·회고 (`.chip` 프리미티브 재사용, 새 컴포넌트 없음) {#source-badges}
- [x] 배지 필터 레일 — 일지·ACP 두 곳에만. 목록에 소스가 1종이면 자동 숨김 {#source-filter-rail}
- [x] 활성 행 — `실행 중…` / `입력을 기다립니다` + 활성 버킷 정렬(`stabilizeHistory` 원장 규약은 불변) {#active-rows}
- [x] 인라인 Stop — 행 hover `.iconbtn` + 우클릭 메뉴, 자동화 실행 카드에도 동일 컨트롤(러너 취소 호출) {#inline-stop}
- [x] 닥터 탭 자동화 섹션 — 배경 모델(미설정이면 딥링크)·스케줄·감시·오늘 예산·최근 실패 {#doctor-automation}
- [x] 발동 원장을 디버깅 정식 경로로 — 진단 「발동」 섹션(상위 발동 + **한 번도 안 걸린 규칙**) + run 상세에서 원장 점프 {#firing-insights}

## Phase 4 — 테마 파일화 {#themes}
- [x] 테마 스키마 v1 — CSS 변수 이름을 그대로 키로, 부분 지정 상속, 허용 토큰 화이트리스트(임의 CSS 주입 차단) {#theme-schema}
- [x] 내장 5종을 같은 스키마로 생성 + `tokens.css` `[data-preset]` 블록과 일치 단언 테스트 {#builtin-themes-as-json}
- [x] 적용 경로 — `data-preset="custom"` + 인라인 CSS 변수, `settingsChanged` 로 전 창 동기. 강조 5토큰 미지정 테마는 `data-accent` **유지**(하나라도 지정하면 제거) {#theme-apply}
- [x] Import/Export — `metadata.id` 무시하고 새 UUID·`is_built_in` 강제 false·크기 상한·이름 충돌은 질의(조용한 덮어쓰기 금지) {#theme-io}
- [x] 라이브 프리뷰 에디터 — 앱 자체가 미리보기, 토큰마다 「가족 기본값으로 되돌리기」 {#theme-editor}
- [x] `follows_system_accent` — macOS 시스템 강조색에서 강조 5토큰 재유도 {#system-accent}
- [x] 프로젝트별 테마 — `034_project_theme.sql`: `ALTER TABLE projects ADD COLUMN theme_id TEXT`(027 과 같은 컬럼 방식, hex 아닌 id), 창 단위 적용, 무바인딩은 전역 폴백 {#project-theme}

## Phase 5 — 컨텍스트 경제학 {#context-economy}
- [ ] 능력 매니페스트 조립 — 규칙·스킬·플랜·일지의 **목록만**(본문 아님) {#capabilities-manifest}
- [ ] 세션 시작 시 동결 — 대화 동안 매니페스트 바이트 불변, 워처가 `.oculpm` 변경을 알려도 재조립 없음 {#manifest-freeze}
- [ ] `context_discover`/`context_load` 를 패널 도구로 — 기존 MCP `journal_search`·`journal_read`·`plan_status` 를 우리 패널에도 노출 {#context-tools}
- [ ] `digestRules` 절단 은퇴 — 규칙은 온디맨드 전문. 안전 조항(시크릿·index 쓰기 금지) 3줄만 매니페스트 상주 {#retire-digest-rules}
- [ ] 슬래시 결정적 주입 — `/rules` `/plan <id>` `/journal <date>` `/skill <name>` 은 검색 없이 전문 주입 {#slash-inject}
- [ ] 스킬 키워드 필드 신설 + 검색 인덱스는 name/description/keywords 만(지시문 본문 미색인) {#skill-keywords}
- [ ] 회상 게이트 `detectRecall(turn, lang)` — 한/영 신호 사전, 무신호 턴에는 일지·플랜 블록 길이 0. **적용 범위는 AI 패널만** — ACP 구동면은 어댑터가 컨텍스트를 소유하므로 제외 {#recall-gate}
- [ ] 회상 예산 ≤800토큰 근사 + 초과 시 관련도 순 절삭 {#recall-budget}
- [ ] `035_context_recall.sql` 관련도 감쇠 — 반감기 30일, 주입 시 회복, **지워도 무해**(파생 캐시) {#recall-decay}
- [ ] 설정 → 컨텍스트 탭 — 항상 가는 것·매니페스트 미리보기·회상 후보(관련도 바+잊기)·예산·위험 구역 {#context-tab}
- [ ] 프로젝트 지시문 층 — 전역 선호와 병합(프로젝트 우선). AGENTS.md(기록 규칙)와 다른 층임을 UI 에서 구분 {#project-instructions}
- [ ] 규칙 도달 회귀 게이트 — `__tests__/fixtures/rules-compliance/` 질문 12개로 구/신 경로의 **조립된 컨텍스트 문자열**을 비교(LLM 0·결정적). 규칙 절이 빠지면 실패 {#rules-ab-check}

## Phase 6 — 선언적 설정 · 플러그인 번들 · 딥링크 {#declarative}
- [ ] `config/planner.rs` + `config/applier.rs` — UI·CLI·MCP 세 진입점이 **같은 두 모듈**을 부른다 {#config-plan-apply}
- [ ] YAML 스키마 `oculpm_config: v1` — settings·`.oculpm/config.toml`·rules·skills·automations(해시). 시크릿 전면 배제 {#config-schema}
- [ ] 승인 카드 — 적용 전 계산된 변경 목록(추가/변경/제거/무변경 건수). `useConfirm()` 이 아닌 전용 카드 {#config-approval-card}
- [ ] 대조 검증 — apply 후 재-plan 해 diff 가 비었는지 확인, 안 비면 「일부만 적용됨」으로 정직하게 보고 {#config-verify}
- [ ] CLI 서브커맨드 `oculpm config export|plan|apply` — same-exe(`--pty-host` 선례), 새 바이너리 무배포 {#config-cli}
- [ ] Claude 플러그인 번들 임포트 — skills/`agents`→자동화/commands/`.mcp.json`/CLAUDE.md 를 **Claude Code 가 읽는 자리에 그대로** {#plugin-import}
- [ ] 번들 소유 마커 + 설치/업데이트/제거 단위 — `rules.rs` 미러 마커 규약 재사용, 마커 없는 사용자 파일은 절대 덮어쓰지 않고 conflict 보고 {#bundle-ownership}
- [ ] 임포트 가드 — **신규 의존성 `zip`(ZIP64)** · 크기/파일수/깊이 상한 · zip slip 거부 · 명시적 교체 확인 · 부분 실패 요약 · GitHub 레이트 리밋 안내 {#import-guards}
- [ ] 「선언됐지만 아직 이행하지 않음」 고지 — 플러그인 상세·AGENTS 템플릿·자동화 에디터 3곳에 일반화 {#not-honored-notice}
- [ ] `oculpm://` 딥링크(skill/theme/plugin/open) — **신규 의존성 `tauri-plugin-deep-link`** + `tauri.conf.json` 스킴 + `capabilities/default.json` 권한. **무확인 실행 0**, GitHub owner/repo 형태만, 테마는 https+화이트리스트, open 은 등록된 프로젝트만 {#deep-link}

## Phase 7 — 임포트 · 오프라인 {#import-offline}
- [ ] 대화 임포트 골격 — 후보 목록(날짜·제목·길이·추정 타입) → 선택 → Core Model 규격 일지화 → `verified_by_user:false` {#conversation-import}
- [ ] 어댑터 — Claude export JSON + 일반 `conversations[].messages[]`. ZIP64·부분 실패 허용·안정 id 중복 스킵·원본 날짜 보존 {#import-adapters}
- [ ] 오프라인 폴백 규약 — 폴백은 **그 호출 한 번**에만, 설정 기본값 불변, 폴백했음을 답변에 배지로 노출 {#offline-fallback}
- [ ] 모델 선택기 오프라인 표시 — 숨기지 않고 흐리게 + 사유 툴팁("사라지면 설정이 날아간 줄 안다") {#model-picker-offline}
- [ ] 오프라인 자동화는 실패가 아니라 **연기** — 따라잡기 규칙에 태움 {#automation-defer-offline}

## Phase 8 — 랜딩 {#landing}
- [ ] `/changelog` — `CHANGELOG.md` 렌더 + 버전 앵커, sitemap `changefreq: daily` {#landing-changelog}
- [ ] `/themes` 갤러리 — 라이트/다크 스와치 미리보기 + 딥링크 설치, 기여는 `landing/themes/*.json` PR {#landing-themes}
- [ ] `plugin.html` → 스킬 카탈로그 — 버전 pill·GitHub 링크·딥링크 설치, `plugin_docs_sync`·`plugin_skills_sync` 게이트 테스트 확장 {#landing-skills}
- [ ] `/privacy` — 나가는 것 3개(LLM 요청·업데이트 확인·GitHub 조회)와 **절대 안 나가는 것** 목록. 자동화 도입으로 선택이 아니라 필수 {#landing-privacy}
- [ ] `/automation` 가이드 위키 ko/en — 2분 설정 + 무엇이 과금되고 무엇이 안 나가는가 {#landing-automation-guide}
- [ ] `docs/RELEASE.md` 5면 절차 갱신 — changelog 재생성·sitemap·테마/스킬 카탈로그 반영 추가 {#release-doc-update}

## 결정

### Decision 1 — 자동화의 SSOT 는 온디스크 마크다운 {#d1-automation-ssot}
잠금 2026-08-31 · claude-code

스케줄·워처 정의는 `.oculpm/automation/{schedules,watchers}/<id>.md`(frontmatter +
지시문 본문). SQLite 는 런타임 상태만 — `next_run_at`·`last_run_at`·`last_status`.

근거: `.oculpm` 전체가 "온디스크가 SSOT, SQLite 는 파생 캐시" 규약이고, 지시문은
사람이 읽고 고치고 git 에 올릴 사용자 콘텐츠다. Osaurus 가 전부 SQLite 에 넣는 건
그쪽에 파일 SSOT 규약이 없기 때문이지 그게 더 나아서가 아니다.

영향: #automation-store #automation-migration #schedule-crud #watcher-automation

### Decision 2 — Core Model 없이는 자동화가 돌지 않는다 {#d2-core-model-gate}
잠금 2026-08-31 · claude-code

배경 작업(자동 화해·일지 초안·스케줄·감시·요약)은 전부 `core_provider`/`core_model`
슬롯을 쓴다. 미설정이면 자동화 UI 가 잠기고 작업은 조용히 스킵된다.

근거: 자동화는 배경에서 조용히 과금된다. "몰랐는데 돈이 나갔다" 를 구조적으로
막는다. 그리고 값싸고 빠른 모델로 배경을 돌리는 것 자체가 옳은 기본값이다 —
지금은 배경 작업이 대화용 모델을 그대로 쓴다.

영향: #core-model #core-model-migrate #schedule-run #watcher-automation

### Decision 3 — 테마 JSON 은 CSS 변수 이름을 그대로 쓴다 {#d3-theme-token-names}
잠금 2026-08-31 · claude-code

Osaurus 식 별도 이름 체계(`colors.primaryText`)를 만들지 않고 `--bg-window`·
`--text-2`·`--accent-soft` 를 키 이름 그대로 JSON 에 쓴다. 내장 5종도 같은
스키마로 표현해 "내장이 곧 예제" 가 되게 한다.

근거: polish-round 에서 디자인 토큰 564곳을 치환해 `tokens.css` 가 단일 SSOT 다.
이름을 한 겹 더 만들면 매핑 표를 영원히 관리해야 한다.

영향: #theme-schema #builtin-themes-as-json #theme-io #theme-editor

### Decision 4 — 자동화는 전부 옵인, 기본 off {#d4-automation-opt-in}
잠금 2026-08-31 · claude-code

`config.toml` 의 `[automation]` 은 `#[serde(default)]` 라 기존 파일이 전부 off 로
파싱된다. `.oculpm/automation/` 은 신규 디렉터리라 기존 온디스크 스펙이 불변이고
`schema_version` 을 올리지 않는다. `auto_reconcile`·`auto_journal_draft` 선례를 따른다.

영향: #automation-config #automation-store

### Decision 5 — 오버레이 채팅은 복원하지 않는다 {#d5-no-overlay-chat}
잠금 2026-08-31 · claude-code

Osaurus 의 ⌘; 전역 오버레이는 "앱 밖 어디서나 물어본다" 는 비서 UX 다. ocul-pm 은
2026-07-16 에 ⌘\ 오버레이 채팅 스택을 의도적으로 은퇴시켰고 `AiPanelScreenV2` 가
유일한 채팅 표면이다. 이 결정을 뒤집지 않는다.

전역 단축키가 필요하면 **퀵 캡처**(지금 한 일을 한 줄로 남기는 창)로만 검토한다 —
이 라운드 범위 밖, 별도 라운드.

### Decision 6 — 텔레메트리를 도입하지 않는다 {#d6-no-telemetry}
잠금 2026-08-31 · claude-code

Osaurus 는 Aptabase 익명 분석 + Sentry 크래시(옵트아웃 기본값)를 쓴다. ocul-pm 은
도입하지 않는다 — "아무것도 나가지 않는다" 약속과 정면 충돌한다. 대신 Osaurus 가
잘한 **서술 방식**만 가져와 무엇을 절대 보내지 않는지를 목록으로 못박는다.

영향: #landing-privacy

### Decision 7 — 범위 밖을 명시한다 {#d7-out-of-scope}
잠금 2026-08-31 · claude-code

따라가지 않는 것: Alpine VM 샌드박스·Seatbelt 격리(ocul-pm 은 코드를 실행하지
않는다) · secp256k1 암호학적 identity·relay(로컬 단일 사용자) · 이미지 생성·
computer-use·음성/TTS(기록기 정체성 밖) · 로컬 추론 서버(우리는 클라이언트다).

근거: Osaurus 는 범용 AI 비서, ocul-pm 은 기록기다. 이 목록을 넣으면 "AI 비서
하나 더" 가 되고 제품이 무엇인지 설명할 수 없게 된다.

### Decision 8 — 새 세션 방언은 접두형으로 {#d8-session-prefix}
잠금 2026-08-31 · claude-code

스케줄·자동화 세션 id 는 `sched-YYYYMMDD-HHMMSS` · `auto-YYYYMMDD-HHMMSS` 로
`manual-`/`mcp-` 와 같은 접두형을 쓴다. `<workday>-sNN` 형태는 쓰지 않는다.

근거: `session_id.rs` 의 `kind()` 는 8자리 뒤 tail 이 전부 숫자여야 `Watcher`,
`git` 이어야 `GitBackfill` 로 본다. `s01` 같은 tail 은 `SessionKind::Unknown` 이 되고,
`workday()` 는 관용적으로 통과시키므로 **색인은 되는데 분류만 조용히 죽는다** —
Phase 3 의 소스 배지가 자동화를 구분하지 못한다. (기존 메모 "IndexWriter 는 첫
8자가 workday 숫자일 것을 강제" 는 polish-round 이전 규약이라 무효.)

영향: #session-id-sources #source-derive #source-badges

### Decision 9 — 자동화 실행은 발동 원장에 나타나지 않는다 {#d9-ledger-scope}
잠금 2026-09-01 · claude-code

설계 [02-provenance.md](../../docs/20260831_osaurus-bench/02-provenance.md) §4.2 는
"자동화 실행 상세에서 원장으로 점프 — run 하나를 열면 그 세션 창에서 걸린 규칙·
스킬을 보여준다" 고 적었다. **이 전제는 틀렸다.**

`firing_ledger.rs` 가 읽는 것은 Claude Code 의 transcript(`~/.claude/projects/**`)
뿐이다. 자동화는 `runner.rs` 의 `ChatBackend` 로 배경 모델을 **직접** 부르므로
Claude Code 를 지나지 않고, 따라서 `sched-`/`auto-` 세션은 원장에 애초에 존재하지
않는다. 그 점프를 만들면 언제나 빈 화면으로 데려가는 문이 된다.

그래서 하지 않는다. 대신 (1) 진단의 「발동」 섹션은 그대로 만들고 — 그쪽은
*에이전트가 쓴* 일지를 의심할 때의 정식 경로다, (2) 트러블슈팅 「결과가 이상하다」
문구를 사실대로 고쳤다: 자동화는 규칙·스킬을 싣지 않으므로 지시문이 곧 전부이고,
먼저 볼 곳은 실행 기록의 결말과 사유다.

영향: #firing-insights #idempotent-guidance

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-31T18:53:00+09:00 | #core-model | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | 배경 작업 모델 슬롯 + LlmTab 섹션 + 폴백 체인 적용 |
| 2026-08-31T18:53:00+09:00 | #core-model-migrate | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | reconcile·journal_draft 이관 + 1회 시드(동작 변화 0) + 안내 카드 |
| 2026-08-31T18:53:00+09:00 | #session-id-sources | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | sched-/auto- 접두 (D8) — 접미형 Unknown 회귀 테스트 포함 |
| 2026-08-31T18:53:00+09:00 | #job-runner | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | 동시 1건 드롭+사유·취소·redact·강등하되 소실 없음. 플랜 산출물은 Phase 2 로 명시 이월 |
| 2026-08-31T18:53:00+09:00 | #automation-store | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | 정의 파서/writer — 파일 stem 정본·경로 탈출 차단·멱등 쓰기 |
| 2026-08-31T18:53:00+09:00 | #automation-migration | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | 033_automation.sql + oculpm_init 에서 고아 정리(읽기 실패 시 건너뜀) |
| 2026-08-31T18:53:00+09:00 | #automation-config | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md | [automation] serde(default)·schema_version 불변·예산 기본 20 |
| 2026-08-31T19:27:00+09:00 | #schedule-frequency | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 8빈도 순수 함수 + cron 0.17. 월말·윤년 자르기, DST 봄(밀기)·가을(1회) 테이블 테스트 |
| 2026-08-31T19:27:00+09:00 | #schedule-crud | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 커맨드 9개 — 전부 AppError{code}, 에러에 UI 언어 없음 |
| 2026-08-31T19:27:00+09:00 | #schedule-run | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 30초 틱 상주 루프. 전역 스위치 AND 개별 enabled, 다음 시각을 먼저 밀고 실행 |
| 2026-08-31T19:27:00+09:00 | #schedule-catchup | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 최대 1회 — next_run_after 가 미래 1건만 내는 성질로. 5분 초과는 note="missed catch-up" |
| 2026-08-31T19:27:00+09:00 | #automation-tab | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 설정 → 자동화 탭(새 화면 없음). 카드 + ⋯메뉴, 삭제는 useConfirm() |
| 2026-08-31T19:27:00+09:00 | #run-history | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | automation_runs 역순. 드롭·스킵도 보인다 + 일지로 NAV_BUS.openEntity 점프 |
| 2026-08-31T19:27:00+09:00 | #schedule-editor | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 2-pane 에디터 + 상시 도움말 2줄(그대로 갑니다 · 멱등하게 쓰세요) |
| 2026-08-31T19:27:00+09:00 | #seed-schedules | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/1927_feature_schedule-automation-phase1.md | 주간 요약·아침 브리핑·월간 회고 3종, 꺼진 채로 생성. 지시문은 content_language |
| 2026-08-31T20:07:00+09:00 | #foundation #schedules | claude-code | ☑→☑ | .oculpm/journal/20260831/Chores/2007_chore_release-v2-26-0.md | v2.26.0 릴리스 — 5면(버전 5파일·CHANGELOG·README ko/en·landing 6곳+featureList/FAQ/벤토) 전부 채우고 태그 푸시·랜딩 배포. agent-discipline 라운드와 한 버전으로 |
| 2026-08-31T20:47:00+09:00 | #responsiveness-tiers | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 6단 티어 + `debounce_ms` 하위호환. OS 디바운서 창은 balanced 로 자른다 |
| 2026-08-31T20:47:00+09:00 | #settle-timer | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 마지막 이벤트 + 티어 지연. 드라이버는 마감 시각까지 잔다(폴링 아님) |
| 2026-08-31T20:47:00+09:00 | #watcher-automation | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 정착 → scheduler::run_job 같은 문. 정의는 30초 TTL + 변경 시 즉시 갱신 |
| 2026-08-31T20:47:00+09:00 | #settle-journal-draft | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 훅 AgentExit 외 두 번째 경로 — 비-Claude-Code 작업이 사라지지 않는다 |
| 2026-08-31T20:47:00+09:00 | #draft-dedupe | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | (project_id, 구간) 청구 등록소. 진 쪽은 이긴 경로를 지목한 사유로 스킵 |
| 2026-08-31T20:47:00+09:00 | #reconcile-absorb | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 화해가 러너를 통과. 편집 로직(CAS·plan_write_lock)은 reconcile.rs 그대로 |
| 2026-08-31T20:47:00+09:00 | #loop-guard | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 원인 제외 4경로(UI emit 과 분리) + 최소 간격 ×2 + 일일 예산. 재발동 0건 테스트 |
| 2026-08-31T20:47:00+09:00 | #idempotent-guidance | claude-code | ☐→☑ | .oculpm/journal/20260831/Features_to_add/2047_feature_watcher-automation-phase2.md | 문제 해결 3종을 에디터·진단이 같은 컴포넌트로 렌더 |
| 2026-09-01T11:13:00+09:00 | #source-derive | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | sourceOf 순수 함수 — 세션 접두가 agent.id 보다 먼저다(자동화의 auto:* 귀속이 스케줄·감시를 덮지 않게) |
| 2026-09-01T11:13:00+09:00 | #source-badges | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 일지 카드·상세·오늘 피드·회고. 검색 결과와 ACP 목록은 의도적 제외 — 일지 사유는 일지 메모 |
| 2026-09-01T11:13:00+09:00 | #source-filter-rail | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 일지 화면. 표본은 출처 필터를 걸기 **전** 목록 — 아니면 고르는 순간 레일이 스스로 사라진다 |
| 2026-09-01T11:13:00+09:00 | #active-rows | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 실행 중…/입력을 기다립니다 + 활성 버킷 안정 분할. stabilizeHistory 원장은 불변 |
| 2026-09-01T11:13:00+09:00 | #inline-stop | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 세션 줄·자동화 카드 양쪽. 우클릭 메뉴는 미구현(행에 이미 보이는 액션 묶음이 있다) |
| 2026-09-01T11:13:00+09:00 | #doctor-automation | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 배경 모델·스케줄·감시·오늘 예산·최근 실패 + 고장난 정의 행. 예산 창은 automation_overview 가 러너와 같은 함수로 |
| 2026-09-01T11:13:00+09:00 | #firing-insights | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | 진단 「발동」 7일 — 상위 + 한 번도 안 걸린 규칙. 미측정·부분 스캔·경로 조건을 정직하게 밝힌다 |
| 2026-09-01T11:20:00+09:00 | #firing-insights #idempotent-guidance | claude-code | ☑→☑ | .oculpm/journal/20260901/Features_to_add/1113_feature_provenance-phase3.md | D9 — run 상세→원장 점프는 폐기(자동화는 Claude Code 를 지나지 않아 원장에 없다). 트러블슈팅 「결과가 이상하다」 문구를 사실대로 정정 |
| 2026-09-01T11:40:00+09:00 | #watchers #provenance | claude-code | ☑→☑ | .oculpm/journal/20260901/Chores/1136_chore_release-v2-27-0.md | v2.27.0 릴리스 — Phase 2+3 한 버전(P2 가 미태그였다). 5면 전부: 버전 5파일·CHANGELOG·README ko/en·landing 6곳+featureList/FAQ(details+JSON-LD)/벤토 3셀 |
| 2026-09-01T12:40:00+09:00 | #theme-schema | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | 31 토큰 화이트리스트 = 편집기 다섯 그룹. 색 값은 파서 대신 «모양이 아닌 문자 전부 거부» |
| 2026-09-01T12:40:00+09:00 | #builtin-themes-as-json | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | scripts/gen-builtin-themes.mjs → src/features/theme/builtin/*.json. 내장은 프런트에만 산다 |
| 2026-09-01T12:40:00+09:00 | #theme-apply | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | resolveThemeAttrs 한 곳에서 계산(설정·바인딩·초안·파일 넷). 강조 미지정 테마는 data-accent 유지 |
| 2026-09-01T12:40:00+09:00 | #theme-io | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | 충돌은 status:"conflict"+source_path 로 되물어 파일을 두 번 안 고르게. 덮어쓰기는 기존 id 유지 |
| 2026-09-01T12:40:00+09:00 | #theme-editor | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | 앱이 곧 미리보기 — 초안이 스토어에 실리면 SettingsContext 가 <html> 을 다시 칠한다 |
| 2026-09-01T12:40:00+09:00 | #system-accent | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | defaults read -g AppleAccentColor → 8색 코드. 창 포커스마다 재조회(분산 알림 미구독) |
| 2026-09-01T12:40:00+09:00 | #project-theme | claude-code | ☐→☑ | .oculpm/journal/20260901/Features_to_add/1240_feature_theme-files-phase4.md | 034 한 컬럼. 값의 축은 설정 theme 과 같다(custom:<uuid>). 창 단위 = 활성 탭 |
<!-- oculpm:plan-log end -->
