---
schema_version: 1
type: bug
slug: "macos27-tray-icon-reexec-pidversion"
status: done
difficulty: high
created_at: "2026-09-15T11:48:20+09:00"
session_id: "20260915-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b264922e-7832-4206-995a-f4582387624e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Info.plist"
    op: create
  - path: "src-tauri/src/main.rs"
    op: update
  - path: "src-tauri/src/ptyhost/env.rs"
    op: update
related: []
tags:
  - "tray"
  - "macos27"
  - "malloc"
  - "launchservices"
  - "regression"
  - "mcp-tool"
---
[x] macOS 27 에서 메뉴바 아이콘 실종 — malloc 튜닝 self-exec 가 pidversion 을 바꿔 상태 아이템 씬 배정이 거부됨

## 발생 원인

macOS 27(Golden Gate)로 올린 뒤 설치본 3.1.0 의 메뉴바 아이콘이 사라졌다. `«` 접힘도, 빈 자리도 없이 그냥 없다. 로그·설정(`tray.show_icon=1`)·팝오버 창 생성까지 정상이라 `TrayIconBuilder::build` 는 성공한 상태였다.

macOS 27 은 메뉴바를 창 하나로 합치고(상태 아이템별 창 없음 — `CGWindowList` 에 layer 25 창이 안 보인다) 상태 아이템을 FrontBoard 씬 `com.apple.appkit.status-items` 로 호스팅한다. MenuBarAgent 는 연결해 온 프로세스를 RunningBoard 의 **(pid, pidversion)** 핸들로 찾는다. 우리 앱은 기동 직후 `MallocLargeCache=0` 을 걸려고 자기 자신을 exec 로 다시 띄우는데(`reexec_with_malloc_tuning`, 2026-09-12 최적화 라운드), exec 는 pid 는 지키지만 커널 pidversion 을 올린다. LaunchServices 가 기동 시점에 잡아 둔 핸들과 어긋나 씬 배정이 거부된다:

```
RunningBoardServices: handle <private> has mismatched pid version
FrontBoard: Unable to resolve vpid 7681(v420A): "process has mismatched pid version"
FBWorkspaceDomain: Unable to assign new incoming connection to a process …
```

`0x420A = 16906` 은 `proc_pidinfo(PROC_PIDUNIQIDENTIFIERINFO)` 로 읽은 그 프로세스의 현재 pidversion 과 일치했다. 재현이 늦은 이유: 터미널이 띄운 dev 빌드(프로브)는 RunningBoard 에 기동 핸들이 없어 아이콘이 멀쩡히 떴다. Dock/LaunchServices 로 뜬 프로세스(ppid 1)만 깨진다.

배제한 가설: tray-icon 0.23.1 크레이트(같은 조건의 최소 재현 정상), 활성화 정책 재호출, 번들·서명·hardened runtime, 사용자 DB 상태(16 프로젝트 상태를 복사한 프로브도 정상), `NSStatusItem` 위치 기억.

## 해결 방법

- `src-tauri/Info.plist` 신설 — `LSEnvironment` 로 `MallocLargeCache=0`·`OCULPM_MALLOC_TUNED=1` 을 프로세스 생성 시점에 넣는다. Tauri 가 번들 plist 에 병합한다. LaunchServices 기동은 exec 없이 같은 효과.
- `main.rs`: launchd 자식(ppid 1)에서는 절대 exec 하지 않는다. 판정을 `should_reexec(already_tuned, opted_out, ppid)` 순수 함수로 빼 단위 테스트 2개. LSEnvironment 가 빠진 번들의 실패 모드가 "아이콘 실종" 에서 "튜닝 생략" 으로 바뀐다.
- 설치본에 대한 즉시 우회: `open --env MallocLargeCache=0 --env OCULPM_MALLOC_TUNED=1 -a Ocul-PM` (앱 종료 후).

곁가지로 확인한 macOS 27 메뉴바 사실: 노치 오른쪽 ~925pt 부터가 가시 영역이고 그 안에 못 드는 아이템은 `«` 뒤로 접힌다(Swift 4아이템 실험). 이건 우리 문제와 무관.

## 검증

- 수정본 릴리스 번들을 `open` 으로 기동(ppid 1): `ps -E` 에 `MallocLargeCache=0`·`OCULPM_MALLOC_TUNED=1` 이 실리고 메뉴바에 동심원 아이콘이 떴다. MenuBarAgent 로그에 그 pid 의 mismatch 0건.
- 메커니즘 독립 재현: 상태 아이템 생성 전에 self-exec 만 넣은 Swift 앱을 LaunchServices 로 띄우면 같은 로그와 함께 아이콘이 사라지고, exec 를 빼면 뜬다.
- `cargo test`(main.rs 단위 2 + 나머지 전부 통과; `dap_lldb` 1건은 이 셸의 debugserver TCC 거부로 환경 실패) · clippy `-D warnings` · fmt · `pnpm typecheck/test(2711)/lint/build` 모두 exit 0.