---
schema_version: 1
type: bug
slug: "modal-focus-trap-and-aria-audit"
status: done
difficulty: medium
created_at: "2026-09-09T20:22:08+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "a11y"
  - "modal"
  - "focus"
  - "audit-correction"
  - "mcp-tool"
---
[x] 모달 셋에 포커스 트랩을 얹고, 감사의 오탐 여섯을 걷어낸다

## 발생 원인

`role="dialog"` 10곳 중 `useModalBehavior` 를 쓰는 곳이 6곳이었다. 나머지 넷은 각자 Esc 만 손으로 달고 **Tab 트랩·트리거 복원·스크롤락이 없었다** — Tab 을 누르면 뒤에 있는 화면으로 빠져나간다.

가장 아픈 자리가 `WelcomeWizard` 였다. **첫 실행 화면**이라 키보드 사용자가 이 제품에서 처음 만나는 모달인데 그게 트랩 없는 모달이었다.

## 해결 방법

훅은 마크업·CSS 를 그대로 둔 채 동작만 얹도록 설계돼 있어서, 셋 다 ref 하나와 한 줄로 끝났다.

| 모달 | 붙인 것 | 주의점 |
|---|---|---|
| `WelcomeWizard` | 트랩·복원·스크롤락 | `initialFocusRef` 로 카드 자신을 찍는다 — 뒤 시작 화면의 타입어헤드가 키를 먹지 않게. 자체 Esc 분기는 제거(훅의 `onClose = skip`) |
| `ProjectManager` | 트랩·복원·스크롤락 | Esc 의 **단계 의미**(확인 중이면 확인만 취소)를 훅의 `onClose` 로 옮겼다. window 리스너와 같이 두면 훅이 패널에서 전파를 끊어 그 의미가 조용히 죽는다 |
| `Attachments` 라이트박스 | 초기 포커스·트랩·복원 | capture 단계 Esc 리스너는 **그대로** 둔다 — 대화 화면의 Escape 는 "생성 중단" 이라 그보다 먼저 먹어야 한다. capture 에서 전파를 끊으므로 훅의 Esc 와 겹치지 않는다 |

### 테스트가 옛 구현을 흉내 내고 있었다

`project_manager.test.tsx` 의 Esc 테스트 둘이 `fireEvent.keyDown(window, …)` 였다. 리스너가 window 에서 패널로 내려오자 실패했는데, **테스트가 틀린 쪽**이다 — 포커스 트랩이 생겼으므로 사용자의 Esc 는 언제나 패널 안에서 난다. `.pm-sheet` 로 쏘도록 고쳤다.

## 감사의 오탐 정정

이번 라운드의 감사가 짚은 것 중 여섯이 실제와 달랐다. 코드를 열어 확인한 결과:

- **아이콘 전용 버튼 6곳 중 5곳이 오탐.** `TrayPopover:373·473·573` 은 `{t("tray.openInApp")} <ExternalLink/>` 처럼 **보이는 텍스트 라벨**이 있고, `WelcomeWizard:343`·`GreenfieldWizard:753` 도 마찬가지다. 진짜 아이콘 전용은 `CodeDebugPanel:271`(트리 캐럿) 하나뿐 — `aria-label` 을 달고 `common.expand`/`common.collapse` 키를 새로 넣었다.
- **`AcpUsageMeter` 는 "Esc·포커스 처리 전무" 가 아니었다.** `useDismiss(open, wrapRef, …)` 가 바깥 클릭과 Escape 를 이미 처리한다. 다만 팝오버에 `role="dialog"` 를 쓰는 건 맞는 지적이라, 같은 오용인 `ConfigControls:372`(슬라이더를 담은 설정 메뉴)를 `role="group"` 으로 바꿨다. `role="dialog"` 는 포커스 관리를 약속하는데 이 팝오버들은 그걸 하지 않는다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트 전부) · `pnpm test`(194 파일 2,522개) · `pnpm build` 각 exit 0.