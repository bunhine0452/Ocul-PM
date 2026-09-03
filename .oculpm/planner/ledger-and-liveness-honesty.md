---
oculpm_plan: v1
id: ledger-and-liveness-honesty
title: "원장과 생존 판정이 거짓말하지 않는다 — 해시 체인 + 3상태"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 crates/buzz-audit 해시 체인과 docs/agent-availability.md 의 "모름은 오프라인이 아니다" 규율 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F3·F5). 우리 NDJSON 원장은 줄 유실은 막지만 삭제·수정은 검출 못 하고, is_live 는 bool 이라 판정 불가를 표현할 자리가 없어 살아 있는 세션의 임대를 걷을 수 있다. **a2a 릴리스 전에 해야 마이그레이션이 아니다.**

## NDJSON 해시 체인 {#chain}
- [x] 원장 줄마다 `prev` 한 칸 — blake3 (`Cargo.toml:54` 에 이미 있다, 새 의존성 없음) {#chain-prev}
  - [x] 첫 줄은 32바이트 제로 센티넬을 해시하되 필드는 없다 — 「첫 줄」과 「앞 줄을 지웠다」를 가를 수 있게 {#chain-genesis}
  - [x] hex 64자가 `NDJSON_LINE_CAP` (4096) 안에 들어가는지 확인 — 상한 부딞히면 쓰기가 실패한다 {#chain-cap}
- [x] canonical 직렬화 — 키 정렬(BTreeMap)로 해시. serde_json 의 필드 순서에 의존하면 리팩터 한 번에 과거 원장이 전부 깨진다 {#chain-canonical}
- [x] 직렬화 실패를 빈 값으로 대체하지 않고 에러로 올린다 — 해시가 실제 payload 대신 조용히 빈 값을 세면 체인이 거짓말이 된다 {#chain-serde-err}
- [x] 타임스탬프를 **해시를 계산하는 그 지점에서** 저장 정밀도로 자른다 — RFC3339 소수 자릿수가 값에 따라 달라져 쓸 때와 읽을 때 프리이미지가 갈린다 (buzz 가 밟은 함정) {#chain-ts-precision}
- [x] 프로젝트 식별자를 해시 **선두**에 — 다른 프로젝트 원장에서 줄을 복사해 넣으면 재계산이 달라 검증이 깨진다 {#chain-project-bind}

## 검증기와 무결성 닥터 {#doctor}
- [x] `verify_chain(path)` — 깨진 지점을 `{line, expected, found}` 로 돌려준다. bool 이 아니다 — 어디서 깨졌는지가 정보다 {#doctor-verify}
- [x] 커맨드 `oculpm_integrity_check` — lib.rs 의 use 와 collect_commands![] 양쪽 등록 후 cargo test 로 bindings 재생성 {#doctor-cmd}
- [x] 화면에 「무결성」 섹션 — 깨진 줄 번호와 근거 발췌. **고치라고 하지 않는다** (사람이 손으로 고친 것일 수 있다) {#doctor-ui}
- [x] 한계를 화면에 적는다 — 체인은 **변조**를 잡지 **위조**를 막지 못한다 (키가 없으므로 원장 전체 재계산은 가능). 감사이지 서명이 아니다 {#doctor-limit}

## 3상태 생존 판정 {#liveness}
- [x] `is_live -> bool` 을 `liveness(card, now) -> Liveness{Live, Dead, Unknown}` 으로 {#live-tristate}
  - [x] Windows 의 `pid_alive` 는 지금 무조건 true — 모름을 살아있음으로 단정하는 거짓 주장이다. Unknown 으로 {#live-windows}
  - [x] 카드 파일 읽기·파싱 실패도 Unknown — 읽지 못한 것은 죽은 것이 아니다 {#live-readfail}
  - [x] EPERM(남의 소유 프로세스)를 살아있음으로 치는 현재 동작은 그대로 둔다 — 이미 올바르다 {#live-eperm}
- [x] `registry::sweep` · `leases::sweep` 은 **Dead 만** 걷는다 — Unknown 의 임대는 유지. 지금은 모름을 죽음으로 읽어 살아있는 세션의 작업 구역을 뺏는다 {#live-sweep}
- [x] UI — Unknown 은 회색 점 + 「판정 불가」. 오프라인과 같은 색으로 그리지 않는다 {#live-ui}
- [x] 임대 판정은 UI 가드이지 분산 락이 아니라는 것을 모듈 주석에 명시 (buzz 가 같은 문장을 문서에 박아 놓았다) {#live-not-a-lock}

## 테스트 {#tests}
- [x] 체인 — 정상 / 중간 줄 삭제 / 줄 내용 수정 / 다른 프로젝트에서 복사해 넣은 줄 — 네 경우가 각각 다른 지점을 가리키는지 {#test-chain}
- [x] 타임스탬프 회귀 — 나노초를 달고 쓴 줄이 재검증되는지 (이 테스트가 없으면 함정을 다시 밟는다) {#test-ts}
- [x] 3상태 — pid 살아있음+오래된 하트비트 / pid 없음+TTL 초과 / 읽기 실패 / Windows {#test-liveness}
- [x] sweep 이 Unknown 의 임대를 걷지 않는다 — 이 보장이 이 Phase 의 이유다 {#test-sweep}
- [x] `a2a-agent-mesh {#rust-tests}` 와 겹치는 부분을 확인해 중복 작성하지 않는다 {#test-dedup}

## 마감 {#wrap}
- [x] cargo fmt/clippy/test · pnpm typecheck/test/lint/build 전부 exit 0 직접 확인 {#wrap-gates}
- [x] i18n 키 ko/en 양쪽 (무결성 섹션·판정 불가 배지) {#wrap-i18n}
- [x] 일지 작성 + 이 플랜 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T17:32:41+09:00 | #chain-genesis | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 첫 줄은 prev 없음 + seq=0 — 삭제되면 뒷줄의 자기 digest 부터 어긋난다 |
| 2026-09-03T17:32:42+09:00 | #chain-cap | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 상한 검사를 hash·prev 를 얹은 뒤로 옮겼다 — 128자가 더 붙는다 |
| 2026-09-03T17:32:45+09:00 | #chain-canonical | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | BTreeMap 재귀 직렬화 + 중첩 정렬 테스트 |
| 2026-09-03T17:32:47+09:00 | #chain-serde-err | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | canonical_json 이 Result 를 그대로 올린다 — 자리표시자 없음 |
| 2026-09-03T17:32:50+09:00 | #chain-ts-precision | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 우리는 at 이 처음부터 문자열이라 함정 모양이 다르다 — 규율은 "재직렬화 금지, 디스크 문자열을 그대로 해시". 나노초 회귀 테스트로 고정 |
| 2026-09-03T17:32:52+09:00 | #chain-project-bind | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 프로젝트 경로가 아니라 **task id** 로 묶었다 — 폴더를 옮겨도 안 깨지고, 원장 간 줄 이식은 잡힌다 |
| 2026-09-03T17:32:54+09:00 | #doctor-verify | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | ChainStatus{Intact\|Unverifiable\|Broken} + ChainBreak{line,reason,forked_from_line,expected,found} |
| 2026-09-03T17:33:02+09:00 | #doctor-cmd | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 커맨드를 새로 만들지 않고 a2a_overview 에 integrity 를 실었다 — 그 구조체의 규율이 "한 번의 왕복". 새 커맨드 등록 없음 |
| 2026-09-03T17:33:05+09:00 | #doctor-ui | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 깨진 것만 줄 번호+이유로. 사슬 이전 원장은 한 줄로 세기만 — 초록불은 안 그린다 |
| 2026-09-03T17:33:07+09:00 | #doctor-limit | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | a2a.integrityLimit — 화면·모듈 문서 양쪽에 "감사이지 서명이 아니다" |
| 2026-09-03T17:33:09+09:00 | #live-windows | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | pid_state 로 이름 바꾸고 non-unix 는 Unknown. 하트비트가 새것이면 Live, 아니면 Unknown |
| 2026-09-03T17:33:12+09:00 | #live-readfail | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | pid 없음 + 시각 파싱 실패 = Unknown (예전엔 false=죽음). 파일 자체가 안 읽히면 카드가 없는 것이라 판정 대상이 아니다 |
| 2026-09-03T17:33:14+09:00 | #live-eperm | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 그대로 Live. ESRCH 는 Dead, 그 밖의 errno 는 Unknown 으로 갈랐다 |
| 2026-09-03T17:33:16+09:00 | #live-sweep | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | registry::sweep · leases::expired 둘 다 == Dead 로. is_live 는 "확실한 근거" 용도로 남기고 부정 사용을 문서에서 금지 |
| 2026-09-03T17:33:24+09:00 | #live-ui | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | UnknownBadge — 죽은 것은 애초에 목록에 안 오므로 말할 것은 모름뿐. 점 대신 회색 라벨 + 툴팁 |
| 2026-09-03T17:33:26+09:00 | #live-not-a-lock | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | registry 모듈 문서에 "화면과 청소를 위한 가드이지 분산 락이 아니다 — 임대의 진짜 안전장치는 기한" |
| 2026-09-03T17:33:28+09:00 | #test-chain | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 네 경우 + 갈래 + 사슬 이전 = 순수 8. 실제 쓰기 경로 3개를 tasks.rs 에 따로 |
| 2026-09-03T17:33:30+09:00 | #test-ts | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | a_nanosecond_timestamp_still_verifies |
| 2026-09-03T17:33:33+09:00 | #test-liveness | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 모름 / 오래된 원격 하트비트 추가. Windows 경로는 cfg 라 macOS 에서 실행 불가 — 코드로만 갈라 뒀다 |
| 2026-09-03T17:33:34+09:00 | #test-sweep | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | a_lease_survives_a_holder_we_cannot_judge — 이 라운드의 이유를 무는 테스트 |
| 2026-09-03T17:33:37+09:00 | #test-dedup | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | a2a-agent-mesh 는 done 으로 잠겨 손대지 않았다. 기존 43개와 겹치지 않는 6개만 추가 |
| 2026-09-03T17:33:44+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 전부 exit 0. today_v2 목이 integrity 없이 굳어 있어 8건 터진 것을 목 수정으로 잡았다 |
| 2026-09-03T17:33:46+09:00 | #wrap-i18n | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | ko/en 9키 (판정 불가·힌트·무결성 6종) |
| 2026-09-03T17:33:48+09:00 | #wrap-journal | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1732_feature_ledger-chain-and-tri-state-liveness.md | 일지 1732 + 이 플랜 24항목 |
<!-- oculpm:plan-log end -->
