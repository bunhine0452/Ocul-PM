---
oculpm_plan: v1
id: evidence-based-rules
title: "규율을 근거로 강제한다 — 크기 래칫 + 일지에서 캔 규칙"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 scripts/check-file-sizes-core.mjs 래칫과 AGENTS.md "Review-Proven Rules"(25 PR 채굴 + 클러스터별 수정률) 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F6·F7). CLAUDE.md 의 800줄 한계는 지금 강제되지 않고, 컨텍스트 예산 화면은 규칙의 비용만 알고 값어치를 모른다. 일지가 이미 갖고 있는 재발 근거를 규칙에 잇는다.

## 파일 크기 래칧 게이트 {#ratchet}
- [ ] `scripts/check-file-sizes.mjs` 신설 — 순수 함수를 export 하고 CLI 는 그것만 부른다 (기존 lint 스크립트 4종과 같은 모양) {#ratchet-script}
  - [ ] `allowedLineCount(base, max) = base == null || base <= max ? max : base` — 이미 넘은 파일은 현재 크기까지만 허용. 부채를 강제하지 않고 악화만 막는다 {#ratchet-fn}
  - [ ] 기준선은 `git merge-base origin/main HEAD` 3점 diff — 2점이면 리베이스 후 main 이 건드린 전부가 걸린다 {#ratchet-base}
  - [ ] CI 는 `HEAD^1`, 환경변수 `OCULPM_FILESIZE_BASE` 로 덮어쓰기. origin/main 을 못 찾으면 조용히 통과하지 말고 명시적으로 실패한다 {#ratchet-ci}
- [ ] 한계표 — CLAUDE.md 기준 그대로: Rust/TS 본문 800줄. 루트별 예외는 두지 않고 전역 하나로 시작한다 (YAGNI) {#ratchet-limits}
- [ ] `package.json` 에 `lint:filesize` 추가하고 `lint` 체인에 연결 {#ratchet-wire}
- [ ] 순수 함수 테스트 — 래칧 경계값(base==max, base>max, base 없음=신규파일) + 이름 바뀐 파일(R 상태) 처리 {#ratchet-test}
- [ ] 도입 시점 실측을 기록 — 지금 800줄 초과가 몇 개인지 세어 이 플랜에 적는다 (다음에 줄었는지 볼 수 있게) {#ratchet-baseline-record}

## 일지에서 결함 클러스터를 캐는다 {#mining}
- [ ] `src-tauri/src/oculpm/defect_clusters.rs` 신설 — Error_cycles · bug 일지에서 반복 클러스터 후보를 뽑는다. 결정적·LLM 없음 {#mine-module}
  - [ ] 클러스터는 표지 목록으로 정의 — `rule_negation.rs` 의 문단 스캐너와 같은 규율을 재사용한다 {#mine-markers}
  - [ ] 근거 발췌 필수 — 일지 경로 + 인용. 휴리스틱이라 사람이 판정할 수 있어야 한다 {#mine-evidence}
  - [ ] 지표는 **재발 간격** — 같은 클러스터가 며칠 만에 다시 나왔나. buzz 가 낸 「수정률」은 우리 표본에 「지적→수정」 짝이 없어 못 낸다. 다른 지표라고 불러야 한다 {#mine-metric}
  - [ ] 표본이 적으면 아무것도 주장하지 않는다 — 계측 전 침묵 규율(context-budget-truth D 단계)을 그대로 {#mine-silence}
- [ ] 커맨드 `defect_clusters_list` — lib.rs 양쪽 등록 + cargo test 로 bindings 재생성 {#mine-cmd}
- [ ] Rust 순수 함수 테스트 — 클러스터 분류·재발 간격·표본 부족 침묵 {#mine-test}

## 규칙과 근거를 잇는다 {#link}
- [ ] 규칙 항목에 「근거 일지 N건 · 최근 재발 D일 전」 배지 — 근거가 없으면 배지를 안 단다 (「근거 0」이라고 쓰지 않는다) {#link-badge}
- [ ] 컨텍스트 예산 화면 — 비용(바이트) 옆에 값어치(재발 방지 근거). 지금 화면은 비용만 안다 {#link-budget}
- [ ] 정리 제안에 근거 추가 — 「항상 로드인데 근거 없음」을 negated·dormant 옆에. 삭제가 아니라 상세 열기까지만 {#link-proposal}
- [ ] 프런트 순수함수 테스트 — 근거가 붙은 규칙과 안 붙은 규칙이 제안에서 갈리는지 {#link-test}

## 마감 {#wrap}
- [ ] 게이트 전부 exit 0 직접 확인 — 새 lint:filesize 를 포함해서 {#wrap-gates}
- [ ] i18n 키 ko/en 양쪽 {#wrap-i18n}
- [ ] 일지 작성 + 이 플랜 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
