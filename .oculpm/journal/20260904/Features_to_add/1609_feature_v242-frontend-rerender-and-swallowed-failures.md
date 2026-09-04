---
schema_version: 1
type: feature
slug: "v242-frontend-rerender-and-swallowed-failures"
status: done
difficulty: high
created_at: "2026-09-04T16:09:14+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "a7a49ff0-edf2-49a1-a1f7-e2c9be2e746a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/features/terminal/TerminalDock.tsx"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/features/settings/useDeferredCommit.ts"
    op: create
  - path: "src/features/settings/saveSetting.ts"
    op: create
  - path: "src/lib/reportFailure.ts"
    op: create
  - path: "src/__tests__/workspace_slice_consumers.test.tsx"
    op: create
  - path: "src/__tests__/settings_deferred_commit.test.tsx"
    op: create
related: []
tags:
  - "frontend"
  - "rerender"
  - "settings"
  - "v2.42.0"
  - "mcp-tool"
---
[x] 슬라이더 한 프레임이 20번 쓰던 것 — 그리고 삼켜지던 실패들

## 추가 기능 / 동작 흐름

측정이 먼저였다 (`docs/20260904_v242-load-bearing/perf-baseline.md` §3). 넷 다 숫자가
아니라 **횟수**로 판정했다 — 러너 부하에 안 흔들리고 다음 라운드가 같은 값을 얻는다.

**`{#workspace-full-consumers}`** — 컨텍스트 4분할은 **이미 올바르게 돼 있었다.** 문제는
상시 마운트된 셋(`ShellV2`·`ProjectTab`·`TerminalDock`)이 합친 겉면 `useWorkspace()` 를
쓴다는 것뿐이었다. 측정: 네 방향 **전부 5/5** 재렌더, 조각 훅은 자기 조각만. 즉 터미널 탭을
하나 고를 때마다 16화면 라우터가 다시 그려졌다. 셋을 조각 훅으로 바꾸고 `setState` 6자리를
조각 세터로 옮겼다.

**`{#settings-slider}`** — 20프레임 드래그 = IPC 20 + `setZoom` 20 + 재렌더 20. 게다가
`SettingsChanged` 가 **전 창 브로드캐스트**라 창마다 설정 테이블 전체조회가 곱해졌다.
`useDeferredCommit` 으로 **미리보기와 커밋을 가른다**: 드래그 중에는 draft + `setZoom` 만,
쓰기는 놓을 때 또는 220 ms 뒤 한 번. **언마운트에서 flush** 하므로 드래그 중 탭을 옮겨도
값이 살아남는다. 공유 `NumberSlider` 8개도 같이 늦췄다.

**플랜 서술 한 갈래를 정정했다** — "구독 재무장"은 사실이 아니었다. 그 구독의 deps 는
안정적인 `reload` 하나다. 나머지 셋만 실재했다.

**`{#settings-set-unhandled}` · `{#floating-promises}`** — `void` 로 침묵시키는 게 아니라
**실패를 말하게** 했다(`reportFailure`). `set()` 12곳 전부 `useSaveSetting` 경유,
`AcpConversation` 3자리·`TerminalSurface` 3자리가 실패를 올린다. `useLsp` 는 버퍼 편집마다
도는 **고빈도 경로**라 토스트 대신 상태줄+로그로 한 번만 알린다.

**설계 판단 하나** — `SettingsContext.set` 은 거절하지 않고 **알리고 resolve** 한다. 소유
밖 8자리(`ThemeGallery`·`WelcomeWizard`·`theme.tsx`)가 아직 `void set(...)` 이라, 거절
계약으로 바꾸면 삼켜지던 실패가 unhandled rejection 으로 **자리만 옮긴다.** 지금은 그
자리들도 사용자에게 보인다. 그 8자리를 `useSaveSetting` 으로 옮기는 것이 다음 정리다.

## 검증

`pnpm typecheck`·`pnpm lint`(eslint 61/61 래칫 그대로)·`pnpm build` exit 0 ·
`pnpm test` **172 파일 2,271 테스트** 통과.

회귀 테스트가 **세 겹**이다:
1. 기준선 표를 그대로 단언 — 네 방향 × 네 소비자의 정확한 델타.
2. **실제 `TerminalDock` 을 마운트**해 `openTab`+`selectTab` 10회에 추가 렌더 **0**
   (전 +10). 짝 케이스로 `terminalDockPos` 가 바뀌면 **여전히 그린다**는 것을 단언해
   "구독을 그냥 끊은 것"이 아님을 보인다. 렌더 카운트는 래퍼나 `<Profiler>` 가 아니라 목
   `TerminalSurface` 자식에서 센다 — 앞의 둘은 `children` 참조가 안정적이라 **늘 0** 이다.
3. 세 파일에 `useWorkspace()`·`setState(` 부재 소스 가드.

**되돌려 확인했다**: `TerminalDock` 에 `useWorkspace()` 를 다시 넣으니 9케이스 중 2개가
붉어졌다.

## 확인 못 함 (앱 미실행)

글자 크기 슬라이더 드래그의 체감(줌이 프레임마다 따라오는지, 놓으면 값이 붙는지, 창 2~3개가
**한 번만** 따라잡는지) · 터미널 폰트가 놓을 때만 바뀌는 것이 답답하지 않은지 · 드래그 중 탭
이동/창 닫기의 flush · 나머지 슬라이더 7개의 라벨 추종 · 터미널 도크 리사이즈/분리/복귀 ·
⌘K 이동과 사이드바 접기 · 실패 토스트 문구.

## 남은 것

- 소유 밖 8자리의 `void set(...)` — 지금은 사용자에게 보이지만 `useSaveSetting` 으로 옮기는
  편이 낫다.
- `MenubarSection` 의 마운트 시 `settingsGetAll` 은 여전히 조용히 실패한다(트레이 토글이
  이유 없이 비활성). 사용자 조작이 아니라 마운트 조회라 이번엔 두었다.
- 저장소 전체에 떠 있는 프로미스 약 100개가 플랜이 지목한 경로 밖에 남아 있다.
- 새 테스트 두 개의 `describe`/`it` 이름이 **영어**다 — `check-no-hardcoded-korean.mjs` 의
  `TESTS` 허용목록에 없어서다. 집 문체(한국어)로 맞추려면 그 목록에 두 줄을 넣어야 한다.