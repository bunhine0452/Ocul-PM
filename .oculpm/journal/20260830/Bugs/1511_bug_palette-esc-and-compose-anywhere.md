---
schema_version: 1
type: bug
slug: palette-esc-and-compose-anywhere
status: done
created_at: 2026-08-30T15:11:00+09:00
session_id: "manual-20260830-151100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/lib/journalCompose.ts
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
related: []
tags: [palette, keyboard, journal, polish-round]
---

[x] ⌘K 팔레트가 Esc 로 안 닫히고 포커스를 되돌리지 않았다 · 터미널 「일지로 남기기」가 일지 화면 밖에선 무반응이었다

## 발생 원인

- 팔레트: cmdk 의 `Command` 는 ↑↓/Enter/Home/End 만 처리한다. `CommandPalette.tsx` 어디에도 `Escape` 나 `activeElement` 복원이 없어 키보드 사용자는 배경을 클릭해야 닫혔고, 닫힌 뒤 포커스가 body 로 떨어졌다. 다른 모달은 전부 `useModalBehavior`(Esc·Tab 트랩·포커스 복원·스크롤락) 를 쓰는데 팔레트만 빠져 있었다.
- 일지 요청: `requestManualEntry` 는 끈적 플래그 + 이벤트인데, 소비자가 `JournalScreenV2` 하나뿐이다. `ShellV2` 는 화면 하나만 마운트하므로 터미널 화면(⌘0)이나 다른 화면 위의 도크에서 「일지로 남기기」·팔레트 「수동 일지」를 누르면 아무 일도 안 일어난 듯 보이고, 일지 화면에 가야 뒤늦게 모달이 떴다.

## 해결 방법

- 팔레트에 `useModalBehavior({open, onClose, panelRef})` 를 얹고 `Command` 에 ref 를 준다 — 훅 호출은 `if (!open) return null` 앞(훅 순서).
- `journalCompose.holdManualEntryRequest(seed)`: 이벤트 없이 플래그만 되돌린다. `ShellV2` 가 요청을 구독해 현재 화면이 일지가 아니면 붙들어 두고 `setUiV2View("journal")` — 일지 화면이 마운트되며 `consumeManualEntryRequest` 로 회수한다. 이미 일지 화면이면 그쪽 구독이 먼저 소비하므로 셸은 아무것도 안 한다. (`requestManualEntry` 를 다시 부르면 이벤트가 또 돌아 셸이 무한히 받으므로 별도 함수다.)

## 검증

`pnpm typecheck` · `lint` · `test`(1450, 팔레트·일지 스위트 포함) · `build` exit 0. 실기기: 터미널 화면에서 명령 블록 → 「일지로 남기기」 → 일지 화면으로 옮겨지며 씨앗이 채워진 작성기 — 앱 꺼진 뒤 몰아서.
