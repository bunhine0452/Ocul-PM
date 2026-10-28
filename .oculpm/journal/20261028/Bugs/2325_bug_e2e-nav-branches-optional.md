---
schema_version: 1
type: bug
slug: "e2e-nav-branches-optional"
status: done
difficulty: low
created_at: "2026-10-28T23:25:15+09:00"
session_id: "20261028-010"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/lib/source.mjs"
    op: update
related: []
tags:
  - "e2e"
  - "ci"
  - "cross-platform"
  - "mcp-tool"
---
[x] E2E 소스 파서 — 갈래 상수가 없으면 행이 곧 화면

## 발생 원인
`e2e/lib/source.mjs` 의 `loadNav` 가 `navRegistry.ts` 에서 `NAV_ENTRIES` 와 `AGENT_BRANCHES`(Claude Code·Codex 갈래) 두 블록을 **둘 다 필수**로 읽었다. 보류 등급 제거(PR #112, df061b4d)로 갈래가 사라지자 `Error: navRegistry.ts 에서 AGENT_BRANCHES 를 못 찾았다` 로 시나리오가 첫 줄에서 죽었다 — ubuntu-22.04 · windows-latest 둘 다, 앱 빌드는 성공한 뒤. macOS 게이트(CI)는 E2E 를 돌리지 않아 로컬·CI 초록이 이걸 못 봤다(port/** 브랜치의 E2E 만 본다 — 메모리 「macOS 게이트는 Linux 를 못 본다」).

## 해결 방법
`block(name, { optional })` — `AGENT_BRANCHES` 는 선택 사항, 없으면 빈 갈래로 두고 모든 행이 그대로 목적지가 된다. 주석에 2026-10-28 이후 갈래가 없음을 적었다. PR #112 브랜치에도 같은 커밋을 올려 E2E 를 다시 돌린다.

## 검증
- `node -e 'import("./e2e/lib/source.mjs").then(m=>m.loadNav(process.cwd()))'` → rows 8 · dest 8 (today,journal,diff,planner,search,skills,discussion,branch)
- 실패 run 40700893435 의 로그: `E2E ... Error: navRegistry.ts 에서 AGENT_BRANCHES 를 못 찾았다 → exit code 1` (두 러너 동일) — 재실행 결과는 PR #112 의 다음 E2E run 이 말한다(이 일지 시점엔 미실행)