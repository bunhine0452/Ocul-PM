---
schema_version: 1
type: bug
slug: "port-crlf-anchor-rename-paths"
status: done
difficulty: high
created_at: "2026-09-28T22:49:52+09:00"
session_id: "20260928-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/eol.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/parse_tests.rs"
    op: create
  - path: "src-tauri/src/oculpm/planner/plan_edit.rs"
    op: update
  - path: "src-tauri/src/oculpm/discussion/parse.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/git/path_form.rs"
    op: update
related:
  - ref: "20260924/Bugs/0230_bug_port-fs-semantics-lfs.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "windows"
  - "planner"
  - "watcher"
  - "mcp-tool"
---
[x] 플래너·논의·롤업 CRLF 내성 · {#id} 앵커는 줄 끝 · 워처 rename 쌍 · files_touched '/' (L-FS3, PR #55)

## 발생 원인

- **CRLF** — Git for Windows 의 기본값 `core.autocrlf=true` 로 체크아웃하면 `.oculpm/` 파일이 CRLF 가 된다. 플래너·논의·롤업 파서는 `split('\n')` 가정이었다. 롤업은 `---\r\n` 에서 frontmatter 를 못 읽어 목록에서 통째로 사라졌다.
- **앵커** — `extract_id` 가 줄의 **첫** `{#…}` 를 id 로 읽었다. 제목 본문에 `{#id}` 글자가 있으면 id 를 가로챘다(이 라운드 플랜의 `fs-crlf-parsers` 항목이 실제로 id `id` 로 잡혔다). plan_edit 은 부분 문자열로 줄을 찾아서, 제목에 `{#b}` 를 적은 앞 항목이 `b` 대신 뒤집혔다.
- **files_touched** — Windows 에이전트가 `src\a.ts` 를 주면 diff 사이드카 키와 어긋났다.
- **rename 쌍** — 워처가 디바운서의 `Name(Both)[from,to]` 에서 첫 경로만 처리해 새 이름이 빠졌다(양 OS 기존 결함).

## 해결 방법

- `planner/eol.rs` — 읽을 때 LF 로 펴고, 쓸 때 원래 줄바꿈으로 되돌린다. 적용한 곳: plan_edit 11개 · set_plan_status · 로그 아카이브 · 논의 doc_edit 4개 · 롤업 쓰기. 논의 파서는 플래너의 fold·앵커 함수를 공유하게 바꿔 복제를 없앴다.
- `parse::anchor_span` — 메모(`⟶`/`->`) 앞의 마지막 앵커를 읽고, 메모 앞에 없으면 줄 끝의 것을 읽는다. phase·결정 헤더와 plan_edit(`is_item_of`)도 같은 함수를 쓴다.
- `git::touched_path` — 쓰는 순간 정규화한다(Windows 는 `\`→`/`, 루트 안 절대경로는 상대로). MCP `journal_write` 와 수동 일지 작성 둘 다에 적용했다.
- 워처가 이벤트의 모든 경로를 처리하고(from=삭제 · to=생성), 사전 필터도 어느 한쪽이 추적 대상이면 통과시킨다.

## 검증

- CI 전 잡 초록: windows 1990/0, ubuntu 1977/0, 번들·설치 스모크, E2E 양 OS.
- 새 CRLF·앵커·rename·정규화 테스트를 양 러너 로그에서 이름으로 확인했다. PR #55 rebase 병합(3c66848d).
- 한계: rename 테스트의 수정 전 붉음은 따로 보지 않았다. macOS 는 FSEvents 가 쌍을 주지 않는다(후속 `#fs-mac-rename-old-name`).
- 후속 셋은 L-PLAN2 로 넘겼다: `#ext-anchor-rule` · `#plan-add-item-anchored-phase` · `#plan-decisions-heading-mismatch`.