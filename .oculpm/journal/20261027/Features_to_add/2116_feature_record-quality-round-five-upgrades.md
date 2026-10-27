---
schema_version: 1
type: feature
slug: "record-quality-round-five-upgrades"
status: done
difficulty: high
created_at: "2026-10-27T21:16:48+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/commands/plan_carry.rs"
    op: create
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/model_names.rs"
    op: create
  - path: "src-tauri/src/oculpm/evidence.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/files_touched.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/files_infer.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/tests.rs"
    op: update
  - path: "src-tauri/migrations/042_oculpm_journal_evidence.sql"
    op: create
  - path: "src-tauri/src/db/registry.rs"
    op: update
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src-tauri/acp-lock/claude/package.json"
    op: update
  - path: "src-tauri/acp-lock/claude/package-lock.json"
    op: update
  - path: "src-tauri/src/acp/fixtures/claude-agent-acp.json"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/api/plan.ts"
    op: update
  - path: "src/features/settings/ClaudePluginBlock.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/skills/PluginDocsTab.tsx"
    op: update
  - path: "src/features/today/PluginDriftCard.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalRow.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/features/oculpm/journal.css"
    op: update
  - path: "src/features/oculpm/entry.css"
    op: update
  - path: "src/features/planner/CarryInbox.tsx"
    op: create
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20261027/Chores/1950_chore_eyes-sweep-machine-evidence.md"
    kind: "followup"
  - ref: "20261027/Bugs/2019_bug_journal-type-alias-path-repair-ghost-race.md"
    kind: "followup"
tags:
  - "journal"
  - "planner"
  - "today"
  - "settings"
  - "acp"
  - "cache"
  - "polish"
  - "mcp-tool"
---
[x] 기록 품질 라운드 — 플러그인 드리프트 감지 · 모델 이름 정규화 · 검증 증거 등급 · 닫힌 플랜 받은함 · files_touched 추정 · ACP 어댑터 0.97.0

## 추가 기능

실데이터 감사(일지 3,900건 · 플랜 로그 3,944건 · 훅 원장 · 캐시)에서 고른 업그레이드 다섯과, 사용자가 본 어댑터 릴리스 하나. 전부 핵심 등급 약속(docs/PROMISE.md)에 닿는 것만.

1. **플러그인 판 드리프트 감지** (약속 2·5의 전제). 실측: 이 저장소의 플러그인이 3.3.0(09-21)으로 5주째 — SessionStart 훅이 마지막 일지 3건도 전달 원장도 안 써서 「이어하기」 카드가 9월부터 빈 채였다. 프로젝트 15개가 2.29.0~3.13.2 로 제각각. `claude_plugin_status(project_id)` 가 `~/.claude/plugins/installed_plugins.json` 에서 **그 프로젝트에 적용되는** 항목(프로젝트 스코프 → 가장 깊은 조상 → 사용자 스코프)을 골라 `installed_version` · `scope` · `bundled_version`(`plugin/oculpm/.claude-plugin/plugin.json` 을 컴파일에 포함) · `behind` 를 돌려준다. 설정 → ocul-pm 플러그인 블록에 판 줄과 `/plugin update oculpm@oculpm` 복사, Today 에 `PluginDriftCard`(낮을 때만).
2. **모델·에이전트 이름 정규화** (`oculpm/model_names.rs`). 같은 모델 30가지 표기(`Opus 5 (1M context)` · `claude-opus-5[1m]` · `Opus 5 (1M)` …)와 터미널 세션 id 가 섞인 에이전트 id(`codex-term-57032`)를 캐시 투영에서만 표준형으로(`Opus 5 (1M)` · `codex`). 디스크는 그대로, 못 읽는 표기는 원문.
3. **검증 증거 등급** (`oculpm/evidence.rs`, 마이그레이션 042 `evidence`). 사람 확인 8건(0.9%) vs 검증 칸 명령 증거 733건(83%). `## 검증` 칸만 보고 0 없음 · 1 칸만(또는 스스로 미검증) · 2 명령 증거 — 성적표 스크립트와 같은 정규식. 일지 행에 방패 배지(확인 체크와 다른 중립색), 상세 화면에 등급 칩.
4. **닫힌 플랜의 미완 받은함** (`commands/plan_carry.rs` + `CarryInbox`). done·archived 플랜 20개에 `[ ]` 63건. `plan_locked_open` 이 잠긴 플랜의 미완 리프를 모으고, 활성 플랜에 `carry-<id>` 항목이 있으면 뺀다. 화면은 플래너 본문 위에 접힌 받은함, 「이 플랜으로」가 고른 활성 플랜의 「이월」 단계에 `AddItem`. **잠긴 플랜은 손대지 않는다**, 숨기기 버튼 없음.
5. **files_touched 추정** (`files_touched::infer_from_git`). 일지의 4~17% 가 파일 목록이 비어 diff 가 붙을 수 없었다(약속 3). MCP `journal_write` 에 `files_touched` 를 **안 준** 경우만 `git status --porcelain -z` 의 작업 트리 변경(상한 40, `.oculpm/` 제외, 하위 폴더 프로젝트는 접두어 처리)으로 채우고 경고 + `files-inferred` 태그. 빈 배열을 명시하면 그대로.
6. **ACP Claude 어댑터 0.93.0 → 0.97.0.** 문서화된 절차대로 lockfile 재생성 · 임시 폴더 `npm ci` · `sandbox-exec` 핸드셰이크 스모크로 픽스처 갱신. diff 는 판 문자열 · `_meta.claudeCode` 능력에 `backgroundSubagents` · `session/new` 선택지에 `ultracode`(on/off) 셋뿐, `session/update` 21종 동일. SDK 0.3.300→0.3.310. Codex 2.3.0 은 AIR 계약을 깨는 메이저라 1.13.1 유지.

## 동작 흐름

- 캐시 재투영은 `COERCION_VERSION 4`(같은 날 앞 PR)가 깨운다 — 새 빌드 첫 기동에 표준형 이름과 증거 등급이 옛 행에도 들어간다.
- 래칫: `commands/plan.rs` 가 898줄이 돼 받은함 커맨드를 `plan_carry.rs` 로 갈랐고, `OculpmSettings.tsx` 는 한 줄 초과라 효과 정리 줄을 한 줄로 접었다. 디자인 규율(아이콘 6단 · `--ctl-N` 높이 · 미정의 변수)과 「이유 없는 비활성」 래칫(`blocked()`)에 한 번씩 걸려 고쳤다.
- 테스트가 잡은 것 둘: `git::safe` 의 「다른 모듈은 git 을 띄우지 않는다」 가드(테스트가 `std_cmd("git")` 를 써서) → `git::safe::cmd` 로; 수동 일지 테스트가 캐시 왕복에서 원문 모델명을 기대 → 표준형을 기대하고 **디스크에 원문이 남는지**를 함께 단언.

## 검증

- 새 테스트 16: model_names 4 · evidence 2 · plugin drift 3 · locked_open 1 · files_infer 2 · 어댑터 픽스처(기존) 재통과 · 프런트 픽스처 갱신(journal_* 4 · mcp_settings).
- `pnpm typecheck` · `lint`(6게이트) · `test`(3285) · `build` exit 0. `cargo fmt --check` · `cargo clippy --all-targets --locked -D warnings` 통과. 전체 `cargo test --locked` 는 커밋 전 확인(앞 라운드 1833 통과 + 이번 수정 2건 통과).
- 실기기: 새 빌드로 Today 에 드리프트 카드가 뜨는지(이 기기는 3.3.0 이라 떠야 한다) · 일지 행 방패 배지 · 플래너 받은함 63건 — 눈으로.