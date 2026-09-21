---
oculpm_plan: v1
id: journal-scale-round
title: "일지 700건 시대 — 찾기·잇기·묶기 (규모 라운드)"
status: active
created: 2026-09-21
updated: 2026-09-21
owner: claude-code
---

727건(주 100건 성장)에서 드러난 문제는 성능이 아니라 찾기·믿기·묶기다. journal_search 디스크 전수 스캔·관련도 없는 랭킹, 태그 806종 중 437종 1회용, links 0건, 검증 8건, 회고 시야 소멸, 62KB 플랜 파일. 감사(2026-09-21)의 1·2·4 가 핵심이고 나머지는 그 위에 올린다.

## 검색 — 캐시 기반·관련도 랭킹 {#search}
- [x] journal_search 를 SQLite 캐시 기반으로 — 디스크 전수 스캔 제거, 캐시 비었을 때만 디스크 폴백 {#search-cache}
- [x] 관련도+최신성 혼합 랭킹(제목>태그>파일>본문, 최근 가산) + 프런트용 oculpm_search_journal 커맨드 {#search-rank}
- [x] 검색 화면에 일지 스코프 추가 (의미·심볼·텍스트 옆) — 랭킹 결과·스니펫·일지 열기 {#search-scope-ui}
- [ ] 의미검색에 일지 포함 옵션 (임베딩 대상 확장) — 검토 후 착수 {#search-semantic-journal}

## 연결 — related 자동 제안과 재발 링크 {#links}
- [x] 관련 후보 산출 커맨드 — 같은 파일·같은 플랜 항목·제목 유사도로 점수, 상위 N {#related-suggest}
- [x] 일지 상세에 관련 후보 카드 + 1클릭으로 frontmatter related 에 기록(디스크 원본 갱신) {#related-ui}
- [x] journal_write 자동 related — 같은 파일을 만진 bug/error 전편이 있으면 followup 자동 연결 {#related-auto}

## 태그 — 사전과 정규화 {#tags}
- [x] mcp-tool 을 태그 통계·필터에서 출처 표식으로 분리 (UI·stats 에서 제외) {#tag-source-marker}
- [x] 프로젝트 태그 사전(빈도 기반 카노니컬) + journal_write 정규화·유사 태그 치환 제안 {#tag-normalize}
- [x] 태그 병합 도구 — A→B 일괄 치환(디스크 frontmatter 재작성) + 1회용 태그 목록 {#tag-merge}

## 핫스팟 — 재발과 반복 수정 {#hotspot}
- [x] 파일별 bug/error 일지 빈도·반복 수정 횟수 쿼리 커맨드 (캐시 SQL) {#hotspot-query}
- [x] Today 화면 핫스팟 카드 — 상위 파일·건수·최근 일지로 이동 {#hotspot-card}

## 요약 계층 — 주간 롤업 {#rollup}
- [x] .oculpm/rollups/ 주간 요약 파일 규격 + 결정적 생성(LLM 옵션) — 원본 위 한 층 {#rollup-weekly}
- [x] 주간 보고 LLM 입력 60건 캡을 청킹으로 — 「외 N개」 누락 제거 {#weekly-cap}
- [x] journal_search·AI 컨텍스트가 요약 층을 먼저 보고 원본으로 내려간다 {#rollup-first}

## 검토·플래너·디스크 위생 {#hygiene}
- [x] 미검토 일지 필터 + 일괄 확인(검토 대기함) — verified_by_user 를 살린다 {#review-queue}
- [x] 플랜 로그 표가 N행을 넘으면 <plan>.log.md 로 분리 — 파서·락 호환 {#plan-log-archive}
- [x] 설정 진단에 .oculpm/index 사용량(history·diffs) 표시 + 정리 버튼 {#index-usage}
- [ ] 태그 사이 일지로 CHANGELOG 초안 생성 — 검토 후 착수 {#release-notes-draft}
- [ ] 주당 건수·유형 추이와 플랜 완료 속도 — 검토 후 착수 {#velocity}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-21T18:21:24+09:00 | #search-cache | claude-code | ☐→~ |  | 1차 웨이브 — worktree 세션 S (opus) |
| 2026-09-21T18:21:29+09:00 | #search-rank | claude-code | ☐→~ |  | 1차 웨이브 — 세션 S (opus) |
| 2026-09-21T18:21:33+09:00 | #related-suggest | claude-code | ☐→~ |  | 1차 웨이브 — 세션 L (opus) |
| 2026-09-21T18:21:37+09:00 | #related-ui | claude-code | ☐→~ |  | 1차 웨이브 — 세션 L (opus) |
| 2026-09-21T18:21:42+09:00 | #related-auto | claude-code | ☐→~ |  | 1차 웨이브 — 세션 L (opus) |
| 2026-09-21T18:21:46+09:00 | #hotspot-query | claude-code | ☐→~ |  | 1차 웨이브 — 세션 H (sonnet) |
| 2026-09-21T18:21:52+09:00 | #hotspot-card | claude-code | ☐→~ |  | 1차 웨이브 — 세션 H (sonnet) |
| 2026-09-21T18:21:56+09:00 | #index-usage | claude-code | ☐→~ |  | 1차 웨이브 — 세션 D (sonnet) |
| 2026-09-21T18:22:01+09:00 | #tag-source-marker | claude-code | ☐→~ |  | 1차 웨이브 — 세션 D (sonnet) |
| 2026-09-21T19:13:30+09:00 | #search-cache | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1912_feature_journal-search-cache-rank.md | 읽기전용 DB + 폴백 4조건, 727건 132→25ms. PR #26 |
| 2026-09-21T19:13:35+09:00 | #search-rank | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1912_feature_journal-search-cache-rank.md | 제목100>태그70>슬러그55>경로40>본문10 + 최신성≤9, oculpm_search_journal 커맨드 |
| 2026-09-21T19:13:41+09:00 | #related-suggest | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_related-suggest-link-auto.md | IDF 공유파일(허브 합산 상한 0.15)+플랜항목+제목 자카드 |
| 2026-09-21T19:13:47+09:00 | #related-ui | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_related-suggest-link-auto.md | RelatedSuggestCard + oculpm_add_related(본문 바이트 불변). 캐시 related 미투영 잠복 결함도 수정 |
| 2026-09-21T19:13:52+09:00 | #related-auto | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_related-suggest-link-auto.md | journal_write 디스크 walk 폴백, auto_related 응답 |
| 2026-09-21T19:13:57+09:00 | #hotspot-query | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_file-hotspots-today-card.md | bug+error≥2 이고 total 의 20% 이상(허브 제외) |
| 2026-09-21T19:14:03+09:00 | #hotspot-card | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_file-hotspots-today-card.md | Today HotspotCard 90일, 0건도 숨지 않음 |
| 2026-09-21T19:14:08+09:00 | #index-usage | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_index-usage-and-source-marker-tag.md | 설정→진단 IndexUsageSection + diff 정리(git 재구성 폴백) |
| 2026-09-21T19:14:13+09:00 | #tag-source-marker | claude-code | ~→x | .oculpm/journal/20260921/Features_to_add/1913_feature_index-usage-and-source-marker-tag.md | SOURCE_MARKER_TAGS(spec.rs) — skill_promotion 클러스터·태그 칩에서 제외 |
| 2026-09-21T23:37:34+09:00 | #search-scope-ui | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2335_feature_search-screen-journal-scope.md | 4번째 스코프 「일지」, N건 중 M건, 더 보기 20→50→100. PR #27 |
| 2026-09-21T23:37:40+09:00 | #tag-normalize | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2336_feature_tag-normalize-hints-and-merge.md | 정규화 적용·유사 태그는 tag_hints 로 제안만 |
| 2026-09-21T23:37:46+09:00 | #tag-merge | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2336_feature_tag-normalize-hints-and-merge.md | oculpm_tag_stats/merge + 「태그 정리」 시트, 디스크 frontmatter 재작성·멱등 |
| 2026-09-21T23:37:53+09:00 | #rollup-weekly | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2336_feature_weekly-rollup-layer.md | .oculpm/rollups/ 결정적+LLM, schema_version 유지, 워처 Rollups 영역, Today 카드 |
| 2026-09-21T23:37:59+09:00 | #weekly-cap | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2336_feature_weekly-rollup-layer.md | 60건 캡 → map-reduce 청킹, summary/chunking.rs 분리 |
| 2026-09-21T23:38:05+09:00 | #rollup-first | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2336_feature_weekly-rollup-layer.md | journal_search rollups · journal_read 확장 · aiContext 롤업 우선 · AGENTS §0 (template_version 13) |
| 2026-09-21T23:38:11+09:00 | #plan-log-archive | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2337_feature_plan-log-archive-sidecar.md | LOG_KEEP 40, 아카이브 먼저 쓰기, 4 append 경로 같은 락, 잠긴 플랜 무접촉 |
| 2026-09-21T23:38:17+09:00 | #review-queue | claude-code | ☐→x | .oculpm/journal/20260921/Features_to_add/2337_feature_review-queue-unverified.md | unverified_only 필터 + bulk 확인 + ReviewQueueBar + v 토글 |
<!-- oculpm:plan-log end -->
