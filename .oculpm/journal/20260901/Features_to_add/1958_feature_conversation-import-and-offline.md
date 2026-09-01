---
schema_version: 1
type: feature
slug: conversation-import-and-offline
status: done
difficulty: high
created_at: 2026-09-01T19:58:00+09:00
session_id: manual-20260901-195800
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/import/mod.rs
    op: create
  - path: src-tauri/src/oculpm/import/adapters.rs
    op: create
  - path: src-tauri/src/oculpm/import/journalize.rs
    op: create
  - path: src-tauri/src/commands/import.rs
    op: create
  - path: src-tauri/src/llm/reach.rs
    op: create
  - path: src-tauri/src/llm/mod.rs
    op: update
  - path: src-tauri/src/commands/llm.rs
    op: update
  - path: src-tauri/src/oculpm/session_id.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/manager/journal.rs
    op: update
  - path: src-tauri/src/oculpm/automation/runner.rs
    op: update
  - path: src-tauri/src/oculpm/automation/scheduler.rs
    op: update
  - path: src-tauri/src/db/automation.rs
    op: update
  - path: src-tauri/src/plugins/archive.rs
    op: update
  - path: src-tauri/src/commands/automation.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/api/import.ts
    op: create
  - path: src/api/llm.ts
    op: create
  - path: src/features/settings/import/ConversationImportSection.tsx
    op: create
  - path: src/features/settings/useReachability.ts
    op: create
  - path: src/features/settings/tabs/DataTab.tsx
    op: update
  - path: src/features/settings/tabs/LlmTab.tsx
    op: update
  - path: src/features/settings/automation/AutomationHistory.tsx
    op: update
  - path: src/features/chat/AiPanelScreenV2.tsx
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/conversation_import.test.tsx
    op: create
  - path: src/__tests__/llm_reachability.test.tsx
    op: create
related: []
tags: [osaurus-round, phase7, import, offline, automation]
---

[x] 지난 대화를 들여오고, 끊겨도 이어간다 — 대화 임포트 · 오프라인 폴백 (Phase 7)

## 추가 기능

Osaurus 벤치마크 라운드의 마지막 기능 Phase다. 두 덩어리가 있다 — **다른 곳에서 한 대화를 이 저장소의 기록으로 들여오는 것**, 그리고 **네트워크가 끊겼을 때 조용히 잘못되지 않는 것**.

### 1. 대화 임포트 (`#conversation-import` · `#import-adapters`)

설정 → 데이터 → 「지난 대화 들여오기」. 흐름은 셋뿐이다: 파일 고르기 → 목록에서 고르기 → 들여오기.

**목록이 중간에 있는 이유**가 이 기능의 설계 전부다. export 한 파일에는 수백 개의 대화가 들어 있고 대부분은 이 프로젝트와 무관하다. 통째로 돌리면 무관한 대화 수백 건에 과금하고 일지를 오염시킨다. 그래서 스캔은 **완전히 오프라인·무과금**이고, 모델은 사용자가 고른 것에만 붙는다.

- **어댑터는 하나**다. Claude 의 export(최상위 배열 · `chat_messages` · `sender`)와 일반형(`conversations[].messages[]` · `role` · `content` 조각 배열)을 `serde_json::Value` 위에서 관용적으로 읽는다. 두 벌의 구조체를 두면 필드 하나가 바뀔 때 임포트가 통째로 죽는다. `.zip` 이면 안에서 대화 JSON 을 찾는다 — 이름이 맞는 것을 먼저 보고, 없으면 파싱에 성공하는 첫 `.json` 을 쓴다.
- **중복은 슬러그가 가른다.** 후보의 슬러그는 원본 id 의 blake3 앞 10자에서 결정적으로 나온다(`imported-<제목ascii>-<10hex>`). 제목이 전부 한글이어도 언제나 `[a-z0-9-]` 60자 이내다. 같은 export 를 두 번 돌려도 **원본 날짜의 워크데이**에 그 슬러그가 이미 있으면 모델을 부르지 않고 건너뛴다 — 중복 스킵이 과금 **앞**에 있다.
- **원본 날짜를 보존한다.** `ManualEntryDraft` 에 `created_at` 옵션을 더해, 워크데이 폴더·파일명 `HHMM`·frontmatter 가 전부 원본 시각에서 나온다. 세션 id 는 Phase 3 이 미리 예약해 둔 `import-` 접두(`import-20250714-113000`)라 출처 배지 「들여옴」이 코드 한 줄 없이 따라온다.
- **부분 실패를 허용한다.** 못 읽은 대화는 사라지지 않고 사유와 함께 보고되고, 한 건이 실패해도 나머지는 계속 간다. 결말 카드는 들여온 것·이미 있던 것·실패한 것을 **전부** 센다.
- 산출물은 전부 `verified_by_user: false` 다. 이 저장소에서 일어난 일이 아니라 다른 곳의 대화를 모델이 옮겨 적은 것이므로, 사용자가 읽기 전까지는 초안이다. 본문 끝의 출처 각주는 모델이 아니라 우리가 결정적으로 붙인다 — 모델이 빼먹을 수 없어야 한다.

### 2. 오프라인 (`#offline-fallback` · `#model-picker-offline` · `#automation-defer-offline`)

판정의 뿌리는 `LlmError::is_transport()` 하나다. **응답이 온 실패(429·401)는 네트워크가 멀쩡하다는 증거**이므로 오프라인이 아니다. 문자열을 뒤지지 않고 `reqwest` 의 연결·타임아웃·요청조립 구분만 믿는다.

- **폴백은 그 호출 한 번**이다. 이미 설정을 건드리지 않고 있었지만 **폴백했다는 사실이 어디에도 안 보이는 것**이 결함이었다 — 사용자가 고른 모델이 아닌 것이 답했는데 화면에는 고른 모델 이름이 그대로 떴다. `ChatEvent::Fallback` 을 더해 답변 행에 배지로 남긴다. 고지는 **답이 실제로 나올 때** 한 번만 나간다(시도 시작에 미리 알리면 그 시도마저 실패했을 때 거짓 배지가 남는다).
- **모델 선택기는 숨기지 않고 흐리게** 한다. 사라지면 설정이 날아간 줄 알고, 막으면 복구된 순간 고를 수가 없다. 프로브를 쏘지 않고 **이미 한 호출의 결과**를 기억한다(`llm::reach`, 앱 메모리에만) — 목록을 여는 것만으로 네트워크가 나가지 않는다. **한 번도 안 불러 본 프로바이더는 목록에 없다**: "모른다" 를 "안 된다" 로 그리면 첫 실행부터 전부 회색이 된다.
- **오프라인 자동화는 실패가 아니라 연기**다. 러너가 `deferred` 로 원장을 닫고, 집행부가 밀어 둔 `next_run_at` 을 **원래 시각으로 되돌려** 기존 따라잡기 규칙에 태운다. 비행기에서 노트북을 열었다고 주간 요약이 영영 사라질 이유는 없다. 되돌리기만 하면 30초 틱마다 연기 행이 쌓이므로 5분 텀을 둔다 — `last_status`/`last_run_at` 이 이미 그 판정의 전부라 새 컬럼도 마이그레이션도 없다. 과금이 없었으므로 일일 예산에서도 세지 않는다.

## 동작 흐름

1. `conversation_pick_export` → `conversation_import_scan`(오프라인) → 목록 → `conversation_import_run`(Core Model). 스캔과 실행은 **같은 파서**를 지난다 — 미리 본 것과 일어난 것이 갈라질 길이 없다.
2. 임포트는 Core Model 없이는 성립하지 않는다(D2). 미설정이면 `import_core_model_missing` 으로 잠기고 화면이 「배경 작업 모델을 먼저 골라 주세요」로 옮긴다.
3. ZIP 가드는 Phase 6 의 `plugins::archive` 를 그대로 쓴다. 상한만 용도별로 갈랐다(`Limits::plugin_bundle` / `Limits::conversation_export`) — 대화 export 는 한 파일이 수십 MB 라 플러그인 번들의 4MB 파일 상한으로는 정상 아카이브가 거절된다. zip slip·깊이·엔트리 수 가드는 한 벌 그대로다.

## 검증

- `cargo test` 1098+통과 (오프라인 연기 2건 · 재시도 텀 2건 · 어댑터 8건 · 아카이브 4건 · 세션 id 방언 신규 포함). `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` exit 0.
- `pnpm test` 144 파일 1735건 통과 (임포트 UI 5건 · 도달성 2건 신규). `pnpm typecheck` · `pnpm lint`(storage·i18n·bindings 셋) · `pnpm build` 전부 exit 0.
- 새 커맨드 4개는 전부 `AppError{code, detail}` 이고 프런트는 `@/api/import` · `@/api/llm` 래퍼를 지난다.

## 메모

실기기 확인은 아직이다 — 설치본이 도는 중에 dev 빌드를 띄우지 않는다는 규율. 실제 Claude export 파일로 한 번 돌려 보는 것이 남았다. 오프라인 연기는 Wi-Fi 를 끈 상태에서 「지금 실행」을 눌러 확인하면 된다.
