---
schema_version: 1
type: bug
slug: "e2e-toast-overlap-english-switch"
status: done
difficulty: low
created_at: "2026-10-28T19:29:55+09:00"
session_id: "20261028-009"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/lib/page.mjs"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src/__tests__/rich_markdown_codec.test.ts"
    op: update
related:
  - ref: "20261007/Bugs/1048_bug_webview-csp-enabled.md"
    kind: "followup"
tags:
  - "e2e"
  - "release"
  - "windows"
  - "linux"
  - "toast"
  - "mcp-tool"
---
[x] E2E 하네스 — 토스트에 가려진 언어 버튼: 클릭 전 가운데 스크롤 + 토스트 소거 대기 (v3.17.0 비-mac 빠짐 원인)

## 발생 원인
v3.17.0 릴리스 run 의 E2E(설치본, windows·linux)가 27건씩 실패했다. 첫 실패는 「영어 모드 전환」— `element click intercepted … Other element would receive the click: <div class="flex gap-2 pt-1">`. 직전 단계가 띄운 「새 기록: E2E 사이드카 일지 열기」 액션 토스트(ACTION_MIN_MS 15초, 우하단 고정)의 버튼 줄이 설정 「표시」의 English 버튼 위에 떠 있었다. 영어 모드로 못 넘어가니 영어 순회 26단계가 연쇄로 떨어졌다. 앱 결함이 아니라 하네스가 UI 밀도 라운드 3 의 토스트 생명 15초를 모르는 것.

## 해결 방법
- `e2e/lib/page.mjs` `clickCss`: 클릭 전 `scrollIntoView({block:'center'})` — 고정 토스트는 화면 모서리에 있으니 가운데로 끌어오면 대부분 피한다.
- 새 `waitNoToasts(wd)`: `.fixed.bottom-4 .pointer-events-auto` 가 0개가 될 때까지 최대 20초 폴링.
- `e2e/scenario.mjs` 「영어 모드 전환」 단계가 English 클릭 전에 `waitNoToasts` 를 부르고 대기 시간을 노트에 남긴다.
- 브랜치는 `port/e2e-toast-overlap` — E2E 워크플로가 `port/**` 에서만 미리보기로 돌기 때문.

## 검증
- PR #109 run: E2E — windows-latest SUCCESS · E2E — ubuntu-22.04 SUCCESS · CI 3 job SUCCESS (`gh pr view 109 --json statusCheckRollup`). rebase 머지 → main `2ad155f8`.
- 같은 run 의 Portability 「프런트 — windows-latest」는 빨강이나 별건 — `rich_markdown_codec.test.ts` 의 `git ls-files '*.md'` 가 cmd.exe 에서 0건 (main 에서 10-27 부터 빨강). PR #110 (`execFileSync`) 로 분리, 로컬 `pnpm vitest run src/__tests__/rich_markdown_codec.test.ts` → 10 passed.

## 메모
v3.17.0 은 macOS 만 공개됐다(latest.json·dmg·app.tar.gz·sig). Windows·Linux 는 다음 판에서 — 같은 날 셋째 릴리스는 리듬 규칙상 사용자 결정. Portability Rust windows 의 `watcher_tasks::same_key_tasks_never_overlap_but_different_keys_do` 도 간헐 실패(기존) — `open_keys()==0` 을 done 직후 바로 단언해 열쇠 거두기 경합.