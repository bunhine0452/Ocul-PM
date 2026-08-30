---
schema_version: 1
type: bug
slug: acp-adapters-orphaned-on-quit
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/acp/process.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
related:
  - .oculpm/journal/20260830/Bugs/1051_bug_pty-kill-was-not-a-kill.md
tags: [acp, process-lifecycle, audit-round]
---

[x] 앱을 끄면 ACP 어댑터(node + 손자 claude)가 고아로 남았다

## 발생 원인

`lib.rs` 의 `ExitRequested` 는 `OculpmManager`(락 해제)와 모바일 브리지만 내렸다. ACP 어댑터는 `Running` 을 떨어뜨리면 연결 태스크의 `stop_rx.await` 가 풀리고 크레이트가 어댑터 프로세스 그룹을 SIGKILL 하는 구조인데, **그 태스크가 돌 시간이 없다** — tao 는 ExitRequested 핸들러가 돌아오면 곧장 `process::exit` 하므로 관리 상태의 Drop 도, 비동기 태스크도 실행되지 않는다. 크레이트 주석 자체가 "stdin EOF 로는 확실히 안 죽는다" 고 적어 두었다. 탭 닫기 쪽 `acpStop` 도 프런트 호출처가 0이라, 어댑터를 내리는 길은 어댑터가 스스로 죽는 것뿐이었다. 실측(2026-08-30 아침): `ps` 에 어제 세션의 `claude-agent-sdk … claude --output-format` 프로세스가 둘 남아 있었다.

## 해결 방법

- `AcpState` 에 `live: AtomicUsize` — 연결 태스크를 spawn 할 때 올리고, 태스크 끝(크레이트가 프로세스를 정리한 뒤)에 내린다.
- 새 `AcpState::stop_all_blocking`: 모든 `Running` 을 떨어뜨리고(싱크·대기 승인 정리 포함 — `stop` 과 같은 경로) `live == 0` 이 될 때까지 **최대 1초** 20ms 간격으로 기다린다. 남은 수는 로그로.
- `ExitRequested` 에서 `manager.shutdown_all_blocking()` 뒤에 호출.

## 검증

`cargo test` 그린(기존 ACP 권한 테스트 포함). 실기기 확인은 앱이 꺼진 뒤 몰아서: 어댑터가 떠 있는 상태로 ⌘Q → `ps aux | grep claude-agent-acp` 가 비어야 한다.

## 메모

- 프로젝트 탭을 닫을 때 유휴 어댑터를 내리는 것(`release_project`)은 `commands/window.rs` 소관인데 그 파일은 병렬 세션(drag-and-drop-round)이 작업 중이라 이번엔 손대지 않았다 — 종료 경로만 막았다.
- 크래시 대비(부모 사망 감시)는 어댑터 래퍼 쪽 일이라 별건.
