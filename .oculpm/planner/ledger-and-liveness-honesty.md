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
- [ ] 원장 줄마다 `prev` 한 칸 — blake3 (`Cargo.toml:54` 에 이미 있다, 새 의존성 없음) {#chain-prev}
  - [ ] 첫 줄은 32바이트 제로 센티넬을 해시하되 필드는 없다 — 「첫 줄」과 「앞 줄을 지웠다」를 가를 수 있게 {#chain-genesis}
  - [ ] hex 64자가 `NDJSON_LINE_CAP` (4096) 안에 들어가는지 확인 — 상한 부딞히면 쓰기가 실패한다 {#chain-cap}
- [ ] canonical 직렬화 — 키 정렬(BTreeMap)로 해시. serde_json 의 필드 순서에 의존하면 리팩터 한 번에 과거 원장이 전부 깨진다 {#chain-canonical}
- [ ] 직렬화 실패를 빈 값으로 대체하지 않고 에러로 올린다 — 해시가 실제 payload 대신 조용히 빈 값을 세면 체인이 거짓말이 된다 {#chain-serde-err}
- [ ] 타임스탬프를 **해시를 계산하는 그 지점에서** 저장 정밀도로 자른다 — RFC3339 소수 자릿수가 값에 따라 달라져 쓸 때와 읽을 때 프리이미지가 갈린다 (buzz 가 밟은 함정) {#chain-ts-precision}
- [ ] 프로젝트 식별자를 해시 **선두**에 — 다른 프로젝트 원장에서 줄을 복사해 넣으면 재계산이 달라 검증이 깨진다 {#chain-project-bind}

## 검증기와 무결성 닥터 {#doctor}
- [ ] `verify_chain(path)` — 깨진 지점을 `{line, expected, found}` 로 돌려준다. bool 이 아니다 — 어디서 깨졌는지가 정보다 {#doctor-verify}
- [ ] 커맨드 `oculpm_integrity_check` — lib.rs 의 use 와 collect_commands![] 양쪽 등록 후 cargo test 로 bindings 재생성 {#doctor-cmd}
- [ ] 화면에 「무결성」 섹션 — 깨진 줄 번호와 근거 발췌. **고치라고 하지 않는다** (사람이 손으로 고친 것일 수 있다) {#doctor-ui}
- [ ] 한계를 화면에 적는다 — 체인은 **변조**를 잡지 **위조**를 막지 못한다 (키가 없으므로 원장 전체 재계산은 가능). 감사이지 서명이 아니다 {#doctor-limit}

## 3상태 생존 판정 {#liveness}
- [ ] `is_live -> bool` 을 `liveness(card, now) -> Liveness{Live, Dead, Unknown}` 으로 {#live-tristate}
  - [ ] Windows 의 `pid_alive` 는 지금 무조건 true — 모름을 살아있음으로 단정하는 거짓 주장이다. Unknown 으로 {#live-windows}
  - [ ] 카드 파일 읽기·파싱 실패도 Unknown — 읽지 못한 것은 죽은 것이 아니다 {#live-readfail}
  - [ ] EPERM(남의 소유 프로세스)를 살아있음으로 치는 현재 동작은 그대로 둔다 — 이미 올바르다 {#live-eperm}
- [ ] `registry::sweep` · `leases::sweep` 은 **Dead 만** 걷는다 — Unknown 의 임대는 유지. 지금은 모름을 죽음으로 읽어 살아있는 세션의 작업 구역을 뺏는다 {#live-sweep}
- [ ] UI — Unknown 은 회색 점 + 「판정 불가」. 오프라인과 같은 색으로 그리지 않는다 {#live-ui}
- [ ] 임대 판정은 UI 가드이지 분산 락이 아니라는 것을 모듈 주석에 명시 (buzz 가 같은 문장을 문서에 박아 놓았다) {#live-not-a-lock}

## 테스트 {#tests}
- [ ] 체인 — 정상 / 중간 줄 삭제 / 줄 내용 수정 / 다른 프로젝트에서 복사해 넣은 줄 — 네 경우가 각각 다른 지점을 가리키는지 {#test-chain}
- [ ] 타임스탬프 회귀 — 나노초를 달고 쓴 줄이 재검증되는지 (이 테스트가 없으면 함정을 다시 밟는다) {#test-ts}
- [ ] 3상태 — pid 살아있음+오래된 하트비트 / pid 없음+TTL 초과 / 읽기 실패 / Windows {#test-liveness}
- [ ] sweep 이 Unknown 의 임대를 걷지 않는다 — 이 보장이 이 Phase 의 이유다 {#test-sweep}
- [ ] `a2a-agent-mesh {#rust-tests}` 와 겹치는 부분을 확인해 중복 작성하지 않는다 {#test-dedup}

## 마감 {#wrap}
- [ ] cargo fmt/clippy/test · pnpm typecheck/test/lint/build 전부 exit 0 직접 확인 {#wrap-gates}
- [ ] i18n 키 ko/en 양쪽 (무결성 섹션·판정 불가 배지) {#wrap-i18n}
- [ ] 일지 작성 + 이 플랜 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
