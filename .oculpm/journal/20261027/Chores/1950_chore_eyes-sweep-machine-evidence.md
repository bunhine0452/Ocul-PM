---
schema_version: 1
type: chore
slug: "eyes-sweep-machine-evidence"
status: done
difficulty: low
created_at: "2026-10-27T19:50:28+09:00"
session_id: "20261027-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md"
    kind: "followup"
tags:
  - "polish"
  - "planner"
  - "verification"
  - "mcp-tool"
---
[x] 확인 날 1차 — 육안 대기 28건 중 기계 증거로 4건 닫고 6건에 사전 조사 메모

## 변경 요약

육안 확인 대기(`{#eyes-…}`) 28건을 설치본(3.14.0, pid 60386)의 로그·프로세스·키체인·설정 DB·라이브 사이트로 대조했다. 사람 눈이 꼭 필요한 것과 기계가 답할 수 있는 것을 갈랐다.

**닫음 (4):**
- `bug-opt #eyes-quit-panic` — lifecycle.rs:335 패닉은 10-14 · 10-17(수정 전)이 마지막, 10-18~27 업데이트 5회·종료 여러 번에 0건. rust-analyzer 고아 없음.
- `optimize #eyes-sqlite353` — 837MB DB 로 3.13.6~3.14.0 기동, vec0 repacked 10-24 · 10-27, sqlite ERROR 0.
- `artifact-board #eyes-keychain` — `security find-generic-password` 없음, 키체인 덤프 notion 0, settings `notion_retired=1`.
- `improvement #eyes-en-surfaces` — /en/keynote 200 `lang="en"`, /en/plugin 200.

**부분 확인 → 메모 (6):**
- `#eyes-vec0` repack 은 매번 찍힘, compact 는 아직(DB 837+67MB WAL). `#eyes-restart` 네 번 교체·재기동 성공, 트레이·창 복원은 눈. `#eyes-round-0914` 로그 ANSI 0 · oculpm-mcp 프로젝트당 1.
- `#eyes-acp` **발견**: app-data/acp 어댑터가 0.81.0 · 1.8.0 으로 핀(0.93.0 · 1.13.1)보다 낡다 — 10-24 이후 ACP 로그가 없어 화면을 한 번도 안 열었을 뿐. 첫 열기가 곧 확인.
- `#eyes-ptyhost-clone` **발견**: 도는 호스트(pid 90019)는 10-24 10:49 기동 — 3.13.5 이전 옛 호스트가 아직 살아 있고 `ptyhost.noindex/` 없음(복제는 새 호스트가 뜰 때라 정상). 터미널 전부 닫기 → 새 호스트가 확인 순서. 이 호스트는 [[ptyhost-outlives-tcc-grants]] 의 EPERM 케이스이기도 하다.
- `#eyes-plugin-root` 이 기기 플러그인은 project 스코프 3.3.0, 캐시 최신 3.13.2. 3.13.6+ 로 올린 뒤 `/oculpm:board` 1회.

**남은 눈 (18):** 터미널 fit·WebGL·하단 줄·밀도(bug-opt 3, improvement 1), 드래그 7건, Claude 연동 5건, 첫 실행 마법사, 보안 라운드 실기기, 버그 헌팅 0922, compact 정리, 트레이·포커스·UI 모양·걷은 자리·worktree 색인(optimize 5), 보드 폰, 크롬 16화면. 전부 손과 눈이 필요하다.

## 검증

- 기계 확인은 각 플랜 로그 메모에 명령·수치를 그대로 적었다(plan_update). 이 일지의 숫자는 모두 2026-10-27 19:40~20:00 KST 실측.
- 앱이 도는 중이라 DB 는 `?mode=ro&immutable=1` 로만 읽었다.