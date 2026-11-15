---
schema_version: 1
type: feature
slug: "accent-colors-off-danger"
status: done
difficulty: medium
created_at: "2026-11-15T08:25:06+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/accent_distinct.test.ts"
    op: create
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/features/theme/claudeTheme.ts"
    op: update
related: []
tags:
  - "테마"
  - "theme"
  - "quality-round"
  - "mcp-tool"
---
[x] 테마: 분홍 · 주황 · 앰버를 위험 · 경고색에서 뗐다

## 추가 기능

사용자 결정(11-15 「세 색을 옮기기」, 계획 quality-round-20261115 #accent-colors). 프로젝트 색은 그 창의 강조색이 된다(projectAccent.ts). 분홍의 `--accent` 가 `--danger` 와 같은 값(라이트 #e0524b · 다크 #f1685f), 다크 주황이 `--warn` 과 같아 장미색 창에서는 「Claude 에게 맡기기」 가 위험 단추로 보이고 보통 확인과 위험 확인이 구별되지 않았다(영수증 규칙 ① · ④).

견본 이름은 그대로 두고 `[data-accent=rose · orange · amber]` 두 가족의 값만 옮겼다 — 분홍은 더 분홍답게(라이트 #c14978 · 다크 #ef8ba5), 주황은 갈색 쪽(라이트 #b25e21), 앰버는 올리브 쪽. 칠하는 넷(--accent · -strong · -text · -ring)이 위험 · 경고 · 일지 버그/에러 색과 OKLab ΔE 0.09 이상 떨어진다.

## 동작 흐름

설정의 강조색 견본과 프로젝트 색이 같은 토큰을 읽어 따로 고칠 곳이 없다. 새 `accent_distinct.test.ts` 가 tokens.css 를 읽어 모든 `[data-accent]` 가 두 가족에서 의미색과 ΔE 0.08 이상인지, 주 단추 글자 대비가 4.5:1 이상인지 문다. Claude 테마 파일의 강조색 표도 이 값을 따른다(합류에서 어긋남을 claude_theme 시험이 잡아 맞췄다).

## 검증

- `pnpm test` 1745 중 1743 passed → claudeTheme 표를 고친 뒤 관련 시험 45 passed, accent_distinct 19 passed. typecheck · lint · build exit 0.
- 이 커밋은 워크트리 기준이 어긋나 독립 리뷰를 거치지 않았다 — 최종 검수 워크플로가 따로 본다. 설치본에서 눈으로 보지는 않았다.

## 메모

- 다크 주황은 「갈색 쪽」 대신 살구색(#ffbb93)이다 — 디자인 래칫(design_tokens 의 on-accent 바닥 7.33)이 밝게 붙잡는다. 캐러멜로 더 옮기려면 그 바닥을 내려야 해서 이번엔 두었다.
- VS Code 제목 막대 색(vscode_color.rs)은 창 구분용이라 바꾸지 않았다.