---
oculpm_plan: v1
id: skill-catalog-round-2
title: "스킬 카탈로그 2차 — 전수 재감사 채택분 (벤더 12종 + 이식 5건)"
status: archived
created: 2026-08-01
updated: 2026-09-04
owner: claude-code
---

ECC(281종)·ponytail 전수 재감사 워크플로(2026-08-01, 6 에이전트·후보 91건·양판사 적대 심사) 합의 채택분.
사용자 질문 "가져올 스킬·툴이 이게 다야?" → 아니었음 — 합의 NOW 채택분 실행.

## Phase R3 — 실행 {#round-r3}
- [x] V1 카탈로그 2차 벤더 12종 — vue-patterns · react-performance · vite-patterns · laravel-patterns · springboot-patterns · django-patterns · fastapi-patterns · accessibility · api-design · database-migrations · e2e-testing · inherit-legacy-style (ECC 핀, vendored-from 헤더, 태그 협소화 원칙, 검증 테스트) {#vendor-12}
- [x] V2 벤더 위생 게이트 — 유니코드 bidi/제로폭 스머글링 검사 축을 카탈로그·갤러리 테스트에 추가 (제3자 콘텐츠 주입 파이프라인 방어) {#unicode-gate}
- [x] H1 /oculpm:help 커맨드 — 플러그인 표면 17종(커맨드5+스킬5+훅4+MCP tool 5) 레퍼런스 카드. plugin.html·인앱 문서 동기 게이트 준수 {#help-command}
- [x] G1 delivery-gate 이식 — Stop 훅이 "코드 변경 있는데 일지 없음"을 감지하면 1회 차단+일지 작성 지시 (ponytail delivery-gate / ECC chief-of-staff 패턴 흡수, stop_hook_active 로 무한루프 방지) {#delivery-gate}
- [x] J1 growth-log 규율 이식 — oculpm-journal 스킬에 학습 품질 규율(실패·막다른길 우선 기록, 성과 나열 금지) 추가 {#growth-log}
- [x] I1 인셉션 보강 번들 — product-lens(인터뷰 질문 프레임) + plan-prd(증거 게이트·anti-fluff) + plan(leaf 항목 Validate 필드) 를 project-inception 스킬·inception 커맨드에 이식 {#inception-bundle}

## Phase R4 — 스킬 샵 표면화 (사용자 요청) {#round-r4}
- [x] S1 샵 탭 — 카탈로그를 갤러리 모달에서 허브 정식 탭으로 승격 (스택 추천·검색·태그 필터·미리보기·원클릭 설치, 게이트 없음 = 스킬은 Claude Code 네이티브) {#shop-tab}
- [x] S2 문서 표면 — oculpm.com/plugin 카탈로그 25종 섹션 + 전 스킬 문서화 테스트 게이트 {#shop-docs}

## 백로그 (합의 채택·후속 라운드) {#round-backlog}
- [ ] B1 훅 브리지 크로스플랫폼(Windows) — 양판사 now 였으나 앱이 현재 macOS 전용 배포라 Windows 앱 트랙과 동승해야 실효 (commandWindows·stdin fail-open·PreCompact 마커 동반) {#hooks-xplat}
- [ ] B2 일지 스키마 확장 라운드 — 실패 원장(save-session "실패해서 재시도 금지") + ADR("왜/버린 대안") + growth-log 심화 를 병합 설계로 (독립 이식 금지 — 축 겹침) {#journal-schema-2}
- [ ] B3 회고 승격 루프(evolve) — 일지 클러스터링→규칙/스킬 승격 제안, learn-eval 품질 게이트(Save/Absorb/Drop) 종속, hookify 아이디어 통합 검토 {#evolve-loop}
- [ ] B4 플래너 승인 게이트(plan-canvas) — annotate-and-approve 를 네이티브 플래너+MCP 로 {#plan-canvas}
- [ ] B5 세션 토큰·비용 텔레메트리 — cost-tracker 의 message.id dedupe 노하우, 훅 Stop 경로 (B1 이후) {#cost-telemetry}
- [ ] B6 카탈로그 3차 후보군 — make-interfaces-feel-better(1순위 명시 이월) · postgres/mysql/prisma/redis(DB 세트) · nestjs · laravel/springboot/django 세트 확장 · e2e 후속 · production-audit · click-path-audit · api-connector-builder · error-handling · contract-first {#catalog-3rd}
- [ ] B7 스킬 출처·건강 추적 — 카탈로그 설치분 출처 배지+설치일 (declining 은 훅 계측 후) {#skill-provenance}
- [ ] B8 규칙 허브 콘텐츠(ECC rules/ 선별 벤더) · 코드맵 내보내기 · 어댑터 매트릭스 확장(카나리 동반) · 스톨 감지(A1 구체안) · spec-miner(브라운필드 인셉션 2차) · safety-guard · ai-regression-testing(self-audit 차기 개정) · 벤치 판정기 셀프테스트 {#misc-backlog}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-01T00:40:00+09:00 | #round-r3 | claude-code | →☐ | | 전수 재감사(91후보→양판사 합의) 채택분 라운드 개설 (사용자 "계속 진행해") |
| 2026-08-01T00:58:00+09:00 | #vendor-12 #unicode-gate #help-command #delivery-gate #growth-log #inception-bundle | claude-code | →[x] | 20260801/Features_to_add/0057_feature_catalog-round-2-and-delivery-gate.md | R3 전 항목 완료 — 적대 리뷰 6건(HIGH 세션 귀속 오판 포함) 반영, 게이트 8시나리오 기능검증, 전체 게이트 그린 |
| 2026-08-01T11:08:00+09:00 | #shop-tab #shop-docs | claude-code | →[x] | 20260801/Features_to_add/1105_feature_skill-shop-tab.md | 샵 탭 승격 + plugin.html 카탈로그 동기 게이트 — 리뷰 2건 반영, v2.8.0 릴리스에 탑승 |
<!-- oculpm:plan-log end -->
