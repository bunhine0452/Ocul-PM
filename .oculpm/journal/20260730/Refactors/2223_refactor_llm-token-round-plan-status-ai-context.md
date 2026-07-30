---
schema_version: 1
type: refactor
slug: "llm-token-round-plan-status-ai-context"
status: done
difficulty: high
created_at: "2026-07-30T22:23:10+09:00"
session_id: "mcp-20260730-222310"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/__tests__/ai_context_parts.test.ts"
    op: update
related: []
tags:
  - "mcp"
  - "token-cost"
  - "ai-panel"
  - "planner"
  - "dogfooding-finding"
  - "mcp-tool"
---
[x] LLM 토큰 라운드 — plan_status 뷰·필터·커서·TSV + AI 패널 컨텍스트 축소·규칙 절단 버그

## 동기

모든 LLM 접점의 바이트를 실측한 결과, 비용이 문서 크기가 아니라 **반복 주기**에
몰려 있었다. `plan_status` 는 인수가 하나도 없어 활성 플랜의 전 항목을 매번
뱉었고(이 저장소 10,011 B, 계획 15×항목 14 규모 추정 ~50 KB ≈ 12k 토큰), 모델이
좁혀 달라고 말할 수단이 없었다. AI 패널 컨텍스트는 **메시지마다** 재조립돼
system 으로 다시 올라가는데 25,036 B / ~6,051 토큰이었다.

## 변경 요약

### plan_status — 뷰·필터·페이징 (인수 0개 → 5개)

`view`(기본 `summary`) · `plan_id` · `status[]` · `limit`(기본 60, 최대 500) ·
`cursor`. 기본이 요약이라 완료·폐기 항목이 빠진다.

- **`cursor` 는 오프셋이 아니라 항목 id.** 필터가 달라진 다음 호출에서 오프셋은
  엉뚱한 자리를 가리켜 항목을 건너뛰거나 되풀이한다.
- 파일 순서를 정렬해 응답을 결정적으로 만들었다 (`read_dir` 순서는 OS 소관).
- `returned` / `total` / `more` / `next_cursor` 를 같이 실어, 잘린 응답이
  '전부인 척' 하지 않는다.
- **`parse_plan` 의 `warnings` 를 처음으로 노출.** 망가진 플랜을 갱신하라고
  시키면서 그 사실을 숨기고 있었다 — 수십 바이트로 가장 값진 정보.
- 항목을 중첩 JSON 대신 **TSV** 로 싣고, 상태 글자는 디스크 글리프 어휘
  (`  ~ x ! > -`)를 그대로 쓴다. 모델이 읽은 글자를 그대로 파일에 쓰므로 번역
  단계가 없다. 레전드가 `ItemStatus::token()` 과 어긋나면 테스트가 깨진다.

실측 (이 저장소, 활성 3플랜 42항목):

| 호출 | payload | 이전 대비 |
|---|---|---|
| 이전 형태 | 10,011 B | — |
| 기본(summary, 미완 11) | **3,183 B** | **−68%** |
| `view:"full"` (같은 42항목, TSV) | 9,294 B | −7% |
| `plan_id` 하나 | 2,122 B | −79% |
| `status:[in_progress,blocked]` | 1,417 B | −86% |

**정정**: TSV 자체의 기여는 설계 단계 예측(−37%)보다 훨씬 작은 **−7%** 였다.
한국어 제목이 길어 JSON 의 항목당 구조 오버헤드가 상대적으로 작기 때문이다.
이득의 대부분은 인코딩이 아니라 요약 기본값과 필터에서 나온다.

### AI 패널 컨텍스트

- `buildPlannerSystemContext` 가 `planList` 결과를 그대로 실어, 사용자가 **잠근**
  done/archived 계획까지 매 메시지 재전송하고 있었다 (MCP `plan_status` 는 active
  만 준다 — 같은 개념이 두 답을 내던 셈). 잠긴 계획은 `plan_apply_edit` 가 쓰기를
  거부하므로 애초에 제안 대상이 아니었다. 활성만 + 상위 4개 + 종료 항목은 개수만.
- **`clampText(master, 2500)` 절단 버그**: 자르는 위치가 §3 frontmatter 의 YAML
  **중간** 이라 인앱 어시스턴트가 §4 본문 규칙부터 §8 까지를 한 번도 못 봤다 —
  **§5 의 시크릿 금지 포함**. 토큰을 아끼려던 코드가 규칙 전달을 조용히 깨뜨리고
  있었다. `digestRules` 로 교체: `## ` 절 경계로 자르고 우선순위(§5→§1→§4→…)대로
  예산을 채우며, 헤딩이 없는 사용자 편집 마스터는 예전 동작으로 되돌아간다.

## 검증

- `cargo test` 436 통과. `plan_status` 신규 테스트 8개 — 요약/전체 분기, 상태
  필터가 뷰를 이김, 항목 id 커서 페이징(+없는 커서 에러), 단일 플랜 좁히기,
  warnings 귀속, 레전드-`ItemStatus::token()` 정합, TSV 셀에 탭이 들어가도 열이
  5개 유지.
- `pnpm test` 265 통과 (`digestRules` 5개 + 플래너 블록 1개 신설).
- typecheck / lint / build exit 0, `bindings.ts` 드리프트 없음 (MCP 는 tauri
  커맨드가 아니라 프런트 계약이 바뀌지 않는다).
- 실 바이너리 왕복으로 위 표의 payload 를 직접 측정.

## 메모

같은 라운드에서 **AGENTS.md 가 Claude Code 에 전달되지 않고 있음** 을 확인했다.
`.claude/CLAUDE.md` 의 `@AGENTS.md` 는 공식 문서상 "임포트를 포함한 파일 기준
상대경로" 로 해석되므로 `.claude/AGENTS.md` 를 찾는데, 실제 파일은 저장소 루트에
있다. 이 세션의 부팅 컨텍스트에도 `@AGENTS.md` 가 확장되지 않은 리터럴로 들어왔다.
`claude_code.md.tpl` 의 `@../AGENTS.md` 한 줄 수정 + `template_version` 범프가
필요하나, 추적 중인 모든 프로젝트에 재동기화가 걸리므로 사용자 판단으로 남긴다.