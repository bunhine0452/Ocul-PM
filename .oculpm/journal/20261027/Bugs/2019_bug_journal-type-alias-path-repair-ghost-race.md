---
schema_version: 1
type: bug
slug: "journal-type-alias-path-repair-ghost-race"
status: done
difficulty: medium
created_at: "2026-10-27T20:19:35+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/frontmatter/repair.rs"
    op: create
  - path: "src-tauri/src/oculpm/frontmatter/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/frontmatter/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher_tasks.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
related:
  - ref: "20261018/Bugs/0114_bug_app-bug-hunt-ghost-index-gitignore.md"
    kind: "followup"
tags:
  - "journal"
  - "frontmatter"
  - "indexer"
  - "watcher"
  - "parser"
  - "mcp-tool"
---
[x] 외부 에이전트 일지 파싱 실패 12건(type 별칭 10 · 경로 인용 2)과 유령 색인 경합 — 읽기 복구 + 경로별 직렬화

## 발생 원인

**파싱 실패 12건.** 10-18 보류 메모는 「템플릿이 경로 인용을 안 알림」이라 했지만, 캐시(`oculpm_journal.parse_ok=0`)를 읽어 보니 원인은 둘이었다.
- 10건(프로젝트 2·3): `type: fix` · `type: feat` — 에이전트가 git 커밋 타입 어휘로 썼다. 프로젝트 3 은 폴더도 `Fix/` 로 만들었다. 파서 `parse_entry_type` 이 규격 5값만 받아 `unknown type` 으로 전체가 `None` 이 됐다.
- 2건(프로젝트 6): `files_touched: - { path: ioreum/src/app/[locale]/guide/content.ts, op: update }` — 플로 매핑 안에서 `[` 는 지시 문자라 serde_yaml 이 `did not find expected ',' or '}'` 로 깨졌다. 이쪽만 10-18 진단과 같다.

**유령 색인 경합.** 증분 색인 레인은 퍼밋 2개다. 같은 파일의 Update 와 Delete 가 **동시에** 돌 수 있어, Update 가 내용을 읽어 임베딩하는 사이 Delete 가 행을 걷고, 그 뒤 Update 의 `upsert_file` 이 행을 되살린다. 10-18 에 남았던 14행의 남은 경로. 오늘 전 프로젝트 `files` 행을 디스크와 대조하니 유령은 0 — 기동 화해가 쓸어 갔지만 창은 그대로였다.

## 해결 방법

- `frontmatter/repair.rs`(새 파일) — 읽기 전용 복구 둘. `parse_entry_type_lenient` 는 규격 값 다음에 별칭(fix·bugfix·hotfix→bug, feat→feature, err→error, refactoring→refactor, docs·test·ci·build·style→chore; `perf` 는 뜻이 갈려 안 받음)을 받고 `(alias)` 경고를 남긴다. `parse_yaml_lenient` 는 YAML 이 깨지면 `repair_unquoted_paths` 로 `path:` 값에 `[ ] { } : #` 가 든 줄만 따옴표로 감싸 **한 번만** 다시 읽고, 성공하면 `yaml repaired` 경고를 남긴다. 디스크는 건드리지 않는다 — `raw_yaml` 은 원문 그대로.
- `COERCION_VERSION` 3→4 — 이미 `parse_ok=0` 으로 굳은 12행이 mtime 이 같아도 한 번 재투영된다.
- 템플릿 master ko/en `template_version` 14→15 — type 줄에 「커밋 타입 fix·feat 가 아니다, 폴더도 Fix/ 가 아니다」, files_touched 에 「경로에 `[ ] { } : #` 가 있으면 반드시 따옴표」 와 예시. 저장소의 AGENTS.md 는 **도는 설치본(v14 템플릿)이 되돌려 놓는다** — 새 빌드가 돌 때 v15 로 올라간다. 손으로 맞추지 않았다.
- `watcher_tasks.rs` — `WatcherTasks::spawn_keyed(lane, key, fut)`: 퍼밋을 받은 뒤 `"<project>:<path>"` 열쇠의 `tokio::sync::Mutex` 를 잡아 같은 경로는 한 번에 하나만 돌고, 끝난 열쇠는 표에서 거둔다. 증분 색인·일지 색인 둘이 쓴다. 직렬화는 겹침을 막지 순서를 되돌리지 않으므로 `reap_if_vanished` 가 저장 직후 파일이 디스크에 없으면 방금 쓴 행을 걷는다.
- `frontmatter/mod.rs` 는 래칫 800줄에 걸려(917) 복구 로직을 전부 `repair.rs` 로 옮겨 799 로 되돌렸다.

## 검증

- 새 테스트 5: 별칭 4종+`perf` 거부, 실제 프로젝트 6 의 frontmatter 그대로 복구(원문 보존 확인), 복구가 손대지 않는 경우 3, 같은 열쇠는 겹치지 않고 다른 열쇠는 퍼밋 2개를 다 쓴다(열쇠 회수까지), 사라진 파일의 행만 걷는다.
- `cargo fmt --check` · `cargo clippy --all-targets --locked -D warnings`(manual char comparison 1건 고침) · 대상 모듈 63 테스트 · `pnpm lint`(파일 크기 래칫 포함) 통과. 전체 `cargo test --locked` 는 커밋 전 확인.
- 캐시 재투영은 설치본이 새 빌드로 기동할 때 일어난다 — 그 뒤 `parse_ok=0` 이 0 이 되는지가 실기기 확인 항목.