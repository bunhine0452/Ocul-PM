---
schema_version: 1
type: refactor
slug: ui-polish-round
status: done
difficulty: medium
created_at: "2026-07-16T20:28:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/styles/tokens.css
    op: update
  - path: src/styles/base.css
    op: update
  - path: src/styles/primitives.css
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/components/ui/AppDialog.tsx
    op: update
  - path: src/components/ui/Toaster.tsx
    op: update
related:
  - journal/20260716/Features_to_add/2011_feature_skills-manager-screen.md
tags: ["ui_v2", "design-system", "motion", "polish", "theme-preset"]
---

[x] UI 폴리시 라운드 — 모션·엘리베이션·타이포 토큰 시스템으로 전 화면 마감 통일 (기능 동일)

## 동기

"대기업이 만든 것처럼 부드럽고 예쁘게" 요청. 화면 구조·기능은 그대로 두고,
프리셋 5종·다크/라이트·액센트 6색이 전부 살아있는 **토큰 레이어**에서 마감 품질을
끌어올리는 접근을 택했다 (화면별 재작성은 12화면 회귀 위험 대비 효익이 낮음).

## 변경 요약

**토큰 시스템 (tokens.css)** — ① 모션 토큰 신설: `--dur-1/2/3`(120/200/340ms) +
`--ease-out`/`--ease-spring`. ② 엘리베이션 3단 재설계: `--shadow-card`(저불투명 다층) /
`--shadow-raise`(hover 승격, 신설) / `--shadow-pop`(다크는 1px 라이트 아웃라인 = 유리판 경계).
③ `--font` 를 로컬 번들 **SUITE** 선두로 — 대시보드(Tailwind font-sans)와 셸 타이포 통일,
네트워크 페치 없음.

**공용 물성 (base.css)** — 전 `<button>` 의 색/배경/그림자 전환을 `:where()` 명시도 0 으로
통일(자체 transition 보유 컴포넌트가 항상 이김). 키보드 `:focus-visible` 액센트 링 전역화.
`prefers-reduced-motion` 전역 존중. `color-scheme` 을 테마 가족에 연동. 스크롤바 톤다운.

**프리미티브/셸 크롬** — `.btn` press(scale 0.98)·hover border, `.btn.primary` 위쪽 광택
그라데이션+인셋 하이라이트, `.iconbtn` press. 사이드바 활성 항목 광택+액센트 그림자,
프로젝트 스위처 hover 부상(raise), 팝오버 `popIn`(spring) 진입. 툴바에
`-webkit-backdrop-filter` 추가 — WKWebView 에서 접두사 없이는 블러가 안 걸리던 것 수정.

**화면 디테일 (screens.css)** — `.jcard` hover 를 pop 그림자에서 raise+1px 상승으로
(떠오르는 카드), `.toggle` 썸에 iOS 물성(press 시 늘어남, spring 이동), 설정 모달
`modalFade/modalRise` 진입.

**공용 컴포넌트** — AppDialog(배경 fade + 패널 zoom/slide-in), Toaster(slide-in-from-bottom)
에 tw-animate 유틸 적용 (CommandPalette 의 기존 animate-in 과 동일 물성).

**프리셋 정합성 fix** — `.nav-item.active`/`.btn.primary`/`.brand-mark` 의 하드코딩 `#fff` 를
`--text-on-accent` 로: 고대비 프리셋(노랑 액센트+검정 글자)에서 흰 글자가 안 읽히던
기존 결함 해소. `.nav-kbd` 의 오타 토큰 `var(--font-mono)` → `var(--mono)`.

## 검증

- typecheck / test(146, axe 포함) / lint / build 모두 exit 0.
- 빌드 산출물 grep 으로 확인: ShellV2 청크에 `dur-1`/`ease-spring`/`shadow-raise`/`SUITE`/
  `-webkit-backdrop-filter`, 전역 청크에 `slide-in-from-bottom-1/2` 유틸 생성됨.
- 실기기 렌더 확인은 미수행 — 플래너 #skills-verify 항목에서 스킬 화면과 함께 확인 예정.

## 메모

- 모든 신규 스타일이 토큰(var) 경유라 프리셋/액센트/다크가 자동 적응. raw 색상은
  광택용 `rgba(255,255,255,α)` 오버레이뿐 (배경 위 가산 레이어라 프리셋 안전).
- 서체 교체로 `font-weight: 550/650` 은 SUITE 정적 웨이트(600/700)로 스냅됨 — 의도 허용.
