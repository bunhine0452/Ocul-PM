---
oculpm_plan: v1
id: session-shim-cli
title: "세션이 자기를 증명한다 — 심 디렉토리 + oculpm CLI"
status: done
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 crates/buzz-dev-mcp/src/shim.rs (세션 전용 0700 PATH 디렉토리 + 멀티콜 심링크) 와 buzz-cli 의 JSON in/out·종료코드·--base-hash CAS 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F4·F10). 지금 agent.id 는 에이전트가 프롬프트에서 자칭하는 값이고, MCP 를 안 쓰는 에이전트는 AGENTS.md 파일 규격을 부탁받는 수밖에 없다. 우리는 이미 same-exe 멀티콜(--pty-host·config)을 쓰므로 기반은 있다.

## 범위 확정 (착수 전) {#scope}
- [x] `terminal-identity-round` 플랜과 범위 충돌을 먼저 확인한다 — 흥수할지 분리할지를 정하고 이 항목에 기록 {#scope-terminal-round}
- [x] OSC 133/7 셀 통합과의 관계 — 셀 통합은 「무슨 명령이 돌았나」, 심은 「누가 돌렸나」. 같이 가는지 따로 가는지 결정 {#scope-osc}

## 심 디렉토리 {#shim}
- [x] 세션마다 0700 임시 디렉토리 + 자기 실행파일로 `oculpm` 심링크 + PATH 선두 {#shim-dir}
  - [x] drop 에서 정리 — 프로세스가 죽어도 남지 않게. 남은 것을 다음 시작 때 걷는 경로도 둔다 {#shim-cleanup}
  - [x] Windows 는 심링크에 권한이 필요하다 — `.cmd` 쉐임 또는 복사본 폴백. 실패해도 세션은 돌아간다 (심은 부가기능) {#shim-windows}
  - [x] PATH 주입은 우리가 띄우는 셀(PTY·ACP)에만 적용된다 — 밖에서 띄운 세션은 여전히 못 잡는다는 한계를 주석에 {#shim-limit}
- [x] 세션 토큰 파일 0600 — 프로젝트 루트 · agent_id · session_id. env 로 넘기지 않는다 (`ps` 에 안 보이게) {#shim-token}
- [x] 심 설치 테스트 — 권한 비트·PATH 순서·drop 정리 {#shim-test}

## CLI 표면 {#cli}
- [x] `oculpm journal write` · `plan status|update` · `agent register|inbox|send` — stdin JSON in / stdout JSON out. MCP 도구와 **같은 함수**를 부른다 (두 벌 금지) {#cli-surface}
- [x] 종료 코드표를 정하고 문서화 — 0 ok / 1 사용자오류 / 2 io / 3 비추적 프로젝트 / 4 기타 / 5 쓰기 충돌 {#cli-exit}
- [x] stdout 은 결과만, stderr 는 에러만 — 섞지 않는다 (에이전트가 파이프로 받는다) {#cli-streams}
- [x] 비추적 프로젝트 가드 — `.oculpm` 이 없으면 만들지 않고 exit 3. (`[claude-plugin-strategy]` 감사에서 나온 journal_write 의 create_dir_all 사고 경로를 CLI 에서 반복하지 않는다) {#cli-guard}

## CAS — 기대 해시 불일치는 쓰지 않는다 {#cas}
- [x] `--base-hash <hex>` — 플랜·일지 갱신 시 기대 내용 해시가 안 맞으면 쓰지 않고 exit 5 {#cas-flag}
- [-] `--no-base-hash` 로 명시적 강제 허용 — 우회로는 두되 **이름이 붙어** 있어서 우회했다는 사실이 보인다 {#cas-optout}
- [x] MCP `plan_update` 에도 선택적 `base_hash` — 같은 규율을 두 표면에 {#cas-mcp}
- [x] 병렬 세션 회귀 테스트 — 두 프로세스가 같은 플랜 항목을 동시에 고치면 한쪽이 exit 5 로 진다 (메모리에 기록된 사고가 이것이다) {#cas-test}

## 신원 — 자칭을 증명으로 {#identity}
- [x] 토큰이 있으면 토큰이 이긴다 — 인자로 받은 agent_id 는 무시 {#id-token-wins}
- [x] 토큰 없는 호출은 기존대로 자칭 허용하되 카드에 `unverified` 표시 — 막지 않고 **보이게** 한다 (a2a 의 trespass 와 같은 철학) {#id-unverified}
- [x] 화면 — 참여자 목록에 검증 여부 배지 {#id-ui}

## 배선과 마감 {#wrap}
- [x] PTY 호스트와 ACP 세션 생성 경로에 심 설치를 배선 {#wrap-wire}
- [x] AGENTS.md 템플릿 §2(파일 규격)을 줄일 수 있는지 검토 — CLI 가 있으면 규격을 설명할 이유가 줄어든다 (토큰 예산 회수) {#wrap-agents-md}
- [x] 게이트 전부 exit 0 직접 확인 + 일지 작성 + 이 플랜 갱신 {#wrap-gates}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T18:42:20+09:00 | #scope-terminal-round | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 충돌 없음 — terminal-identity-round 는 **시각** 정체성(Warp/cmux UI)이고 잠겨 있다. 여기는 **기록 귀속** 신원이라 다른 축 |
| 2026-09-03T18:42:24+09:00 | #scope-osc | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 보완 관계로 확정 — 셸 통합이 「무슨 명령」, 심이 「누가」. 그리고 통합 스크립트가 PATH 를 붙이는 **통로**가 됐다 (앱 PATH 강요 회피) |
| 2026-09-03T18:42:26+09:00 | #shim-cleanup | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 종료 경로 둘(PTY Kill·ACP stop) + 앱 시작 시 전량 sweep (막 뜬 앱에 도는 세션은 없다) |
| 2026-09-03T18:42:29+09:00 | #shim-windows | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | symlink_file 실패 시 복사본. 그것도 실패하면 심 없이 세션이 뜬다 (셸 통합과 같은 규율) |
| 2026-09-03T18:42:30+09:00 | #shim-limit | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 모듈 문서에 명시 — 앱 밖에서 띄운 세션은 못 잡는다 |
| 2026-09-03T18:42:32+09:00 | #shim-token | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 0600 session.json. agent_id 는 Option — 터미널은 그 안에서 뭐가 돌지 모르므로 안 적는다 |
| 2026-09-03T18:42:34+09:00 | #shim-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 5개 — 멱등·경로탈출·sweep 선별·env 없이 심 옆 토큰·PATH prepend |
| 2026-09-03T18:42:43+09:00 | #cli-surface | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | `oculpm <도구> [json\|-]` — MCP 도구 이름을 그대로 쓴다. call_tool 한 함수를 두 표면이 공유 (두 벌 금지) |
| 2026-09-03T18:42:45+09:00 | #cli-exit | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 0/1/2/3/4/5. 3(비추적)은 메시지를 뜯지 않고 CLI 가 스스로 판정 — 문구는 바뀌어도 코드는 계약 |
| 2026-09-03T18:42:47+09:00 | #cli-streams | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | stdout=결과 / stderr=오류 |
| 2026-09-03T18:42:49+09:00 | #cli-guard | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | exit 3 + 테스트가 "가드가 .oculpm 을 만들지 않는다"까지 단언 |
| 2026-09-03T18:42:50+09:00 | #cas-flag | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | plan_update 의 선택 인자. 응답에 새 해시를 실어 다음 CAS 재료로 |
| 2026-09-03T18:42:53+09:00 | #cas-optout | claude-code | ☐→- | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 불필요 — base_hash 가 선택 인자라 **안 주는 것이 곧 옵트아웃**이다. 같은 뜻의 플래그를 더 두면 계약이 둘이 된다 |
| 2026-09-03T18:42:55+09:00 | #cas-mcp | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 한 구현이라 자동으로 두 표면 — 도구 스키마에도 적었다 |
| 2026-09-03T18:43:02+09:00 | #cas-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 거부된 호출이 **파일을 건드리지 않는다**까지 단언 (해시 비교로) |
| 2026-09-03T18:43:04+09:00 | #id-token-wins | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | CLI 와 agent_register 양쪽. 단 **이름을 아는 토큰**일 때만 — 터미널 토큰은 세션만 알아서 자칭을 그대로 둔다 |
| 2026-09-03T18:43:07+09:00 | #id-unverified | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | AgentCard.verified (serde default=false — 옛 카드를 검증됨으로 올리지 않는다). 앱이 띄운 어댑터만 true |
| 2026-09-03T18:43:09+09:00 | #id-ui | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 「자칭」 조용한 표기 — 대부분의 앱 밖 세션의 정상 상태라 경고가 아니라 사실 한 줄 |
| 2026-09-03T18:43:12+09:00 | #wrap-wire | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | PTY(셸 통합이 PATH 를 붙임) + ACP(우리가 PATH 를 만든다). 래칫이 process.rs 를 잡아 acp/identity.rs 분리 동반 |
| 2026-09-03T18:43:15+09:00 | #wrap-agents-md | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 검토 결과 **안 넣는다** — 마스터 6,100자 상한에 27자가 모자랐다(가장 짧은 한 줄로도 6,127). 게이트를 올리는 대신 물렀다. §2 산문과 맞바꾸는 것은 CLI 가 기본 경로가 된 뒤 |
| 2026-09-03T18:43:17+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1842_feature_session-shim-cli.md | 전부 exit 0 (cargo 1330 · vitest 2109). 일지 1842 + 이 플랜 19항목 |
<!-- oculpm:plan-log end -->
