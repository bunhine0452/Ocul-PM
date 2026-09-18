---
schema_version: 1
type: bug
slug: "bug-hunt-round2-git-quotepath"
status: done
created_at: "2026-09-18T19:14:55+09:00"
session_id: "20260918-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/repo.rs"
    op: update
  - path: "src-tauri/src/git/diff.rs"
    op: update
  - path: "src-tauri/src/git/history.rs"
    op: update
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: "src-tauri/src/git/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/branch/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/automation/watchers/mod.rs"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/features/search/searchUtils.ts"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/features/tray/traySnapshot.ts"
    op: create
  - path: "src/api/plan.ts"
    op: create
  - path: "scripts/check-bindings-imports.mjs"
    op: update
related:
  - ref: "20260918/Bugs/1837_bug_bug-hunt-session-id-panic-redact-leak.md"
    kind: "followup"
tags:
  - "bug-hunt"
  - "git"
  - "quotepath"
  - "planner"
  - "tray"
  - "api-facades"
  - "mcp-tool"
---
[x] 버그 헌팅 2라운드 — git 이 한국어 파일명을 8진수로 내놓아 백필·브랜치·diff 캡처가 빗나감 · 플랜 상세 경쟁 · 트레이 부분 실패</title>
<parameter name="difficulty">medium

## 발생 원인

1라운드에 이어 "전부 고쳐" 로 범위를 넓혀 프런트 데이터 훅과 git 읽기 경로를 읽었다.

1. **git 의 `core.quotepath` 기본값이 한국어 파일명을 8진수로 내놓는다** — `한글 파일.md` 가 `"\355\225\234\352\270\200 \355\214\214\354\235\274.md"` 로 나온다 (스크래치 저장소에서 재현). 이 앱의 git 읽기 세 갈래(`git/repo.rs`·`index/mod.rs`·`index/branch/mod.rs` 의 `run_git`)가 전부 기본값으로 돌았고 파서는 따옴표를 풀지 않았다. 결과: git 백필 일지의 `files_touched` 경로가 이스케이프 문자열로 저장되고, 브랜치 화면의 `dirty_files`/`commit_files` 가 한국어 파일을 절대 매치하지 못하고, `split_multi_diff` 가 `diff --git "a/…"` 로 감싼 머리글을 머리글로 못 알아봐 **그 파일의 일지 diff 가 앞 파일 조각에 붙거나 통째로 빠졌다** (주석은 "이 앱이 다루는 경로엔 따옴표가 없다" 고 단언하고 있었다). `verdict/collect.rs` 만 `quotepath=off` 를 알고 있었다.
2. `usePlanDocument.refreshDetail` — 계획 레일을 빠르게 오가면 느린 첫 `planGet` 응답이 나중에 도착해 다른 계획의 본문이 실린다. 선택이 `null` 로 바뀌면 `loadingDetail` 이 true 로 남는 경로도 있었다.
3. `useJournalDays` — 비활성 분기가 `loading` 을 되돌리지 않아, 직전 요청이 취소돼 `finally` 를 건너뛴 뒤엔 스켈레톤이 계속 그려진다.
4. 트레이 `reload` — `Promise.all` 이라 한 프로젝트의 전송 실패가 목록 전체를 지우고 `void reload()` 에서 unhandled rejection 이 났다. 정렬 주석은 "오늘 일지 많은 순" 인데 실제 키는 전 기간 누적 `entries.length` 였다.
5. `searchUtils` — `toLowerCase()` 가 길이를 바꾸는 문자(`İ`)에서 소문자 인덱스로 원문을 잘라 하이라이트가 한 글자씩 밀린다.
6. 감시 자동화 틱 — `current_workdays()` 가 돌려준 뒤 닫힌 프로젝트의 `NotInitialized` 를 WARN 으로 남겼다 (로그에 실재).

## 해결 방법

1. `QUOTEPATH_OFF = ["-c", "core.quotepath=off"]` 를 세 `run_git` 에 공통으로 붙이고, 그래도 남는 C-quote(공백·따옴표가 든 경로)를 푸는 `unquote_git_path` (겉따옴표 + `\\ooo`·`\\n`·`\\t`·`\\"` 처리) 를 `--name-status`·`--porcelain`·`diff --git` 머리글 파서 전부에 적용했다. 파서만으로도 8진수 출력을 복원하므로 `quotepath=off` 는 이중 안전장치다. 테스트 3개: 헬퍼 단위, 감싼 머리글의 `split_multi_diff`, `core.quotepath=true` 를 강제한 실제 저장소에서 백필·변경 목록·`diff_patches` 세 경로 모두 실명 복원.
2. `selectedIdRef` 로 응답 도착 시점의 선택과 비교해 낡은 응답을 버린다. `null` 분기에서 `setLoadingDetail(false)`.
3. 비활성 분기에 `setLoading(false)`.
4. `Promise.allSettled` + fulfilled 만 취함, 정렬 키를 `current_workday` 로 자른 오늘 건수로. 파일 크기 래칫(963>954)에 걸려 `loadProject` 를 `traySnapshot.ts` 로 떼어 냈고, 새 파일은 `bindings` 직접 호출이 막혀 있어 `src/api/plan.ts` (`planApi.list/get`) 파사드를 만들어 `oculpmApi` 와 함께 썼다 — `{#api-facades}` 의 첫 조각.
5. `foldForIndex`: 소문자화 결과의 길이가 다르면 원문으로 비교한다.
6. `NotInitialized` 는 조용히 `Ok(())`.

## 검증

- `cargo fmt --check` · `clippy -D warnings` · `cargo test` 전부 통과 (git 테스트 18, 새 3 포함)
- `pnpm typecheck` · `pnpm lint` 6게이트(래칫·bindings 게이트 포함) exit 0 · `vitest` 2740 · `pnpm build` 성공