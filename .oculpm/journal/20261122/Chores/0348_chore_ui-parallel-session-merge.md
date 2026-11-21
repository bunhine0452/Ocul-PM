---
schema_version: 1
type: chore
slug: "ui-parallel-session-merge"
status: done
difficulty: medium
created_at: "2026-11-22T03:48:50+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/agent-era-20261122.md"
    op: update
related: []
tags:
  - "화면"
  - "합류"
  - "병렬-세션"
  - "mcp-tool"
---
[x] 화면: 병렬 세션의 UI 개선 일곱을 합류

## 한 일

사용자 지시(11-22 「병렬 세션을 만들어서 UI 업그레이드할 곳도 찾아서 해줘」)로 별도 워크트리의 병렬 세션이 다섯 화면 · 터미널을 감사하고 일곱 가지를 고쳤다. 그 커밋 일곱을 main 위로 일직선으로 옮겨 붙였다(cherry-pick, 충돌 없음 — 사전 두 벌은 자동 병합). 워크트리와 브랜치는 걷었다.

합류한 것 (각각 자기 일지 · 테스트가 있다):

- 터미널 세션 목록을 창에서 한 번만 읽고, 답이 그대로면 다시 그리지 않는다 — 사건 10묶음에 읽기 33 → 11, 훅 다시 그리기 30 → 0
- 오늘 「지금 일하는 중」: 세션이 5개를 넘으면 조용한 것만 줄로, 나머지는 수 하나로 — 40줄 → 3줄 + 접힌 한 줄
- 오늘 「오늘 한 일」: 편 목록을 한 번에 30줄까지 — 300건에서 DOM 3,009 → 310
- 일지 상세는 그 일지의 사건에만 다시 읽는다 — 남의 사건 10번에 읽기 11 → 1
- 일지 「검증 없는 것만」 을 u 키로, 다 읽으면 「볼 것이 없어요」
- 변경 화면: 볼 것이 없으면 목록 머리의 한 줄이 그렇다고 말한다
- 계획 기록은 펼쳐도 최신 50줄까지 — 400줄에서 DOM 4,407 → 559

## 남긴 것 (감사에서 나왔지만 하지 않은 것, 급한 순)

1. 계획 레일 순서 — 활성 계획이 많으면 실패 · 바뀜 판정이 흩어진다(`planner/planList.ts` `railOrder`). 「오늘과 같은 순서」 가 계약이라 사용자 결정이 필요하다.
2. 오늘 「먼저 볼 것」 의 기다림 줄에 상한이 없다 — 세션 40개가 기다리면 40줄.
3. `ShellV2` 가 오늘 저장소가 바뀔 때마다 지금 화면을 다시 그린다(배지 계산을 윗줄로 내리면 풀린다).
4. 일지 화면이 일지 사건 하나에 전체 다시 읽기를 5~6번 한다 — `oculpm_gone_journals` 는 백엔드에서 증분으로 바꿔야 한다.
5. 오늘 저장소가 일지 사건마다 git 을 읽는다(`local` · `arrived`).
6. 변경 화면이 워처의 새 경로마다 git 을 다시 읽는다 — 300~500ms 모아 읽기.
7. 변경 화면의 v 가 다음 안 본 파일로 넘어가지 않는다(키 뜻을 바꾸는 결정).
8. 변경 화면 「일지 없음」 묶음에 상한이 없다.
9. 계획 상세 · 기록이 모든 계획 파일 사건에 다시 읽는다.
10. `TermSessionsChanged` 에 세션 목록을 실으면 남은 `term_list` 읽기도 없어진다(백엔드).

## 검증

- `pnpm typecheck` exit 0 · `pnpm test`: `Test Files  213 passed (213)` · `Tests  2008 passed (2008)` · `pnpm lint` 여섯 게이트 exit 0 · `pnpm build` exit 0 (pnpm 10.34.9 — 합류 뒤 main 에서)
- 병렬 세션은 실제 앱 화면을 보지 못했다(수는 전부 vitest/jsdom). 새 CSS 와 좁은 창 · 어두운 테마는 설치본 눈 확인 몫이다.

## 메모

이 PC 의 `node_modules` 가 잠금 파일보다 옛 상태여서(`@xterm/addon-fit` 0.11.0, 잠금은 0.10.0) 터미널 테스트 하나가 붉었다 — `pnpm install --frozen-lockfile` 로 맞추니 통과했다. 전역 pnpm 12.18 은 `package.json` 의 `pnpm` 칸을 읽지 않아 스크립트를 거부한다 — `npx pnpm@10.34.9` 로 돌렸다.