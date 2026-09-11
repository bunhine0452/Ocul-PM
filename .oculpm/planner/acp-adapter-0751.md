---
oculpm_plan: v1
id: acp-adapter-0751
title: "ACP 어댑터 0.75.1 이월 — 아직 안 읽는 새것과 육안 확인"
status: active
created: 2026-09-06
updated: 2026-09-06
owner: claude-code
---

어댑터 0.73.0 → 0.75.1 상향과 그것이 깬 `/usage` 파싱은 끝났다 (일지 `20260906/Features_to_add/1025_feature_acp-adapter-0751-usage-markdown.md`). 남은 것은 **깨지지는 않지만 아직 쓰지 않는** 새 표면 둘과, 설치본으로 눈으로 볼 한 건이다.

## 이월 — 0.75.1 이 들여왔지만 아직 안 읽는 것 {#carry}
- [x] `_meta.contextCompaction`(trigger·preTokens·postTokens·durationMs)을 읽어 압축을 일반 도구 카드가 아닌 제 모양으로 — 지금은 "Compact conversation" 이라는 think 도구로만 보여 몇 토큰이 줄었는지 알 수 없다 {#carry-compaction}
- [ ] `_auth/status_update`(연결 단위 push, `agentCapabilities._meta.authStatus` 광고)를 받아 어떤 신원으로 도는지 표시 — 지금은 크레이트가 조용히 버려서 앱이 구독/API키/게이트웨이를 구별 못 한다. 침묵은 "보고 안 함"이고 `kind:"none"` 이 로그아웃이라는 구분이 핵심 {#carry-auth}

## 육안 확인 {#eyes}
- [ ] 0.75.1 어댑터를 실제로 깔고 `/usage` 새로고침 — 툴바 pill 네 줄(오늘·주간·Opus·Sonnet)이 이름대로 뜨는가 · 카드의 기여도 대목이 표 그대로가 아니라 막대로 읽히는가 · 구조화 조회가 실패해 평문이 올 때도 예전처럼 읽히는가 {#eyes-usage-meter}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-11T17:16:02+09:00 | #carry-compaction | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1715_feature_acp-context-compaction-row.md | AcpCompaction(tool_meta.rs) + compaction.ts 문장 「128k → 42k 토큰 (−68%) · 자동 · 2.3초」. 시작 빈 메타→끝 숫자가 덮음. 어휘는 안 늘림(얼굴·이름만). 실기기는 eyes-usage-meter 와 같이. 52d4501 |
<!-- oculpm:plan-log end -->
