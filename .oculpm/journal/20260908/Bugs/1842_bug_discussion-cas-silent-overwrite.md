---
schema_version: 1
type: bug
slug: "discussion-cas-silent-overwrite"
status: done
difficulty: high
created_at: "2026-09-08T18:42:18+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "faee9c1b-8293-4d9c-8bad-017834dd5425"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/cas.rs"
    op: create
  - path: "src-tauri/src/commands/discussion.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/mobile_bridge/dispatch.rs"
    op: update
  - path: "src/features/discussion/conflict.ts"
    op: create
  - path: "src/features/discussion/useDiscussionSave.ts"
    op: create
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/mobile/tabs/DiscussionTab.tsx"
    op: update
  - path: "src/__tests__/write_conflict_contract.test.ts"
    op: create
  - path: "src/__tests__/discussion_v2.test.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "cas"
  - "discussion"
  - "journal"
  - "data-loss"
  - "mcp-tool"
---
[x] 논의·일지 문서의 조용한 덮어쓰기를 문지기와 CAS 로 닫는다

## 발생 원인

플래너는 병렬 쓰기 사고를 겪고 세 겹을 세웠다 — 인프로세스 락 · 크로스프로세스
`FileGuard` · 필수 `base_hash` (`{#cas-required}` · `{#cas-toctou}`). **논의는 셋 다
없었다.**

`commands/discussion.rs` 의 주석이 그 이유를 이렇게 댔다:

> Single-user tool, so concurrent in-process edits are last-write-wins
> (no separate lock yet — mirrors planner PR-PLN 1).

근거가 둘 다 무너져 있었다. 플래너는 그 뒤로 옮겨 갔고("mirrors" 가 가리키는 곳이
사라졌다), "single-user" 도 세 방향에서 깨졌다 — 바로 두 줄 위가 인정하듯 **외부
에이전트가 같은 `.md` 를 고치고**, 모바일 브리지가 `discussion_write` 를 폰에 열어
두었으며, 멀티 창이라 편집기가 둘일 수 있다.

손실 경로는 프런트가 스스로 벌려 놓았다. `startEdit` 이 본문 스냅숏을 뜨고,
`refreshFromDisk` 가 **편집 중에는 디스크 변경을 일부러 무시하고**(초안을 지키려고),
저장이 그 스냅숏으로 본문을 통째로 덮었다. 그 사이 에이전트가 적은 결론은 오류도
흔적도 없이 사라지고 화면에는 "저장했어요" 가 떴다.

일지(`update_journal_entry_body` 외 3개)도 같은 모양이었다 — 넷 다 파일을 통째로
읽고 한쪽만 바꾼 뒤 통째로 다시 쓴다.

## 해결 방법

두 장치를 `oculpm/cas.rs` 로 끌어올려 세 문서가 **같은 구현**을 쓰게 했다. 해시는
발급하는 자리와 대조하는 자리가 같아야 하고, 문지기는 잡는 자리가 같아야 문지기다.
`plan_ops` 의 `plan_hash` · `acquire_plan_guard` 도 이제 여기로 위임한다.

- **논의**: 모든 read-modify-write 가 읽기 **앞에서** 문지기를 잡는다
  (`write` · `set_status` · `rename` · `promote_to_plan`). 본문을 통째로 갈아 끼우는
  `discussion_write` 는 그 위에 `base_hash` 대조를 얹었다. 해시는 **본문만** 건다 —
  파일 전체를 걸면 `set_status` 가 프런트매터만 고친 것까지 거짓 충돌이 된다.
- **프런트**: `discussion_read_raw` 가 `{body, hash}` 를 준다. 충돌은 평범한 실패와
  달리 **물어볼 것이 있는** 실패라, 초안을 그대로 둔 채 두 길을 이름 붙여 연다
  (내 것으로 덮어쓰기 / 디스크 것 불러오기). 자동 재시도는 없다 — 새 해시로 다시
  쏘는 것은 사고를 한 단계 뒤로 옮긴 것에 지나지 않는다.
- **일지**: 문지기만 붙였다. CAS 는 뺐고 그 이유를 코드에 적었다 — 짝이 되는 읽기가
  **마스킹된** 투영을 돌려주므로 호출자가 디스크와 일치하는 해시를 만들 길이 없다.
  만들 수 없는 값을 필수로 걸면 보호가 아니라 고장이다.
- 폰도 예외가 아니다 (`dispatch.rs` 가 `baseHash` 를 요구한다). 브리지의 존재
  이유가 데스크톱과 폰이 같은 문서를 동시에 여는 것이라, 여기 우회로를 두면 그것이
  곧 손실 경로가 된다.

`set_status` 는 문지기를 **폴더 이동 전에** 놓는다. 락 파일이 그 폴더 안에 살아서,
쥔 채로 옮기면 `Drop` 이 옛 자리를 헛치고 새 자리에 락이 남아 보관한 문서가 10초
동안 잠긴다.

## 검증

- 새 회귀 3건 (`commands/discussion::tests`) — 낡은 해시는 거절하고 **에이전트의
  문단이 그대로 남으며**, 방금 읽은 해시는 통과하고, 남이 쥔 락은 조용한 성공이
  아니라 충돌로 떨어진다.
- `write_conflict_contract.test.ts` 가 TS↔Rust 접두사 드리프트를 문다 (갈라지면
  화면이 충돌을 평범한 실패로 읽는다).
- typecheck · lint 6종 · vitest 2457 · cargo test 33 스위트 · clippy · build 전부 0.