---
schema_version: 1
type: bug
slug: planner-narrow-width-and-inline-md
status: done
difficulty: medium
created_at: "2026-08-23T20:39:47+09:00"
session_id: "manual-20260823-203947"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/lib/inlineMarkdown.ts"
    op: create
  - path: "src/components/InlineMarkdown.tsx"
    op: create
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlanRail.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/__tests__/inline_markdown.test.tsx"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags: [planner, diff, layout, responsive, container-query, markdown, dogfooding]
---

[x] 사이드바를 열면 플래너 항목이 한 글자씩 세로로 서던 것 — 그리고 제목의 `**` 가 그대로 보이던 것

## 발생 원인

"플래너의 항목이 내가 사이드바들을 띄워놓으면 이렇게 망가지게돼. 그리고
플래너의 항목에 \*\* 같은 마크다운 문법들이 무시항다고있어."
이어서 "변경 diff 에서도 이런 현상이 있음 수정됨이 세로로보임".

**증상 하나 — 세로로 서는 글자.** 원인은 두 겹이다.

*첫째, 안 줄어드는 것들이 폭을 다 먹었다.* 항목 행은
`제목(flex:1) + 실행 + 에이전트칩 + 액션` 한 줄 고정이었고 뒤의 셋이 전부
`flexShrink: 0` 이었다. 줄어들 수 있는 것이 제목뿐이라 폭이 모자라면 제목만
0 으로 눌린다. 한국어는 어느 글자 사이에서나 줄바꿈이 되므로 눌린 칸의
min-content 는 **한 글자**까지 내려간다 — 그래서 잘리는 대신 세로로 섰다.
diff 화면의 `.chip`("수정됨")·`.tbadge` 도 정확히 같은 구조였다.

*둘째, 폭 기준이 틀렸다.* 플래너의 좁은 폭 대응은 `@media (max-width: 1120px)`
였는데, 사용자가 겪은 상황은 **창은 그대로고 플래너 칸만 좁아진** 경우다
(앱 사이드바 + 터미널 패널). 뷰포트는 2000px 이니 미디어 쿼리는 영영 안 걸린다.

**증상 둘 — 노출된 마크다운.** 플래너 항목은 `.oculpm/planner/*.md` 의 한
줄이고 AI 가 `**강조**`·`` `식별자` `` 를 섞어 쓴다. 그런데 화면은
`{item.title}` 로 원문을 그대로 그렸다. 좁아진 칸에서는 이 기호들이 내용을
밀어내는 노이즈까지 됐다.

## 해결 방법

**자르지 않고 접는다.** 항목 행을 `제목 묶음 / 메타 묶음` 둘로 나누고
`.pln-item-line` 을 `flex-wrap: wrap` 으로 뒀다. 제목 묶음에
`flex: 1 1 200px` — **그만큼도 못 받는 폭이면** 메타 묶음(실행·에이전트·
액션)이 통째로 아랫줄로 내려가고 제목이 온전한 폭을 되찾는다. 넓을 때의
모양은 예전과 100% 같다(제목이 grow 해서 메타를 오른쪽 끝으로 민다).
글자는 한 자도 줄이지 않았다 — 사용자가 명시적으로 요구한 방향이다.

**기준을 컨테이너로 옮겼다.** `.pln-body` 를 `container-type: inline-size`
로 선언하고 레일 폭·문서 여백 규칙을 `@container plnbody` 로 바꿨다.
이제 사이드바를 열어 남은 폭이 줄면 그 즉시 반응한다. 760px 아래에서는
문서 여백을 걷고, 제목의 `ellipsis` 도 풀어 두 줄로 흐르게 했다(자르기보다
흐르는 편이 낫다). `AppDialog` 는 이 칸 밖에 있어 containment 영향이 없다.

**라벨은 라벨답게.** `.chip`·`.tbadge`·`.jref-btn`·`.goal-status`·
`.prog-pct` 등에 `white-space: nowrap; flex: none` 을 줬다. 이미
`.scope-chip` 에 같은 선례가 있었다(2026-07-20) — 그 규율을 라벨 프리미티브
전반으로 넓힌 것이다. diff 바의 「수정됨」은 이제 안 꺾이고, 대신 옆의 경로가
`…` 로 줄어든다.

**인라인 마크다운 렌더러를 새로 뒀다.** `react-markdown` 은 블록 렌더러라
`<p>` 를 만들고 141KB 청크를 끌어온다 — 칩·버튼과 한 줄에 흐르는 제목에는
못 쓴다. `lib/inlineMarkdown.ts`(순수 파서) + `components/InlineMarkdown.tsx`
로 `**굵게**`·`` `코드` ``·`*기울임*`·`~~취소~~`·링크만 처리한다.

의도적으로 **`_` 강조는 지원하지 않는다** — 플래너 제목엔
`plan_apply_edit`·`in_progress` 같은 이름이 널려 있어 `_apply_` 오탐
비용이 강조 이득보다 훨씬 크다. 링크도 `http(s):`/`mailto:` 만 앵커로
승격한다(`javascript:` 차단). 버튼 안(단계 헤더·계획 제목)에서는
`linkable={false}` 로 앵커를 만들지 않는다 — 중첩 인터랙티브는 a11y 위반이다.
레일 행은 버튼 하나라 `stripInlineMarkdown()` 평문을 쓴다.

## 검증

- 새 스위트 `inline_markdown.test.tsx` 9건 — 굵게/코드/취소선/중첩 파싱,
  snake_case 가 기울임으로 안 잡히는 것, 짝 안 맞는 `**` 와 `2 * 3 * 4` 가
  원문으로 남는 것, `javascript:` 링크 거부, 버튼 안 앵커 미생성.
- 실제 CSS(tokens/base/primitives/screens)를 그대로 물린 브라우저 하네스로
  `pln-body` 520 · 620 · 860px 를 눈으로 확인 — 520/620 에서 메타가 아랫줄로
  내려가고 제목이 전폭을 쓴다, 860 에서는 예전 한 줄 배치 그대로.
  diff 바는 180 · 240 · 320 · 460px 전부에서 「수정됨」이 한 줄 유지.
- `pnpm typecheck` exit 0 · `pnpm lint` exit 0 ·
  `pnpm vitest run` 플래너/diff/a11y 관련 스위트 그린(84건).

## 메모

플래너에 대응 항목이 없어(계획 밖 도그푸딩 수정) §4 갱신은 생략했다.
`three-features-round #i18n-overflow`("248px 사이드바/툴바 칩 오버플로")가
이웃이지만 영어 모드 순회라는 다른 작업이다.

전량 테스트는 **이 저장소 기준으로는** 그린이 아니다 —
`src/features/settings/SettingsPanel.tsx` 의 `Code2` 미임포트로
`a11y_screens`/`i18n_english_render`/`notion_export_v2` 3파일과
`code_screen` 4건이 깨져 있는데, 병렬 세션이 지금 편집 중인 파일이라
이번 변경과 무관하다. 커밋 전에 다시 확인해야 한다.
