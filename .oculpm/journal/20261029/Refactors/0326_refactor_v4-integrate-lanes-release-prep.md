---
schema_version: 1
type: refactor
slug: "v4-integrate-lanes-release-prep"
status: done
difficulty: superhigh
created_at: "2026-10-29T03:26:09+09:00"
session_id: "20261029-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/window/projects.rs"
    op: update
  - path: "src-tauri/src/commands/window/events.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src-tauri/tests/webview_csp.rs"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src/features/settings/AgentsSection.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/lib/paletteNav.ts"
    op: create
  - path: "docs/PROMISE.md"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "landing/keynote.html"
    op: delete
related:
  - ref: "20261029/Features_to_add/0048_feature_v4-round-part1-design-plugin-journal.md"
    kind: "followup"
tags:
  - "v4"
  - "simplify"
  - "release"
  - "ui"
  - "mcp-tool"
---
[x] 4.0 합류 — 레인 일곱 + 문서를 main 위 한 줄로, 버전 4.0.0 · CHANGELOG · 키노트 내림 · Windows MCP 직접 등록 복원

## 동기

4.0 의 레인 일곱(판정 집계 · 플러그인 · 일지/변경 · 오늘/계획 · 셸/설정/시작 · 화면 덜어내기 · 엔진 덜어내기)은 서로 같은 파일의 옛 판을 고치거나 지웠다 — 합류가 이 라운드의 가장 큰 위험이었다. 문서(PROMISE v4 · CLAUDE.md · README · 랜딩)와 릴리스 준비까지 묶어 main 위에 올릴 수 있는 한 줄로 만든다.

## 변경 요약

- 합류 방법(충돌 수백 곳): 스쿼시 머지 → 한쪽이 지운 파일은 삭제 승(37 + 50) → 목록 파일은 diff3 줄 집합 규칙(조상 줄은 양쪽이 남겼을 때만, 한쪽이 더한 줄은 살림) → 코드 파일은 많이 바꾼 쪽을 바탕으로 두고 다른 쪽 diff 를 `patch -F3` 로, 거절 조각은 손으로 → 잠금 파일은 ours 후 재생성(`pnpm remove --lockfile-only`, cargo) → bindings 는 cargo test. 손으로 고친 곳: 창 모듈의 `WindowNavigate`·`open_project_nav`(트레이 경로를 셸의 창 모델 위로), project.rs, entity_search 의 논의 갈래, CSS 남은 괄호, 테스트 다섯.
- 웹뷰 송출 0: What's-new 카드가 걷혀 api.github.com 을 부르는 프런트가 없다 → CSP connect-src·원장·RELEASES_API 정리, `Control::Exempt` 제거(약속의 예외 자리가 전부 사라짐), 리댁션 호출 파일 28 → 14(실측).
- 레인 잇기: 사이드바 「오늘」 배지 = `useTodayExceptions().count`, 툴바 「찾기 ⌘K」(paletteNav), 에이전트 연결 딥링크.
- 문서 레인이 짚은 회귀 수정: 플러그인 MCP 가 안 뜨는 Windows 의 「MCP 직접 등록」 행을 설정에 되살림(mcp_register 호출자 0 이었다). 죽은 모듈 셋(plugins/archive · db/chat · db/recall) 걷음. 3.x 서사 그대로이던 키노트 페이지·전용 스크린샷·링크를 내리고 옛 주소는 리다이렉트.
- 릴리스 준비: PROMISE.md v4(약속 10문장 · 걷은 것과 실측 근거 · Rieseberg 네 축 → 자리), CHANGELOG `## v4.0.0`(확인 날 없이 내는 판 · 외부 리뷰 주기 초과를 첫 문단에), bump-version 4.0.0(+ plugin.html 배지는 손으로), 랜딩 변경 이력, build.mjs 재빌드.
- main 위 일직선화: 다른 세션의 #112 가 rebase 머지되고 #113 이 #114 로 바뀌어, `rebase -X theirs --onto origin/main b5b8faaf` 로 25커밋을 다시 쌓고 트리가 통합 브랜치와 **바이트 단위로 같음**을 확인했다(#114 의 두 커밋 내용 포함).

## 검증

- 통합 트리: `pnpm typecheck` exit 0 · `pnpm test` → `Test Files 72 passed (72) · Tests 881 passed (881)` · `pnpm lint` 6 게이트 ✓(경고 2 기존) · `pnpm build` ✓ · `cargo fmt --check` · `cargo clippy --all-targets --locked -- -D warnings` ✓ · `cargo test --locked --no-fail-fast` → 36 suites, 1145+11 passed, 0 failed (plugin_manifest 의 배지 실패 1건은 plugin.html nav-ver 를 고쳐 `11 passed`)
- 일직선화: `git diff --stat port/v4-major port/v4-major-rebase` → 출력 없음(트리 동일)
- 설치본에서 새 화면을 눈으로 본 것은 없다 — CI(E2E 포함)와 사용자 확인 날 몫.