---
schema_version: 1
type: bug
slug: honesty-audit-false-positives
status: done
difficulty: high
created_at: "2026-08-20T23:55:15+09:00"
session_id: "manual-20260820-235515"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/paths.rs"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/features/today/HonestyAudit.tsx"
    op: update
  - path: "src/__tests__/honesty_audit.test.tsx"
    op: create
related: []
tags: [honesty-audit, compare-layers, watcher, dogfooding]
---

[x] 정직성 감사가 기록된 파일까지 「미기록」으로 외치던 오탐 — 60건 중 진짜는 3건

## 발생 원인

Today 화면의 정직성 감사가 오늘 세션 3개에 걸쳐 60개 파일을 「심각 · 기록 안 함」으로
표시했다. 실제로 일지에 안 적힌 건 3개뿐이었다. 원인이 세 겹으로 쌓여 있었다.

**1. session_id 방언 불일치 (주범, 오탐 57건 중 대부분).**
`compare_layers` 는 일지를 `j.session_id = ?2` 로 **완전 일치** 조인한다
(`cache.rs` `files_for_session`). 그런데 watcher 가 찍는 ID 는 `20260820-002` 형식이고,
에이전트가 일지에 적는 ID 는 `manual-20260820-205400` 형식이다 — AGENTS.md 가
"없으면 `manual-<workday>-HHMMSS`" 를 허용하고, MCP 도구 없이 파일을 직접 쓰는 경로에서는
watcher 의 세션 번호를 알 방법이 없기 때문이다. 두 집합이 영원히 안 겹치니
`journal_set` 이 **항상 공집합**이 되고 `only_in_index = index_set - ∅ = 전부`가 됐다.
오늘 일지 13개 전부 `manual-` 방언이었고, 세션 002·004 는 실제 커버리지 100% 인데도
11개·14개 전량이 미기록으로 보고됐다. `sessions.json` 의 `linked_journal_entries` 가
5개 세션 모두 `[]` 인 것도 같은 뿌리.

**2. macOS 샌드박스 임시파일이 노이즈 필터를 통과.**
`landing/shots/03-diff.jpg.sb-0aaecef3-EzZZ48` 같은 `<name>.sb-<hex>-<rand>` 파일은
샌드박스 앱(Preview·sips)이 제자리 재작성할 때 만드는 것으로, 밀리초 단위로 생겼다 사라지고
git 에도 안 들어간다. 그런데 `is_self_suppressed`/`is_noise_path` 는 `.tmp`·`.swp`·`~`·
`.DS_Store` 모양만 알아서 이 형태를 못 잡았다.

**3. 접두사 검사라 중첩 경로가 새어나감 + 디렉터리 삭제 이벤트가 유령 파일로 기록.**
자기억제와 에이전트 상태 필터가 전부 `starts_with(".oculpm/")` / `starts_with(".claude/")`
루트 접두사만 봤다. 그래서 `docs/acp-panel/spike/.oculpm/hooks/claude-events.jsonl`
(다른 프로젝트의 기계 생성물)이 그대로 통과했다. 게다가 watcher 5단계의
`path.is_dir()` 가드는 **이미 삭제된** 디렉터리에 대해 false 를 반환하므로,
`docs/acp-panel/spike/.oculpm` 라는 디렉터리 삭제 이벤트가 파일인 척 ndjson 에 들어갔다.

## 해결 방법

**정직성 판정을 워크데이 커버리지로 전환 (주범).** "어떤 일지든 이 파일을 적었는가?" 는
세션이 아니라 워크데이 단위 질문이다. `cache::files_for_workday` 를 추가하고
(`idx_oculpm_journal_workday` 사용), `LayerComparison` 에 `unrecorded` +
`unrecorded_severity` 두 필드를 새로 넣었다. `unrecorded = index_set - 워크데이_일지_합집합`
이라 session_id 방언에 아예 면역이다. severity 는 jaccard 가 아니라 **커버리지**로 계산한다 —
일지는 이 세션이 안 건드린 파일도 정당하게 언급하므로 일지 쪽을 감점 요인으로 세면 안 된다.

기존 `only_in_index`/`jaccard_index` 는 계약을 그대로 뒀다. 세션 정밀 비교는 에이전트가
watcher 방언을 쓸 때 여전히 유효한 신호이고, 백엔드 인트로스펙션이 그걸 읽는다.
UI(`HonestyAudit.tsx`)만 `unrecorded` 로 갈아탔다.

**공유 노이즈 판별을 `paths.rs` 로 추출.** watcher(캡처 시점)와 manager(과거 ndjson 비교
시점)가 반드시 대칭이어야 해서 — 한쪽만 고치면 규칙 생기기 전에 쌓인 ndjson 이 계속
「누락」을 외친다 — `is_macos_sandbox_temp` · `is_nested_oculpm_path` ·
`is_nested_agent_state_path` · `AGENT_STATE_DIRS` 를 한 곳에 두고 양쪽에서 호출한다.
중첩 판별은 세그먼트 경계(`/.oculpm/` 또는 `/.oculpm` 로 끝남)를 보므로 루트 `.oculpm/journal/**`
(진짜 사용자 콘텐츠)는 건드리지 않고 `src/oculpm.rs` 같은 이름만 비슷한 파일도 안 걸린다.

**디렉터리 이벤트는 notify 가 말해주는 것만 믿는다.** `is_directory_event` 를 추가해
`RemoveKind::Folder`/`CreateKind::Folder` 를 걸러낸다 (macOS FSEvents 백엔드가
`kFSEventStreamEventFlagItemIsDir` 에서 이 값을 세팅한다). 디렉터리를 지우면 내부 파일마다
Remove 이벤트가 따로 오므로 폴더 이벤트를 버려도 이력 손실이 없다. 경로 모양 휴리스틱은
**의도적으로 안 썼다** — `Makefile`·`LICENSE`·`Dockerfile` 처럼 확장자 없는 진짜 소스가
흔해서, 실제 삭제를 놓치는 쪽이 유령 행 하나보다 나쁘다. 그래서 이벤트 종류를 모호하게
뭉개는 플랫폼에서는 여전히 통과할 수 있다 (남은 천장).

## 검증

`cargo test` 617+52 전부 통과 (신규 백엔드 테스트 6개: `paths.rs` 3개 —
중첩 `.oculpm`/중첩 에이전트 상태/`.sb-` 판별 + 루트·유사이름 반례,
`manager.rs` 3개 — 외래 session_id 일지가 미기록을 만들지 않는지 / 전량 기록 시 침묵하는지 /
노이즈가 `unrecorded` 에 안 들어가는지). `pnpm test` 1080개 통과 — 신규
`honesty_audit.test.tsx` 3개는 컴포넌트를 `only_in_index` 로 되돌리면 2개가 실패하는 것을
직접 확인해 이빨이 있음을 증명했다. typecheck / lint / build 전부 exit 0.

실데이터 대조: 오늘 ndjson + 일지 13개에 새 로직을 그대로 적용하면 미기록이
**60 → 9** 로 줄고, 세션 002·004 는 커버리지 100% 라 카드가 아예 렌더되지 않는다.
남은 9개 중 5개는 이 작업에서 방금 고친 파일들(아직 이 일지를 쓰기 전이었으니 정확한 보고),
4개는 실제로 안 적은 랜딩 스크린샷 교체다.

## 메모

`bindings.ts` 는 `cargo test` 가 재생성했다 (수동 편집 아님).

`only_in_index` 를 지우지 않고 남긴 이유: 필드 계약을 깨면 `oculpm_compare_layers` 를
직접 부르는 외부(플러그인 MCP) 소비자가 조용히 망가진다. 대신 두 필드의 용도를 spec.rs
독주석과 `api/oculpm.ts` 양쪽에 명시했다 — 사용자에게 보이는 것은 `unrecorded` 쪽.

세션↔일지 연결 자체를 고치는 건 별개 작업이다. 근본 해법은 에이전트가 watcher 의 현재
session_id 를 알 수 있게 하는 것(MCP `journal_write` 가 서버에서 채우거나, 훅 인박스가
현재 세션을 노출)이고, 그러면 `linked_journal_entries` 와 `jaccard_index` 도 같이 살아난다.
이번엔 정직성 판정만 방언 독립적으로 만들어 급한 오탐을 껐다.
