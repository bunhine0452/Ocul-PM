---
schema_version: 1
type: feature
slug: "planner-dispatch-v1"
status: done
difficulty: medium
created_at: "2026-07-31T02:33:49+09:00"
session_id: "mcp-20260731-023349"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/dispatch.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/mod.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/terminal/dispatchBus.ts"
    op: create
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
related: []
tags:
  - "planner"
  - "dispatch"
  - "terminal"
  - "plugin-round"
  - "mcp-tool"
---
[x] 플래너 디스패치 v1 — 항목을 터미널의 Claude Code 로 발화 (IN2)

## 추가 기능

plugin-round Phase C {#in2-dispatch}. "계획이 구현을 끌고 간다"의 첫 링크 — 플래너가 백미러에서 핸들이 된다:

1. **프롬프트 조립기** (`planner/dispatch.rs`): 항목 텍스트+phase+(부모면) 하위 체크리스트+**미완 리프만** `plan_update` 갱신 대상으로 명시 + plan-log 에서 이 항목(하위 포함)에 연결된 **최근 일지 2건 발췌**(frontmatter 제거·700자 컷) + 게이트 실행→journal_write→plan_update 지시. 잠긴 plan·미지 항목 거부, 프롬프트 전체 redact(심층 방어).
2. **`plan_dispatch_prompt` 커맨드**: 조립 결과를 `.oculpm/index/dispatch/<plan>-<item>.md`(앱 관리·gitignore 영역)에 쓰고, 터미널 프리필용 한 줄 `claude "$(cat '…')"` 을 반환 — 경로는 단일인용부호+`'\''` 이스케이프(셸 주입 방지, 단위 테스트).
3. **프런트 배선**: 플래너 항목 행에 ▶실행 버튼(완료/폐기 제외·잠긴 plan 제외) → `dispatchBus`(모듈 싱글턴, 1회 소비·비영속) → 터미널 화면 전환 → 활성 페인 PTY 에 명령 프리필(**개행 없음 — 실행은 사용자가 Enter**, 세션 기동 전이면 300ms 재시도 ≤10회). 자동화·큐잉은 v2.

## 동작 흐름

항목 ▶실행 → 백엔드 조립·저장 → 토스트 안내 + 터미널 전환 → 프리필된 `claude "$(cat …)"` 확인 후 Enter → 디스패치된 세션이 구현→일지→plan_update 로 루프를 닫는다.

## 검증

- Rust 단위 2: 조립(하위 체크리스트·일지 발췌·redact·미완 리프 타깃·잠금/미지 거부), 셸 인용 이스케이프. cargo 전체 FAILED 0.
- typecheck/lint/vitest 335/build 그린 (bindings 재생성 +planDispatchPrompt).
- 실기기(버튼→터미널 프리필→Enter→실세션) 확인은 A0d 에 동승.

## 메모

원안의 "해당 rules 포함"은 의도적으로 제외 — 디스패치된 Claude Code 세션이 CLAUDE.md/.claude/rules 를 네이티브 로드하므로 프롬프트 중복 탑재는 토큰 낭비(Phase B 원칙과 정합). 프리필-후-Enter 는 안전장치이자 v1 범위 표시.