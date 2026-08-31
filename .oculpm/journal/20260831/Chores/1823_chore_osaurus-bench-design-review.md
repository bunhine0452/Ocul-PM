---
schema_version: 1
type: chore
slug: osaurus-bench-design-review
status: done
created_at: 2026-08-31T18:23:00+09:00
session_id: manual-20260831-182300
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: docs/20260831_osaurus-bench/00-master-plan.md
    op: update
  - path: docs/20260831_osaurus-bench/01-automation.md
    op: correct
  - path: docs/20260831_osaurus-bench/03-themes.md
    op: correct
  - path: docs/20260831_osaurus-bench/04-context-economy.md
    op: update
  - path: docs/20260831_osaurus-bench/06-landing.md
    op: correct
  - path: .oculpm/planner/osaurus-bench-round.md
    op: update
related:
  - .oculpm/journal/20260831/Chores/1808_chore_osaurus-bench-design-and-plan.md
tags: [design, review, correction]
---

[x] Osaurus 라운드 설계 검증 — 코드 대조로 결함 3건 + 보완 7건 수정

## 무엇을 했는가

작성한 설계 문서 7편과 플래너를 저장소 코드와 한 줄씩 대조했다. 설계가 인용한
타입·제약·파일명·의존성을 전부 실물로 확인했고, 어긋난 것을 고쳤다.

## 고친 결함 (설계대로 구현하면 깨졌을 것)

**F1 — 세션 방언 설계가 실제 타입과 달랐다.** 문서는 `enum SessionId { Watcher(String), … }`
로 적었지만 실물은 `SessionId(String)` 뉴타입 + `SessionKind` enum + 접두 방언
(`manual-`/`mcp-`)이다. 더 나쁘게, 내가 제안한 `<workday>-sNN` 형태는 `kind()` 에서
**`SessionKind::Unknown`** 으로 떨어진다 — `workday()` 가 관용적으로 통과시켜 색인은
되는데 분류만 조용히 죽고, 그 위에 얹힌 Phase 3 소스 배지가 자동화를 구분하지
못한다. 접두형(`sched-`/`auto-`)으로 정정하고 Decision 8 로 잠갔다.

**F2 — 마이그레이션 번호가 병렬 Phase 에서 충돌한다.** Phase 4~7 을 병렬 가능하다고
선언해 놓고 033/034/035 를 Phase 순서로 배정했다. 두 세션이 각자 "다음 번호" 를
고르면 같은 번호가 나온다. 계획 시점 **예약제**로 바꿨다 (033 automation ·
034 project_theme · 035 context_recall).

**F3 — 자동 일지 초안이 이중 생성된다.** 훅 `AgentExit` 와 정착 트리거가 같은
작업 구간에 둘 다 걸린다. 기존 "에이전트 우선" 판정은 **자필** 일지만 보는데 훅이
만든 초안은 `agent.id = auto:*` 라 자필이 아니다. 정착 트리거가 어떤 일지든 있으면
스킵하도록, 두 경로가 같은 중복 키 `(project_id, 구간)` 을 공유하도록 규칙을 추가했다.

## 보완 7건

F4 Core Model 강제가 기존 사용자의 자동화를 조용히 멈춤 → `default_*` 1회 시드로
(신규엔 게이트, 기존엔 시드) · F5 회상 게이트 적용 범위 미명시 → AI 패널만, ACP
구동면 제외 · F6 게이트 규율 누락 → `lint:i18n`/`lint:bindings`/`lint:storage` 를
완료 기준에 명시 · F7 테스트 파일명 오기(`plugin_manifest` → `plugin_docs_sync`·
`plugin_skills_sync`) · F8 신규 의존성 3개 미명시(`cron`·`zip`·`tauri-plugin-deep-link`
— `serde_yaml`·`uuid` 는 이미 있음) · F9 `027_project_appearance` 는 테이블이 아니라
컬럼 두 개 → 034 도 `ALTER TABLE projects ADD COLUMN theme_id` · F10 커스텀 테마의
`data-accent` 상호작용 미정의 → 강조 5토큰 미지정이면 유지, 하나라도 지정하면 제거.

그리고 "질문 10개 A/B" 라는 막연한 게이트를 고정 픽스처 회귀 테스트로 바꿨다 —
LLM 을 부르지 않고 **조립된 컨텍스트 문자열**을 비교해 규칙 절 누락을 잡는다.

## 검증

- 대조 근거는 전부 실물 확인: `session_id.rs`(SessionKind·접두 상수·`kind()`·
  `workday()`) · `index.rs:488 workday_from_id`(이제 `SessionId::workday()` 에 위임 —
  첫-8자-숫자 강제 없음) · `Cargo.toml`(cron·zip·deep-link 부재, serde_yaml·uuid 존재) ·
  `migrations/`(최신 032, 010·025 결번) · `027_project_appearance.sql`(ALTER COLUMN) ·
  `package.json` lint 3종 · `src/__tests__/`(design_tokens·plugin_docs_sync·
  plugin_skills_sync) · `manager/mod.rs:145 plan_write_lock`.
- 플래너 구조 재검사: 항목 70(중복 방지 1건 추가), `{#id}` 전부 줄 끝, 중복 id 0,
  Decision 의 `영향: #id` 참조가 전부 실존 항목을 가리킴(스크립트 확인).
- 코드 변경 없음 → 빌드 게이트 해당 없음.

## 메모

`oculpm-session-id-format` 개인 메모가 polish-round 이전 규약(첫 8자 숫자 강제)을
담고 있어 무효화했다 — 그 메모를 그대로 믿었으면 F1 을 못 잡았을 것이다. 메모는
쓰인 시점의 사실이라는 것을 다시 확인한 사례.
