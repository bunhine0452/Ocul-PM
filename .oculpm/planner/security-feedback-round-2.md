---
oculpm_plan: v1
id: security-feedback-round-2
title: "보안 피드백 2차 (2026-10-07)"
status: active
created: 2026-10-07
updated: 2026-10-07
owner: claude-code
---

v3.8.0 뒤 남은 지적 4건(일반 파일 링크·diff 캡처 경로·히스토리 해시 슬라이스·프롬프트 원장의 래퍼 맹점)을 코드로 확인하고 같은 부류까지 닫는다.

## 경로 가드 {#guard}
- [x] path_guard 모듈 — 어휘 + 링크, 마지막 구간 세 판(따라감·링크 자체·관리 파일). 첫 관문만 쓰던 창구(외부 편집기·심볼 펼침·이미지 미리보기·변경 diff)까지 {#path-guard}
- [x] 앱이 읽고 합쳐 쓰는 프로젝트 파일 — 열 때마다 도는 규칙 어댑터 동기·.gitignore 블록, 그리고 .mcp.json·훅 설정·규칙 미러·규칙/스킬 프로젝트 범위는 링크면 손대지 않기 {#managed-writes}
- [x] 배경 읽기 — 자동 색인·로컬 히스토리가 링크를 따라 밖의 내용을 담지 않기 {#background-reads}

## 일지·히스토리 {#records}
- [x] diff 캡처가 files_touched 의 절대경로·..·링크 경로를 읽지 않기 {#entry-diff-paths}
- [x] 로컬 히스토리 hash 바이트 슬라이스 패닉 + meta.json 해시 모양 검증 {#history-hash}

## 송신 목록 {#ledger}
- [x] 프롬프트 원장이 래퍼(call_llm·map_reduce_blocks·ChatBackend)를 지나는 호출까지 보기 + 미분류 래퍼 판정 {#prompt-ledger}
- [x] 마스킹 바닥 — 설정을 못 읽어도 내장 패턴은 선다 + 릴리스 노트 문체 표본 가리기 {#redact-floor-fallback}

## 합류·알림 {#ship}
- [x] PR 머지 (CI 초록 확인 뒤) {#merge}
- [ ] 다음 릴리스 노트에 v3.8.0 링크 문단의 과장 정정 — 그때 막은 것은 .oculpm 안뿐이었다 {#changelog-correction}
- [ ] 실기기 확인 — 링크 든 저장소 열기(어댑터·.gitignore 건너뜀 로그), 설정 「지금 동기화」 실패 사유 문구, 코드 트리의 밖 링크 {#eyes-round2}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-07T20:27:00+09:00 | #path-guard | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_symlink-guard-general-files.md | PR #70 — 코드 화면은 둘째 관문이 이미 막았고, 첫 관문만 쓰던 창구가 뚫려 있었다 |
| 2026-10-07T20:27:05+09:00 | #managed-writes | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_symlink-guard-general-files.md | PR #70 — 리뷰 밖에서 찾은 가장 큰 자리(열 때마다 도는 어댑터 동기·.gitignore 블록) |
| 2026-10-07T20:27:09+09:00 | #background-reads | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_symlink-guard-general-files.md | PR #70 — 색인 걷기·워처 판정·reindex 단건, 히스토리 캡처 |
| 2026-10-07T20:27:12+09:00 | #entry-diff-paths | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_entry-diff-files-touched-outside.md | PR #70 |
| 2026-10-07T20:27:17+09:00 | #history-hash | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_history-hash-byte-slice-panic.md | PR #70 |
| 2026-10-07T20:27:22+09:00 | #prompt-ledger | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_prompt-ledger-sees-wrappers.md | PR #70 — 변이 시험 둘 통과 |
| 2026-10-07T20:27:26+09:00 | #redact-floor-fallback | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/2026_bug_prompt-ledger-sees-wrappers.md | PR #70 — 여섯 폴백 + 릴리스 노트 표본, CALL_SITE_FILES 28 |
| 2026-10-07T20:41:12+09:00 | #merge | claude-code | ☐→x |  | PR #70 rebase 머지 973a55b7 — CI 3잡 conclusion success |
<!-- oculpm:plan-log end -->
