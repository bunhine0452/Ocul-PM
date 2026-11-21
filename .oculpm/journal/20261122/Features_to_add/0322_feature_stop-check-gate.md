---
schema_version: 1
type: feature
slug: "stop-check-gate"
status: done
difficulty: high
created_at: "2026-11-22T03:22:19+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/verdict/check.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/transcript.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/collect.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/cli.rs"
    op: update
  - path: "src-tauri/src/oculpm/verdict/mod.rs"
    op: update
  - path: "src-tauri/src/bin/oculpm_mcp.rs"
    op: update
  - path: "plugin/oculpm/hooks/delivery-gate.sh"
    op: update
  - path: "plugin/oculpm-codex/hooks/delivery-gate.sh"
    op: update
  - path: "src-tauri/tests/delivery_gate.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
related:
  - ref: "20261122/Bugs/0310_bug_windows-plugin-mcp-launch.md"
    kind: "followup"
tags:
  - "게이트"
  - "판정"
  - "플러그인"
  - "mcp-tool"
---
[x] 게이트: 판정 없이 닫은 대화를 짚는다

## 추가 기능

Stop 훅이 「일지가 있는가」 에 더해 「확인 명령을 돌렸는가」 를 대화당 한 번 묻는다. 이 대화가 `plan_update` 로 계획의 항목을 닫았는데(`done`) 그 계획에 확인 명령이 있고, 이 대화가 그 계획에 판정(`판정 ✓|✗ …`)을 한 번도 남기지 않았으면 턴을 한 번 막고 「확인 명령을 돌리고 끝 줄을 plan_update note 에 남겨라, 못 돌리면 까닭을 적어라」 고 말한다. 여태 판정은 `AGENTS.md` §1 의 문장에만 걸려 있었다 — Lydia Hallie 발표(「확인은 훅 · 테스트 · CI 가」)와 사용자의 exit 1 대 exit 2 실험이 짚은 자리다.

앱은 확인 명령을 돌리지도 결과를 읽지도 않는다. 짚기만 한다.

## 동작 흐름

- `verdict/transcript.rs` 가 트랜스크립트를 **한 번** 읽어 편집 대상과 oculpm 의 `plan_update` 호출(성공한 것만)을 함께 낸다(`Transcript`). 도구 호출이 없는 줄은 JSON 으로 뜯지 않는다.
- `verdict/check.rs` 가 판정한다. 근거는 그 대화 자신의 트랜스크립트(1차 출처)이고 덜 붙잡는 쪽으로만 틀린다: 트랜스크립트가 없거나, 계획에 확인 명령이 없거나, 계획이 진행 중이 아니거나, 이 대화가 시작한 뒤 누구든(서브에이전트 · 옆 대화) 판정을 남겼으면 침묵.
- `oculpm-mcp gate` 가 배달 판정과 확인 판정을 한 프로세스에서 낸다(10 배달 · 12 확인 · 13 둘 다). 둘이 함께면 전문도 한 번에 나가 턴을 두 번 쓰지 않는다. 이미 뜬 게이트는 훅이 `--skip-…` 로 알리고, 배달 판정을 건너뛰면 `git status` 도 안 돈다.
- `delivery-gate.sh` 는 게이트마다 대화당 1회 플래그를 따로 둔다(`.delivery-gate-<id>` · `.check-gate-<id>`). 앱이 옛 판이라 `gate` 를 모르면(사용법 오류 2) 예전 `verdict` 로 물러나 배달 게이트를 그대로 지킨다. Codex 판 훅은 같은 파일이다.

## 검증

- `cargo test --locked --test delivery_gate`: `test result: ok. 17 passed; 0 failed` (훅을 Git Bash 로 실제 실행 — 확인 게이트 5건 · 옛 바이너리 폴백 1건 포함)
- `cargo test --locked --lib verdict`: `test result: ok. 68 passed; 0 failed`
- `cargo clippy --locked --all-targets -- -D warnings`: 경고 없이 `Finished`
- 이 대화의 트랜스크립트(4.4MB)로 잰 한 턴: 설치본 4.11.2 `verdict` 0.592 s → 새 `gate`(디버그 빌드, 두 판정) 0.400 s · 배달 게이트가 이미 뜬 뒤(`--skip-journal`) 0.080 s

## 메모

macOS · Linux 에서는 못 돌렸다(CI 가 본다). 실제 Claude Code 세션에서 게이트가 뜨는 것은 새 앱을 깐 뒤에야 볼 수 있다 — 지금 설치본은 4.11.2 라 `gate` 를 모르고, 그 경우의 폴백은 테스트가 가짜 옛 바이너리로 잰다.