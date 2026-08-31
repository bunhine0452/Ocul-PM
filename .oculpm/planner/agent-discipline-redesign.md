---
oculpm_plan: v1
id: agent-discipline-redesign
title: "스킬·규칙 재설계 — 관리자 화면에서 발동 루프로"
status: done
created: 2026-08-29
updated: 2026-08-31
owner: claude-code
---

사용자 관측("스킬·규칙을 잘 안 쓴다")을 transcript 136개 실측으로 진단한 뒤 재설계한다.
실측 결론: 스킬은 죽어 있고(0.08회/세션), 규칙은 폭주 중(세션당 30파일·90KB·무관 3세트).
SSOT = docs/agent-discipline/00-master-plan.md.

## Phase 0 — 진단 {#diagnose}
- [x] transcript 136개 계측 + 재설계 마스터플랜 작성 (D1~D5 · AD-1~6 · 성공 지표 기준선) {#measure-and-design}

## Phase 1 — 계측 먼저 {#instrument}
- [x] AD-1 발동 원장 백엔드 — firing_ledger.rs (nested_memory 주입 · Skill 발동 파싱) + 캐시 테이블 + 커맨드 2종 + Rust 테스트 {#ad1-ledger}
- [x] AD-2 발동 배지 — 기존 스킬·규칙 탭 행에 30일 발동 횟수·마지막 발동·"한 번도 안 걸림" 노출 (화면 재설계 전 가치 착지) {#ad2-badges}

## Phase 2 — 표면 재배치 {#resurface}
- [x] AD-3 화면 3존 통합 — 5탭(스킬·샵·규칙·훅·플러그인) → 1화면(컨텍스트 예산 바 · Live 목록 · 제안 인박스), 휴면 자동 강등, 샵/플러그인 흡수 {#ad3-three-zones}
- [x] AD-4 사건 진입점 — 일지 상세·diff·터미널 명령블록·Today·⌘K 에 승격 액션 (회고의 RuleCandidates/SkillCandidates 재사용) {#ad4-entry-points}

## Phase 3 — 자기정리 루프 {#selfclean}
- [x] AD-5 제안 3종 신규 — 범위 교정(주입되나 대상 확장자 0) · 정리(30일 발동 0회) · 트리거 교정(스킬 description 재작성) {#ad5-proposals}
- [x] AD-6 규칙 다이어트 — 무관 규칙 결정적 진단 + 승인형 paths 축소(전역 파일 백업·최소 행 치환) {#ad6-rule-diet}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-29T17:53:00+09:00 | #measure-and-design | claude-code | →x | .oculpm/journal/20260829/Chores/1753_chore_agent-discipline-redesign-plan.md | 실측 기준선: Skill 11회/136세션(oculpm 1회) · .claude/skills·rules 모두 부재 · nested_memory 주입 1,812회(세션당 30파일 90KB, react-native/arkts/vue 포함). 원인=ECC 규칙의 `**/*.ts(x)` 과대 glob |
| 2026-08-29T18:12:00+09:00 | #ad1-ledger #ad2-badges | claude-code | →x | .oculpm/journal/20260829/Features_to_add/1812_feature_firing-ledger-and-badges.md | transcript 2신호(nested_memory 주입·Skill tool_use) 증분 파싱 + 030 캐시 + firing_rescan/firing_stats. 스킬·규칙 목록/상세 배지 + 규칙 탭 세션당 주입 KB. 게이트 5종 그린, 실기 transcript 프로브로 폴더판정·파싱 대조 |
| 2026-08-31T18:46:00+09:00 | #ad3-three-zones #ad4-entry-points | claude-code | →x | .oculpm/journal/20260831/Features_to_add/1846_feature_agent-context-three-zones.md | 5탭→1화면 3존(예산 바·Live+휴면 강등·인박스), 편집기 2벌→1벌(RulesTab 867줄 삭제), 샵·훅·플러그인·갤러리 흡수. 진입점 5곳(일지 bug/error·diff·터미널 블록·Today·⌘K)이 씨앗 채운 생성 모달로 — intent slot + 순수 씨앗 계산. 게이트 4종 그린 |
| 2026-08-31T19:48:00+09:00 | #ad5-proposals #ad6-rule-diet | claude-code | →x | .oculpm/journal/20260831/Features_to_add/1948_feature_agent-context-selfclean-loop.md | 두 신호로 무관 확정(glob 매칭 0 · 규칙 경로의 스택 ≠ detect_stack) → 제안 3종(범위 교정·정리·트리거 교정). 예산 바가 무관 조각을 떼어 그리고 눌러서 처방으로. 사용자 소유 전역 규칙은 rules_save_with_backup(.bak) 한 경로뿐. 게이트 7종 그린 |
<!-- oculpm:plan-log end -->
