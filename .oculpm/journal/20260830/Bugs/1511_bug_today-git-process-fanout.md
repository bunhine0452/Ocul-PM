---
schema_version: 1
type: bug
slug: today-git-process-fanout
status: done
created_at: 2026-08-30T15:11:00+09:00
session_id: "manual-20260830-151100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src/features/today/useTodayMonitor.ts
    op: update
  - path: src-tauri/src/git.rs
    op: update
  - path: src-tauri/src/commands/git.rs
    op: update
related: []
tags: [performance, today, git, polish-round]
---

[x] Today 를 열 때마다 git 프로세스 ~15개가 떴다 — 모니터 이중 조회 + 호출마다 저장소 루트 재해석 + 워커 위 동기 실행

## 발생 원인

1. `useTodayMonitor.refresh` 의 deps 에 `totalEntriesFromBrief` 가 있어 brief 가 도착하면 함수 identity 가 바뀌고 `useEffect(() => refresh(), [refresh])` 가 다시 돌았다 — `listSessions + gitHeadStatusBrief + gitLog(50)` 을 마운트에 2번, 일지 이벤트마다 2번.
2. `git.rs primary_repo` 가 호출마다 `discover_repos → rev-parse --show-toplevel`(중첩 저장소면 디렉터리 걷기까지) 을 다시 돌렸다. `head_status_brief` 3 + `log` 2 + `graph` 2 프로세스의 절반이 이 재해석.
3. `commands/git.rs` 의 4 커맨드가 `async fn` 안에서 `Command::output()` 을 동기로 불러 런타임 워커가 호출마다 5~80ms 멈췄다(`git_line_changes` 만 `spawn_blocking`).

## 해결 방법

- `totalEntries` 는 refresh 밖에서 `useMemo` 로 합성 — deps 에서 뺐다.
- `primary_repo` 에 프로젝트 루트별 30초 TTL 캐시(`LazyLock<Mutex<HashMap>>`). TTL 인 이유: 나중에 `git init` 한 프로젝트가 영원히 "저장소 아님" 으로 남지 않게.
- `git_log/graph/status/head_status_brief` 를 `blocking()` 헬퍼(`spawn_blocking`) 로.

## 검증

`cargo test` 869 · 프런트 게이트 4종 exit 0. 실기기 계측(Today 진입 시 `ps`/`fs_usage` 로 git 프로세스 수) 은 앱 꺼진 뒤 몰아서.
