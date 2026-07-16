---
schema_version: 1
type: feature
slug: boot-splash-and-reskin
status: done
difficulty: medium
created_at: "2026-07-16T20:43:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/components/BootSplash.tsx
    op: create
  - path: src/components/bootsplash.css
    op: create
  - path: src/App.tsx
    op: update
  - path: src/App.css
    op: update
  - path: src/styles/tokens.css
    op: update
  - path: src/styles/base.css
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/components/Sidebar.tsx
    op: update
related:
  - journal/20260716/Refactors/2028_refactor_ui-polish-round.md
tags: ["ui_v2", "design", "reskin", "boot-splash", "motion", "atelier"]
---

[x] 부트 스플래시 + 전면 리스킨 "Atelier" — 시작 모션과 디자인 언어를 통째로 교체

## 추가 기능

**1. 부트 스플래시 (신규 동작)** — 앱 콜드 스타트 첫 ~0.9초를 브랜드 모션으로 덮는다:
마크(icon.svg)가 스프링으로 떠오르고, 아이콘의 동심원 모티프를 라운드-사각 링 에코
두 겹이 반향하고, 워드마크가 따라붙은 뒤 오버레이가 들리며(스케일 1.02+페이드)
아래 UI 를 드러낸다. App 이 프로세스당 1회 마운트되므로 화면·프로젝트 전환에는
다시 뜨지 않는다. 전 구간 `pointer-events: none`(입력 무차단), `prefers-reduced-motion`
이면 JS+CSS 이중으로 스킵. 셸 청크보다 먼저 페인트돼야 하므로 전역(shadcn) 토큰만 사용.

**2. 전면 리스킨 "Atelier"** — 차가운 macOS 회색을 버리고:
- **팔레트**: 라이트 = 웜 아이보리 캔버스+잉크 텍스트+딥 에메랄드(#0e8a60, 브랜드 초록
  가족 유지). 다크 = "Deep Forest"(초록기 딥 차콜 + 민트 #34d095, on-accent 는 딥그린
  잉크). tokens.css(셸)와 App.css shadcn 블록(대시보드)을 짝으로 교체.
- **레이아웃 언어**: 앱 전체가 캔버스(--bg-sidebar) 위에 놓이고 사이드바는 캔버스에
  투명하게 앉으며, **콘텐츠가 라운드 20px+테두리+전용 그림자(--shadow-sheet)의
  '떠 있는 시트'** 가 된다 (shell.css — 12화면 공통 크롬이라 화면별 수정 없이 전체가
  바뀜). 캔버스엔 액센트 파생 라디얼 앰비언트 2겹(고대비 프리셋은 off).
- **진입 모션**: 시트 상승(sheetIn 0.5s) + 사이드바 내비 위→아래 캐스케이드(항목당
  26ms, Sidebar 가 `--i` 주입, `backwards` 필로 :active 변형과 충돌 없음).
- 라운드 스케일 7/10/14/20 으로 한 단계 부드럽게, diff 거터·t-feature 훅 등 파생
  토큰 동기화.

## 동작 흐름

1. 콜드 스타트 → BootSplash(전역 토큰) → 0.55s 에 오버레이 리프트 → 그 아래에서
   StartScreen(새 아이보리 팔레트) 또는 ShellV2 시트 상승+내비 캐스케이드가 이어짐.
2. 프리셋/액센트/다크는 전부 토큰 경유라 그대로 동작 — 프리셋은 자기 --bg-sidebar
   (캔버스)/--bg-content(시트) 값으로 새 지오메트리에 자동 적응. 사이드바 접힘
   오버레이는 캔버스에서 분리되므로 자기 배경+경계를 명시.

## 검증

- typecheck / test(146) / lint / build 모두 exit 0.
- 번들 grep: 전역 청크에 boot-splash·새 액센트(#0e8a60), ShellV2 청크에
  sheetIn/navIn/#0e8a60 생성 확인.
- 실기기 렌더 확인 미수행 — 플래너 {#reskin-verify} 로 추적 (부트 모션 체감 속도,
  시트 레이아웃, 프리셋 5종 회귀 훑기).

## 메모

- 사이드바 하단(테마/설정) nav-item 은 --i 미지정 → 딜레이 0 즉시 표시 (의도).
- macOS 신호등: 사이드바 표시 시엔 캔버스 위(기존 22px 스트립), 접힘 시엔 시트
  툴바 padding-left 84px 규칙이 계속 유효 (시트 x=10 이동분 여유 포함).
- 랜딩/README 의 브랜드 초록(#12a06b)과 앱 기본 액센트(#0e8a60)가 이제 한 톤
  다르다 — 릴리스 시 랜딩 토큰을 따라 올릴지 사용자 결정.
