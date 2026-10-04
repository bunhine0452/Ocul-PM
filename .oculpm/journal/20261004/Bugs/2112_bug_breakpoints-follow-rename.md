---
schema_version: 1
type: bug
slug: "breakpoints-follow-rename"
status: done
difficulty: medium
created_at: "2026-10-04T21:12:24+09:00"
session_id: "20261004-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code/mutate.rs"
    op: update
  - path: "src/features/code/fileOps.ts"
    op: update
  - path: "src/features/code/useDebug.ts"
    op: update
  - path: "src/features/code/useFileOps.ts"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/__tests__/code_rename_breakpoints.test.ts"
    op: create
related:
  - ref: "20260819/Bugs/0725_bug_code-screen-save-hardening.md"
    kind: "followup"
tags:
  - "dap"
  - "code-editor"
  - "mcp-tool"
---
[x] 편집기에서 파일·폴더 이름을 바꾸면 찍어 둔 중단점이 사라지던 것

## 발생 원인
중단점은 경로를 키로 두 곳에 산다 — 백엔드 `BreakpointStore` 와 거터가 읽는 `useDebug` 의 Map. `code_rename` 은 로컬 히스토리만 새 경로로 옮기고 중단점은 그대로 둬서, 이름 바꾼 파일의 중단점이 거터에서 사라지고 다음 디버그 세션은 없는 경로로 보냈다. 저장소를 옮기는 `DapState::rename_breakpoint_path` 는 2026-08-23 부터 있었지만 **호출자가 0** 이었다 (pub 함수라 컴파일러가 못 잡음 — 호출자 0 인 pub 함수 스캔에서 발견).

## 해결 방법
- `code_rename` 이 성공 뒤 `rename_breakpoint_path` 를 부른다 (폴더면 하위 전부, 백엔드가 알려 준 is_dir 기준).
- 프런트: 순수 `remapPathKeys` (fileOps.ts) + `useDebug.renamePath` 가 중단점·미검증 지도를 같은 규칙으로 다시 키잉, `useFileOps.applyRenamed` 가 `onRenamed` 로 알린다. 바뀔 키가 없으면 같은 Map 을 돌려줘 렌더를 깨우지 않는다.

## 검증
`code_rename_breakpoints.test.ts` 3건 (파일·폴더·형제 이름 겹침·무변경 동일성). 실기기 육안은 설치본이 돌고 있어 미확인.