---
schema_version: 1
type: feature
slug: "a2a-phase3-leases"
status: done
difficulty: high
created_at: "2026-09-03T15:00:39+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/a2a/leases.rs"
    op: create
  - path: "src-tauri/src/oculpm/a2a/mod.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related:
  - ref: "20260903/Features_to_add/1452_feature_a2a-phase2-mailbox-tasks.md"
    kind: "followup"
tags:
  - "a2a"
  - "mcp-tool"
---
[x] A2A Phase 3 — 구역 임대, 부딪히기 전에 막는다

## 추가 기능

`a2a::leases` — 에이전트가 파일 glob 으로 작업 구역을 잡고, 겹치면 **선점자와
기한을 알려주며 거절**한다. 이 라운드에서 설계상 "1차 가치"로 잡아 둔 부분이다:
이 저장소에서 실제로 난 사고는 대화 부족이 아니라 충돌이었다(`git add -A` 가
병렬 세션 WIP 를 쓸어간 2d95df8).

`OculpmA2aTrespass` — 남의 구역을 밟았을 때의 경고 이벤트.

## 동작 흐름

**겹침은 넉넉하게 본다.** 두 glob 이 정말 교차하는지는 일반적으로 어려운 문제라,
각 패턴에서 첫 와일드카드 앞의 디렉터리 접두사만 뽑아 비교한다. `src/**/*.rs` 와
`src/**/*.ts` 는 실제로 안 겹치지만 여기서는 겹친다고 본다 — **틀리는 방향을
고른 것**이다. 헛되이 "쓰는 중"이라 하는 것은 불편할 뿐이지만, 안 겹친다고 잘못
말하면 그게 이 기능이 막으려던 사고다.

**확인과 쓰기 사이를 지킨다.** 둘이 동시에 "안 겹친다"를 확인하고 둘 다 쓰면
임대가 겹친 채로 성립한다. 짧은 문지기 파일(`create_new`)로 그 구간만 막고,
10초보다 오래된 문지기는 죽은 프로세스가 남긴 것으로 보고 걷어낸다.

**살아 있는 임대 = 기한 + 주인 생사.** 주인이 참여자 카드를 두었는데 그 카드가
죽었으면 기한과 무관하게 풀린다. 카드가 아예 없는 주인은 기한만으로 판정한다 —
등록을 안 했다는 이유로 남의 임대를 뺏을 수는 없다.

## 위반 감지의 한계를 그대로 적는다

워처는 파일이 바뀐 것은 보지만 **누가 썼는지는 모른다.** 그래서 감지는 에이전트가
스스로 신고한 변경(ACP `session_info_update` 의 파일 변경 보고)에만 건다 — 앱 안
Claude·Codex 는 걸리고, 앱 밖 CLI 세션은 안 걸린다. 그쪽에 임대는 강제가 아니라
합의다. 이것을 감추고 "충돌을 막는다"고 말하면 거짓이 된다.

경고는 **막지 않는다.** 신고는 변경이 끝난 뒤에 오고, 되돌릴지는 사용자의
판단이다(D5 — 승인 없는 자동 행동 없음). 일지 자동 기록도 같은 이유로 안 한다.

## 검증

`cargo fmt --check` 0 · `cargo clippy --all-targets -D warnings` 0 ·
`cargo test` 1274 passed / 0 failed (신설 10: 선점자 통지·같은 주인 재잡기·
보수적 겹침·기한 만료·죽은 주인 해제·미등록 주인 유지·주인만 해제·위반 경로
선별·패턴 탈출 차단·낡은 문지기 돌파) · `pnpm typecheck` 0 · `pnpm test`
159 files 2073 passed · `pnpm lint` 0.

clippy 가 `manual_pattern_char_comparison` 을 잡아 `find(['*','?','[','{'])` 로
고쳤다. 그리고 내 게이트 체인이 `cmd | tail && echo OK` 라 파이프 뒤 성공을
잘못 읽고 있었다 — exit code 를 직접 찍도록 바꿨다.