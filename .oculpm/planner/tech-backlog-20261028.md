---
oculpm_plan: v1
id: tech-backlog-20261028
title: "기술 이월 원장 (2026-10-28) — 닫은 라운드 플랜의 근거 있는 부채"
status: active
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

덜어내기 라운드(simplify-round-20261028)에서 활성 플랜 18개를 4개로 줄이며, 닫은 플랜의 미완 기술 항목 가운데 근거가 살아 있는 것만 여기로 옮겼다. 사용자 확인·결정 항목은 polish-round-20261027 로 갔다. 여기서 구현하지 않는다 — 착수할 때 라운드 플랜으로 옮겨 `[>]` 로 적는다.

**완료 조건:** 항목마다 라운드 플랜으로 옮겨져 `[>]` 가 되거나 근거가 사라져 `[-]` 가 되면 끝 — 비어 있으면 닫는다. 이 플랜에서 코드를 쓰지 않는다.
**확인 명령:** pnpm test && (cd src-tauri && cargo test --lib)

## 의존성 올리기 (근거 있음, 사용자 결정 대기) {#deps}
- [ ] notify 8 / debouncer 0.7 — Debouncer::watch 가 FileIdMap 을 루트부터 WalkDir 로 채움, OrderedFileIdCache 시그니처 이식 + perf_baseline 재측정 (← optimize-round-20261024 #carry-notify8) {#notify8}
- [ ] fastembed 5.17 → 7.5 (+ ort·hf-hub 짝) — 메이저 둘, 변경 내용·메모리 실측부터 (← optimize-round-20261024 #next-fastembed7) {#fastembed7}
- [ ] 보류 유지(근거): TypeScript 7 — typescript-eslint 8.72 의 peer 가 `<6.1.0` · notify 9 rc · specta rc.27 · keyring 4 기존 키 호환 불명. 근거가 바뀔 때만 다시 본다 (← optimize-round-20261024 #next-hold) {#deps-hold}

## 메모리·디스크 (측정 먼저) {#footprint}
- [ ] 라이브 풋프린트 Malloc Small 511MB 귀속 — 설치본이 꺼진 때 심볼 빌드 + MallocStackLogging 으로 상위 할당 지점(3.12.0 실측: UI footprint 604MB · peak 949MB · 할당 835MB/144만 개). 보류 등급 제거(10-28) 뒤 재측정이 먼저 (← optimize-round #carry-malloc-small, improvement-round-2026-09-14 #footprint-attribution) {#malloc-small}
- [ ] 이미 쌓인 worktree 사본 로컬 히스토리 236MB — 디스크에 없는 경로의 판 정리 (← optimize-round-20261024 #carry-history-purge) {#history-purge}
- [ ] 남은 빈 테이블 mobile_devices · graph_nodes · graph_edges · symbol_relations (+ 10-28 제거로 비게 된 터미널·ACP·LSP 계열 테이블 조사) — 다음 마이그레이션 라운드에서 DROP 판단 (← optimize-round-20261024 #carry-dead-tables) {#dead-tables}

## 플러그인·스킬 {#plugin}
- [ ] 플러그인 마켓플레이스 공개 — 택일 UX·훅 계약 문서·버전 스큐 매트릭스·커뮤니티 제출 (← improvement-round-2026-09-14 #plugin-marketplace ← plugin-round #a3-marketplace) {#plugin-marketplace}
- [ ] 스킬 카탈로그 2차 가운데 살아 있는 것만 — 훅 Windows 검증·일지 스키마 2(실패 원장·ADR)·플래너 승인 게이트·스킬 출처. 스킬 12→5 로 줄인 뒤라 카탈로그 3차·비용 텔레메트리는 뺐다 (← improvement-round-2026-09-14 #skill-catalog-b) {#skill-catalog-b}
- [ ] Codex 플러그인에 MCP 를 직접 싣기 — codex 0.162.1 실측: `.mcp.json` 은 읽지만 절대 경로일 때만 기동. Codex 가 플러그인 상대 경로를 풀게 되면 다시 본다 (← bug-opt-round-20261018 #carry-codex-plugin-mcp) {#codex-plugin-mcp}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
