---
oculpm_plan: v1
id: record-quality-round-20261027
title: "기록 품질 라운드 (2026-10-27) — 플러그인 드리프트 · 모델 이름 정규화 · 검증 증거 등급 · 닫힌 플랜 받은함 · files_touched 추정 · ACP 0.97.0"
status: active
created: 2026-10-27
updated: 2026-10-27
owner: claude-code
---

실데이터 감사(일지 3,900건 · 훅 원장 · 캐시)에서 나온 업그레이드 다섯 + 어댑터 한 판. 전부 핵심 등급 약속(docs/PROMISE.md)에 닿는 것만. 완료 조건: 코드 여섯이 main 에 있고, 새 빌드에서 Today 드리프트 카드·일지 방패 배지·플래너 받은함이 눈으로 확인되면 끝.

## 코드 {#code}
- [x] 플러그인 판 드리프트 — claude_plugin_status(project_id) 가 installed_plugins.json 에서 그 프로젝트 판을 골라 behind 판정, 설정 블록 판 줄 + Today PluginDriftCard {#plugin-drift}
- [x] 모델·에이전트 이름 표준형 — oculpm/model_names.rs, 캐시 투영에만 (디스크 불변) {#model-names}
- [x] 검증 증거 등급 — oculpm/evidence.rs + 042 evidence 컬럼, 일지 행 방패 배지 · 상세 칩 {#evidence-grade}
- [x] 닫힌 플랜의 미완 받은함 — plan_locked_open(plan_carry.rs) + CarryInbox, 「이 플랜으로」는 활성 플랜에 carry-<id> AddItem {#carry-inbox}
- [x] files_touched 추정 — MCP journal_write 가 비어 있으면 git status 작업 트리 변경으로 채우고 경고 + files-inferred 태그 {#files-infer}
- [x] ACP Claude 어댑터 0.93.0 → 0.97.0 — lockfile 재생성 · 샌드박스 핸드셰이크 픽스처 · PINNED_VERSION {#acp-097}

## 합류 {#merge}
- [x] PR → CI 초록 → rebase 머지 {#pr-merge}

## 실기기 확인 {#eyes}
- [ ] [사용자] 새 빌드로 Today 에 드리프트 카드(3.3.0 → 새 판)가 뜨고, /plugin update 뒤 사라진다 {#eyes-drift-card}
- [ ] [사용자] 일지 행에 방패 배지(증거 있음) · 상세 칩 · 모델 이름이 표준형으로 보인다 (재투영 뒤) {#eyes-evidence-badge}
- [ ] [사용자] 플래너 받은함에 63건 · 하나 옮기면 활성 플랜 「이월」 단계에 생기고 받은함에서 빠진다 {#eyes-carry-inbox}
- [ ] [사용자] Claude Code 화면 첫 열기 — 0.97.0 재설치, ultracode 선택지가 셀렉터에 보이고 대화 한 턴 {#eyes-acp-097}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-27T21:17:39+09:00 | #plugin-drift | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | commands/mcp.rs pick_plugin_entry·version_behind + 설정 블록 + Today PluginDriftCard, 테스트 3 |
| 2026-10-27T21:17:44+09:00 | #model-names | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | model_names.rs — 30가지 표기 → 8 이름, 캐시 투영만. 테스트 4 |
| 2026-10-27T21:17:49+09:00 | #evidence-grade | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | evidence.rs + 042 + 캐시 투영·질의, 일지 행 방패 배지·상세 칩. 테스트 2 |
| 2026-10-27T21:17:54+09:00 | #carry-inbox | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | plan_carry.rs plan_locked_open + CarryInbox(「이월」 단계 AddItem, carry-<id> 로 제외). 테스트 1 |
| 2026-10-27T21:18:01+09:00 | #files-infer | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | files_touched::infer_from_git — 상한 40 · .oculpm 제외 · 명시한 빈 배열은 그대로. 테스트 2 |
| 2026-10-27T21:18:07+09:00 | #acp-097 | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | 픽스처 diff 셋(판·backgroundSubagents·ultracode 선택지), session/update 21종 동일, SDK 0.3.310. Codex 2.3.0 은 AIR 깨는 메이저라 보류 |
| 2026-10-27T21:35:47+09:00 | #pr-merge | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2116_feature_record-quality-round-five-upgrades.md | PR #102 CI 3잡 success → rebase 머지 44c84375. 래칫(manager/tests.rs)에 두 번 걸려 디스크 원문 확인을 통합 테스트로 옮겼다 |
<!-- oculpm:plan-log end -->
