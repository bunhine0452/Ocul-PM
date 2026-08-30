---
schema_version: 1
type: refactor
slug: error-convention-and-store-helpers
status: done
created_at: 2026-08-30T16:36:00+09:00
session_id: "manual-20260830-163600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/app_error.rs
    op: create
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/commands/acp.rs
    op: update
  - path: src-tauri/src/mobile_bridge/dispatch.rs
    op: update
  - path: src/api/invoke.ts
    op: create
  - path: src/api/oculpm.ts
    op: update
  - path: src/i18n/errors.ts
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: scripts/check-bindings-imports.mjs
    op: create
  - path: package.json
    op: update
  - path: src/lib/createStore.ts
    op: create
  - path: src/lib/journalCompose.ts
    op: update
  - path: src/lib/settingsNav.ts
    op: update
  - path: src/lib/projectActions.ts
    op: update
  - path: src/lib/indexProgressStore.ts
    op: update
  - path: src/lib/integrityLog.ts
    op: update
  - path: src/features/chat/usageBus.ts
    op: update
  - path: src/lib/format.ts
    op: create
  - path: src/lib/workday.ts
    op: create
  - path: src/features/chat/relativeTime.ts
    op: update
  - path: src/features/onboarding/home/homeModel.ts
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/features/today/PlanUpdates.tsx
    op: update
  - path: src/features/today/TodayGitGraph.tsx
    op: update
  - path: src/features/chat/ConversationHistoryModal.tsx
    op: update
  - path: src/features/code/treeUtils.ts
    op: update
  - path: src/features/diff/BinaryFileView.tsx
    op: update
  - path: src/features/settings/tabs/DiagnosticsTab.tsx
    op: update
  - path: src/mobile/workday.ts
    op: update
  - path: src/features/oculpm/useJournalDays.ts
    op: update
  - path: src/features/today/useTodayBrief.ts
    op: update
  - path: src/__tests__/polish_phase2.test.tsx
    op: update
  - path: src/__tests__/home_model.test.ts
    op: update
  - path: src/__tests__/i18n_settings_wiring.test.tsx
    op: update
related:
  - .oculpm/journal/20260830/Refactors/1636_refactor_session-id-newtype-and-events.md
tags: [design, errors, i18n, lint, stores, polish-round]
---

[x] 오류 규약 — 백엔드 `AppError{code,detail}` (oculpm·acp 커맨드 59개 이관, Rust 오류 문구 한국어 0) · 프런트 `call` 단일 래퍼 · `bindings` 직접 import 린트 — 그리고 버스 7종 → `createStore/createSignal/createIntentSlot`, `relativeTime`×6·`formatBytes`×3·`shiftWorkday`×3 단일화

## 배경

275개 커맨드가 전부 `Result<_, String>` 이었다. 프런트는 영어 문자열을 정규식 25개로 되짚어 i18n 키를 골랐고(`errors.ts`), Rust 커맨드 안에 한국어 오류 문구가 46곳(acp.rs 에 17) 있어 영어 UI 에 한국어가 튀었다. `typedError` 는 진짜 `Error`(전송 실패)를 봉투에 넣지 않고 던져 호출자가 두 경로를 다 다뤄야 했고, 73개 파일이 생성 파일 `@/lib/bindings` 의 `commands` 를 직접 import 했다. 모듈 스코프 버스는 일곱 벌이 같은 뼈대를 손으로 들고 있었고, 상대 시각 포매터 6벌·바이트 포매터 3벌·워크데이 산술 3벌이 각각 살았다.

## 변경

- **`app_error.rs`**: `AppError { code: snake_case, detail: Option<영어 원문> }`(Serialize·specta). `From<OculpmError>`(변이체 → 코드 20개)·`From<String>`(`unknown` 다리)·`From<io/db>`; `Into<String>` 으로 모바일 디스패치도 통과. `commands/oculpm.rs`(36)·`commands/acp.rs`(24 — 한국어 문구 전부 `acp_*` 코드로) 가 `Result<_, AppError>`. 바인딩은 `typedError<T, AppError>` 로 재생성.
- **`api/invoke.ts`**: `call(command, promise)` — 봉투의 `string | AppError` 와 reject 를 전부 `ApiError{code, detail}` 로. `oculpmApi.unwrap` 이 이걸 쓰고 `OculpmApiError extends ApiError`(`message` 계약 유지). `tError(string | AppError)`: 코드가 사전(`err.code.*`, 26키)에 있으면 문장, 없으면 영어 원문, `unknown` 은 옛 정규식 표. 호출부 27곳이 `tError(r.error)` 로.
- **린트** `scripts/check-bindings-imports.mjs`(`pnpm lint:bindings`): `@/lib/bindings` 의 **값** import(`commands`/`events`)와 `@tauri-apps/api/core` 의 `invoke` 를 allowlist 밖에서 금지. 한국어 린트와 같은 역방향 allowlist(현재 89개) — 새 파일은 처음부터 래퍼.
- **`lib/createStore.ts`**: `createStore`(값+구독+훅)·`createSignal`·`createIntentSlot`(끈적 플래그 + CustomEvent, `consume` 옵션). journalCompose·settingsNav·projectActions(3)·usageBus·indexProgressStore·integrityLog 가 이 위로 (공개 API 불변).
- **`lib/format.ts`**: `relativeTime(at, now, {style, fallback, beyondDays})`(ISO·ms·초 입력, `time.*` 사전) + `formatBytes`. 여섯 정의 → 겉면 하나씩(`chat/relativeTime` 은 null 계약 유지). `home.ago*`·`chat.ago*` 키 삭제. **`lib/workday.ts`**: `shiftWorkday/recentWorkdays/localWorkdayKey` — 오늘이 무엇인지는 여전히 백엔드.

## 검증

`cargo test`(945, `app_error` 2개 신규) · `clippy -D warnings` · `pnpm typecheck` · `lint`(3종) · `vitest`(1475 — call/tError/스토어/포매터/워크데이 신규) · `build` exit 0. 진입 청크 268KB 유지(`errors.ts` 가 사전을 정적으로 끌지 않도록 `t()` 의 키 반환으로 존재를 판정).

## 한계 / 후속

- 나머지 216개 커맨드는 `Result<_, String>` 그대로 — `From<String>` 다리로 `unknown` 코드가 되고 옛 정규식 표가 받는다. 린트가 직접 import 를 더 늘리지 못하게 막으니, 도메인별로 옮겨 가며 allowlist 를 줄인다.
- `toast.destructive(...)` 87곳은 아직 `tError` 를 안 지난다 — 그 자리에 `AppError` 객체가 닿으면 `[object Object]` 가 아니라 `String(e)` 결과가 보인다(`AppError` 는 `Display` 로 `code: detail`). 다음 라운드에서 `toast` 자체가 `unknown` 을 받아 `tError` 를 태우게.
