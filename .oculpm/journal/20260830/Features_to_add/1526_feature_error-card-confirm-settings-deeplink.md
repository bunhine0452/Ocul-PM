---
schema_version: 1
type: feature
slug: error-card-confirm-settings-deeplink
status: done
created_at: 2026-08-30T15:26:00+09:00
session_id: "manual-20260830-152600"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/components/ErrorCard.tsx
    op: create
  - path: src/hooks/useConfirm.tsx
    op: create
  - path: src/lib/settingsNav.ts
    op: create
  - path: src/features/settings/SettingsPanel.tsx
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
  - path: src/features/planner/PlannerScreenV2.tsx
    op: update
  - path: src/features/discussion/DiscussionScreenV2.tsx
    op: update
  - path: src/features/discussion/DiscussionEditor.tsx
    op: update
  - path: src/features/retro/RetroScreenV2.tsx
    op: update
  - path: src/features/search/SearchScreenV2.tsx
    op: update
  - path: src/features/docs/DocsScreenV2.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/features/chat/ConversationHistoryModal.tsx
    op: update
  - path: src/features/chat/AcpConversation.tsx
    op: update
  - path: src/features/settings/tabs/DataTab.tsx
    op: update
  - path: src/features/terminal/TerminalScreenV2.tsx
    op: update
  - path: src/features/today/JournalMissingCard.tsx
    op: update
  - path: src/__tests__/ai_history.test.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260830/Bugs/1511_bug_palette-esc-and-compose-anywhere.md
tags: [ux, error-handling, confirm, settings, polish-round]
---

[x] 오류 카드·파괴 확인·설정 딥링크를 프리미티브 셋으로 — 화면마다 다르게 굴던 세 가지를 하나씩으로

## 배경 / 요구

완성도 감사(2026-08-30)에서 14개 화면이 같은 상황을 제각각 다루고 있었다.
- 오류: Today·일지·플래너는 `.card` 안에 ⚠ 제목 + 재시도 버튼, 논의·회고·검색·문서·Diff 는 평문 `.empty-hint` 에 재시도 없음 — 실패하면 화면을 옮겼다 돌아와야 했다.
- 파괴 확인: 논의 삭제·작성기 취소는 `window.confirm`(OS 알림창, 테마·i18n 밖), 대화 삭제·설정 초기화·Notion 토큰 제거는 **확인 없이** 바로 실행.
- 설정 안내: 「설정 → ocul-pm 에서 켜세요」류 문구가 셋(터미널 셸 통합·ACP 꺼짐·훅 안내)인데 탭 이름이 틀리거나 경로만 말하고 데려다주지 않았다. `JournalMissingCard` 는 설정 화면을 열긴 하지만 어느 탭인지는 못 골랐다.

## 설계 / 구현

- `components/ErrorCard.tsx` — `{title, error?, onRetry?}`. Today 가 쓰던 `.card.card-pad > .stat-top(TriangleAlert)` 마크업을 그대로 뽑아 8화면에 얹었다. 재시도는 각 화면의 로더를 그대로 부른다(회고는 `reloadNonce` 를 effect deps 에 더해 같은 범위를 다시 긁게 함, 문서는 새로고침 버튼이 오류 상태에서도 보이도록).
- `hooks/useConfirm.tsx` — `const { confirm, confirmDialog } = useConfirm()`; `confirm({title, detail?, confirmLabel?, danger?})` 가 `Promise<boolean>`. `AppDialog`(role=dialog, aria-label=title, Esc·포커스 복원 내장) 위에 `.sk-modal-*` 마크업. `danger` 면 확인 라벨 기본값이 「삭제」. 호출부는 `if (!(await confirm(...))) return;` 한 줄. `window.confirm` 은 저장소에서 사라졌고, 무확인 3곳(대화 삭제·설정 초기화·Notion 연결 해제)에 확인이 생겼다.
- `lib/settingsNav.ts` — `openSettings(tab?)`: 끈적 플래그 + `oculpm:open-settings` 이벤트. `ShellV2` 가 구독해 `setUiV2View("settings")`, `SettingsPanel` 은 마운트 시 `consumeSettingsTab()` 으로 초기 탭을 잡고 이미 떠 있으면 이벤트로 탭만 바꾼다(팔레트 `journalCompose` 와 같은 one-shot 버스 패턴). 터미널 셸 꺼짐 카드 → 「셸 통합 켜기」 버튼, ACP 꺼짐 → 「설정 열기」 칩, `JournalMissingCard` → ocul-pm 탭으로 직행.

## 검증

`pnpm typecheck` · `lint`(하드코딩 한국어 0) · `vitest`(122 파일 · 1451, `ai_history` 는 다이얼로그의 「삭제」를 눌러야 지워지는 흐름 + 취소 케이스로 다시 씀) · `build` exit 0. Rust 무변경. 실기기 확인은 앱 꺼진 뒤 몰아서.

## 한계 / 후속

- `ErrorCard` 는 문자열 오류만 받는다 — Phase 4 `#error-convention` 에서 `AppError{code,detail}` 로 바뀌면 code 별 메시지를 여기서 푼다.
- 설정 딥링크는 탭까지만. 섹션 앵커(예: ocul-pm → 연동 → 훅)는 필요해지면 `openSettings(tab, section)` 으로 넓힌다.
