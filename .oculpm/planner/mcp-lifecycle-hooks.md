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
- [ ] Claude Code 네이티브 `Stop` 훅이 우리 훅 브리지를 거쳐 실제로 불리는지, 반환값으로 턴을 연장시킬 수 있는지 실측 {#probe-cc}
- [ ] Codex · 그 밖 ACP 하네스가 `_` 접두 도구를 부르는지 — 안 부르면 MCP 표면은 2순위로 내리고 범위를 줄인다 {#probe-others}
- [ ] 실측 결과를 이 플랜에 기록하고 범위를 확정한다 — 불러주는 하네스가 하나도 없으면 **이 플랜을 접는다** (그것도 결과다) {#probe-decide}

## 판정 로직은 하나 {#verdict}
- [ ] 순수 함수 `stop_verdict(state) -> Option<Objection>` — 표면 둘이 같은 함수를 부른다. 두 벌이 되는 순간 둘이 엇갈린다 {#verdict-fn}
  - [ ] 근거 1 — 이번 세션에 프로젝트 파일이 바뀌었는데 일지가 없다 {#verdict-no-journal}
  - [ ] 근거 2 — 일지는 있는데 대응 플랜 항목이 안 갱신됐다 {#verdict-no-plan}
  - [ ] 무엇을 「바뀌었다」로 볼지 — `.oculpm/` 자기 자신·빌드 산출물·lock 파일 제외 {#verdict-scope}
  - [ ] 읽기만 한 턴은 이의 없음 — 질문에 답하고 끝난 세션을 붙잡으면 도구가 아니라 방해다 {#verdict-readonly}
- [ ] 이의 문구는 **무엇을 하라는지**까지 말한다 — 「일지를 쓰세요」가 아니라 「journal_write 로 ‹바뀐 파일 N개› 를 기록하세요」 {#verdict-actionable}
- [ ] 순수 함수 테스트 — 네 근거가 각각 올바로 갈리고, 읽기만 한 턴은 침묵하는지 {#verdict-test}

## 표면 둘 {#surfaces}
- [ ] Claude Code `Stop` 훅 — 훅 실패는 전부 exit 0 (훅이 세션을 죽이지 않는다). `[claude-plugin-strategy]` 에서 이미 정한 규율 {#surf-cc}
- [ ] MCP `_Stop` · `_PostCompact` — `_` 접두는 도구 목록에서 필터, LLM 이 직접 부르면 거부 {#surf-mcp}
  - [ ] 응답은 JSON 인코딩해서 돌려준다 — tool-result 는 system 보다 신뢰 등급이 낮다는 것을 살린다 {#surf-json}
  - [ ] `_PostCompact` 는 활성 플랜의 미완 리프를 돌려준다 — 압축으로 잊힌 맥락 중 제일 비싼 것 {#surf-postcompact}
- [ ] 두 표면이 **같은 판정**을 낸다는 테스트 — 같은 입력으로 둘을 불러 결과 비교 {#surf-parity-test}

## 에이전트 주권 — 훅은 권고이지 명령이 아니다 {#sovereignty}
- [ ] 타임아웃(기본 2.5초) = 이의 없음으로 처리 — 느린 훅이 턴을 잡지 않는다 {#sov-timeout}
- [ ] 프롬프트당 이의 예산(기본 3) — 소진되면 무조건 정지. 다음 프롬프트에 초기화 {#sov-budget}
- [ ] 기본 꾺짐 — 설정에서 켜는다. 켜지지 않은 상태가 지금과 같은 동작이어야 한다 {#sov-optin}
- [ ] 무한 루프 불가능 테스트 — 항상 이의하는 훅을 가지고도 N 번 뒤에는 반드시 정지한다 {#sov-test}
- [ ] 연속 2회 타임아웃에만 훅 경로를 끊는다 — 일회성 느림을 관용 (buzz 의 규율 그대로) {#sov-two-strikes}

## 마감 {#wrap}
- [ ] 사용자 실측 — 실제 세션에서 켜 보고 거슬리는지 판단. 거슬리면 예산을 1로 낮추거나 판정을 좁힌다 {#wrap-dogfood}
- [ ] 플러그인 문서 페이지 갱신 (landing/plugin.html) — 새 훅·도구는 반영 필수 {#wrap-plugin-docs}
- [ ] 게이트 전부 exit 0 직접 확인 + 일지 작성 + 이 플랜 갱신 {#wrap-gates}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
