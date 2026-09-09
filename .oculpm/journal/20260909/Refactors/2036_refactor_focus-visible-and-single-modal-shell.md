---
schema_version: 1
type: refactor
slug: "focus-visible-and-single-modal-shell"
status: done
difficulty: medium
created_at: "2026-09-09T20:36:08+09:00"
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
  - "focus"
  - "modal"
  - "design"
  - "mcp-tool"
---
[x] Tab 으로 들어가도 안 변하던 입력 여섯, 그리고 팝오버 층에 앉아 있던 모달 셸

## 동기

### 포커스가 새는 입력

`outline: none` 을 쓰면서 `:focus-within` 대체가 없는 자리를 다시 세었다. **감사의 줄번호는 이미 밀려 있었다** — 같은 라운드의 모션 커밋이 `agent.css`·`skills.css`·`discussion.css` 를 건드려 줄이 이동했다. 다시 도출하니 6곳이 아니라 **9곳**이었고 집합도 달랐다.

그중 셋은 고칠 게 아니었다:
- `.wz-card` — `tabIndex={-1}` 컨테이너를 **프로그램으로** 포커스한다. 링을 그리면 안 된다.
- `.code-tree-draft-input` — 이미 `border: 1px solid var(--accent-ring)` 이 활성 표시다.
- `.code-goto-input` — 팝업의 유일한 입력이고 자동 포커스된다. 팝업 자체가 표시다.

남은 여섯이 진짜다. 래퍼가 있는 넷(`.ctx-search` · `.disc-note` · `.acp-panel-search` · `.term-search`)은 `:focus-within`, 래퍼가 없는 둘(`.term-sess .ts-rename` · `.acp-session-input`)은 자기 자신에 `:focus`. `.search-box:focus-within` 이 쓰던 관용구(`border-color: var(--accent); box-shadow: var(--ring-soft)`)를 그대로 따랐다.

### 입력 경계 대비 — 3:1 은 못 채운다

`--input` 은 팔레트 별칭화 때 `--sep`(가장 옅은 헤어라인)이 됐다. 카드 위 실측:

```
          --sep   --sep-strong
라이트      1.19       1.36
다크        1.28       1.62
solarized  1.23       1.45
nord       1.25       1.48
dracula    1.31       1.61
고대비      5.33      12.58
```

`--sep-strong` 으로 올렸다(한 단 개선). **다만 WCAG 1.4.11 의 3:1 에는 여전히 못 미친다** — 헤어라인 토큰은 원래 구분선이지 컨트롤 경계가 아니다. 3:1 을 채우려면 입력 전용 경계색을 새로 만들어야 하고, 그건 모든 입력의 인상을 바꾸는 결정이라 사용자 판단 사항으로 남긴다.

### 모달 셸이 두 벌, 그중 하나는 팝오버 층

`.set-modal-backdrop` 이 `z-index: var(--z-popover)`(60) 였다. 진짜 모달(`AppDialog`, z-modal 100) 밑으로 들어간다는 뜻이다.

층만 올릴 수는 없었다. `ConversationHistoryModal` 은 안에서 확인 다이얼로그(`AppDialog`)를 띄우는데 그걸 **백드롭보다 앞에** 렌더하고 있었다 — 층이 달라서 순서가 상관없었기 때문이다. 층을 맞추면 순서가 위아래를 정하므로 확인창이 가려진다.

## 변경 요약

셸을 `AppDialog` 한 벌로 접었다. 둘 다 이미 `useModalBehavior` 를 쓰고 있었으므로 남은 건 백드롭·패널·층·등장 애니메이션이었다.

- `ConversationHistoryModal` · `ManualEntryModalV2` → `<AppDialog>`. 후자는 제출 중 Esc·백드롭 닫기를 막는 `dismiss` 를 `onClose` 로 넘긴다.
- `{confirmDialog}` 를 모달 **뒤로** 옮겼다. 이제 같은 층이라 DOM 순서가 위아래를 정한다.
- `.set-modal-backdrop` · `.set-modal` · `.set-modal--wide` · `@keyframes modalFade`/`modalRise` 삭제. 남은 건 안쪽 내용 스타일뿐이고 여백은 `.set-modal-body`(`--space-7`, 옛 22px 에서 램프 위로) 하나가 갖는다.
- `primitives.css` 의 `.scrim, .set-modal-backdrop` 이 `.scrim` 하나가 됐다.

**계약 테스트가 한 단 강해졌다.** 전에는 "두 번째 스크림이 `.scrim` 과 **같은 바탕**을 쓴다" 였는데, 이제 "`.set-modal-backdrop` 이 되살아나지 않는다" 다. 이름이 하나면 "이 모달만 프리셋을 안 따른다"(2026-09-02 에 실제로 났던 버그)가 구조적으로 불가능해진다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트 전부) · `pnpm test`(194 파일 2,522개) · `pnpm build` 각 exit 0.