---
schema_version: 1
type: refactor
slug: home-grid-overhaul
status: done
created_at: 2026-08-12T21:30:00+09:00
session_id: "manual-20260812-212827"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/features/onboarding/home/homeModel.ts
    op: update
  - path: src/features/onboarding/home/ProjectCard.tsx
    op: create
  - path: src/features/onboarding/home/tiles.tsx
    op: update
  - path: src/features/onboarding/home/rows.tsx
    op: update
  - path: src/features/onboarding/StartScreen.tsx
    op: update
  - path: src/features/onboarding/home.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: src/__tests__/home_model.test.ts
    op: update
  - path: src/__tests__/start_screen.test.tsx
    op: update
  - path: scripts/check-critical-css.mjs
    op: create
  - path: package.json
    op: update
  - path: src/App.css
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/features/projects/projects.css
    op: update
  - path: src/features/settings/SettingsPanel.tsx
    op: update
related:
  - .oculpm/journal/20260812/Bugs/2128_bug_tabstrip-css-in-lazy-chunk.md
tags: [home, layout, density, a11y]
---

[x] 시작 화면 대격변 — 벤토 3티어를 없애고 프로젝트 전부를 한 화면 격자로

## 동기

"새 창을 열었을 때 한눈에 모든 게 다 보이게" — 사용자 요청.

기존 화면은 **크기로 위계를 만들었다**: 1위는 사령탑 타일(약 700px 높이), 2~3위는 판, 나머지는 행, 2주 넘게 조용한 건 접힌 색인. 프로젝트가 3~4개일 때는 통했지만 **9개가 되자 1위 하나가 화면 절반을 먹고 나머지 6개는 스크롤 아래로 사라졌다**. 사령탑 안쪽은 절반이 빈 여백이었는데도.

"어디서 이어서 일하지?" 의 답은 **순위**지 크기가 아니다.

## 변경 요약

**모델** — `hero` / `panels` / `rows` 3티어를 `ranked` 하나로 합쳤다. 활발한 것이 앞, 2주 넘게 조용한 것이 뒤(`quiet` 는 흐리게 그릴 목적으로만 남는다). 조용하다고 **접지 않는다** — 접는 순간 "내 프로젝트 전부가 한눈에" 라는 약속이 깨진다.

커서 평면(`flat`)에도 파급이 있다. 예전에는 벤토 타일을 `flat` 에서 **빼야** 했다 (커서에 등록되지 않은 요소가 `flat[0]` 을 차지하면 로빙 tabindex 의 탭 스톱이 0개가 되어 ↓/↑/Home 이 전부 죽는 회귀가 있었다). 이제 모든 카드가 같은 격자에서 커서에 등록되므로 그 예외가 사라졌고, `flat[0] === ranked[0] === primary` 가 성립한다.

**레이아웃** — 페이지 자체가 스크롤하지 않는다. `.home-wrap` 이 4행 그리드(상단바 · 검색 · 판 · 바닥 띠)이고, 판은 두 칸(프로젝트 격자 + 오늘의 흐름 레일)이며 **스크롤은 안쪽 두 칸이 각자 소유**한다. 창을 열었을 때 보이는 것이 곧 전부다.

**카드** — `ProjectCard` 는 모두 같은 크기고 네 줄로 답한다: 무엇(이름·경로) · 언제(마지막 활동·오늘 건수·배지) · 흐름(14일 스파크라인) · 다음(플랜 1줄). 1위는 크기가 아니라 **왼쪽 액센트 모서리 + "이어서" 칩**으로만 드러낸다. "다음 할 일" 줄은 높이를 고정했다 — 없으면 마지막 기록으로 채워서 격자가 들쭉날쭉해지지 않는다.

**바닥 띠** — 초안·명령·키 안내를 한 줄로 압축했다. 예전엔 각각 섹션 헤더를 단 세로 블록이라, 정작 프로젝트를 밀어내고 있었다.

**정리** — `ResumeTile`·`ProjectPanel`·`AddTile`·`ProjectRow`·`IndexRow`·`HomeSection` 을 제거하고 `AddCard` 로 대체했다. `home.css` 는 735줄 → 545줄.

## 검증

`pnpm typecheck` · `pnpm test`(58파일 **725**테스트) · `pnpm lint` · `pnpm build` · `cargo test`(12 스위트 0실패) 전부 exit 0 을 직접 확인.

테스트는 계약이 뒤집힌 만큼 다시 썼다 — "벤토 타일은 flat 에 절대 안 들어간다"가 **"ranked 의 모든 카드가 커서 평면에 들어간다"** 로 반대가 됐고, 로빙 tabindex 계약(격자 전체에서 '열기' 탭 스톱 정확히 1개, 파괴적 액션은 커서 카드에만)은 셀렉터만 `.home-list` → `.hg-grid` 로 바꿔 그대로 지켰다. 신규 2개: 프로젝트 9개를 하나도 접지 않고 전부 그리는지, 다른 탭에서 열린 프로젝트에 "열림" 배지가 붙는지.

죽은 CSS 는 클래스 사용처를 스캔해 0개까지 지웠다.

## 메모

- 배지(색인 중·열림)를 요약(brief) 로딩 게이트 **밖으로** 빼야 했다. 안에 두면 요약을 못 받은 프로젝트에서 배지가 영영 안 뜬다 — 색인·열림은 로컬 상태라 요약을 기다릴 이유가 없다.
- 죽은 CSS 를 스크립트로 지우다 여러 줄 선택자를 반토막 내 빌드를 깨뜨렸다(`.home-t-hero, .home-t-flow,` 만 남음). 되돌리고 경계를 손으로 확인한 뒤 다시 했다. 자동 삭제는 선택자가 한 줄일 때만 안전하다.
- **화면이 실제로 어떻게 보이는지는 아직 확인하지 못했다.** jsdom 은 CSS 를 적용하지 않으므로 725개 테스트가 전부 통과해도 레이아웃 회귀는 못 잡는다. 실기기 확인 필요.

---

## 후속 (21:39) — 첫 시도는 화면에 반영되지 않았다

위 작업을 마치고 게이트 5종이 전부 통과했는데도 화면은 그대로 깨져 있었다. **CSS 를 넣은 치환이 매치되지 않았고, 스크립트가 무조건 성공을 찍었다** (`s.replace(...)` 뒤에 `print("ok")` — 반환값을 확인하지 않았다). 결과적으로 새 레이아웃 규칙이 파일에 **한 줄도** 들어가지 않은 채로 typecheck·725 테스트·lint·build·cargo test 가 전부 초록이었다.

같이 드러난 것 셋:

- `.home-rail` **클래스 이름 충돌** — 이미 상단 레일(`position:sticky; height:44px`)이 쓰고 있는 이름을 흐름 레일 `<aside>` 에 또 썼다. `.home-side` 로 분리.
- `Mark` 는 받은 문자열을 **그대로** 그린다 — `text={p.name}` 을 넘겨 26px 상자 안에서 이름이 줄바꿈됐다. 이니셜은 호출자가 만든다(`initials(p.name)`).
- `.home-spark` 는 폭 지정이 없고 막대가 `flex:1` 이라 부모를 그대로 채운다 — `.hg-spark` 에 폭을 못박지 않으면 스파크라인이 카드 한 줄을 통째로 먹는다.

### 재발 방지 — 빌드 산출물 검사

`scripts/check-critical-css.mjs` 를 만들어 `pnpm build` 끝에 붙였다. 창 엔트리 CSS 청크(`TabbedWindow-*.css`)에 핵심 선택자 8개(`.winroot` `.tabstrip` `.tabstrip-tab` `.tabpane` `.home-board` `.home-wrap` `.hg-grid` `.hg-card`)가 전부 있는지 본다. 이 한 검사가 오늘 낸 **두 사고를 모두** 잡는다:

1. 항상 필요한 CSS 를 lazy 청크(ShellV2)에만 넣은 경우 → 엔트리 청크에 없으므로 실패
2. 편집이 반영되지 않은 경우 → 선택자 자체가 없으므로 실패

선택자는 부분 문자열이 아니라 **토큰**으로 찾는다 (`\.hg-grid(?![\w-])`) — `includes(".winroot")` 는 `.winroot-DISABLED` 에도 걸려 이름이 바뀐 사고를 놓친다. 실제로 규칙 하나를 지워 `exit 1` 과 정확한 누락 목록이 나오는 것까지 확인했다.

### 남은 교훈

문자열 치환으로 코드를 고칠 때는 **매치 여부를 단언**한다. 이번 라운드에서 `assert old in s` 를 넣은 치환은 전부 한 번에 맞았고, 넣지 않은 둘이 조용히 빗나갔다.

---

## 폴리시 (21:51) — "AI 스러움" 걷어내기

사용자 피드백: 왼쪽 액센트 세로줄, 알약 버튼과 세로줄의 충돌, 워드마크 서체.
그 셋을 고치면서 같은 계열의 신호를 함께 정리했다.

### 걷어낸 것과 이유

| 걷어낸 것 | 왜 |
|---|---|
| 카드 왼쪽 액센트 세로 막대 (`inset 3px 0 0 accent`) | 카드 모서리 반경과 어긋나 붙인 것처럼 보이고, 순위를 색으로 코딩하면 액센트가 의미를 잃는다 |
| 커서 글로우 링 (`0 0 0 3px accent-soft`) | 카드 9장에서 화면이 번진다. 헤어라인 한 겹이면 충분하다 |
| 헤더 뒤 방사형 액센트 광원 | "생성된 화면" 의 가장 흔한 신호. 평평하고 정확한 면이 낫다 |
| 채운 알약 배지 3종 | 배지 수프. 윤곽선 + 작은 반경이 옆의 숫자와 광학 높이도 맞는다 |
| 바닥 띠 알약 + 세로 막대 | 둥근 모서리 안에서 막대가 삐져나왔다. 면(배경) 강조로 바꾸니 충돌 자체가 사라졌다 |
| 활동 점의 헤일로 | 6px 점 하나에 광원을 두르면 그 자체가 장식이 된다 |
| EB Garamond (세리프 워드마크·제목) | 산세리프 UI 위의 세리프 워드마크는 AI 랜딩의 전형. 앱 전체가 Pretendard 한 벌로 |

### 대신 넣은 것

- **1위는 색이 아니라 깊이로** — `--shadow-sheet` 한 겹. 순위는 자리와 무게가 말한다.
- **액센트는 카드 안에서 한 가지 의미만** = "오늘". 오늘 건수와 스파크라인의 **마지막 막대**만 액센트고, 과거 13일은 중성색 45%다. 눈이 "지금" 을 먼저 찾는다.
- **포커스 링은 `:focus-visible` 에만** — 마우스 hover 에는 링을 그리지 않는다.
- **상태 태그 최대 2개** — '이어서' 는 순위 정보라 '열림' 이 있으면 양보한다.
- 시각·건수 `tabular-nums`, 제목 자간 `-0.008em`, 이니셜 상자 테두리 제거(면 하나로), 다음 할 일 아이콘을 프로젝트 아이콘 → `ListTodo` 로 (그 줄이 말하는 건 프로젝트가 아니라 작업이다).

### 검증

typecheck / 725 테스트 / lint / build(+CSS 가드) / cargo test 12스위트 전부 exit 0. 이번 라운드의 CSS 치환은 **전부 `assert` 를 걸었고 13건 모두 매치**됐다.
