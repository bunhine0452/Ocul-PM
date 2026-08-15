---
schema_version: 1
type: feature
slug: "boot-splash-arc-motion"
status: done
difficulty: low
created_at: "2026-08-15T21:46:08+09:00"
session_id: "mcp-20260815-214608"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/BootSplash.tsx"
    op: update
  - path: "src/components/bootsplash.css"
    op: update
related: []
tags:
  - "ui"
  - "motion"
  - "brand"
  - "bootsplash"
  - "mcp-tool"
---
[x] 부트 스플래시 — 아이콘 맥박을 걷어내고 동심 아크를 직접 그린다

## 추가 기능

콜드 스타트 오버레이가 `<img src="/icon.svg">` 를 스프링으로 띄우고 라운드 사각 링 2겹을 퍼뜨리던 걸(사용자 표현으로 "우웅거린다") 걷어내고, **아이콘과 같은 지오메트리를 라이브 SVG 로 그리는** 모션으로 교체했다.

`public/icon.svg` 의 `<circle>` 3개를 좌표·대시·회전값 그대로 컴포넌트로 옮겼다 (1024 뷰박스, r=190/132/74, dasharray 970·224 / 640·190 / 330·135, rotate 125°/−40°/70°). 이미지가 아니라 개별 엘리먼트라 아크마다 따로 애니메이션할 수 있다.

## 동작 흐름

1. 마크가 scale 0.93→1 로 올라온다.
2. 바깥→안 순서로 80ms 간격, 아크마다 `stroke-dasharray` 를 `0 → 아이콘 값` 으로 키우며(=호가 그려지며) 최종 각도로 58° 쓸어 들어온다. 방향은 시계/반시계/시계 교차 — 기존 `OculSpinner` 의 조리개 언어와 이어진다.
3. 멈추는 자리가 정확히 앱 아이콘이다.
4. 중앙 초점(r=22)이 오버슛과 함께 맺히고, 파문 링이 **한 번만** 퍼진다 (맥박이 아니라 마침표).
5. 워드마크가 자간 0.5em→0.3em 으로 앉고, 마크가 scale 1.05 로 다가서며 오버레이가 걷힌다. 총 1060ms.

무한 회전이 없다 — 한 번 해결되고 끝난다는 점이 이전 모션과의 핵심 차이다.

## 설계 메모

- **색은 위계만 이식.** 아이콘은 어두운 타일 위라 안쪽이 흰색이지만 스플래시는 앱 캔버스 위다. "안으로 갈수록 대비가 세진다"는 위계만 남기고 `--primary` 42% → `--primary` → `--foreground` 로 매핑해 다크·프리셋 6종·컬러 테마를 그대로 따라가게 했다. 타일 배경(`rect rx=204`)은 일부러 안 그렸다 — 아이콘을 다시 띄우는 인상이 되기 때문.
- **dasharray 보간 폴백.** `.boot-arc` 의 기본 `stroke-dasharray` 를 최종값으로 두고 키프레임 0% 에서만 `0 var(--len)` 로 내렸다. 혹시 보간이 안 먹는 엔진이라도 아크가 사라지는 대신 아이콘 그대로 남는다.
- 토큰은 전역 shadcn 이름만 쓴다 (`--background`/`--foreground`/`--primary`/`--muted-foreground`) — 이 CSS 는 첫 페인트에 있어야 하고, 넷 다 `App.css :root` 와 `[data-theme]`/`[data-preset]` 에 정의돼 있다.
- `pointer-events: none` 과 `prefers-reduced-motion` 이중 가드(컴포넌트 matchMedia + CSS)는 유지.
- 중간에 "작업 파편이 타임라인 레일에 앉아 일지 줄이 된다"는 안을 먼저 만들었으나, 사용자가 아이콘 마크를 레퍼런스로 제시해 폐기했다. 두 안 모두 재생·슬로모션 가능한 미리보기 페이지로 검토했다.

## 검증

- `pnpm lint` (storage·i18n) exit 0.
- `pnpm typecheck` — 부트 스플래시 관련 오류 0개. 남은 28개는 병렬 세션의 터미널 도크 WIP(`TerminalDock`/`TerminalAway` 미생성 bindings·i18n 키)에서 나온 것이라 이 변경과 무관.
- `pnpm test` — 71/72 파일 통과. 실패 1파일(`terminal_quality_round.test.ts`, 5건)도 같은 WIP 소속. 그 WIP 가 정리되기 전에는 `pnpm build` 가 통과할 수 없어 커밋은 보류했다.