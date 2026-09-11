---
schema_version: 1
type: feature
slug: "vscode-ext-watcher"
status: done
difficulty: medium
created_at: "2026-09-11T15:57:53+09:00"
session_id: "20260911-009"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/tree/watcher.ts"
    op: create
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
  - path: "extension/.vscode-test.mjs"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "watcher"
  - "multi-root"
  - "mcp-tool"
---
[x] VS Code 확장 워처 — 일지·플랜 변경이 1초 안에 트리에, 멀티루트·미추적 폴더 처리

## 추가 기능

플랜 `vscode-extension-round` `{#sb-watch}` + `{#sb-watch-multi}` — 워크스페이스 폴더마다 `RelativePattern(folder, ".oculpm/{journal,planner}/**/*.md")` 워처(create/change/delete) → 100ms 디바운스 → 트리 2개 refresh. 폴더 스코프 패턴이라 `.oculpm/index/**`(앱 관리 캐시, 재구축 때 수백 파일)는 글롭에 아예 안 든다. `onDidChangeWorkspaceFolders` 로 재무장. 멀티루트는 `trackedFolders()` 가 refresh 때마다 `.oculpm/journal` 유무를 다시 세고, 미추적 폴더만 열면 트리가 비어 `viewsWelcome`('추적 대상이 아닙니다 — 앱에서 프로젝트 추가')이 뜬다.

## 동작 흐름

- **추적 여부와 무관하게 모든 폴더를 건다.** 처음엔 `.oculpm/journal` 디렉터리 생성을 보는 마커 워처를 뒀는데 실측에서 디렉터리 이벤트가 안 왔다 → 파일 이벤트만 믿는다. 앱에서 프로젝트를 추가해 첫 일지가 생기면 그 create 가 곧 "추적 시작" 신호라 재시작 없이 Welcome 이 트리로 바뀐다.
- 테스트 세 번 삽질: ① macOS `tmpdir` 은 `/var`→`/private/var` 심링크라 워처가 실경로로 보고 → `realpath` 로 연다. ② **단일 폴더 창에 폴더를 더하면 VS Code 가 untitled workspace 로 창을 다시 연다** → 테스트가 끊기고, 실패한 창이 `.vscode-test/user-data` 에 복원돼 다음 실행에서 창 4개가 같은 스위트를 돌렸다(✔ 가 4번씩). `.vscode-test.mjs` 가 `repo.code-workspace` 를 만들어 처음부터 멀티루트로 연다. ③ 새 폴더의 재귀 워처(parcel) 준비 시간 — 1.5초 뒤부터 1초 예산을 잰다(실사용은 폴더가 열린 지 오래라 무관).

## 검증

- mocha 신규 1: 임시 폴더 추가 → 트리에 안 낌(미추적) → 첫 일지 파일 쓰기 → **1초 안에** `onDidChangeTreeData` 발화 → 폴더 층 + 날짜 1·건수 1. 클린 user-data 3회·복원 상태 1회 전부 통과(5 passing).
- `pnpm compile && pnpm test` exit 0(vitest 16·mocha 5), 루트 `pnpm lint:extension` exit 0. 실기기 수동 시나리오는 EVALS 1·7번.