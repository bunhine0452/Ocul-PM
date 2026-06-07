---
schema_version: 1
type: bug
slug: diff-no-baseline
status: done
difficulty: low
created_at: "2026-06-04T21:01:26+09:00"
updated_at: "2026-06-04T21:01:26+09:00"
session_id: "20260604-m03"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: true
files_touched:
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
    bytes_added: 2200
    bytes_removed: 400
  - path: src/__tests__/diff_v2.test.tsx
    op: update
    bytes_added: 700
    bytes_removed: 200
related:
  - "../Features_to_add/2036_feature_pr-ui8b-dark-purge.md"
tags: ["ui-v2", "diff", "dogfood", "baseline"]
---

## 버그 수정

변경 diff 에서 **커밋/인덱싱 된 적 없는(untracked) 새 파일**을 열면 "아직 baseline 이 없어요 … 부분 reindex 후 …" 막다른 안내만 떠서 변경을 바로 못 보던 문제.

- **원인**: `computeDiff` 는 git→snapshot 순으로 baseline 을 찾는데, untracked·미인덱싱 파일은 둘 다 없어 `snapshots_unavailable` 반환 → UI 가 안내문만 표시.
- **수정**: `snapshots_unavailable` 일 때 `readProjectFile` 로 파일 내용을 읽어 전체를 `+` 추가 patch 로 합성 → 기존 파서/렌더 그대로 통과해 새 파일 내용이 녹색 추가 diff 로 **즉시** 표시. footer 로 "baseline 없는 새 파일이라 전체 표시(커밋/인덱싱 후엔 변경분만)" 안내.

## 검증

- 백엔드 무변경(`readProjectFile` 기존 command). `diff_v2` 테스트 갱신(안내문 단언 → 전체-추가 렌더 단언).
- typecheck/test(88)/lint/build green. **사용자 dogfood — 전체 내용 즉시 표시 확인**.

## 메모

- 추적 중인 파일은 기존대로 git HEAD 기준 diff. 본 fix 는 *새/untracked* 케이스 한정.
- 머지 `ae71caa`.
