---
schema_version: 1
type: chore
slug: "rename-ai-panel-to-agent"
status: done
difficulty: verylow
created_at: "2026-08-14T20:12:05+09:00"
session_id: "mcp-20260814-201205"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
related: []
tags:
  - "i18n"
  - "naming"
  - "ui"
  - "acp"
  - "mcp-tool"
---
[x] "AI 패널" → "에이전트" 이름 변경 (ko/en + 팔레트 + 테스트)

## 동기

ACP 라운드([acp-agent-panel](.oculpm/planner/acp-agent-panel.md))가 이 화면을 "여러 LLM에 질문하는 채팅"에서 **도구를 쓰고 파일을 고치는 에이전트 구동면**으로 바꾼다. 이름이 먼저 바뀌어야 이후 UI 문구가 일관된다.

## 변경 요약

사용자 노출 문자열만 5쌍(ko/en): `nav.ai` · `nav.ai.alias` · `palette.openAiPanel` · `ai.title` · `ai.threadTitle`. 영어는 "AI Panel" → "Agent".

- **alias 는 구 명칭을 남겼다** — `nav.ai.alias` 에 "AI 패널"/"ai panel" 을 유지해 ⌘K 팔레트에서 옛 이름으로도 잡힌다. 근육기억을 깨지 않기 위한 의도적 중복.
- `ai.threadTitle` 은 DB 에 영구 저장되는 대화 제목의 기본값이라 **기존 대화 제목은 그대로** 남고 신규 대화부터 "에이전트"가 된다. 소급 변경은 하지 않았다.
- 코드 주석과 `tools_v2.test.tsx` 의 mock 대화 제목(어서션 아닌 픽스처)은 건드리지 않았다 — 사용자에게 안 보이는 자리라 변경은 순수 노이즈.

## 검증

`pnpm typecheck` 0. `sidebar_a11y` + `tools_v2` 24건 통과 후 전체 `pnpm test` 59파일 738건 통과. `pnpm lint`(하드코딩 한국어 검사) 통과 — 미번역 0개.