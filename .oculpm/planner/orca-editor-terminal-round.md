---
oculpm_plan: v1
id: orca-editor-terminal-round
title: "Orca 벤치마크 — 터미널 한 줄 · 편집기 바깥 변경 · 리치 마크다운"
status: active
created: 2026-10-25
updated: 2026-10-25
owner: claude-code
---

2026-10-25 사용자 결정: 터미널 시안 A(한 줄), 코드 편집기를 Orca 처럼 탄탄하게, 노션식 마크다운 편집을 코드 화면 .md 와 논의 편집기에. 시안 https://claude.ai/artifact/Jvw4BhsFN8tMVYW175t6zj

**완료 조건:** 실기기 확인 1건(`{#term-eyes}` — 화면 · 도크 · 분리 창 세 곳)이 끝나면 끝. v3.14.0 에 실렸다.

## 터미널 시안 A {#term}
- [x] 화면 툴바와 세션 줄을 한 줄로 — 「터미널 / 세션」 + 검색·분할·Aa·도크로 {#term-one-row}
- [x] 글자 크기·줄 간격을 Aa 메뉴 하나로, 상태바 키캡은 ? 단축키 보기로 {#term-view-menu}
- [x] 상태바를 셸 통합·일지 감시 점 + ? 만 남긴 얇은 줄로 {#term-slim-status}
- [x] 세션 이름 자리에 '.' 같은 의미 없는 제목이 뜨지 않게 {#term-dot-title}
- [ ] 실기기: 화면·도크·분리 창 세 곳에서 머리줄·Aa·상태바 확인 {#term-eyes}

## 편집기 바깥 변경·저장 충돌 {#guard}
- [x] 저장 직전 디스크 해시 재확인 — 읽은 뒤 바뀌었으면 덮지 않고 충돌로 {#guard-save-precondition}
- [x] 내가 쓴 저장은 바깥 변경으로 치지 않기 (self-write 기록) {#guard-self-write}
- [x] 변경 없는 탭은 바깥 변경을 조용히 다시 불러오고 '다시 불러옴' 표시 {#guard-clean-reload}
- [x] 변경 있는 탭은 노란 띠 — 바뀐 곳 비교 / 디스크 것 불러오기 / 내 것 유지 {#guard-banner}
- [x] 바깥에서 지워진 파일 처리 (탭 표시·다시 저장) {#guard-deleted}

## 리치 마크다운 편집 {#rich}
- [x] TipTap 기반 리치 편집기 — 마크다운 왕복(파싱·직렬화)과 frontmatter 칩 {#rich-core}
- [x] / 블록 메뉴 — 제목·할 일·표·코드 블록·인용 {#rich-slash}
- [x] 코드 화면 .md 에 리치/원문 전환 {#rich-code-md}
- [x] 논의 문서 편집기를 리치 편집으로 교체 — 옛 원문+미리보기 길 제거 {#rich-discussion}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-25T11:43:24+09:00 | #term-one-row | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1143_feature_terminal-one-row-de-ai.md | PR #97 main 471788c0 — screenTitle 이면 머리줄이 Toolbar |
| 2026-10-25T11:43:27+09:00 | #term-view-menu | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1143_feature_terminal-one-row-de-ai.md | TerminalViewMenu — fixed 팝오버 |
| 2026-10-25T11:43:31+09:00 | #term-slim-status | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1143_feature_terminal-one-row-de-ai.md | 셸 통합·감시 점 + 보기 값 + ? · 페인 장식 걷기 포함 |
| 2026-10-25T11:43:35+09:00 | #term-dot-title | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1143_feature_terminal-one-row-de-ai.md | 글자 없는 제목 거부 · 굳은 '.' 탭 회복 |
| 2026-10-25T12:11:26+09:00 | #guard-save-precondition | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1207_feature_editor-external-change-guard.md | 이미 있었음 — write_with_lock base_hash 대조 (확인만) |
| 2026-10-25T12:11:30+09:00 | #guard-self-write | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1207_feature_editor-external-change-guard.md | 이미 있었음 — file.hash === baseHash 에코 무시 (확인만) |
| 2026-10-25T12:11:34+09:00 | #guard-clean-reload | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1207_feature_editor-external-change-guard.md | PR #98 — 상태바 4초 「다시 불러왔어요」 |
| 2026-10-25T12:11:37+09:00 | #guard-banner | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1207_feature_editor-external-change-guard.md | PR #98 — 바뀐 곳 비교(DiffMode disk) 추가 |
| 2026-10-25T12:11:42+09:00 | #guard-deleted | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1207_feature_editor-external-change-guard.md | PR #98 — GONE_HASH 충돌 + 다시 만들기 |
| 2026-10-25T12:23:19+09:00 | #rich-core | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1212_feature_rich-markdown-editing.md | PR #99 39ce32d1 — 블록 원문 보존 코덱, 저장소 .md 전수 바이트 동일 |
| 2026-10-25T12:23:23+09:00 | #rich-slash | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1212_feature_rich-markdown-editing.md | 10개 블록 + 영문 별칭 |
| 2026-10-25T12:23:26+09:00 | #rich-code-md | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1212_feature_rich-markdown-editing.md | 크럼 줄 리치/원문 — 실기기 한글 IME·체크박스 클릭 미확인 |
| 2026-10-25T12:23:32+09:00 | #rich-discussion | claude-code | ☐→x | .oculpm/journal/20261025/Features_to_add/1212_feature_rich-markdown-editing.md | 리치 기본 · 나란히/미리보기 제거 · 메모는 원문으로 |
<!-- oculpm:plan-log end -->
