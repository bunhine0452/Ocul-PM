---
schema_version: 1
type: bug
slug: "lsp-trust-chip-missed-event"
status: done
difficulty: low
created_at: "2026-10-08T23:23:02+09:00"
session_id: "20261008-008"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/lspBridge.ts"
    op: update
  - path: "src/__tests__/code_trust.test.tsx"
    op: update
related:
  - ref: "20261008/Bugs/1906_bug_lsp-workspace-trust-gate.md"
    kind: "followup"
tags:
  - "lsp"
  - "security"
  - "regression"
  - "mcp-tool"
---
[x] 「신뢰하고 켜기」 칩이 안 뜨던 것

## 발생 원인
v3.10.0 업데이트 직후 사용자 보고: "신뢰가 어디서 뜬다는 거야? 안 뜨던데". 상태줄 칩은 `LspServerStateChanged` 이벤트로만 켜졌다. `useLsp` 는 열기 effect 가 구독 effect 보다 먼저 정의돼, 막 마운트된 편집기에선 `lsp_open` 이 구독(비동기 listen)보다 먼저 나간다. 예전 상태(Starting · Ready)는 서버를 띄우는 몇 초 뒤에 와서 문제가 없었다. 반면 신뢰 전(Untrusted)은 서버를 띄우지 않고 **즉시** 답해, 구독이 붙기 전에 지나갔다. jsdom 엔 이벤트가 없어 v3.10.0 의 테스트(상태줄 컴포넌트 단독)가 이 경로를 못 봤다.

## 해결 방법
`lsp_open` 이 붙지 못한 언어 파일이면 `lsp_status` 로 그 언어의 상태를 직접 묻고, untrusted · missing 이면 세운다. 경로 → 언어 id 는 `lspBridge.lspLanguageIdFor`(registry.rs `spec_for_path` 와 같은 표)다. 3.10.0 의 우회로는 설정 → 코드 → 언어 서버의 「신뢰하기」 뒤 파일 다시 열기다.

## 검증
이벤트가 오지 않는 jsdom 에서 useLsp 가 untrusted 를 세우는 회귀 테스트를 넣었다. 수정 전 코드로 되돌리면 그 테스트가 실패(타임아웃)하고 수정 뒤엔 통과한다. 전체 3,298건 · PR #78 CI 초록 → 1dd20045.

## 메모
교훈: 「즉시 답하는 새 상태」 를 이벤트로만 알리면 마운트 경합에 진다. 상태를 바꾸는 요청은 그 결과를 반환값이나 직후 조회로도 받아야 한다. 컴포넌트 단독 테스트로는 배선 경합을 못 본다.