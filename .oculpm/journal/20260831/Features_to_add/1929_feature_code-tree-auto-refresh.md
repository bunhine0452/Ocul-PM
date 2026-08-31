---
schema_version: 1
type: feature
slug: code-tree-auto-refresh
status: done
created_at: 2026-08-31T19:29:00+09:00
session_id: "manual-20260831-192943"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/features/code/useTreeWatch.ts
    op: create
  - path: src/__tests__/code_tree_watch.test.tsx
    op: create
  - path: src/features/code/treeUtils.ts
    op: update
  - path: src/features/code/CodeScreenV2.tsx
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - 20260821/Bugs/1842_bug_oculpm-live-refresh.md
tags:
  - code-screen
  - watcher
  - live-refresh
---

[x] 코드 화면 파일 트리가 스스로 최신이 된다 — ⟳ 를 누르지 않아도

## 추가 기능

코드 화면에서 **열린 파일의 본문**은 이미 워처 이벤트로 스스로 최신화되고 있었는데(`CodePane` 의 외부 변경 감지), 정작 **그 파일이 어디에 생겼는지 보여 주는 트리**만 마운트 때 읽은 목록에 머물러 있었다. 이 앱에서 파일을 만들고 지우는 것은 대개 사용자가 아니라 밖에서 도는 에이전트라, "손으로 눌러야 최신" 은 기본값이 틀린 것이었다.

`.oculpm/` 화면들이 `useOculpmLive` 로 하는 일을 코드 트리에 맞게 한 훅 `useTreeWatch` 를 붙였다. 툴바의 ⟳ 는 그대로 남긴다 — 아래 "안 오는 경우" 가 있기 때문이다.

## 동작 흐름

1. `oculpmApi.onFileChanged` 로 워처의 파일 변경 스트림을 구독한다 (새 파일이라 `bindings` 직접 호출 대신 래퍼를 냈다 — 이벤트 구독 창구가 `api/oculpm.ts` 에 처음 생겼다).
2. **모양을 바꾸는 조작만** 고른다 (`create`/`delete`/`rename`). `update` 는 내용만 바뀐 것이라 목록에는 아무 변화가 없다 — 에이전트가 파일 하나를 연달아 고치는 동안 전량 트리를 다시 걷을 이유가 없다.
3. 바뀐 경로마다 **캐시에 있는 가장 가까운 조상 폴더**를 찾는다(`nearestCachedDir`). 직계 부모를 그냥 다시 읽으면 안 되는 이유: `src/new/deep/x.ts` 처럼 폴더째로 생긴 파일은 그 부모가 애초에 캐시에 없어서 다시 읽어 봐야 아무 데도 안 붙는다. `src` 를 읽어야 새 폴더가 목록에 나타난다.
4. 첫 이벤트부터 400ms 를 모아 한 번에 갚는다 — `git checkout` 한 번의 수백 건이 한 번의 갱신으로 접힌다. 갚는 자리는 기존 `reloadAfterOp` 그대로(해당 폴더만 다시 읽고, 필터용 전량 트리는 조용히 교체 — 깜빡임 없음).
5. 창으로 돌아올 때 `useRefetchOnWake` 로 읽어 둔 폴더를 통째로 한 번 더 읽는다. 이벤트가 **안 오는 경우**의 그물이다: gitignore 된 자리, `.claude/`·`.cursor/` 처럼 다른 통로로 빠지는 경로, 워처가 멈춰 있던 동안의 변화.

마스킹된 금지 경로(`**redacted/sensitive**:…`)는 실제 자리를 알 수 없으므로 트리를 건드리지 않는다.

## 검증

- 게이트 4종 직접 확인: `pnpm typecheck` / `pnpm test`(128 파일 1539건) / `pnpm lint`(storage·i18n·bindings) / `pnpm build` 전부 exit 0.
- 새 스위트 `code_tree_watch.test.tsx` 13건 — 조상 탐색 4건(직계·폴더째 생성·루트·캐시 없음), 조작 선별 1건, 훅 8건(생성 알림·폭풍 접기·update 무시·타 프로젝트 무시·마스킹 무시·안 펼친 가지·창 복귀·언마운트 후 무발화).
- 기존 코드 화면 스위트 5종(54건) 회귀 없음.

## 메모

- 실기기 육안 확인은 아직 — 설치본이 도는 동안 dev 빌드 금지 규율.
- 대응하는 활성 플래너 항목이 없어 플래너 갱신은 생략했다 (`ide-completion`·`code-editor-screen` 은 둘 다 `status: done`).
