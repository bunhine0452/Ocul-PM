---
schema_version: 1
type: feature
slug: schedule-automation-phase1
status: done
created_at: 2026-08-31T19:27:00+09:00
session_id: manual-20260831-192700
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
difficulty: high
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/automation/frequency.rs
    op: create
  - path: src-tauri/src/oculpm/automation/scheduler.rs
    op: create
  - path: src-tauri/src/oculpm/automation/seeds.rs
    op: create
  - path: src-tauri/src/oculpm/automation/runner.rs
    op: update
  - path: src-tauri/src/oculpm/automation/store.rs
    op: update
  - path: src-tauri/src/oculpm/automation/mod.rs
    op: update
  - path: src-tauri/src/commands/automation.rs
    op: create
  - path: src-tauri/src/commands/mod.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src/api/automation.ts
    op: create
  - path: src/features/settings/automation/automationModel.ts
    op: create
  - path: src/features/settings/automation/AutomationTab.tsx
    op: create
  - path: src/features/settings/automation/AutomationEditor.tsx
    op: create
  - path: src/features/settings/automation/AutomationHistory.tsx
    op: create
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/lib/settingsNav.ts
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/automation_tab.test.tsx
    op: create
related:
  - .oculpm/journal/20260831/Features_to_add/1853_feature_automation-foundation-phase0.md
tags: [automation, osaurus-bench, phase1, schedules]
---

[x] Osaurus 라운드 Phase 1 — 정해진 시각에 스스로 돌아본다 (스케줄 자동화)

## 추가 기능

Phase 0 이 놓은 토대 위에 **첫 발동원**을 얹었다. 8항목 전부 구현했다.

**빈도 모델 8종** (`frequency.rs`) — once·minutes·hourly·daily·weekly·monthly·
yearly·cron. `next_run_after(tz, after)` 하나만 하는 순수 함수이고 **시각을
주입받는다**. 신규 의존성 `cron 0.17`.

**스케줄 CRUD + 커맨드 9개** (`commands/automation.rs`) — 목록·저장·삭제·
일시중지/재개·지금 실행·기록·씨앗·취소. 전부 `AppError{code,detail}` 이고
에러 문자열에 UI 언어가 없다 (`automation_bad_time` 같은 코드를 프런트가 i18n
키로 바꾼다).

**집행 루프** (`scheduler.rs`) — 30초 틱의 상주 태스크. `supervisor` 와 같은
자리에서 돈다.

**설정 → 자동화 탭** — 새 화면을 만들지 않았다. 12개 화면 목록을 늘리는 대신
"설정에 가까운 관리면" 으로 들어왔다(설계 §1.3). 카드 목록 + ⋯메뉴(편집·지금
실행·기록·일시중지·삭제) + 2-pane 에디터 + 실행 기록 + 씨앗 3종.

## 동작 흐름

**발동 조건은 AND 다.** `config.toml [automation] schedules`(프로젝트 전역
스위치) **그리고** 정의 파일의 `enabled`. 전역 스위치 하나로 프로젝트의 모든
자동화를 즉시 멈출 수 있어야 한다(D4). 전역이 꺼져 있으면 정의를 읽지도 않는다.

**놓친 실행은 최대 1회.** 밀린 것을 세지 않는다 — `next_run_after` 가 언제
물어도 **미래의 첫 시각 하나**만 내므로, 한 번 돌리고 지금 기준으로 다시
계산하면 밀린 나머지가 자연히 사라진다. 3일 꺼져 있었다고 3번 돌지 않는다.
5분 넘게 늦은 발동은 `note = "missed catch-up"` 으로 History 에서 구분된다.
예산이 소진됐으면 러너가 사유를 남기고 건너뛴다.

**다음 시각을 먼저 밀고 나서 돌린다.** 순서를 뒤집으면 실패하는 자동화가 매 틱
재발동해 예산을 태운다.

**월말·윤년은 자른다.** `day_of_month: 31` 은 2월에 없다. 건너뛰면 2·4·6·9·11
월에 조용히 안 도는데 사용자가 고른 건 "매달" 이다. 말일로 당긴다 (2/29 →
평년 2/28 도 같다).

**DST 두 경계를 정의했다.** 봄에 없어진 시각(02:30)은 **건너뛰지 않고** 한 시간
밀어 03:30 에 돈다 — 하루를 통째로 거르는 것보다 늦게라도 도는 편이 기록기의
약속에 맞는다. 가을에 두 번 오는 시각은 **이른 쪽 한 번만**.

**씨앗 3종은 꺼진 채로 생긴다.** 만들자마자 과금되면 "이걸로 시작" 이 아니라
함정이다. 지시문은 `content_language` 를 따른다 (일지와 같은 이유 — 디스크에
남고 되돌릴 수 없다).

**「지금 실행」은 집행 루프와 같은 문**(`scheduler::run_job`)을 쓴다. 예산·
동시성·락 규약이 두 경로에서 갈라지지 않게. 전역 스위치가 꺼져 있어도 수동
실행은 되는데, 사용자가 방금 누른 버튼이라 "조용히 아무 일도 안 일어남" 이
더 나쁘기 때문이다.

## 검증

- `pnpm typecheck` · `pnpm test`(1526) · `pnpm build` · `cargo test` ·
  `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` 전부 exit 0
  을 직접 확인. 자동화 Rust 테스트 40개.
- 빈도 테이블 테스트 11건: 8빈도 파싱 · 잘못된 필드가 **문장이 아니라 코드**로
  실패 · 월말 자르기(1/31→2/28, 윤년 2/29, 4/30) · 윤년 연간 자르기 ·
  **DST 봄**(건너뛰지 않고 03:30) · **DST 가을**(이른 쪽 1회, 이튿날로) ·
  once 는 한 번만 · cron 요일 방언 못박기 · 3일 공백 뒤 미래 1건.
- 씨앗 3건: 전부 꺼져 있고, 빈도가 해석되며, ko/en 양쪽에서 저장소를 왕복한다.
- 프런트 10건: 고장난 자동화가 목록 맨 위 · 빈도별 입력칸 · id kebab 강제(경로
  탈출 차단) · 저장 전 검증 · 깨진 시각은 null · Core Model 게이트 표시/숨김 ·
  **스킵된 실행을 성공으로 보고하지 않음** · 씨앗 생성 · 삭제 확인.
- 원장 시각을 UTC 로 통일했다 (Phase 0 은 로컬 오프셋이었다) — 일일 예산의
  `started_at >= ?` 사전식 비교와 History 의 `ORDER BY started_at DESC` 가 DST
  경계에서 어긋나기 때문. 테스트로 못박았다.

## 메모

`pnpm lint` 는 지금 붉은데 **이 작업 때문이 아니다.** 병렬 세션이 같은 워킹
트리에 만든 두 파일(`features/code/useTreeWatch.ts`,
`__tests__/code_tree_watch.test.tsx`)이 `lint:bindings`·`lint:i18n` 에 걸린다.
내 신규 파일은 셋 다 통과한다(`lint:storage` 는 전체 통과). 그쪽 세션이
allowlist 를 정리하면 초록이 된다 — 남의 세션 진행 중 파일을 대신 고치지 않았다.

`AutomationOutput::Plan` 은 여전히 미연결이다 (Phase 2 `#reconcile-absorb`).
에디터의 산출물 선택지에 "미연결" 이라고 적어 두었고, 고르면 실행이 사유와
함께 건너뛴다 — 고르는 순간에도 조용하지 않다.

워처 축(정의 저장·편집은 되지만 발동하지 않음)은 Phase 2 의 자리다. 자동화
탭의 전역 스위치도 `schedules` 하나만 노출했다.
