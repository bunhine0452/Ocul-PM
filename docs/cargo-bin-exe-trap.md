# `cargo check`/`clippy` 가 `target/debug/<bin>` 을 자리표시자로 덮는다

`{#cargo-bin-exe-trap}` — 3차 병렬 라운드(v3-release 플랜)에서 처음 발견됐고,
코드로 막을 방법이 없어(Cargo 자체의 동작) 문서로만 다룬다. **지금은 무해하다**
— 이 트랩을 밟는 `CARGO_BIN_EXE_*` 테스트가 아직 없다. 다음에 그런 테스트를
쓰려는 사람을 위한 메모.

## 증상

`[[bin]]` 이 둘 이상인 크레이트(이 저장소는 `ocul-pm` 메인 바이너리 +
`oculpm-mcp`)에서, 정상적으로 링크된 실행파일이 있는 상태에서 `cargo check`
또는 `cargo clippy --all-targets -- -D warnings` 를 돌리면 `target/debug/<bin>`
이 **0바이트·실행 권한 없는(`rw-r--r--`) 파일**로 바뀐다. 그 경로를 직접
실행하면:

```
$ target/debug/oculpm-mcp
permission denied: target/debug/oculpm-mcp   # 셸에 따라 "Permission denied (os error 13)" / EACCES
```

Rust 테스트가 `env!("CARGO_BIN_EXE_<name>")` 로 이 경로를 받아
`std::process::Command::new(path).spawn()` 하면 같은 에러(`EACCES`)로 죽는다.
`cargo test` 자체는 영향이 없다 — 걸리는 건 그 실행파일을 **경로로 직접
스폰하는** 테스트뿐이다.

## 재현 절차

1. `cargo build` (또는 `cargo build --bin <bin>`) 로 정상 실행파일을 만든다 —
   실행 권한(`rwxr-xr-x`)이 있고 크기가 0이 아님을 확인.
2. 같은 target dir 에서 `cargo check` 또는
   `cargo clippy --all-targets -- -D warnings` 를 돌린다.
3. `ls -la target/debug/<bin>` 으로 다시 본다 — 0바이트 · 실행권한 없음으로
   바뀌어 있다.

3차 라운드에서 재현 2/2. 이번(4차) 라운드에서도 같은 증상을 다시 봤는데,
이번엔 직접 `cargo check`/`clippy` 를 돌려서가 아니라 **같은 worktree 를 공유한
다른 병렬 레인이 그 사이에 `cargo`(build/check/clippy 무엇이든)를 돌리고
있어서**였다 — 즉 이 트랩은 "내가 방금 그 커맨드를 쳤을 때" 만이 아니라
**같은 `target/` 디렉터리를 공유하는 cargo 프로세스들 사이에서도** 일어난다.
병렬 세션·CI 매트릭스처럼 `target/` 을 공유하는 모든 상황이 후보다.

내부 메커니즘(Cargo 가 왜 이 경로에 0바이트를 쓰는지)은 확인하지 않았다 —
`check`/`clippy` 는 링커를 돌리지 않으니 최종 실행파일을 만들 이유가 없는데도
그 자리의 기존 파일을 건드린다는 점만 재현으로 확인했다. 짐작으로 원인을
적기보다 재현 절차와 회피책에 집중한다.

## 회피책

- **가장 안전한 패턴 — 테스트 실행 파일 자기 재진입.** 별도 `[[bin]]` 을 열어
  스폰하는 대신, 테스트 바이너리 자신을 환경변수/인자로 분기해 "자식 모드"로
  재실행한다:
  ```rust
  if std::env::var("MY_TEST_CHILD").is_ok() {
      // 자식 모드 — 여기서 실제로 하려던 일을 한다.
      return;
  }
  let exe = std::env::current_exe().unwrap(); // 테스트 바이너리 자신
  Command::new(exe).env("MY_TEST_CHILD", "1").spawn()...
  ```
  `current_exe()` 는 `cargo test` 가 이미 링크해 둔 테스트 바이너리를 가리켜서
  `cargo check`/`clippy` 가 건드리는 `target/debug/<bin>` 과 별개 경로다.
- 정 별도 `[[bin]]` 을 경로로 스폰해야 한다면, 그 테스트 스위트 진입부에서
  `cargo build --bin <name>` 을 픽스처 셋업으로 한 번 더 강제해 링크를
  되채운 뒤 스폰한다.
- CI 에서는 `cargo check`/`clippy --all-targets` 스텝과, 그 바이너리를 경로로
  스폰하는 테스트 스텝을 **같은 `target/` 을 공유하지 않게** 분리한다
  (`CARGO_TARGET_DIR` 로 격리하거나 스텝 순서를 바이너리 스폰 테스트 마지막에
  둔다).
- 로컬에서 이미 이 파일을 만났다면 지우거나 손댈 필요 없다 —
  `cargo build --bin <name>` 을 다시 돌리면 링크가 다시 채운다.

## 지금 무해한 이유

이 저장소에 `CARGO_BIN_EXE_*` 를 쓰는 테스트가 없다(전수 검색 0건, 2026-09-07
기준). `oculpm-mcp` 같은 두 번째 `[[bin]]` 은 있지만 아직 테스트가 그 경로를
직접 스폰하지 않는다. 다음에 그런 테스트(예: MCP 서버 프로세스를 실제로 띄워
보는 통합 테스트)를 추가하는 사람이 이 문서의 대상이다.
