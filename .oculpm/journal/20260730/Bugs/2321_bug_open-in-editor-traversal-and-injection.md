---
schema_version: 1
type: bug
slug: "open-in-editor-traversal-and-injection"
status: done
difficulty: high
created_at: "2026-07-30T23:21:47+09:00"
session_id: "mcp-20260730-232147"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/commands/project.rs"
    op: update
related: []
tags:
  - "security"
  - "path-traversal"
  - "shell-injection"
  - "editor"
  - "mcp-tool"
---
[x] open_in_editor 경로 탈출·셸 주입 — 홈 밖 파일 열기와 명령 치환이 가능했다

## 발생 원인

터미널 출력의 `file:line` 을 ⌘클릭으로 열려면 **터미널이 뱉은 문자열을 경로로** `open_in_editor` 에 넘겨야 한다. 붙이기 전에 이 커맨드를 읽어보니 구멍이 두 개 있었다.

**1) 경로 탈출** — `root.join(&rel_path)` 이 전부였다.

- `../../.ssh/id_rsa` → 프로젝트 밖 파일이 그대로 열린다.
- 절대경로는 더 나쁘다. `Path::join` 은 인자가 절대경로면 **base 를 통째로 버린다** — `/etc/passwd` 를 주면 root 가 무시되고 그대로 열린다.

같은 파일의 `read_project_file`·`read_file_range` 는 이미 `secure_join` 을 쓰고 있었는데 이 경로만 빠져 있었다.

**2) 셸 주입** — `substitute_path` 가 경로를 큰따옴표로 감싸고 `"` 만 이스케이프한 뒤 `sh -c` 로 넘겼다. 큰따옴표 안에서는 `$`·백틱·`\` 가 여전히 특별하다.

- `/tmp/$(id).rs` → `id` 가 **실행된다**.
- `` /tmp/`whoami`/x.rs `` → 마찬가지.
- `\` 로 끝나는 경로는 닫는 따옴표를 먹어 인용이 통째로 깨진다.

두 구멍 모두 지금까지는 경로 출처가 앱 내부(diff 화면·코드 맵 노드)여서 실질 위험이 낮았다. 터미널 링크를 붙이는 순간 출처가 **신뢰할 수 없는 외부 텍스트**가 되므로, 링크보다 먼저 닫아야 했다.

## 해결 방법

- `project::secure_join` 을 `pub(crate)` 로 올려 `external_editor` 가 같은 함수를 쓰게 했다. 방어를 복제하면 한쪽만 고쳐지고 다른 쪽이 남는다. `..` 과 절대경로 둘 다 이 함수가 막는다(`clean_path` 후 `starts_with(root)`).
- 인용을 **POSIX 작은따옴표**로 바꿨다 — `'…'` 로 감싸고 내부의 `'` 만 `'\''` 로 끊는다. 작은따옴표 안에서는 어떤 문자도 특별하지 않아 `$(...)`·백틱·`\`·`"` 가 한 번에 닫힌다.
- 프런트에서도 절대경로·`..`·URL 스킴은 애초에 링크로 만들지 않는다. 클릭했는데 백엔드가 거절하는 링크는 UI 로서 거짓말이다.
- `%line` 자리표시자를 추가하면서 `code -g "%path:%line"` 처럼 경로와 줄이 한 토큰인 형태를 통째로 인용하게 했다 — 따로 인용하면 `'…':42` 가 되어 깨진다.

## 검증

- 회귀 테스트 10건 추가(`external_editor.rs`): 명령 치환·백틱·후행 역슬래시·작은따옴표 포함 경로가 전부 리터럴로 남는지, `%line` 4가지 형태(`"%path:%line"` / `%path:%line` / 줄 없음 / 분리된 `%line`)가 의도대로 나오는지.
- 프런트 스캐너 테스트 14건: `../../.ssh/id_rsa.pub` · `/etc/passwd.bak` · `C:/Windows/system.ini` · `https://…/app.js` 가 링크로 만들어지지 않는다.
- `cargo test` 431 passed / 0 failed, `vitest` 332 passed. 커밋 `d7fd19c` 를 분리 worktree 에서 재확인.
- 실제 악성 경로를 앱에서 클릭해 보는 실기기 확인은 안 했다 — 단위 테스트 수준의 검증이다.