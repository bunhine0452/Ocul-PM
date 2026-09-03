---
schema_version: 1
type: feature
slug: "ledger-chain-and-tri-state-liveness"
status: done
difficulty: high
created_at: "2026-09-03T17:32:33+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/chain.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/tasks.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/registry.rs"
    op: update
  - path: "src-tauri/src/oculpm/a2a/leases.rs"
    op: update
  - path: "src-tauri/src/commands/a2a.rs"
    op: update
  - path: "src/features/today/A2aCard.tsx"
    op: update
  - path: "src/__tests__/a2a_card.test.tsx"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1706_feature_untrusted-text-framing.md"
    kind: "followup"
tags:
  - "a2a"
  - "integrity"
  - "hash-chain"
  - "liveness"
  - "buzz-borrows"
  - "mcp-tool"
---
[x] 원장은 손을 탄 것을 말하고, 생존 판정은 모른다고 말한다

## 추가 기능

`block/buzz` 의 `crates/buzz-audit` 해시 체인과 `docs/agent-availability.md` 의 "모름은 오프라인이 아니다" 규율을 가져왔다 (논의 `.oculpm/discussion/buzz-borrows/discussion.md` F3·F5). 두 결함이 같은 뿌리를 갖고 있었다 — **원장도 판정도 자기가 모르는 것을 아는 척했다.**

1. **원장** — `append_ndjson` 은 O_APPEND 라 줄이 유실되지 않는다. 그것뿐이었다. 중간 줄을 지우거나 내용을 고쳐도 남는 흔적이 없었다.
2. **생존 판정** — `is_live` 가 `bool` 이라 "판정할 수 없다"를 적을 자리가 없었다. 모름이 전부 죽음으로 흘렀고, 그 값을 `registry::sweep` 과 `leases::expired` 가 읽었다. **살아 있는 세션의 작업 구역을 뺏는 길**이 열려 있었다.

새로 생긴 것: `src-tauri/src/oculpm/chain.rs` (해시 체인 · 검증기), `registry::Liveness` 3상태.

## 동작 흐름

**체인** — 원장 줄마다 자기 digest(`hash`)와 앞 줄의 digest(`prev`)를 싣는다. blake3 는 이미 의존성에 있었다.

- **canonical JSON**(키 정렬) 위에서 해시한다. 필드 순서에 의존하면 구조체를 리팩터하는 순간 과거 원장이 전부 깨진다.
- 직렬화 실패는 빈 값으로 대체하지 않고 **에러로** 올린다.
- `seq`(줄 자리)와 **binding**(task id)을 해시에 넣는다. binding 에 절대경로를 쓰지 않은 이유는 프로젝트 폴더를 옮기는 순간 멀쩡한 원장이 통째로 붉어지기 때문이다. task id 는 타임스탬프 + UUIDv4 라 사실상 유일하면서 위치와 무관하다.
- `hash`·`prev` 는 `TaskEvent` 구조체가 아니라 **직렬화된 값에** 얹는다. 접는 쪽(`read`)은 serde 가 모르는 필드를 흘려보내므로 사슬을 알 필요가 없고, 사슬을 아는 자리가 `append_event` 하나로 남는다.

**buzz 의 타임스탬프 함정은 우리에게 다른 모양이었다.** 저쪽은 Postgres TIMESTAMPTZ(μs)와 in-memory 나노초가 갈려 쓸 때와 읽을 때의 프리이미지가 달라졌다. 우리 `at` 은 처음부터 문자열이라 그 갈림이 없다 — 대신 규율은 **"디스크에 적힌 문자열을 그대로 해시하고 `DateTime` 을 다시 직렬화하지 않는다"** 가 됐고, 나노초 회귀 테스트로 고정했다.

**갈래를 변조라고 부르지 않는다.** 두 프로세스가 같은 순간에 덧붙이면 둘 다 같은 `prev` 를 보고 쓴다. 줄은 안 잃지만 사슬은 갈라진다. 이때 뒤 줄의 `prev` 는 **앞선 어느 줄의 digest 와는 맞는다** — 그 사실로 갈래와 삭제를 가른다. 동시 쓰기의 흔적을 "누가 원장을 고쳤다"고 말하는 것은 거짓 고발이다.

**3상태** — `Liveness { Live, Dead, Unknown }`. 모름이 나오는 자리는 셋이다: 윈도우(값싼 pid 확인 수단이 없다 — 예전에는 무조건 `true` 였다), 하트비트 시각을 못 읽은 카드, `kill(2)` 가 `ESRCH`·`EPERM` 도 아닌 오류를 낸 경우. `sweep` 둘은 이제 **`Dead` 만** 걷는다. `is_live` 는 "확실한 근거"를 요구하는 자리용으로 남기되, 청소하는 쪽이 그 부정을 쓰면 안 된다는 것을 문서에 박았다.

**화면** — `a2a_overview` 가 참여자를 `{card, liveness}` 로 주고 **죽은 것만** 뺀다. 판정 불가는 목록에 남아 회색 「판정 불가」 배지를 단다 — 목록에서 지우면 사용자가 "없다"고 읽는다. 무결성은 깨진 원장만 줄 번호와 이유로 보여주고, 사슬 이전 원장은 한 줄로 세기만 한다(초록불은 아무도 안 읽는다). 고치라고 하지 않는다 — 사람이 손으로 고친 것일 수 있다.

## 검증

- Rust 순수 함수 8 (`chain.rs`) — 정상 / 중간 줄 삭제 / 내용 수정 / 남의 원장에서 복사 / 갈래 / 사슬 이전 / 나노초 / canonical 정렬.
- 프로덕션 시임 3 (`tasks.rs`) — `create`·`advance` 로 **실제로 쓴** 원장이 검증되고, 손으로 고치면 그 줄에서 잡히고, 옛 원장은 "깨짐"이 아니라 "판정 불가"이면서 여전히 읽힌다.
- 3상태 2 (`registry.rs`) + 임대 1 (`leases.rs`) — 판정 불가 카드가 지워지지 않고 **그 임대도 걷히지 않는다**. 이 보장이 이 라운드의 이유다.
- 프런트 2 (`a2a_card.test.tsx`) — 판정 불가 배지, 무결성 행(줄 번호·이유)과 옛 원장 집계.
- 게이트 전부 직접 확인 — `cargo fmt --check` · `cargo clippy --all-targets -D warnings` · `cargo test`(1234 lib, 0 실패) · `pnpm typecheck` · `pnpm test`(161파일 2086) · `pnpm lint` · `pnpm build` 모두 exit 0.

## 메모

`ChainBreak.reason` 을 태그된 enum(`Forked { from_line }`)으로 두었더니 두 가지가 터졌다 — ① `ChainStatus` 가 이미 `kind` 로 태그를 쓰고 있어 한 오브젝트에 `kind` 가 두 번 났고, ② `skip_serializing_if` 를 붙이자 specta 가 직렬화/역직렬화 타입을 둘로 쪼개 프런트 타입이 외부 태그 형태로 바뀌었다. 평평한 `reason` + `forked_from_line: Option<u32>`(스킵 없이 `null` 그대로)로 두 문제가 같이 사라졌다. 코드 주석에 이유를 남겼다.