---
schema_version: 1
type: bug
slug: "plan-phase-titled-decision-loses-items"
status: done
difficulty: medium
created_at: "2026-07-30T18:49:58+09:00"
session_id: "mcp-20260730-184958"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
related: []
tags:
  - "planner"
  - "parser"
  - "mcp"
  - "data-loss"
  - "dogfooding-finding"
  - "mcp-tool"
---
[x] '결정' 이 제목에 든 Phase 의 항목이 UI·MCP 양쪽에서 통째로 사라지던 파서 버그

## 발생 원인

`is_decisions_heading` 이 부분 문자열 검사였다:

```rust
lower.contains("결정") || lower.contains("decision")
```

`## 결정` 섹션을 찾으려는 의도였지만, 제목에 그 단어가 **들어가기만 해도** 참이 된다.
`.oculpm/planner/claude-integration.md` 의 실제 헤딩 `## Phase A — 기록의 결정론화 {#phase-a}`
가 여기 걸려 `Section::Decisions` 로 전환됐고, 그 아래 체크 항목 7개가 phase 소속을
잃고 파싱 결과에서 조용히 빠졌다.

`parse_plan` 은 Planner 화면(`plan_get`)과 MCP `plan_status` 가 함께 쓰는 단일
경로라서 두 표면 모두 같은 거짓말을 했다 — 디스크에 20개가 있는데 13개만 보고했고
진척도 8/13 으로 계산됐다. 실행 중인 `oculpm-mcp` 바이너리로 확인한 실측이다.

가장 나쁜 점은 **어떤 UI 로도 손실을 알 수 없었다**는 것. 경고도 없고, 항목이
지워진 흔적도 없다. 사용자에게는 그냥 '적었는데 없어진' 상태로만 보인다.

## 해결 방법

판정을 헤딩 **전체 라벨** 의 정확 일치로 바꿨다 (`DECISIONS_HEADINGS` 허용 목록).
AGENTS.md §7 이 문서화한 `## 결정 (Decisions)` 형태를 위해 뒤따르는 괄호 주석은
벗겨 내고, 뒤쪽 구두점(`:` `.` `·` `—` `-`)도 정리한 뒤 비교한다.

이 방향이 중요한 이유는 **실패 모드가 뒤집히기** 때문이다. 목록에 없는 결정 헤딩은
이제 phase 로 렌더된다 — 눈에 보이고 사용자가 이름을 고치면 끝난다. 반대 방향의
실패(phase 가 자기 항목을 삼키는 것)는 화면 어디에도 드러나지 않는다.

## 검증

- `cargo test --lib planner::parse` — 15/15 통과. 회귀 테스트 2개 추가:
  `phase_titled_with_the_word_decision_keeps_its_items` (실제 헤딩 그대로 재현),
  `decisions_heading_variants_still_open_the_decisions_section` (`## 결정` /
  `## 결정사항` / `## Decisions` / `## 결정 (Decisions)` 4종).
- `cargo test` 전체 429 통과 (기존 `plan_edit` 의 `## 결정 (Decisions)` 픽스처 포함).
- 실 바이너리 확인: `cargo build --bin oculpm-mcp` 후 `tools/call plan_status` 를
  stdio 로 호출 → `claude-integration` 이 `items: 20 / progress 13,20` 로 응답
  (수정 전 13 / 8,13).