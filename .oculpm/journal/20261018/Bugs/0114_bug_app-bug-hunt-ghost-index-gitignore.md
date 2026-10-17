---
schema_version: 1
type: bug
slug: "app-bug-hunt-ghost-index-gitignore"
status: done
difficulty: medium
created_at: "2026-10-18T01:14:24+09:00"
session_id: "20261018-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f2a896a3-7a54-47ca-9267-32f3b36af4fc"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db/code_index.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/handle.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_queue.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher/tests_gitignore.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/tests/plan_anchor.rs"
    op: create
  - path: "src/lib/workday.ts"
    op: update
  - path: "src/__tests__/local_iso_date.test.ts"
    op: create
related:
  - ref: "20261011/Bugs/0000_bug_index-duplicate-chunks-low-value.md"
    kind: "followup"
tags:
  - "watcher"
  - "indexer"
  - "planner"
  - "automation"
  - "mcp-tool"
---
[x] 앱 결함 4건 — 사라진 폴더 유령 색인 · 늦게 생긴 .gitignore · 플랜 앵커 이중 · 자동화 날짜 UTC

병렬 레인 C (Opus 5.5 medium, worktree). 어디서 찾았나:
- 로그 집계
- DB 사본: quick_check·FK 는 깨끗하고, 일지·플랜 캐시는 디스크와 일치한다. 결함은 코드 색인 유령 64행이었다.
- `.oculpm` 실데이터: 앵커가 두 번 쓰인 항목 35건

종료 패닉도 찾았지만 레인 B 와 같은 수정이라 합류 때 B 쪽을 남겼다.

## 발생 원인
1. **유령 색인**: 폴더를 옮기거나 지워도 파일마다 Remove 이벤트가 온다는 보장이 없다. 증분 색인은 이벤트가 가리킨 경로만 지웠고, 폴더 이벤트는 `watcher/handle.rs` 5단계에서 버렸다. project 29 의 유령 64행 중 50행이 통째로 사라진 폴더 아래에 있었다.
2. **늦게 생긴 .gitignore 무시**: `watcher/mod.rs` 는 워처가 켜질 때 `.gitignore` 를 한 번만 읽었다. 그 뒤 생긴 `.gitignore` 아래 `.work/` 119파일이 그대로 색인됐다.
3. **앵커 이중**: 에이전트가 `"제목 {#x}"` 로 넘기면 서버가 앵커를 한 번 더 붙였다(plan_create·add_item·rename_item).
4. **자동화 날짜 UTC**: `AutomationTab` 의 `created` 가 `toISOString().slice(0,10)` 이라 KST 09시 전에는 어제였다. `useMemo([])` 로 한 번만 계산하기도 했다. `aiContext.ts` 의 커밋 날짜도 같은 문제였다.

## 해결 방법
1. `Db::delete_files_under` 를 추가했다. char 기반 substr 이라 한국어 경로에서도 맞는다. 디스크에 없는 경로는 그 아래까지 지우고, 사라진 폴더 이벤트는 색인 삭제로 보낸다.
2. prefilter 와 watcher 가 공유하는 `ProjectGitignore` 를 두었다. 루트 `.gitignore` 이벤트가 오면 다시 읽는다.
3. `trailing_anchor`·`strip_own_anchor` 는 자기 앵커만 떼고, 남의 id 참조는 남긴다. 디스크에 이미 있는 35건은 건드리지 않았다.
4. `localIsoDate()`(`src/lib/workday.ts`)를 클릭 시점에 부른다.

## 검증
- 결함별 회귀 테스트(cargo 4·vitest 1)를 두었다. gitignore·앵커 테스트는 수정 전 실패를 확인했다. 합류 브랜치 전 게이트 exit 0.
- **실기기 미확인**: 앱이 도는 중에 폴더를 휴지통으로 보낸 뒤 의미검색에서 빠지는지, `.gitignore` 를 편집한 뒤 새로 무시된 경로가 색인에서 빠지는지 봐야 한다.
- 보류: 남은 유령 14행(Index 레인의 permit 2개가 같은 경로의 Update 와 Delete 를 동시에 돌리는 의심), 외부 에이전트 일지 parse_ok=0 12건(템플릿 예시가 경로 인용을 안 알림 → template_version 필요).