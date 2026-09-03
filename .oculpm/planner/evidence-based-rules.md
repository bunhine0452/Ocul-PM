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
- [x] `scripts/check-file-sizes.mjs` 신설 — 순수 함수를 export 하고 CLI 는 그것만 부른다 (기존 lint 스크립트 4종과 같은 모양) {#ratchet-script}
  - [x] `allowedLineCount(base, max) = base == null || base <= max ? max : base` — 이미 넘은 파일은 현재 크기까지만 허용. 부채를 강제하지 않고 악화만 막는다 {#ratchet-fn}
  - [x] 기준선은 `git merge-base origin/main HEAD` 3점 diff — 2점이면 리베이스 후 main 이 건드린 전부가 걸린다 {#ratchet-base}
  - [x] CI 는 `HEAD^1`, 환경변수 `OCULPM_FILESIZE_BASE` 로 덮어쓰기. origin/main 을 못 찾으면 조용히 통과하지 말고 명시적으로 실패한다 {#ratchet-ci}
- [x] 한계표 — CLAUDE.md 기준 그대로: Rust/TS 본문 800줄. 루트별 예외는 두지 않고 전역 하나로 시작한다 (YAGNI) {#ratchet-limits}
- [x] `package.json` 에 `lint:filesize` 추가하고 `lint` 체인에 연결 {#ratchet-wire}
- [x] 순수 함수 테스트 — 래칧 경계값(base==max, base>max, base 없음=신규파일) + 이름 바뀐 파일(R 상태) 처리 {#ratchet-test}
- [x] 도입 시점 실측을 기록 — 지금 800줄 초과가 몇 개인지 세어 이 플랜에 적는다 (다음에 줄었는지 볼 수 있게) {#ratchet-baseline-record}

## 일지에서 결함 클러스터를 캐는다 {#mining}
- [x] `src-tauri/src/oculpm/defect_clusters.rs` 신설 — Error_cycles · bug 일지에서 반복 클러스터 후보를 뽑는다. 결정적·LLM 없음 {#mine-module}
  - [x] 클러스터는 표지 목록으로 정의 — `rule_negation.rs` 의 문단 스캐너와 같은 규율을 재사용한다 {#mine-markers}
  - [x] 근거 발췌 필수 — 일지 경로 + 인용. 휴리스틱이라 사람이 판정할 수 있어야 한다 {#mine-evidence}
  - [x] 지표는 **재발 간격** — 같은 클러스터가 며칠 만에 다시 나왔나. buzz 가 낸 「수정률」은 우리 표본에 「지적→수정」 짝이 없어 못 낸다. 다른 지표라고 불러야 한다 {#mine-metric}
  - [x] 표본이 적으면 아무것도 주장하지 않는다 — 계측 전 침묵 규율(context-budget-truth D 단계)을 그대로 {#mine-silence}
- [x] 커맨드 `defect_clusters_list` — lib.rs 양쪽 등록 + cargo test 로 bindings 재생성 {#mine-cmd}
- [x] Rust 순수 함수 테스트 — 클러스터 분류·재발 간격·표본 부족 침묵 {#mine-test}

## 규칙과 근거를 잇는다 {#link}
- [x] 규칙 항목에 「근거 일지 N건 · 최근 재발 D일 전」 배지 — 근거가 없으면 배지를 안 단다 (「근거 0」이라고 쓰지 않는다) {#link-badge}
- [x] 컨텍스트 예산 화면 — 비용(바이트) 옆에 값어치(재발 방지 근거). 지금 화면은 비용만 안다 {#link-budget}
- [-] 정리 제안에 근거 추가 — 「항상 로드인데 근거 없음」을 negated·dormant 옆에. 삭제가 아니라 상세 열기까지만 {#link-proposal}
- [x] 프런트 순수함수 테스트 — 근거가 붙은 규칙과 안 붙은 규칙이 제안에서 갈리는지 {#link-test}

## 마감 {#wrap}
- [x] 게이트 전부 exit 0 직접 확인 — 새 lint:filesize 를 포함해서 {#wrap-gates}
- [x] i18n 키 ko/en 양쪽 {#wrap-i18n}
- [x] 일지 작성 + 이 플랜 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T18:09:31+09:00 | #ratchet-fn | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | buzz 와 같은 한 줄. 경계값 3케이스를 테스트로 고정 |
| 2026-09-03T18:09:33+09:00 | #ratchet-base | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | merge-base==HEAD 이면 HEAD 로 접는다 (main 위에서는 커밋 안 된 변경만 본다) |
| 2026-09-03T18:09:35+09:00 | #ratchet-ci | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 기준선 실패는 exit 2 로 명시 — 조용한 통과 없음. 테스트가 던지는지까지 단언 |
| 2026-09-03T18:09:38+09:00 | #ratchet-limits | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 전역 800 하나. 제외는 셋 — 생성물(bindings)·사전(i18n)·명세서(lib.rs, 길이가 기능 수의 함수라 래칫이 우회될 규칙이 된다) |
| 2026-09-03T18:09:40+09:00 | #ratchet-wire | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | lint 체인 다섯 번째 |
| 2026-09-03T18:09:42+09:00 | #ratchet-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 17개 — R/C 상태 파싱, countLines 의 wc -l 차이, 기준선 해석 4갈래 |
| 2026-09-03T18:09:44+09:00 | #ratchet-baseline-record | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 도입 시점 800줄 초과 **50개** (최대 tools.rs 3,675 · window.rs 3,028 · manager/tests.rs 2,316). 이 라운드에 둘이 줄었다: tools.rs 3,240 · SkillsScreenV2 740 |
| 2026-09-03T18:09:52+09:00 | #mine-markers | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 클러스터 7종 — 이 저장소 버그 일지 126건을 실제로 훑어 뽑았다(상상 아님). 매칭은 제목+「발생 원인」 절만: 본문 전체는 고친 이야기까지 결함으로 셌다 |
| 2026-09-03T18:09:53+09:00 | #mine-evidence | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | ClusterHit{rel_path, workday, title, excerpt, marker} — 걸린 표지까지 낸다 |
| 2026-09-03T18:09:56+09:00 | #mine-metric | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | typical_gap_days(중앙값)+last_gap_days. 「수정률」을 흉내 내지 않는 이유를 모듈 문서 첫머리에 |
| 2026-09-03T18:09:59+09:00 | #mine-silence | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | MIN_HITS=3. 실측에서 path-escape 가 표지를 조인 뒤 3 밑으로 떨어져 실제로 사라졌다 |
| 2026-09-03T18:10:01+09:00 | #mine-cmd | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 이름은 `rules_evidence` — 클러스터만 주는 게 아니라 규칙 연결까지 한 왕복에 준다. lib.rs 양쪽 등록·bindings 재생성 |
| 2026-09-03T18:10:03+09:00 | #mine-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 5개 + 실측용 #[ignore] mines_this_repository (표지를 다듬을 때 쓰는 자) |
| 2026-09-03T18:10:05+09:00 | #link-badge | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | EvidenceChip — 근거 없으면 아무것도 안 그린다. 툴팁에 클러스터 이름 + 재발 간격 |
| 2026-09-03T18:10:12+09:00 | #link-budget | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 예산 바 아래 「근거가 붙은 규칙 N개 · 일지 M건」. 0이면 줄 자체를 안 그린다 |
| 2026-09-03T18:10:15+09:00 | #link-proposal | claude-code | ☐→- | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 안 한다 — 우리 연결은 표지 휴리스틱이라 대부분의 규칙에 근거가 안 붙는다. 그걸 「쓸모없음」으로 제안하면 데이터가 지지하지 않는 판정이 된다. 침묵은 무죄의 증거도 유죄의 증거도 아니다 |
| 2026-09-03T18:10:18+09:00 | #link-test | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | indexEvidence 3개 — 근거 없는 규칙은 색인에 **없다**(0이 아니라), 여러 클러스터의 일지를 경로로 중복 제거, null 응답 접기 |
| 2026-09-03T18:10:21+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 새 게이트가 자기 라운드의 코드를 두 번 잡았다 → tools.rs 분할(3675→3240) · SkillsScreenV2 훅 추출(819→740). plugin_docs_sync 도 분할에 맞춰 두 파일을 읽게 고침 |
| 2026-09-03T18:10:23+09:00 | #wrap-i18n | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | ko/en 3키 (배지·툴팁·요약) |
| 2026-09-03T18:10:25+09:00 | #wrap-journal | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1809_feature_evidence-based-rules.md | 일지 1809 + 이 플랜 20항목 (1건 dropped) |
<!-- oculpm:plan-log end -->
