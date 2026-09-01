---
schema_version: 1
type: bug
slug: window-global-state-leaks-across-tabs
status: done
difficulty: high
created_at: 2026-09-01T19:12:00+09:00
session_id: manual-20260901-191200
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src/features/terminal/dispatchBus.ts
    op: update
  - path: src/features/terminal/TerminalSurface.tsx
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/features/onboarding/GreenfieldWizard.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/features/docs/DocsImage.tsx
    op: update
  - path: src/features/chat/acpBusyBus.ts
    op: update
  - path: src/components/Sidebar.tsx
    op: update
  - path: src/lib/toast.ts
    op: update
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/__tests__/dispatch_handoff.test.ts
    op: update
  - path: src/__tests__/skills_v2.test.tsx
    op: update
  - path: src/__tests__/acp_working_indicator.test.tsx
    op: update
related:
  - .oculpm/journal/20260901/Bugs/1849_bug_recent-changes-leak-across-tabs.md
  - .oculpm/journal/20260901/Bugs/1858_bug_index-progress-collides-across-tabs.md
tags:
  - tabs
  - state
  - terminal
  - journal
  - skills
---

[x] 창 전역 상태가 탭을 가로질러 새던 나머지 6건

## 발생 원인

앞선 두 건(`related`)을 고친 뒤 모듈 스코프 가변 상태를 전수 감사했다. 같은
전제 붕괴 — **한 창이 프로젝트 여럿을 물고 숨은 탭도 마운트된 채**라, 창에
하나뿐인 모듈은 전부 프로젝트를 가로지른다 — 에서 6건이 더 나왔다.

가장 나쁜 둘은 **남의 프로젝트에 쓴다**:

1. `dispatchBus` 의 `PendingDispatch` 에 주인이 없었다. 플래너 ▶실행·회고
   「Claude Code 로」·Greenfield 킥오프가 큐에 넣으면, 터미널 면은 탭마다 살아
   있으므로(도크를 열어 둔 탭 + 터미널 화면인 탭) 살아 있는 sid 를 먼저 가진
   **남의 프로젝트 면**이 집어 갔다. 그 셸의 cwd 는 남의 루트고, 그 페인에서
   에이전트가 돌고 있었다면 다른 프로젝트의 프롬프트를 그대로 붙여넣는다.
2. `journalCompose`·`agentContextNav` 인텐트 슬롯은 창 전역이 **설계**지만,
   소비자가 `active` 를 안 봤다. A 탭 터미널의 「일지로 남기기」가 숨은 B 탭의
   일지 화면에서 작성기를 열고, 저장하면 A 의 터미널 출력이 **B 프로젝트의
   `.oculpm/journal/`** 에 남는다. diff 의 「규칙으로」도 같은 길로 B 의
   `.claude/rules` 에 A 의 경로를 적었다. 같은 파일 `ShellV2.tsx` 의
   `NAV_BUS.openEntity` 는 이미 `active` 게이트가 있었는데 세 형제만 빠져 있었다.

나머지 넷은 잘못된 것을 보여 준다: `DocsImage` 캐시가 경로만 키라(주석은
"경로가 키라 충돌 없음" 이라 정반대로 적혀 있었다) `docs/architecture.png` 를
가진 두 프로젝트가 서로의 이미지를 그렸다 — 탭을 열어 둘 필요도 없이 제자리
전환만으로 샜다. 사이드바의 Claude Code 배지는 `working.size` 를 그대로 그려
**모든 프로젝트의 합**을 탭마다 붙였다. 토스트 dedup 키 `drift:${agentId}` ·
`reconciled:${planId}` · `integrity:${kind}:${path}` 는 프로젝트끼리 겹쳐 B 의
경고를 삼켰고, `DriftCooldown` 의 sessionStorage 키도 agentId 뿐이라 A 에서 누른
「무시」가 B 를 5분간 잠갔다.

## 해결 방법

두 갈래를 구분했다 — **데이터에 주인을 새기거나**(구조적), **활성 탭만
듣거나**(집의 기존 규약).

- `PendingDispatch.projectId` 신설 + `hasPendingDispatchFor(projectId)`.
  터미널 면은 자기 것만 집고, 재시도 tick 마다 다시 확인한다 (슬롯은 하나라
  도중에 주인이 바뀔 수 있다). `null` 은 "아직 주인 없음" — Greenfield 킥오프는
  프로젝트 탭이 서기 전에 예약되므로 누가 집어도 된다.
- `ShellV2` 의 세 인텐트 효과(수동 일지·설정 딥링크·규칙/스킬로)에 `active`
  게이트. 비활성 탭은 **구독 자체를 안 한다**. 화면이 이미 떠 있으면 그쪽
  구독이 먼저 소비하므로 셸 게이트만으론 모자라 `JournalScreenV2`·
  `SkillsScreenV2` 에도 `active` 를 내려 같은 게이트를 건다.
- `DocsImage` 캐시 키를 `${projectId}:${relPath}` 로 (`codeBuffers.bufferKey` 규약).
- `useAcpWorkingCount(projectId)` / `useAcpAttentionCount(projectId)` — 키에 이미
  프로젝트가 들어 있으므로 세는 쪽만 고치면 된다. 죽은 `count`/`attentionCount`
  캐시는 제거.
- 토스트 dedup 키 3종과 `DriftCooldown` 에 프로젝트를 붙였다.

## 검증

`pnpm typecheck` · `pnpm test`(140 파일 / **1714** 통과) exit 0. 신규/수정
테스트: 디스패치 주인 4건(주인 없는 건은 누구든 집는다·큐로 떨어져도 주인
보존), 숨은 탭이 창 전역 요청을 집지 않는다 1건, 사이드바 배지 프로젝트 격리
2건. 사이드바 테스트 중 하나는 **옛 동작(프로젝트 합산)을 굳혀 두고 있어서**
새 계약으로 고쳐 썼다 — 합산이 의도가 아니었음은 그 곁의
`countAcpWorkingFor(projectId)`(탭 닫기 문지기용)가 이미 프로젝트별인 것이
증거다.

`pnpm lint` 의 `lint:bindings` 는 붉지만 이 변경과 무관하다 — 병렬 세션의
`api/declarativeConfig.ts`·`api/plugins.ts`·`features/deeplink/DeepLinkSheet.tsx`
를 짚는다.

## 메모

**고치지 않고 남긴 것**: `retroGen` 의 동시 1건 단일 비행은 "백엔드 LLM 호출을
겹치지 않게" 라고 코드에 명시된 의도적 결정이라 손대지 않았다. 다만 프로젝트
B 에서 누르면 아무것도 안 도는 화면에 "이미 생성 중" 이 떠 최대 3분(STALL_MS)
막히므로, 프로젝트별로 풀지 예산 가드로 남길지는 사용자 판단이 필요하다.

무해하다고 판정한 것(설계상 창 전역): `busyGuard`(재시작 문지기는 **모든** 탭의
진행 중 턴을 봐야 한다) · `closeIntent`/`newTabIntent`(핸들러가 전부 포커스·
가시성으로 자기 검열) · `themeStore`(`<html>` 은 창당 하나, 활성 탭만 밀어넣음) ·
`toast`/`Toaster` · i18n 언어. `codeBuffers`·`manifest.frozen`·`terminalLaunch`
는 이미 프로젝트/세션 키를 쓰고 있었다.
