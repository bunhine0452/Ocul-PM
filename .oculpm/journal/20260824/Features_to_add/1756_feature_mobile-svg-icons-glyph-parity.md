---
schema_version: 1
type: feature
slug: mobile-svg-icons-glyph-parity
status: done
difficulty: low
created_at: "2026-08-24T17:56:00+09:00"
session_id: "manual-20260824-175600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/mobile/MobileApp.tsx"
    op: update
  - path: "src/mobile/EntryDetail.tsx"
    op: update
  - path: "src/mobile/mobile.css"
    op: update
  - path: "src/mobile/tabs/JournalTab.tsx"
    op: update
  - path: "src/mobile/tabs/PlannerTab.tsx"
    op: update
  - path: "src/mobile/tabs/DiscussionTab.tsx"
    op: update
  - path: "src/mobile/tabs/TodayTab.tsx"
    op: update
related:
  - "20260824/Features_to_add/1753_feature_mobile-reskin-desktop-identity.md"
tags: [mobile, icons, design]
---

[x] 모바일 아이콘 마무리 — 텍스트 화살표·캐럿 전부 SVG, 플래너 글리프는 데스크톱 정합

## 추가 기능

- UI 컨트롤 텍스트 글리프 전부 SVG 교체: 뒤로(←→ChevronLeft ×3), 일지 날짜
  넘김(←→→Chevron ×2), 헤더 캐럿(▾→ChevronDown), 작성 버튼(+→Plus),
  Today 상태 전이(→→ArrowRight).
- 플래너 체크 글리프는 **의도적 유지** — 데스크톱 PlannerScreenV2 STATUS_META
  가 글리프(☐ ▣ ☑)를 토큰 색으로 그리는 앱 어휘다. 오히려 초판의 어긋남을
  교정: ◐→▣, in_progress 색 앰버→accent (데스크톱 동일).

## 검증

- src/mobile 에서 ←/→/▾/이모지 grep 잔존 0 (글리프 상수만 예외).
- vitest 1295 / typecheck / lint / build exit 0. pnpm build 완료 — 폰 새로고침
  으로 반영.
