---
schema_version: 1
type: feature
slug: cheatsheet-whatsnew-review-loop
status: done
created_at: 2026-08-30T15:51:00+09:00
session_id: "manual-20260830-155100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/lib/shortcutRegistry.ts
    op: create
  - path: src/components/ShortcutCheatsheet.tsx
    op: create
  - path: src/hooks/useGlobalShortcuts.ts
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/features/today/WhatsNewCard.tsx
    op: create
  - path: src/lib/settings.ts
    op: update
  - path: src/lib/updater.ts
    op: update
  - path: src/features/settings/tabs/UpdateTab.tsx
    op: update
  - path: src/contexts/SettingsContext.tsx
    op: update
  - path: src-tauri/src/oculpm/cache/mod.rs
    op: update
  - path: src-tauri/src/oculpm/cache/stats.rs
    op: update
  - path: src/features/diff/changeGroups.ts
    op: update
  - path: src/features/diff/DiffFileList.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/__tests__/polish_phase2.test.tsx
    op: create
  - path: src/__tests__/diff_v2.test.tsx
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1111_feature_verified-toggle-and-related-links.md
tags: [keyboard, whats-new, review-loop, diff, polish-round]
---

[x] ⌘/ 단축키 치트시트(레지스트리 파생) · 업데이트 뒤 1회 What's-new 카드 · 검토 루프 — 새 기록 토스트 「열기」, diff 그룹 머리글 확인 토글, Today 회고 진입점

## 변경

- **치트시트**: `lib/shortcutRegistry.ts` 가 단일 목록 — 화면 이동 행은 `navRegistry` 배열 순서에서 **계산**(화면을 추가하면 저절로 나타남), 전역·창/탭·터미널·코드·일지·검색·변경·시작 화면은 각 keydown 핸들러가 실제로 듣는 키를 옮겨 적었다(앱 메뉴 가속키는 Rust `menu.rs` 가 정본이라 값을 복사). `⌘/` 는 비어 있던 조합 — `useGlobalShortcuts` 가 요청 버스로 보내고 `TabbedWindow` 에 하나 떠 있는 `ShortcutCheatsheet`(AppDialog) 가 여닫는다. 팔레트에도 「키보드 단축키 ⌘/」. 테스트가 그룹 안 중복 조합과 양 언어 라벨 누락을 잡는다.
- **What's new**: SQLite 설정 `last_seen_version`(창 여러 개여도 한 값). 앱 버전이 그보다 새로우면 Today 맨 위에 그 태그의 릴리스 노트(`RELEASES_API` → `releaseHighlights`, 이제 `lib/updater` 소유) 를 마크다운으로 한 번. 첫 설치(기록 없음)·다운그레이드는 조용히 현재 버전을 적는다 — "업데이트됐어요" 는 거짓말이 되니까. `useOptionalSettings` 로 프로바이더 밖(테스트)에서도 안전.
- **검토 루프**: (1) `oculpm-journal-added` 토스트에 「열기」 — `NAV_BUS.openEntity` 로 일지 상세까지 직행. (2) `ChangeGroup.verified_by_user`(캐시 `oculpm_journal` 조인) → diff 그룹 머리글에 일지 상세와 같은 확인 토글(`.dfl-verify`, aria-pressed) — `oculpmApi.setJournalVerified` 뒤 그룹 상태만 고쳐 다시 묶지 않는다. (3) Today 툴바에 「회고」.

## 검증

전 게이트 exit 0. `polish_phase2`: 레지스트리 파생·중복·라벨, 그룹 뷰 verified 매핑, 머리글 토글 aria/콜백.

## 한계 / 후속

- 회고 진입점은 화면 이동까지 — `RetroScreenV2` 가 preset range 를 안 받아 "오늘 기준 7일" 이 기본이다. 필요해지면 `initialDays` prop.
- 치트시트의 화면별 로컬 키는 손으로 옮긴 표다 — 핸들러가 바뀌면 같이 고친다(테스트가 존재 여부까지는 못 본다).
