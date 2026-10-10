---
oculpm_plan: v1
id: security-feedback-round-3
title: "보안 피드백 3차 — 경로 3건 · 상위 폴더 · 자동화 동의 범위"
status: done
created: 2026-10-08
updated: 2026-10-11
owner: claude-code
---

2026-10-08 외부 피드백 5건 판정(전부 사실) → PR #74. 결정 #d-consent-unit(v3.8.0, 프로젝트에 한 번·영구)을 고친다: 단위는 프로젝트 그대로, 동의는 그때 본 스위치·지시문 지문에 묶이고 거둘 수 있다.

## 수정 {#fix}
- [x] git 블롭 질의(code_head_content·이미지 미리보기 이전·거터)가 secure_join 을 지난다 {#blob-path-guard}
- [x] ▶실행 일지 발췌는 .oculpm/journal 안의 .md 만 {#dispatch-journal-ref}
- [x] 가져오기: symlink_metadata 이름 검사 + create_new/create_dir 쓰기 {#import-no-link-write}
- [x] 홈의 조상·최상위 시스템 폴더를 프로젝트로 받지 않음 (마법사 포함) {#unsafe-root-wider}
- [x] 동의를 스위치·정의 지문에 묶기 + 앱 변경분 허락 + 거두기 + 워처 캐시 틈 {#consent-scoped}

## 합류·확인 {#ship}
- [x] PR #74 CI 초록 → rebase 머지 {#merge}
- [-] 실기기 확인 — 오늘 카드의 바뀐 정의 이름·설정의 「허락 거두기」·/Users 추가 거부 문구 (다음 릴리스 설치본에서) {#eyes-round3}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-08T05:59:52+09:00 | #blob-path-guard | claude-code | ☐→x | .oculpm/journal/20261008/Bugs/0559_bug_path-guard-blob-dispatch-import.md | d7841255 · 지적보다 넓음(미리보기·거터) |
| 2026-10-08T06:00:02+09:00 | #dispatch-journal-ref | claude-code | ☐→x | .oculpm/journal/20261008/Bugs/0559_bug_path-guard-blob-dispatch-import.md | d7841255 |
| 2026-10-08T06:00:13+09:00 | #import-no-link-write | claude-code | ☐→x | .oculpm/journal/20261008/Bugs/0559_bug_path-guard-blob-dispatch-import.md | d7841255 |
| 2026-10-08T06:00:17+09:00 | #unsafe-root-wider | claude-code | ☐→x | .oculpm/journal/20261008/Bugs/0559_bug_unsafe-root-ancestors-system-dirs.md | 7efa6d67 |
| 2026-10-08T06:00:22+09:00 | #consent-scoped | claude-code | ☐→x | .oculpm/journal/20261008/Features_to_add/0559_feature_automation-consent-scoped-revocable.md | c1c901be · #d-consent-unit 수정 |
| 2026-10-08T06:08:42+09:00 | #merge | claude-code | ☐→x |  | PR #74 rebase 머지 → origin/main 20bdf597 (CI 3/3 초록) |
| 2026-10-11T00:01:35+09:00 | #eyes-round3 | claude-code | ☐→- | .oculpm/journal/20261011/Chores/0001_chore_security-plans-closeout.md | 이월 → improvement-round-2026-09-14 #eyes-security (실기기 원장 하나로 합침). 플랜 잠금 |
<!-- oculpm:plan-log end -->
