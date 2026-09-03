---
schema_version: 1
type: bug
slug: "a2a-card-empty-hint-misuse"
status: done
difficulty: low
created_at: "2026-09-03T16:32:33+09:00"
session_id: "20260903-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/A2aCard.tsx"
    op: update
  - path: "src/features/settings/A2aEndpointBlock.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
related:
  - ref: "20260903/Features_to_add/1532_feature_a2a-phase5-ui.md"
    kind: "followup"
tags:
  - "a2a"
  - "ui"
  - "mcp-tool"
---
[x] 협업 카드가 화면을 뒤덮은 이유 — 빈 상태용 여백을 목록 행에 썼다

## 발생 원인

실기기에서 협업 카드가 뜨긴 했는데 행 사이가 250px 씩 벌어져 카드 하나가 화면을
뒤덮었다. 원인은 CSS 한 줄이다: 보조 텍스트에 `.empty-hint` 를 썼는데, 그건
**빈 상태 프리미티브**라 `padding: 60px 30px; text-align: center` 가 붙어 있다.
행마다 위아래 60px 이 더해졌고, 행이 다섯 자리에 있었으니 그만큼 벌어졌다.

이름도 틀렸다. 어댑터 핸드셰이크가 주는 `name` 은 npm 패키지 이름
(`@agentclientprotocol/claude-agent-acp`)이라 사람이 읽을 것이 못 되는데 그것을
그대로 제목 자리에 세웠다.

## 해결 방법

- 인라인 보조 텍스트 전용 `.a2a-sub`(한 줄·말줄임)와 문단용 `.a2a-desc`(접힘)를
  나눠 만들었다. 빈 상태 프리미티브를 조밀한 목록에 재사용하지 않는다 — 왜
  그러면 안 되는지 CSS 주석에 남겼다.
- 참여자 이름은 기록에 쓰는 라벨(`agentLabel(provider)` → "Claude Code" ·
  "Codex CLI")을 앞에 세우고, 어댑터 패키지 이름은 흐린 보조로 뒤에 붙였다.
- 설정의 외부 문 블록도 같은 실수를 하고 있어 함께 고쳤다.

## 검증

`pnpm typecheck` 0 · `pnpm test` 160 files 2077 passed · `pnpm lint` 0 ·
`pnpm build` 0. 실기기 재확인은 사용자 몫 — dev 서버가 HMR 로 반영한다.