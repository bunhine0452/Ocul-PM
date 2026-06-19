---
schema_version: 1
type: bug
slug: entry-diff-missing-new-files
status: done
difficulty: medium
created_at: "2026-06-19T19:37:41+09:00"
updated_at: "2026-06-19T19:37:41+09:00"
session_id: "20260619-m02"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/entry_diffs.rs
    op: update
    bytes_added: 11829
    bytes_removed: 769
  - path: src-tauri/src/git.rs
    op: update
    bytes_added: 1120
    bytes_removed: 0
related:
  - 20260619/Features_to_add/1924_feature_docs-wiki-viewer.md
tags: ["entry-diffs", "git", "diff", "journal", "dogfooding-finding"]
---

[x] 작업 일지에서 특정 항목 진입 시 새로 생긴 파일의 diff 가 안 뜨는 버그

## 발생 원인

작업 일지 항목을 열면 `files_touched[]` 별로 캡처해 둔 git diff 사이드카(`.oculpm/index/diffs/*.json`)를 읽어 보여준다. 캡처는 3-tier: ① `git diff HEAD -- <path>` ② snapshot(직전 인덱싱 baseline) ③ git-history(인근 커밋). **새로 생성된(아직 `git add` 안 한 untracked) 파일은 세 tier 모두 무력**하다:
- `git diff HEAD` 는 **untracked 파일을 아예 표시하지 않음** → tier1 빈 결과.
- 갓 만든 파일이라 snapshot baseline 없음(있어도 disk 와 동일 → diff 없음) → tier2 None.
- 아직 커밋 안 됨 → tier3 None.

도그푸딩 흐름(에이전트가 `Write` 로 새 파일 생성 → 커밋 전에 일지 작성)에서 정확히 이 모양이 된다. 게다가 "**가끔**"인 이유: 한 일지가 수정 파일 A(diff 있음) + 신규 파일 B(diff 없음)를 함께 건드리면, 캡처 시 사이드카가 A 만 담겨 기록되고 — `read_or_reconstruct` 는 사이드카가 비어있지 않으면 재캡처하지 않으므로 — **B 가 영구히 누락**된다. (A 가 없던 신규-단독 일지는 사이드카 자체가 안 써져 빈 상태로 보였다.)

## 해결 방법

1. **tier 4 — 생성 파일 폴백 추가** (`entry_diffs.rs::new_file_patch`). tier1~3 이 모두 비면, 빈 baseline vs 현재 disk 내용으로 unified diff 를 합성(파일 전체를 추가분으로) — 생성 행위 자체가 곧 그 diff다. *추적되는 unchanged 파일을 추가분으로 오인 렌더하지 않도록* 가드: git 저장소면 `git::path_in_head` 로 **HEAD 에 없을 때만**, 비-git 이면 기록된 `op == create` 일 때만 발동.
2. **`git::path_in_head(root, path) -> Option<bool>`** 신규 (`git.rs`). `git cat-file -e HEAD:<rel>` 으로 HEAD 멤버십 판정 — `None`(비-git) / `Some(true)`(추적·HEAD 존재) / `Some(false)`(untracked·신규·unborn HEAD). 파일이 포함된 repo 를 해석(.oculpm 가 git repo 상위일 수 있음)하는 기존 `repo_root_for`/`repo_relative` 재사용.
3. **사이드카 스키마 1→2 + in-place 업그레이드.** tier4 누락으로 **불완전하게 기록된 기존 v1 사이드카가 자가 복구**되도록: `read_entry_diffs` 는 스키마 불일치를 빈 결과로 reject(기존 동작) → lazy `read_or_reconstruct` 가 재캡처 트리거. capture 의 스킵 가드를 `out.exists()` → **`sidecar_is_current`(현재 스키마일 때만 스킵)** 로 바꿔, v1 사이드카는 tier4 포함해 재캡처·덮어쓴다. (watcher 의 신규 항목 캡처는 v2 로 바로 기록.)

수정은 `capture_entry_diffs` 한 곳에 집중 — watcher 캡처·backfill·lazy reconstruct 세 경로가 모두 이 함수를 거치므로 일괄 적용.

## 검증

`entry_diffs` 단위테스트 12종(신규 4종 포함) 전부 통과:
- `new_file_patch_renders_additions_and_guards` — tier4 단독: create=추가분 기록 / 비-git+update=None / 누락 파일=None.
- `capture_records_newly_created_file_via_tier4` — 신규 파일 op=create 가 diff 기록됨.
- `capture_records_untracked_new_file_in_git_repo` — **실제 git repo + untracked 신규 파일**(op 오기 update 여도 path_in_head=Some(false)로 기록).
- `stale_v1_sidecar_is_upgraded_to_include_missed_new_file` — 손으로 쓴 v1 사이드카(A만) → 재캡처로 v2(A+B) 승격.
- 기존 회귀(비-git nothing / snapshot / history / no-HHMM) 모두 유지.

전체 게이트: `cargo test` **289 통과**(0 실패, lib +4) + 통합스위트 그린, `pnpm typecheck`=0. (프런트 무변경 — `EntryDetailView` 는 기록된 diff 를 그대로 렌더하므로 백엔드 수정만으로 노출됨. 실앱 수동확인은 사용자 검증 대기.)

## 메모

- 한계: 이미 v1 으로 기록된 항목은 **다음 열람 시** lazy reconstruct 로 복구된다(즉시 일괄 복구 아님 — backfill 은 `sidecar_exists` 로 presence 만 보므로 v1 을 스킵). 사용자가 해당 일지를 열면 자동 갱신됨.
- 여전한 본질적 한계(커밋·인덱싱 없이 사라진 중간 상태 등)는 모듈 docs 그대로.
