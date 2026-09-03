---
oculpm_plan: v1
id: mcp-lifecycle-hooks
title: "부탁을 기구로 — 턴이 끝나기 전에 기록을 묻는다"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 docs/MCP_DRIVEN_HOOKS.md (`_` 접두 도구 = 라이프사이클 훅, `_Stop`/`_PostCompact`, 에이전트 주권 제약) 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F1). 지금 MCP 도구 13종은 전부 에이전트가 부르기로 마음먹어야 돌고, 안 부르면 조용히 아무 일도 안 일어난다. **착수 전 실측 필수** — `_Stop` 은 MCP 표준이 아니라 하네스 규약이라, 부르는 하네스가 없으면 MCP 표면은 죽은 코드다.

## 실측 먼저 (이거 없이 구현 금지) {#probe}
- [x] Claude Code 네이티브 `Stop` 훅이 우리 훅 브리지를 거쳐 실제로 불리는지, 반환값으로 턴을 연장시킬 수 있는지 실측 {#probe-cc}
- [x] Codex · 그 밖 ACP 하네스가 `_` 접두 도구를 부르는지 — 안 부르면 MCP 표면은 2순위로 내리고 범위를 줄인다 {#probe-others}
- [x] 실측 결과를 이 플랜에 기록하고 범위를 확정한다 — 불러주는 하네스가 하나도 없으면 **이 플랜을 접는다** (그것도 결과다) {#probe-decide}

## 실측이 남긴 단 하나의 구멍 {#gate-test}
- [x] 배달 게이트에 **행위 테스트** — 지금 계약을 무는 것은 스크립트 소스의 문자열 존재 단언뿐이라, 판정 로직을 지우고 `exit 2` 라는 글자만 남겨도 통과한다 (buzz 리뷰 규칙 3) {#gate-test-behavior}

## 판정 로직은 하나 {#verdict}
- [-] 순수 함수 `stop_verdict(state) -> Option<Objection>` — 표면 둘이 같은 함수를 부른다. 두 벌이 되는 순간 둘이 엇갈린다 {#verdict-fn}
  - [-] 근거 1 — 이번 세션에 프로젝트 파일이 바뀌었는데 일지가 없다 {#verdict-no-journal}
  - [-] 근거 2 — 일지는 있는데 대응 플랜 항목이 안 갱신됐다 {#verdict-no-plan}
  - [-] 무엇을 「바뀌었다」로 볼지 — `.oculpm/` 자기 자신·빌드 산출물·lock 파일 제외 {#verdict-scope}
  - [-] 읽기만 한 턴은 이의 없음 — 질문에 답하고 끝난 세션을 붙잡으면 도구가 아니라 방해다 {#verdict-readonly}
- [-] 이의 문구는 **무엇을 하라는지**까지 말한다 — 「일지를 쓰세요」가 아니라 「journal_write 로 ‹바뀐 파일 N개› 를 기록하세요」 {#verdict-actionable}
- [x] 순수 함수 테스트 — 네 근거가 각각 올바로 갈리고, 읽기만 한 턴은 침묵하는지 {#verdict-test}

## 표면 둘 {#surfaces}
- [x] Claude Code `Stop` 훅 — 훅 실패는 전부 exit 0 (훅이 세션을 죽이지 않는다). `[claude-plugin-strategy]` 에서 이미 정한 규율 {#surf-cc}
- [-] MCP `_Stop` · `_PostCompact` — `_` 접두는 도구 목록에서 필터, LLM 이 직접 부르면 거부 {#surf-mcp}
  - [-] 응답은 JSON 인코딩해서 돌려준다 — tool-result 는 system 보다 신뢰 등급이 낮다는 것을 살린다 {#surf-json}
  - [-] `_PostCompact` 는 활성 플랜의 미완 리프를 돌려준다 — 압축으로 잊힌 맥락 중 제일 비싼 것 {#surf-postcompact}
- [-] 두 표면이 **같은 판정**을 낸다는 테스트 — 같은 입력으로 둘을 불러 결과 비교 {#surf-parity-test}

## 에이전트 주권 — 훅은 권고이지 명령이 아니다 {#sovereignty}
- [-] 타임아웃(기본 2.5초) = 이의 없음으로 처리 — 느린 훅이 턴을 잡지 않는다 {#sov-timeout}
- [-] 프롬프트당 이의 예산(기본 3) — 소진되면 무조건 정지. 다음 프롬프트에 초기화 {#sov-budget}
- [-] 기본 꾺짐 — 설정에서 켜는다. 켜지지 않은 상태가 지금과 같은 동작이어야 한다 {#sov-optin}
- [x] 무한 루프 불가능 테스트 — 항상 이의하는 훅을 가지고도 N 번 뒤에는 반드시 정지한다 {#sov-test}
- [-] 연속 2회 타임아웃에만 훅 경로를 끊는다 — 일회성 느림을 관용 (buzz 의 규율 그대로) {#sov-two-strikes}

## 마감 {#wrap}
- [x] 사용자 실측 — 실제 세션에서 켜 보고 거슬리는지 판단. 거슬리면 예산을 1로 낮추거나 판정을 좁힌다 {#wrap-dogfood}
- [x] 플러그인 문서 페이지 갱신 (landing/plugin.html) — 새 훅·도구는 반영 필수 {#wrap-plugin-docs}
- [x] 게이트 전부 exit 0 직접 확인 + 일지 작성 + 이 플랜 갱신 {#wrap-gates}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T18:55:58+09:00 | #probe-cc | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 확인 — Stop 훅은 exit 2 로 턴을 막고 stderr 가 전달된다. 그런데 **우리가 이미 쓰고 있었다**(delivery-gate.sh, 2026-07-31 벤치 근거). buzz 의 주권 제약도 이미 있고, 세션 귀속 판정은 buzz 에 없는 우리 것 |
| 2026-09-03T18:56:01+09:00 | #probe-others | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 부르는 하네스 0 — Claude Code 의 대응물은 네이티브 훅 이벤트라 `_Stop` 을 영원히 안 부른다. Codex·ACP 에도 그 규약이 없다 |
| 2026-09-03T18:56:03+09:00 | #probe-decide | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | **플랜을 접는다** — 22항목 중 13 폐기. 남긴 것은 실측이 드러낸 진짜 구멍 하나(게이트의 행위 테스트) |
| 2026-09-03T18:56:05+09:00 | #gate-test-behavior | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | tests/delivery_gate.rs 7개 — 진짜 실행해 종료 코드를 본다. 반증 확인: 게이트를 무력화하니 2개가 즉시 깨졌고 복구 후 7/7 |
| 2026-09-03T18:56:08+09:00 | #verdict-no-journal | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — delivery-gate.sh 의 판정이 정확히 이것이고, Rust 로 한 벌 더 만들면 이 항목이 경고한 「두 벌」이 된다 |
| 2026-09-03T18:56:11+09:00 | #verdict-no-plan | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 근거 부족 — 「일지는 있는데 플랜 미갱신」은 플랜이 그 작업을 안 덮을 때 정상이다. 두 번째 발화 조건은 그 자체로 실측이 필요하다 |
| 2026-09-03T18:56:13+09:00 | #verdict-scope | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — `.oculpm/` 제외 + 세션 귀속(mtime) + pathspec 로 모노레포 이웃 제외. 새 테스트가 그 둘을 문다 |
| 2026-09-03T18:56:20+09:00 | #verdict-readonly | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — 변경이 없으면 발화 자체가 없다. 새 테스트가 단언 |
| 2026-09-03T18:56:23+09:00 | #verdict-actionable | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — 현재 문구가 journal_write·plan_update 를 지목하고 「진행 중이면 무시하라」까지 말한다 |
| 2026-09-03T18:56:26+09:00 | #verdict-test | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 순수 함수 대신 **행위 테스트**로 이행 — 판정이 셸에 있으므로 그 셸을 실행해 잰다 (#gate-test-behavior) |
| 2026-09-03T18:56:28+09:00 | #surf-cc | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 출하돼 있었고, 이제 테스트가 그것을 지킨다 |
| 2026-09-03T18:56:30+09:00 | #surf-json | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | MCP 표면을 안 만들므로 함께 폐기 |
| 2026-09-03T18:56:32+09:00 | #surf-postcompact | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 확인 실패 — PostCompact 이벤트는 있으나 문서상 additionalContext 주입을 지원하지 않는다(사후 이벤트). 확인 안 된 가정 위에 짓지 않는다 |
| 2026-09-03T18:56:34+09:00 | #surf-parity-test | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 표면이 하나뿐이라 대조할 짝이 없다 |
| 2026-09-03T18:56:41+09:00 | #sov-timeout | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 해당 없음 — 훅은 Claude Code 가 직접 띄우는 프로세스라 타임아웃도 그쪽 몫이다 |
| 2026-09-03T18:56:43+09:00 | #sov-budget | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — 세션당 1회 플래그가 buzz 의 예산보다 더 센 규율(예산 3이 아니라 1) |
| 2026-09-03T18:56:45+09:00 | #sov-optin | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 있다 — 플러그인 설치가 옵트인이고, `.oculpm` 없는 프로젝트에서는 침묵 |
| 2026-09-03T18:56:48+09:00 | #sov-test | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | `it_never_blocks_twice_in_a_row` 가 무한 차단 불가를 문다 (stop_hook_active + 세션당 1회 둘 다) |
| 2026-09-03T18:56:50+09:00 | #sov-two-strikes | claude-code | ☐→- | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 해당 없음 — 우리 훅은 MCP 서버가 아니라 셸 한 번이라 「연속 2회 타임아웃에 죽인다」는 대상이 없다 |
| 2026-09-03T18:56:53+09:00 | #wrap-dogfood | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 이미 도그푸딩된 기능이다 — 2026-07-31 A/B 벤치가 근거이고 이 저장소에서 돈다. 새로 켤 것이 없다 |
| 2026-09-03T18:56:55+09:00 | #wrap-plugin-docs | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 갱신 불필요 확인 — landing/plugin.html 이 배달 게이트를 이미 설명한다. 새 도구·훅이 없다 |
| 2026-09-03T18:56:57+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Chores/1855_chore_stop-hook-probe-and-gate-test.md | 전부 exit 0 (cargo 1337 — 배달 게이트 7 추가). 반증 확인까지 직접 돌렸다 |
<!-- oculpm:plan-log end -->
