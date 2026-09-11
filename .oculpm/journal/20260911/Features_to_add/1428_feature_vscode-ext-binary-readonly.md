---
schema_version: 1
type: feature
slug: "vscode-ext-binary-readonly"
status: done
difficulty: low
created_at: "2026-09-11T14:28:42+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "f765a77e-6dcb-4163-aad5-23b2741956c9"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/src/binary.ts"
    op: create
  - path: "extension/src/binary.spec.ts"
    op: create
  - path: "extension/src/commandRegistry.ts"
    op: create
  - path: "extension/src/manifest.spec.ts"
    op: create
  - path: "extension/src/extension.ts"
    op: update
  - path: "extension/src/test/extension.test.ts"
    op: update
  - path: "extension/package.json"
    op: update
  - path: "extension/src/oculpm/reader.spec.ts"
    op: rename
  - path: "extension/tsconfig.json"
    op: update
related: []
tags:
  - "vscode"
  - "extension"
  - "read-only"
  - "mcp"
  - "mcp-tool"
---
[x] VS Code 확장 — oculpm-mcp 탐색과 읽기 전용 강등(컨텍스트 키·상태바·커맨드 분류 게이트)

## 추가 기능

플랜 `vscode-extension-round` `{#sc-binary}` — `findOculpmMcp(settingPath, candidates, exists)`: 설정 `oculpm.mcpBinaryPath`(machine 스코프) → `/Applications/Ocul-PM.app/Contents/MacOS/oculpm-mcp` → `~/Applications/…` 순. 플랜 문구는 설정을 마지막에 뒀지만 **사용자가 명시한 경로가 앱 후보에 밀리는 건 이상**해서 설정을 먼저 본다(`exists` 주입으로 순수 테스트). 못 찾으면 활성화는 그대로 끝나고 `readOnly=true`: 컨텍스트 키 `oculpm.readOnly` 를 `setContext` 로 올리고, 상태바 `$(circle-slash) Ocul-PM 읽기 전용`(툴팁에 살펴본 경로 목록, 클릭 → oculpm.com). 찾으면 상태바를 숨긴다. 설정 변경·`ocul-pm.rescanBinary` 로 재탐색.

## 동작 흐름

- **커맨드 분류 게이트**: `commandRegistry.ts` 의 `READ_COMMANDS`/`WRITE_COMMANDS` 와 `package.json` 을 `manifest.spec.ts` 가 대조 — 분류 안 된 커맨드는 실패, 쓰기 커맨드는 `menus.commandPalette` `when` 에 `!oculpm.readOnly` 가 없으면 실패. 지금 쓰기 커맨드는 0개(Phase 1~2 가 채움)라 "숨는다"는 게이트로만 보장되고 실물은 `{#sb-toggle}` 에서 처음 생긴다.
- `ext.exports` 가 활성화 시점 객체를 붙들어 rescan 뒤에도 옛 값을 돌려줬다 → getter 로 된 **살아 있는 뷰**를 내보내 고침.
- vitest 파일이 `*.test.ts` 라 tsconfig `exclude` 가 mocha 의 `src/test/extension.test.ts` 까지 삼켜 **옛 `out/` 이 돌고 있었다**(새 테스트 3개 중 2개만 "passing") → vitest 는 `*.spec.ts` 로 이름 분리.

## 검증

- `cd extension && pnpm compile && pnpm test`: vitest 13 · mocha 3 통과(설정에 `/nowhere/oculpm-mcp` 를 넣으면 첫 후보로 살펴보고 앱 경로로 폴백, `readOnly === (binary.path === null)` 불변). 루트 `pnpm lint:extension` exit 0.
- 이 머신엔 앱이 설치되어 있어 Extension Host 에서 읽기 전용 경로는 vitest(빈 후보 → null·throw 없음)로만 판정 — 실기기 강등 화면은 EVALS 4번 항목.