---
schema_version: 1
type: refactor
slug: "ime-guard-single-definition"
status: done
difficulty: medium
created_at: "2026-09-10T01:34:42+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/ime.ts"
    op: create
  - path: "src/__tests__/ime_guard.test.ts"
    op: create
  - path: "src/features/chat/conversation/useComposerKeys.ts"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/features/terminal/imeBridge.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "ime"
  - "i18n"
  - "refactor"
  - "mcp-tool"
---
[x] IME 판정이 네 벌이었고, 제일 많이 데인 화면만 조건 하나를 더 알고 있었다

## 동기

`{#unify-chat}`(AI 3면 파리티)를 실측하다 항목에 없던 것을 찾았다.

## 실측이 항목의 세 주장을 갈랐다

**① "컴포저는 170줄을 다시 짰다" — 과장이다.** `AiPanelScreenV2` 의 컴포저는 `.composer`·`.composer-ctx`·`.composer-input`·`.composer-foot`·`.composer-send` 를 그대로 쓴다 — **시각 껍데기는 이미 공유되고 있다**(CSS 로). 다른 170줄은 공급자/모델 고르개이고, 공유 `Composer.tsx` 의 대응부는 ACP 설정 노브다. 둘은 프로토콜이 달라서 다른 것이지 베껴 쓴 게 아니다.

공유 `Composer` 의 props 는 39개이고 그중 스무 개 남짓이 ACP 전용이다(`AcpCommand`·`AcpConfigOption`·ultracode·ACP usage). AI 패널에 재사용하려면 그 절반을 optional 로 만들고 내부에서 분기해야 하는데, 그 파일의 머리 주석이 정확히 그걸 경고한다 — *"줄이려고 상태를 이리로 내리면 '어느 대화의 것인가'를 판정하는 자리가 둘이 되고, 그 이중화가 이 화면이 겪은 오배송 사고의 뿌리였다."*

"첨부·슬래시가 없다" 는 맞지만 그건 **일관성 결함이 아니라 기능 부재**다(공급자 API 에 이미지 업로드를 물려야 한다). 이 라운드 밖으로 본다.

**② 진짜 중복은 다른 데 있었다.** 두 컴포저가 공유하는 건 CSS 만이 아니었다 — 한글 IME 가드를 **글자까지 똑같이** 각자 들고 있었다. 세어 보니 앱 전체에 **네 벌**이었다:

| 자리 | 조건 |
|---|---|
| `chat/conversation/useComposerKeys.ts` | `isComposing \|\| keyCode === 229` |
| `chat/AiPanelScreenV2.tsx` | `isComposing \|\| keyCode === 229` |
| `onboarding/StartScreen.tsx` (2곳) | `isComposing \|\| keyCode === 229` |
| `terminal/imeBridge.ts` | `+ key === "Process"` ← **이것만 완전했다** |

터미널만 조건 하나를 더 알고 있었던 건 우연이 아니다. 그 화면이 IME 버그로 제일 많이 데였고(`imeBridge.ts` 머리 주석에 실제 트레이스가 남아 있다 — "조합 이벤트 0건, `isComposing` 끝까지 false"), **그러다 얻은 지식이 그 파일에만 남았다.** 판정이 네 자리에 흩어져 있으면 배운 것이 퍼지지 않는다. 이 라운드가 계속 만난 형태의 가장 비싼 버전이다 — 여기서 어긋난 대가는 픽셀이 아니라 "「회고」를 치다가 프로젝트가 열리는" 버그다.

## 변경 요약

`src/lib/ime.ts` 에 `isImeComposing()` 하나를 두고 네 자리를 전부 그리로 보냈다. 조건은 **가장 완전한 쪽**(터미널의 셋)을 채택했다 — 세 신호 모두 "조합 중" 일 때만 참이라 더 보는 쪽이 안전한 방향이고, 컴포저·시작 화면은 이제 터미널이 배운 것을 공짜로 받는다.

React 합성 이벤트와 네이티브 이벤트를 모두 받게 했다 — 호출부에 둘 다 있었다(`e.isComposing` 과 `e.nativeEvent.isComposing`).

## 안 한 것 — 항목이 아직 열려 있는 이유

- **`AcpToolbar` 가 `title` 자리에 세션 탭을 넣는 것**(16화면 중 제목 없는 둘). 탭은 이 화면의 주 내비게이션이라 `sub` 로 내리면 좁아지고, `children`(액션)으로 옮기면 오른쪽 끝으로 밀린다. 어디로 보낼지는 눈으로 보고 정할 일이다.
- **ACP 는 사이드 패널 · AI 패널은 모달**(대화 기록 UI). 정보구조 선택이라 같은 이유로 남긴다.

## 검증

계약 테스트 4개 — 조합 중 아님 · 세 신호 각각 · React 합성 이벤트 · **손으로 쓴 가드가 남아 있지 않다**(주석 줄은 제외하고 `isComposing` 과 `229`/`"Process"` 가 한 줄에 같이 오는 것을 잡는다). 마지막 것은 `StartScreen` 에 옛 가드를 되살려 실패시키고, 되돌린 뒤 `git diff` 로 복구를 확인했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선 — 새 테스트는 한글 제목이라 허용목록에 알파벳 자리로 추가) · test 198파일/2584 · build.

**눈으로 볼 것:** 한글로 컴포저·시작 화면 검색창에 입력해 Enter 로 조합을 확정해 볼 것. 조건이 하나 늘었으므로 **덜 보내지는** 방향의 변화만 있어야 한다.