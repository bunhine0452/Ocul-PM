---
schema_version: 1
type: feature
slug: git-history-backfill
status: done
difficulty: high
created_at: "2026-06-22T08:30:00+09:00"
session_id: "20260622-m05"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/git.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/api/oculpm.ts
    op: update
  - path: src/features/oculpm/JournalScreenV2.tsx
    op: update
related:
  - 20260622/Bugs/0630_bug_redaction-not-wired-to-journal-diff.md
tags: ["feature", "git-backfill", "cold-start", "oculpm", "dev-report-followup", "F5"]
---

[x] Git 히스토리 백필 — 콜드스타트 절벽 제거 (F5)

## 추가 기능

일지는 AGENTS.md 에이전트가 앞으로 써야만 생긴다 — 이미 수개월 git 히스토리가 쌓인 실제 레포는 `.oculpm/journal/` 이 비어 day 1 에 빈 화면이다. `oculpm_backfill_from_git(project_id, max_commits)` 로 **커밋당 일지 1개를 합성**해 콜드스타트 절벽을 없앤다.

## 동작 흐름

- **git.rs** `commits_for_backfill`: `git log --no-merges -M --name-status` 1콜로 sha/author/date/subject/body/변경파일을 RS·US 구분자로 파싱(rename `R100` 처리).
- **manager** `backfill_from_git`(spawn_blocking git → 일지 합성):
  - type=conventional-commit 프리픽스 추론(feat→feature·fix→bug·refactor/perf→refactor·else chore), slug=subject 정규화(비ASCII→`commit-<sha>` 폴백, validate_slug 만족), created_at=author date(프로젝트 tz), session_id=`{workday}-git`, agent.id=body 트레일러 휴리스틱(Claude/Cursor/…→해당, else `git`), files_touched=name-status→FileOp.
  - body 는 **redact 후** 디스크 기록, per-file diff 는 `entry_diffs`(tier-3 nearest-commit 가 바로 이 커밋의 diff)로 **캡처+마스킹**.
  - **멱등**: 처리한 commit SHA 를 `.oculpm/index/git-backfill.json` 에 영속 → 재실행 시 신규 커밋만 추가. `max_commits` 캡(1..=2000).
- **프런트**: `JournalScreenV2` 콜드스타트 빈 화면에 "git 히스토리에서 가져오기" 버튼(`oculpmApi.backfillFromGit` → 토스트 + refresh).

## 검증

- 백엔드 `cargo test` 268 lib(임시 git 레포에서 feat/fix 2커밋→2일지·타입 분류·`git-backfill` 태그·재실행 멱등 0건 검증) + 통합 통과. bindings 재생성.
- 프런트 typecheck/test/lint/build 전부 exit 0(125 통과).

## 메모

- 한계(MVP): 기존 일지와 commit 단위 dedup 은 처리-SHA sidecar 기반(앱이 처음 본 commit 만 마킹) — 동일 commit 에 에이전트 수기 일지가 따로 있어도 공존. 콜드스타트(빈 journal) 시나리오 타깃이라 수용. 사이드카 삭제 시 재백필 가능.
- redaction(R1) 선행 활용 — 옛 diff/본문 스크럽됨.
