---
schema_version: 1
type: refactor
slug: "api-facades-code-terminal-git-llm"
status: done
difficulty: high
created_at: "2026-10-01T18:25:03+09:00"
session_id: "20261001-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/api/code.ts"
    op: update
  - path: "src/api/git.ts"
    op: update
  - path: "src/api/invoke.ts"
    op: update
  - path: "src/api/llm.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/api/plan.ts"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/api/conversations.ts"
    op: create
  - path: "src/api/dap.ts"
    op: create
  - path: "src/api/diff.ts"
    op: create
  - path: "src/api/lsp.ts"
    op: create
  - path: "src/api/projects.ts"
    op: create
  - path: "src/api/search.ts"
    op: create
  - path: "src/api/secrets.ts"
    op: create
  - path: "src/api/settings.ts"
    op: create
  - path: "src/api/terminal.ts"
    op: create
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/useDebug.ts"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/features/diff/useDiffChanges.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "src/__tests__/new_tab_intent.test.ts"
    op: update
related:
  - ref: "20260918/Bugs/2000_bug_bug-hunt-round3-settings-writeback.md"
    kind: "followup"
  - ref: "20260915/Refactors/2301_refactor_split-codepane.md"
    kind: "followup"
tags:
  - "api-facades"
  - "refactor"
  - "error-convention"
  - "lint"
  - "mcp-tool"
---
[x] 코드·LSP·DAP·터미널·git·diff·LLM 화면의 직접 커맨드 호출 39파일을 @/api 파사드로 — lint:bindings 미이전 87→52

## 동기

`improvement-round-2026-09-14 {#api-facades}` — 화면이 생성 바인딩(`commands`/`events`)을 직접 부르면 봉투 `{status}` 를 화면마다 풀고, 오류가 `string`·`AppError`·던져진 `Error`(전송 실패) 세 모양으로 갈렸다. 같은 실패가 어느 화면에선 `tError`, 어느 화면에선 `String(e)` 로 찍혔고, 전송 거절은 대부분 unhandled rejection 이었다. 9/18 에 `plan.ts`·`shellIntegration.ts` 두 조각만 옮긴 채 code·terminal·git·llm 이 남아 있었다.

## 변경 요약

- **새 파사드 9개** — `lsp`(수명·읽기·고치기·서버 관리·이벤트 2) · `dap`(세션·중단점·스택·변수·이벤트 3) · `diff`(compute·이진 미리보기·묶기·영향) · `terminal`(`ptyApi`·`terminalWindowApi`) · `conversations` · `secrets` · `settings`(get/set) · `search`(chunks) · `projects`(list).
- **기존 확장** — `codeApi`(read·write·dir·tree·검색·치환·가져오기·프로젝트 파일 읽기) · `gitApi`(graph·status·log·lineChanges·lastCommit·headBrief) · `planApi`(create·applyEdit) · `llmApi.stream` · `oculpmApi`(agentRunSignal·searchEntities) · `windowApi.onNewTabIntent`.
- `invoke.ts` 에 공용 둘: `errorDetail(e)`(옛 `res.error` 원문 자리 — 토스트 문구가 그대로다) · `subscribe(event, cb)`(비-Tauri 에서 빈 해제 함수, 각 훅에 복제돼 있던 try/catch 를 하나로).
- 이전 39파일: 코드 화면 20(CodePane·codePane 훅 6·codeScreen 훅 4·useLsp·useDebug·검색·가져오기·미리보기·디버그 패널·설정 코드 탭) · 터미널 9 · diff/Today git 6 · AI 패널 4(+LlmTab·llmTarget) · ⌘K 팔레트.
- 보존한 것: `ptyApi.send` 만 **봉투를 그대로** 낸다 — `createPtyWriter` 의 세션별 직렬 줄이 봉투로 말하고 테스트가 그 모양의 가짜를 꽂는다. `reportFailure(…, commands.x)` 는 `reportRejection(api.x())` 로. `lspApi.format`·`applyCodeAction`·`rename` 은 예전처럼 던진다(호출자가 `e.message` 로 토스트 — `ApiError.message` 가 같은 원문).
- 행동 차이(의도): 전송 거절이 이제 같은 `catch` 로 와서 토스트·상태줄에 실린다(예전엔 unhandled). `String(e)` 자리는 `tError(toAppError(e))` 로 — "Error: " 접두가 사라지고 영어 원문이 번역 규칙을 탄다.
- `lint:bindings` allowlist: 래퍼 9 추가, 호출자 39 제거(+ 타입만 남은 `api/invoke.ts`), 지운 항목만 설명하던 분할 주석 3개 정리. 남은 직접 호출자 52 — 탭 스트립·시작 탭·설정 다수·논의·플래너·모바일.
- `TerminalInstanceImpl` 래칫 958줄: 시작 실패 갈래를 `.catch` 로 접어 늘리지 않았다.

## 검증

- `pnpm typecheck` · `pnpm test`(252파일 3,288건) · `pnpm lint`(6게이트, eslint 경고 4=상한) · `pnpm build` 전부 exit 0 직접 확인.
- 깨진 테스트 1건(`new_tab_intent` 소스 계약이 `events.newTabIntent` 문자열을 TerminalWindow 에서 찾음) — 창 래퍼 경유 + 래퍼가 같은 이벤트를 듣는지로 고쳐 물었다.
- 실기기 확인은 없다(설치본 구동 중 dev 빌드 금지) — 코드 화면 열기·저장·LSP 진단·디버그·터미널 재접속·AI 대화 스트림을 다음 설치본에서 한 바퀴.