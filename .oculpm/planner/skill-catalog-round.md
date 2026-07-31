---
oculpm_plan: v1
id: skill-catalog-round
title: "스킬 카탈로그 라운드 — 3종 강화(ECC·ponytail 이식) + 스택 감지 추천(쇼핑)"
status: active
created: 2026-07-31
updated: 2026-08-01
owner: claude-code
---

ECC(281종 전수·14종 정독)·ponytail(6종 정독) 조사(2026-07-31) 채택안 실행.
사용자 아이디어: 신규=인셉션 계획 단계에서, 기존=스택 감지로 — 스킬을 "쇼핑"해 추천.

## Phase R1 — 플러그인 스킬 3종 강화 {#round-r1}
- [x] S1 self-audit v2 — 형식 강제(고정 태그·1발견 1줄·net 지표·빈 결과 sentinel) + 신뢰도 게이트 4문항 + false-positive 제외 목록 (ponytail-review + ECC code-reviewer) {#self-audit-v2}
- [x] S2 run-evals v2 — capability/regression 이원화·grader 3분류·"베이스라인 없는 수치 금지" 정직성 룰 (ECC eval-harness + ponytail-gain) {#run-evals-v2}
- [x] S3 tdd-workflow v2 — RED 증거 규칙(컴파일 실패 인정)·체크포인트 커밋 규격·증거 표(일지 ## 검증 규격 정렬) (ECC tdd-workflow) {#tdd-workflow-v2}

## Phase R2 — 스킬 카탈로그 + 추천 {#round-r2}
- [x] C1 카탈로그 벤더링 — ECC/ponytail 선별 ~13종을 커밋 핀·출처·MIT 헤더와 함께 동봉(런타임 네트워크 0), skillsCatalog 데이터(태그·토큰 비용) + 출처 헤더 검증 테스트 {#catalog-vendor}
- [x] C2 스택 감지 — detect_stack 커맨드(매니페스트·언어 결정적 감지, LLM 0) + 테스트 {#detect-stack}
- [x] C3 갤러리 추천 UI — 스킬 탭 갤러리에 "이 프로젝트 스택 추천" 섹션(태그 매치·토큰 비용 표기·원클릭 설치·전체 카탈로그) {#catalog-ui}
- [x] C4 인셉션 연결 — 사양 확정 후 "스택에 맞는 검증된 스킬을 갤러리에서 추천" 안내 1줄 {#inception-hook}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-31T23:00:00+09:00 | #round-r1 | claude-code | →☐ | | ECC·ponytail 인벤토리 조사 채택안 → 라운드 개설 (사용자 "진행해") |
| 2026-08-01T00:13:00+09:00 | #self-audit-v2 #run-evals-v2 #tdd-workflow-v2 #inception-hook | claude-code | →[x] | 20260801/Features_to_add/0011_feature_plugin-skills-v2-hardening.md | 형식 강제·신뢰도 게이트·RED 증거 이식 + 리뷰 지적(자기모순·규격충돌) 반영 |
| 2026-08-01T00:13:00+09:00 | #catalog-vendor #detect-stack #catalog-ui | claude-code | →[x] | 20260801/Features_to_add/0012_feature_skill-catalog-and-stack-detect.md | 13종 핀 벤더링+MIT 전문, detect_stack 워크스페이스 감지, 갤러리 추천 UI — 적대 리뷰 12건 전부 반영, 게이트 그린 |
<!-- oculpm:plan-log end -->
