---
schema_version: 1
type: feature
slug: mobile-reskin-desktop-identity
status: done
difficulty: medium
created_at: "2026-08-24T17:53:00+09:00"
session_id: "manual-20260824-175300"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/mobile/theme.ts"
    op: create
  - path: "src/mobile/mobile.css"
    op: update
  - path: "src/mobile/MobileApp.tsx"
    op: update
  - path: "src/mobile/PairScreen.tsx"
    op: update
  - path: "src/mobile/EntryDetail.tsx"
    op: update
  - path: "src/mobile/tabs/shared.tsx"
    op: update
  - path: "src/mobile/tabs/TodayTab.tsx"
    op: update
  - path: "src/mobile/tabs/JournalTab.tsx"
    op: update
  - path: "src/mobile/tabs/PlannerTab.tsx"
    op: update
  - path: "src/mobile/tabs/DiscussionTab.tsx"
    op: update
  - path: "src/mobile/tabs/AiTab.tsx"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/__tests__/mobile_shell.test.tsx"
    op: update
related:
  - "20260824/Features_to_add/1601_feature_mobile-bridge-mb3-shell.md"
tags: [mobile, design, tokens, reskin]
---

[x] 모바일 리스킨 — 데스크톱 아이덴티티 이식 (사용자 피드백: "내 앱 느낌이 안 남")

## 추가 기능

실기기 검증에서 받은 피드백의 원인: 초판 모바일 셸이 범용 tailwind 유틸 +
이모지 아이콘이라 Ocul-PM 시각 어휘가 0 이었다. 데스크톱 디자인 시스템을
정찰해 전면 이식:

- **테마 축 이식** (theme.ts): 맥의 theme·color_theme 설정을 settings_get 으로
  읽어 SettingsContext 와 같은 판정(data-theme family / data-preset /
  data-accent)을 폰에 적용 — PRESET_FAMILY export 해 사본 드리프트 차단.
  사용자가 고른 액센트 6색·프리셋 5종(Solarized/Nord/…)이 폰에서 그대로.
- **토큰 컴포넌트 층** (mobile.css 재작성): Atelier Ivory 문법 — 캔버스
  --bg-content / 카드 --bg-card+--border-card+--shadow-card / 잉크 위계
  text·-2·-3 / 라디우스·모션 토큰. 유틸 색 클래스 전부 제거.
- **시각 어휘**: 일지 타입 칩 = 트리거 색(--t-feature/bug/error/refactor/chore
  + soft) · 에이전트 = agentColor() 결정론 스와치+agentLabel · 검증 = Check
  아이콘(accent) · 플래너 = 글리프 색(done=accent, 진행=amber)+진행 바
  (--bg-inset/--accent) · 논의 = statusMeta 재사용 상태 칩 · AI = accent
  말풍선 · 로딩 = OculSpinner (앱 고유).
- **하단탭 = navRegistry 와 같은 아이콘** (Sunrise·NotebookText·TargetIcon·
  MessagesSquare·SparklesIcon), 활성 = 사이드바 문법(accent-soft pill).
- **브랜드**: 헤더·페어링·프로젝트 피커에 icon.svg + Pretendard(--font).

## 검증

- vitest 1295 / typecheck / lint(스토리지·한글) / build 전부 exit 0.
  (백엔드 무변경 — cargo 875 유지.)
- 시각 판정은 사용자 실기기 재확인 필요 — pnpm build 완료라 서버 재시작 없이
  폰 새로고침으로 반영.
