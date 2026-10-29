---
schema_version: 1
type: bug
slug: "v4-prerelease-defects"
status: done
difficulty: medium
created_at: "2026-10-29T13:02:11+09:00"
session_id: "20261029-008"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/index.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "plugin/oculpm/hooks/plan-context.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/plan-context.sh"
    op: update
  - path: "src-tauri/tests/plugin_hook_no_plan.rs"
    op: update
  - path: "src/__tests__/start_window.test.tsx"
    op: update
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "CHANGELOG.md"
    op: update
related:
  - ref: "20261029/Features_to_add/1138_feature_v4-terminal-back-in-app-sessions.md"
    kind: "followup"
tags:
  - "v4"
  - "release"
  - "i18n"
  - "plugin"
  - "flaky"
  - "mcp-tool"
---
[x] 4.0 태그 전 결함 셋 — 영어 「1 entries」, 시작 훅의 한글 가운데 자르기, Windows 에서 흔들리던 시작 창 테스트

## 증상

사용자 요청: 「결함들 해결하고 태그 올려」. 태그 전에 알려진 결함은 셋이었다.

1. **영어 단수형.** PR #118 E2E 영어 화면의 터미널 세션 줄과 오늘 요약 줄에 「1 entries」가 떴다. i18n 에 복수형 처리가 없었다.
2. **시작 훅의 자르기.** 시작 훅 `plan-context.sh` 가 완료 조건과 확인 명령을 `cut -c1-240` 으로 잘랐다.
   - 대조군: C 로케일에서 `printf '**완료 조건:** 가나다…' | LC_ALL=C cut -c1-240` 를 돌리니 Python 디코드가 「invalid continuation byte」를 냈다(238~239바이트 자리).
   - GNU cut 은 `-c` 도 바이트 단위다.
   - UTF-8 이 깨지면 additionalContext JSON 이 깨져 시작 컨텍스트가 통째로 사라진다.
3. **흔들리는 테스트.** `start_window.test.tsx` 의 「첫 일지가 오면 이 창이 그 프로젝트가 된다」가 #117 의 Windows 러너에서 한 번 실패했다(다시 돌리면 통과).

## 원인과 수정

1. **i18n.** `interpolate` 에 `{n|one|many}` 문법을 더했다. n 이 1 이면 앞, 아니면 뒤를 고른다. 한국어 사전은 이 문법을 쓰지 않는다.
   - 화면이 실제로 부르는 영어 문구 18개를 고쳤다.
   - 동사 일치도 맞췄다(isn't/aren't, has/have).
2. **훅.** 판정 줄이 이미 쓰던 규칙을 `clip_line` 으로 꺼내 완료 조건 · 확인 명령 · 닫힌 플랜 세 자리에 썼다. 규칙은 이렇다: C 로케일 awk 로 바이트를 세고, UTF-8 연속 바이트 위에서는 한 글자 앞으로 물러서 끝에 「…」를 붙인다. Claude Code 와 Codex 두 플러그인에 같은 파일로 넣었다.
3. **테스트.** 첫 일지 구독은 「기록 켜짐」이 그려진 뒤의 효과에서 걸린다. 그런데 테스트가 그 전에 사건을 쏘았다. 구독이 걸리기를 `waitFor` 로 기다린 뒤 쏘게 고쳤다.
- **CHANGELOG.** v4.0.0 첫 문단의 게이트 수를 실측으로 바꾸고 다시 구웠다.

## 검증

- `pnpm typecheck` exit 0
- `pnpm test` → `Test Files 77 passed (77) · Tests 932 passed (932)`. i18n 단수/복수 단언(1 entry · 3 entries · 0 entries · 1 file isn't)을 포함한다.
- `pnpm lint` 6 게이트 ✓ · `pnpm build` ✓
- `cargo fmt --check` ✓ · `cargo clippy --all-targets --locked -- -D warnings` ✓
- `cargo test --locked --no-fail-fast` → 36 suites, 1151 passed, 0 failed
  - 새 테스트 `a_long_done_condition_is_clipped_on_a_character_boundary` 를 포함한다. `context()` 가 JSON 을 파싱하므로 UTF-8 이 깨지면 실패한다.
- 대조군: 옛 `cut` 은 C 로케일에서 UTF-8 이 깨졌고, `clip_line` 은 깨지지 않았다(242바이트, 유효).