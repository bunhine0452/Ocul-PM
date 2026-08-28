---
schema_version: 1
type: bug
slug: tab-strip-clips-tabs
status: done
difficulty: low
created_at: "2026-08-28T20:38:00+09:00"
session_id: "manual-20260828-203800"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "src/styles/tabs.css"
    op: update
related:
  - "20260828/Features_to_add/2022_feature_tab-context-menu-keyboard.md"
tags: [tabs, css, layout, regression-risk]
---

[x] 탭이 아홉 개째부터 잘려 닿지 않았다

## 발생 원인

`tabs.css` 의 오버플로 주석은 이렇게 약속하고 있었다.

> 탭이 늘어나면 균등하게 줄고, 아이콘만 남을 만큼 좁아지면 이름을 감춘다.
> 가로 스크롤 대신 축소를 택한 이유: 스트립이 스크롤되면 "지금 창에 탭이 몇
> 개인지" 라는 한눈 신호가 사라진다.

그런데 구현이 그 약속을 지키지 않았다. 두 규칙이 맞물려 있다.

```css
.tabstrip-tab  { min-width: 96px; flex: 1 1 auto; }
.tabstrip-tabs { flex: 0 1 auto; overflow: hidden; }
```

flexbox 는 `min-width` 아래로 줄이지 않는다. 그래서 탭은 **96px 에서 축소를
멈추고**, 그 뒤로는 늘어난 탭이 `overflow: hidden` 에 그대로 잘렸다. 최소 창
너비(960px)에서 신호등 인셋 78px 과 `+` 버튼을 빼면 대략 여덟 개가 한계고,
아홉째 탭부터는 **화면에 아예 없다** — 클릭도, 드래그도, 우클릭 메뉴도 닿지
않는다. 스트립은 스크롤되지 않으므로(위 주석의 의도적 결정) 되찾을 길도 없었다.

바로 앞 라운드에서 드래그와 메뉴를 넣으면서 플래너에 "스트립이 넘칠 때"를
후속으로 적어 뒀는데, **그 전제부터 틀렸다.** "폭이 줄어드니 스크롤이 들어오면
자동 스크롤이 필요하다" 고 썼지만 실제로는 줄지 않고 잘리고 있었다.

## 해결 방법

하한을 96px → **68px** 로 내려 주석이 약속한 축소가 실제로 일어나게 했다.
68 은 탭 내부 고정 요소가 겹치지 않는 최소치다.

```
padding-left 10 + 아이콘 13 + gap 6 + 활동 점 6 + gap 6 + 닫기 18 + padding-right 6 = 65
```

이름(`.tabstrip-name`)은 이미 `flex: 1; min-width: 0` + `text-overflow: ellipsis`
라 그 아래에서 **0 폭으로 접혀** 아이콘만 남는다 — 주석이 말한 "이름을 감춘다"가
별도 규칙 없이 성립한다. Chrome 과 같은 거동이다.

탭이 적을 때는 아무것도 안 바뀐다: `flex: 1 1 auto` + `max-width: 200px` 라
내용 크기대로 잡히고, `min-width` 는 자리가 모자랄 때만 구속력이 생긴다.

곁들여 죽은 규칙 `.tabstrip-label` 을 걷어냈다. 닫기 버튼이 탭의 **형제**이던
시절의 것으로 지금은 렌더되지 않는데, 바로 위 주석이 "닫기 버튼은 형제라 위젯
중첩이 없다" 고 **틀린 구조를 설명**하고 있었다 — 지금은 닫기가 탭 안에 있고
보조기술에서만 감춰진다. 없는 것을 찾게 만드는 주석이라 규칙과 함께 지웠다.

## 검증

- `pnpm lint` · `pnpm typecheck` · `pnpm test`(118파일 1,385건) · `pnpm build`
  전부 exit 0. CSS 변경이라 단언이 늘지는 않았다.
- 산술 확인 — 하한 68px 기준으로 최소 창(960px)에서 대략 11개까지 들어간다
  (예전 96px 은 8개). 잘림이 사라진 게 아니라 **문턱이 뒤로 밀렸다.**
- **육안 미확인.** 붐비는 스트립(탭 10개 이상)에서 아이콘·활동 점·닫기가 실제로
  겹치지 않는지는 봐야 한다. 설치본 `ocul-pm.app` 이 돌고 있어 dev 빌드를 못
  띄운다 — 플래너 `#crowded-strip-verify` 로 열어 뒀다.

## 메모

가로 스크롤은 **일부러 안 넣었다.** 위 주석의 결정("스크롤되면 탭이 몇 개인지
모른다")은 지금도 유효하고, 이번 수정은 그 결정을 뒤집는 게 아니라 그 결정이
전제한 축소를 실제로 켜는 것이다. 탭을 12개 넘게 여는 사용이 실제로 관찰되면
그때 스크롤 대 축소를 다시 저울질하는 게 맞다 — 지금 넣으면 관찰 없이 결정을
뒤집는 셈이다.
