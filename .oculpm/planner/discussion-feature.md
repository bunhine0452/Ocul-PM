---
oculpm_plan: v1
id: discussion-feature
title: "문제 해결(Discussion) 기능"
status: done
created: 2026-06-29
updated: 2026-07-20
owner: claude-code
status_note: "전 PR 구현 완료 (미커밋)"
---

## 설계 {#design}
- [x] 설계 문서 세트 작성·잠금 (docs/discussion-feature/ 6종) {#design-docs}

## PR-DISC 0 — Backend Foundation {#pr0}
- [x] migration 024 + paths + parse.rs + project.rs(투영) + watcher 분기 + 읽기 커맨드(list/get) {#pr0-backend}

## PR-DISC 1 — 쓰기 경로 {#pr1}
- [x] doc_edit + create/write/set_status/rename/delete + redact + atomic {#pr1-write}

## PR-DISC 2 — 조사 자료 {#pr2}
- [x] 첨부 사이드카(attach/asset/detach, secure_join) + read_raw {#pr2-attach}

## PR-DISC 3 — UI {#pr3}
- [x] DiscussionScreenV2(목록+2-pane+편집) + WorkspaceContext/ShellV2/Sidebar 배선 {#pr3-screen}

## PR-DISC 4 — 승격 & 연결 {#pr4}
- [x] discussion_promote_to_plan + resolution_ref + Today "결정 대기 N건" + 편집 가드 {#pr4-promote}

## PR-DISC 5 — Agent Protocol {#pr5}
- [x] AGENTS.md "문제 해결" 규칙 + 템플릿 동기화(template_version 4) + 가드 테스트 {#pr5-agents}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-06-29T11:40:12+09:00 | #design-docs | claude-code | →x | journal/20260629/Chores/1140_chore_discussion-feature-design-docs.md | 설계 6종 작성·잠금 |
| 2026-06-29T11:54:12+09:00 | #pr0-backend | claude-code | →x | journal/20260629/Features_to_add/1154_feature_discussion-pr0-backend.md | 스키마·파서·투영·watcher·읽기커맨드, lib 302 green |
| 2026-06-29T12:03:27+09:00 | #pr1-write | claude-code | →x | journal/20260629/Features_to_add/1203_feature_discussion-pr1-write.md | doc_edit + 쓰기커맨드 5종, lib 309 green |
| 2026-06-29T12:34:01+09:00 | #pr2-attach | claude-code | →x | journal/20260629/Features_to_add/1234_feature_discussion-pr2-attachments.md | 첨부 attach/asset/detach + read_raw, lib 311 |
| 2026-06-29T12:34:11+09:00 | #pr3-screen | claude-code | →x | journal/20260629/Features_to_add/1234_feature_discussion-pr3-screen.md | DiscussionScreenV2 + 배선, 프론트 124 green |
| 2026-06-29T12:34:21+09:00 | #pr4-promote | claude-code | →x | journal/20260629/Features_to_add/1234_feature_discussion-pr4-promote-today.md | promote_to_plan + Today 위젯, lib 312 |
| 2026-06-29T12:34:31+09:00 | #pr5-agents | claude-code | →x | journal/20260629/Chores/1234_chore_discussion-pr5-agents-rules.md | AGENTS §8 + template_version 4 + 가드 |
<!-- oculpm:plan-log end -->
