---
schema_version: 1
type: refactor
slug: "planner-parallel-write-cas"
status: done
difficulty: high
created_at: "2026-09-05T13:27:54+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/file_guard.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/leases.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/mailbox.rs"
    op: update
  - path: "src-tauri/src/oculpm/agent_cli.rs"
    op: update
  - path: "src-tauri/tests/plan_parallel_write.rs"
    op: create
  - path: "landing/plugin.html"
    op: update
related: []
tags:
  - "플래너"
  - "cas"
  - "병렬세션"
  - "v3"
  - "mcp-tool"
---
[x] 플래너 병렬 쓰기를 CAS 로 — 첫 갱신부터 쓸 수 있는 해시와 크로스프로세스 락

## 동기

`session-shim-cli` 라운드가 `plan_update` 에 `base_hash` 를 **선택 인자**로 넣었는데, 이번 감사에서 그게 실효가 없다는 것이 드러났다. `base_hash` 의 유일한 출처가 **직전 `plan_update` 응답**이라, 세션의 **첫** 갱신은 CAS 사용 자체가 불가능했다 — 그게 가장 흔한 경우다. 게다가 `plan_write_lock` 은 인프로세스라 MCP 서버 프로세스가 다르면 무력했고, 해시 대조와 쓰기 사이에 TOCTOU 창이 열려 있었다.

이 저장소가 실제로 겪은 사고가 이것이다: 두 세션이 같은 플랜 항목을 동시에 고치면 나중 쓴 쪽이 이기고 그 사이 변경이 사라진다.

## 변경 요약

**해시를 발급한다.** `plan_status` 응답의 플랜마다, 그리고 `plan_create` 응답에도 파일 blake3 해시를 실었다. 이제 "방금 읽었다"가 세 곳에서 공짜로 나온다.

**`base_hash` 를 필수화했다.** 하위호환을 깨는 쪽을 골랐다 — 낡은 호출자는 조용히 옛 동작으로 흐르지 않고 멈추며, **오류 문장이 곧 마이그레이션 경로**다(`plan_status` 로 hash 를 읽고 재호출하라). 강제 우회로는 두지 않았다: 우회 플래그가 있으면 계약이 둘이 되고, 마찰을 만나는 쪽은 늘 둘째를 고른다.

누락 오류에는 `write-conflict` 표지를 붙이지 않았다. 종료 코드 5의 뜻("그 사이 남이 고쳤다")을 흐리면 호출자가 "다시 읽고 다시 쓴다"를 판단할 수 없다. 5는 해시 불일치와 락 획득 실패만이다.

**락을 공용화했다.** `a2a/leases.rs`·`a2a/mailbox.rs` 가 각자 쓰던 `create_new` 관용구를 `oculpm/file_guard.rs` 로 뽑았다. `leases.rs` 는 자기 구현을 버리고 이것을 쓴다(두 벌 제거). `mailbox.rs` 는 락이 아니라 그냥 원자적 생성이라 제외하고 사유를 주석에 남겼다. 락 자리는 `.oculpm/planner/.<파일명>.lock` — `.oculpm/index/**` 는 금지 구역이고, `.oculpm/` 바로 아래 새 폴더는 워처 라우팅표에 없어 **코드 변경 ndjson 파이프라인까지 흘러가 변경 원장을 오염**시킨다.

**TOCTOU 는 락 하나로 닫았다.** 읽기 → 잠금판정 → 해시대조 → 쓰기가 한 임계구역에 들어간다. 잠금 판정을 해시 대조보다 앞에 뒀다 — 잠긴 플랜은 어떤 해시로도 못 고치니, 순서가 반대면 "다시 읽고 재시도" 안내를 받고 한 왕복 더 쓴 끝에 같은 거절을 만난다.

`tools/mod.rs` 가 1663→1401줄로 줄고 `plan_ops.rs` 387줄이 생겼다.

## 검증

`mcp::tools` 45, `file_guard` 4, `a2a` 50, `plan_parallel_write` 5 — 전부 통과.

**반증 실험이 결정적이었다.** `plan_guard` 의 락 경로를 호출마다 다르게 만들어 상호배제만 제거하고 동시성 테스트를 돌리니 exit 101, **8개 전이 중 7개 유실**(항목이 `- [ ]` 그대로, plan-log 는 1줄만 남음). 그리고 **어느 스레드도 실패하지 않았다** — 원래 사고의 모습 그대로다. 테스트가 실제로 무는지가 증명됐다. 이후 원복 확인.

## 메모

**`oculpm::reconcile` 이 아직 문지기 밖이다.** 앱 내부 화해기는 여전히 인프로세스 락만 쓰므로, 앱과 MCP 서버가 동시에 같은 플랜을 고치는 창이 남아 있다. 이월.

동시성 테스트는 스레드다(`create_new` 는 스레드·프로세스 모두에 원자적이라 상호배제 자체는 검증됨). 진짜 2-프로세스 테스트는 후속.

`AGENTS.md`·`_template.md` 에 CAS 규칙 한 문단을 넣으려다 되돌렸다 — `master_en` 이 토큰 다이어트 상한 6,100자 중 6,077자로 이미 천장이다. 넣지 않기로 결정했다: §4의 파일 직접 작성 경로는 애초에 `plan_update` 를 안 쓰고, 도구를 쓰는 에이전트는 `required` 를 포함한 스키마를 늘 함께 받으며, 누락 오류가 스스로 복구를 지시한다. 규칙 문서에 한 번 더 적는 건 중복이지 보험이 아니다.

미반영 자리 둘: `src/features/skills/pluginDocs.ts:90`, `mcp/protocol.rs` 의 `MCP_INSTRUCTIONS`.