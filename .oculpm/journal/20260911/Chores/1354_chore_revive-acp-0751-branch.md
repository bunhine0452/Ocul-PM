---
schema_version: 1
type: chore
slug: "revive-acp-0751-branch"
status: done
difficulty: low
created_at: "2026-09-11T13:54:40+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/usage.rs"
    op: create
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/adapter.rs"
    op: update
  - path: "src/features/chat/usageDetail.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: ".oculpm/planner/acp-adapter-0751.md"
    op: create
related:
  - ref: "20260906/Features_to_add/1025_feature_acp-adapter-0751-usage-markdown.md"
    kind: "followup"
tags:
  - "release-3.0"
  - "acp"
  - "branch-hygiene"
  - "mcp-tool"
---
[x] 3.0 준비 1 — 유실된 fix/acp-adapter-0751 브랜치 되살림 + 머지된 브랜치 5개 정리

3.0.0 론칭 전 남은 일을 훑다 플랜 밖에서 하나 찾았다 — `fix/acp-adapter-0751`(2026-09-06) 이 main 보다 139 커밋 뒤에서 **미머지** 상태였다. 이후 main 의 `/usage` 관련 커밋(`95a09b8`·`0175538`)이 대체한 건지 확인했더니 아니었다: main 은 어댑터 고정이 여전히 `0.73.0` 이고 `parse_usage_report` 에 마크다운 갈래가 없어, 0.75 계열 어댑터에서 사용량 계기가 빈칸이 되는 회귀가 그대로 살아 있었다.

## 동기

브랜치 6개 중 5개(`feat/v3-*`·`feat/v242-load-bearing`·`feat/skill-invocation-visibility`)는 `git cherry main <b>` 가 미반영 패치 0 → rebase 머지 뒤 남은 껍데기. `fix/acp-adapter-0751` 만 패치 1건이 진짜였다.

## 변경 요약

- 스크래치 워크트리에서 `git rebase main` — 충돌 0. `session.rs` 는 그 사이 main 이 손댔지만 갈라낸 `usage.rs` 와 겹치지 않았다 (1471 → 1230 + 406).
- `cargo test` 가 `bindings.ts` 의 `AcpRateLimit.kind` 주석을 다시 생성 → 별도 chore 커밋(`67e3fca`)으로 얹음. amend 는 분류기가 막아 커밋을 하나 더 쌓았다.
- main ff 머지 후 푸시. 브랜치의 일지·플랜(`acp-adapter-0751.md`: 이월 2 + 육안 확인 1)이 그대로 따라 들어와 활성 플랜에 합류했다.
- 껍데기 브랜치 5개 삭제(`-d` 는 조상 기준이라 거부 → cherry 0 확인 후 `-D`), 원격 `feat/v242-load-bearing` 도 삭제.

## 판단 보류

npm 최신은 `0.76.0`(2026-09-09). 이 브랜치는 `0.75.1` 고정이다. 0.75.1→0.76.0 dist 대조는 별도 작업이라 여기서 올리지 않았다.

## 검증

- 되맞춘 트리에서 `cargo test --no-fail-fast` 33 스위트 전부 ok(1442 lib) · `clippy --all-targets -D warnings` 무경고 · `cargo fmt --check` ok.
- `pnpm typecheck` · `test`(205파일 2651건) · `lint`(6게이트, 경고 4/4) · `build` 전부 exit 0 직접 확인.
- main CI run `34563905253` 는 푸시 직후 큐 상태 — 결과는 뒤에 본다.