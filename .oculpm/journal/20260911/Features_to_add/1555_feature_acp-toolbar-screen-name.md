---
schema_version: 1
type: feature
slug: "acp-toolbar-screen-name"
status: done
difficulty: low
created_at: "2026-09-11T15:55:20+09:00"
session_id: "20260911-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/conversation/AcpToolbar.tsx"
    op: update
  - path: "src/features/chat/AcpSessionTabs.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
related:
  - ref: "20260910/Refactors/0134_refactor_ime-guard-single-definition.md"
    kind: "followup"
tags:
  - "acp"
  - "toolbar"
  - "design-consistency"
  - "ia-decision"
  - "mcp-tool"
---
[x] AI 3면 파리티 마감 — ACP 상단바에 화면 이름 복원(이름 + 탭), 지난 대화 UI 는 프로토콜 차이로 유지

`{#unify-chat}` 의 남은 두 갈래는 둘 다 "눈으로 볼 IA 선택"이었고 양쪽에 근거 주석이 박혀 있었다(PR-ACP14 "탭 줄이 곧 제목" · `SessionPanel` "옆에 두고 오가는 동작"). 임의로 한쪽을 뒤집지 않고 사용자에게 물었다.

## 추가 기능

**결정 1 — ACP 제목: "이름 + 탭".** `AcpToolbar` 의 `title` 에 화면 이름(`nav.claudecode` / `nav.codex`)을 `.acp-screen-name` 으로 세우고 세션 탭 줄을 그 곁에 둔다. 이름은 `.toolbar-title` 칸이 주는 서체(fs-7·strong)를 그대로 받아 다른 14화면과 같고, 탭 줄은 `padding-left + border-left: var(--sep)` hairline 하나로 이름에서 떼어 "Claude Code 새 대화" 가 한 문장으로 읽히지 않게 했다. `.toolbar-title:has(.acp-tabs)` 가 flex 컨테이너가 되어 이름은 `flex: none`, 탭은 남은 폭을 쓴다. PR-ACP14 의 근거("사이드바가 이미 말한다")는 사이드바를 접으면 무너진다는 점을 주석에 남겼다.

**결정 2 — 지난 대화 UI: 둘 다 유지.** ACP 목록은 Claude Code 자체 세션 스토어를 `session/list` 로 여는 외부 목록이라 옆에 두고 오가는 패널이 맞고, AI 대화 목록은 로컬 SQLite 의 작은 목록이라 모달이 맞다 — 겉모습 차이가 아니라 자료의 성격 차이. `AiPanelScreenV2` 가 1032줄(한계 초과 상태)이라 패널로 옮기려면 분할이 선행돼야 하는 것도 이유.

지난 로그(2026-09-10)가 이미 정정한 대로 "컴포저 170줄 재작성"은 과장이었고 IME 가드 통합으로 갚았으니, 이로써 항목의 세 갈래가 전부 닫힌다.

## 동작 흐름

`AcpToolbar` → `<Toolbar title={<><span.acp-screen-name/>{name}</span><AcpSessionTabs/></>}>`. 이름 span 에 `data-tauri-drag-region` — Toolbar 규약대로 비대화 자식은 창 드래그를 받는다.

## 검증

- 병렬 세션 WIP 와 섞이지 않게 `refs/heads/main`(`d4b35d5`) 워크트리에 3파일 패치만 적용해 게이트: `typecheck` ok · `test` 209파일 2671건 ok · `lint` 6게이트 ok(경고 4/4) · `build` ok.
- 임시 인덱스 + CAS `update-ref` 로 3파일만 커밋(`4724063`), 푸시.
- 실기기 육안은 안 봤다 — v3-release 의 `{#eyes-activity}`/`{#eyes-ia}` 격자에 "ACP 상단바 이름+탭 hairline, 좁은 폭에서 탭 줄 스크롤" 이 얹힌다.