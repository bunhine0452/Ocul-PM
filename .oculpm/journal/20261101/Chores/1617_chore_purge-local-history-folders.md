---
schema_version: 1
type: chore
slug: "purge-local-history-folders"
status: done
difficulty: verylow
created_at: "2026-11-01T16:17:27+09:00"
session_id: "20261101-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "d8b38fb5-2ed4-4f05-8ab6-4ca7b916800b"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20261101/Refactors/1549_refactor_optimize-dead-code-sweep.md"
    kind: "followup"
tags:
  - "최적화"
  - "optimization"
  - "mcp-tool"
---
[x] 최적화: 남은 로컬 히스토리 1.5GB를 지웠다

## 무엇을
사용자 지시("네가 그냥 지워줘")로, 추적 프로젝트 12곳의 `.oculpm/index/history/` 를 지웠다. 직전 라운드(a7b576da)에서 이 폴더를 쓰던 코드(`oculpm/history.rs`)를 걷었고, 읽는 코드는 그 전부터 없었다. 앱 관리 영역이라 앱이 지우지 않기로 했던 자리를, 사람의 지시를 받아 한 번 지운 것이다.

- 대상: 앱 DB `projects.root_path` 12곳. 지운 것은 `history` 폴더뿐이고 `index/diffs` 와 워크데이 캐시는 그대로다.
- 크기: project_naeri 434M · projectborard 394M · ai-pm 329M · project01 184M · godgame 74M · lazymemo 55M · 나머지 6곳 42M, 합계 약 1.5GB.
- 앱이 꺼져 있을 때 지웠다 (`pgrep` 결과 없음).

## 검증
- 지운 뒤 12곳 모두 폴더가 없고, 저장소 `git status` 는 변화가 없다 (`.oculpm/index/` 는 gitignore 영역).