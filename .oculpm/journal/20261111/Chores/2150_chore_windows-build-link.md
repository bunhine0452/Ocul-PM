---
schema_version: 1
type: chore
slug: "windows-build-link"
status: done
difficulty: low
created_at: "2026-11-11T21:50:00+09:00"
session_id: "manual-20261111-215000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
related: []
tags:
  - "빌드"
  - "windows"
---
[x] 빌드: lib 은 rlib 만 굽는다

## 내용
`src-tauri/Cargo.toml` `crate-type = ["staticlib", "cdylib", "rlib"]` → `["rlib"]`. staticlib · cdylib 는 Tauri 모바일 템플릿의 몫인데 모바일 타깃이 없다(`gen/` 없음 — `mobile_entry_point` 속성은 그대로 둔다, 컴파일에 지장 없다). 사이드카 스크립트(`scripts/build-sidecar.mjs` 는 `--bin oculpm-mcp`) · CI · tauri 설정 어디도 `ocul_pm_lib.dll`/`.lib` 를 읽지 않는다(검색 0건). 지금까지는 증분 빌드마다 바이너리 둘과 별개로 lib 를 두 번 더 링크했다 — debug `ocul_pm_lib.lib` 394MB · `ocul_pm_lib.dll` 2.3MB.

**하지 않은 것 (측정 · 확인 뒤):**
- `.cargo/config.toml` 의 `linker = "rust-lld"` — 빌드 · 링크는 됐지만 증분 빌드가 빨라지지 않았다(아래 수치). 링커를 바꾸면 내보내는 exe 의 링커도 바뀌고 CI 캐시가 통째로 무효가 되니, 이득이 안 보이는 채로 넣지 않았다.
- `+crt-static` — 아무 일도 안 한다. tauri-build 가 이미 `static_vcruntime` 으로 VC 런타임을 정적으로 링크하고(libcmt + libvcruntime) `/NODEFAULTLIB:libucrt.lib` + `/DEFAULTLIB:ucrt.lib` 로 UCRT 는 OS 것을 쓰게 한다 — crt-static 을 켜도 exe 의 가져오기 목록이 똑같았다(dumpbin). 그래서 넣지 않았다. (재배포 걷기는 따로 — `2200_chore_drop-vcredist`.)
- CI `CARGO_INCREMENTAL=0` — cargo 를 돌리는 Windows 잡은 모두 cargo 단계 앞에 `swatinem/rust-cache` 가 있고, 그 액션이 이미 `CARGO_INCREMENTAL=0` 을 잡 환경에 내보낸다.

## 검증
`CARGO_BUILD_JOBS=3`, `src/db/startup.rs` 를 건드린 뒤 `cargo build`(dev) 한 번씩. 같은 PC 에서 다른 작업 · rust-analyzer 가 함께 돌아 몇 초는 흔들린다.
- 기준 staticlib+cdylib+rlib · link.exe: `Finished ... in 34.26s`
- rlib 만 · link.exe: `Finished ... in 17.80s`
- rlib + rust-lld (+crt-static): `28.51s`, 다시 `19.98s` — link.exe 대비 이득 없음
- rlib 만 · link.exe (설정 걷은 뒤 다시): `40.25s` — 다른 에이전트의 빌드와 겹친 때라 흔들림이 수치보다 크다. 확실한 것은 링크 산출물 둘(394MB staticlib · 2.3MB dll)이 더는 안 생긴다는 것
- `cargo test --no-fail-fast` → 35 묶음 `test result: ok`, 합계 1117 passed · 0 failed
