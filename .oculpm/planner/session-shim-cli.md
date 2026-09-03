---
oculpm_plan: v1
id: session-shim-cli
title: "세션이 자기를 증명한다 — 심 디렉토리 + oculpm CLI"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 crates/buzz-dev-mcp/src/shim.rs (세션 전용 0700 PATH 디렉토리 + 멀티콜 심링크) 와 buzz-cli 의 JSON in/out·종료코드·--base-hash CAS 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F4·F10). 지금 agent.id 는 에이전트가 프롬프트에서 자칭하는 값이고, MCP 를 안 쓰는 에이전트는 AGENTS.md 파일 규격을 부탁받는 수밖에 없다. 우리는 이미 same-exe 멀티콜(--pty-host·config)을 쓰므로 기반은 있다.

## 범위 확정 (착수 전) {#scope}
- [ ] `terminal-identity-round` 플랜과 범위 충돌을 먼저 확인한다 — 흥수할지 분리할지를 정하고 이 항목에 기록 {#scope-terminal-round}
- [ ] OSC 133/7 셀 통합과의 관계 — 셀 통합은 「무슨 명령이 돌았나」, 심은 「누가 돌렸나」. 같이 가는지 따로 가는지 결정 {#scope-osc}

## 심 디렉토리 {#shim}
- [ ] 세션마다 0700 임시 디렉토리 + 자기 실행파일로 `oculpm` 심링크 + PATH 선두 {#shim-dir}
  - [ ] drop 에서 정리 — 프로세스가 죽어도 남지 않게. 남은 것을 다음 시작 때 걷는 경로도 둔다 {#shim-cleanup}
  - [ ] Windows 는 심링크에 권한이 필요하다 — `.cmd` 쉐임 또는 복사본 폴백. 실패해도 세션은 돌아간다 (심은 부가기능) {#shim-windows}
  - [ ] PATH 주입은 우리가 띄우는 셀(PTY·ACP)에만 적용된다 — 밖에서 띄운 세션은 여전히 못 잡는다는 한계를 주석에 {#shim-limit}
- [ ] 세션 토큰 파일 0600 — 프로젝트 루트 · agent_id · session_id. env 로 넘기지 않는다 (`ps` 에 안 보이게) {#shim-token}
- [ ] 심 설치 테스트 — 권한 비트·PATH 순서·drop 정리 {#shim-test}

## CLI 표면 {#cli}
- [ ] `oculpm journal write` · `plan status|update` · `agent register|inbox|send` — stdin JSON in / stdout JSON out. MCP 도구와 **같은 함수**를 부른다 (두 벌 금지) {#cli-surface}
- [ ] 종료 코드표를 정하고 문서화 — 0 ok / 1 사용자오류 / 2 io / 3 비추적 프로젝트 / 4 기타 / 5 쓰기 충돌 {#cli-exit}
- [ ] stdout 은 결과만, stderr 는 에러만 — 섞지 않는다 (에이전트가 파이프로 받는다) {#cli-streams}
- [ ] 비추적 프로젝트 가드 — `.oculpm` 이 없으면 만들지 않고 exit 3. (`[claude-plugin-strategy]` 감사에서 나온 journal_write 의 create_dir_all 사고 경로를 CLI 에서 반복하지 않는다) {#cli-guard}

## CAS — 기대 해시 불일치는 쓰지 않는다 {#cas}
- [ ] `--base-hash <hex>` — 플랜·일지 갱신 시 기대 내용 해시가 안 맞으면 쓰지 않고 exit 5 {#cas-flag}
- [ ] `--no-base-hash` 로 명시적 강제 허용 — 우회로는 두되 **이름이 붙어** 있어서 우회했다는 사실이 보인다 {#cas-optout}
- [ ] MCP `plan_update` 에도 선택적 `base_hash` — 같은 규율을 두 표면에 {#cas-mcp}
- [ ] 병렬 세션 회귀 테스트 — 두 프로세스가 같은 플랜 항목을 동시에 고치면 한쪽이 exit 5 로 진다 (메모리에 기록된 사고가 이것이다) {#cas-test}

## 신원 — 자칭을 증명으로 {#identity}
- [ ] 토큰이 있으면 토큰이 이긴다 — 인자로 받은 agent_id 는 무시 {#id-token-wins}
- [ ] 토큰 없는 호출은 기존대로 자칭 허용하되 카드에 `unverified` 표시 — 막지 않고 **보이게** 한다 (a2a 의 trespass 와 같은 철학) {#id-unverified}
- [ ] 화면 — 참여자 목록에 검증 여부 배지 {#id-ui}

## 배선과 마감 {#wrap}
- [ ] PTY 호스트와 ACP 세션 생성 경로에 심 설치를 배선 {#wrap-wire}
- [ ] AGENTS.md 템플릿 §2(파일 규격)을 줄일 수 있는지 검토 — CLI 가 있으면 규격을 설명할 이유가 줄어든다 (토큰 예산 회수) {#wrap-agents-md}
- [ ] 게이트 전부 exit 0 직접 확인 + 일지 작성 + 이 플랜 갱신 {#wrap-gates}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
