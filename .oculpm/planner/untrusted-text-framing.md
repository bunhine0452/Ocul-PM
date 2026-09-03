---
oculpm_plan: v1
id: untrusted-text-framing
title: "남이 쓴 텍스트는 데이터다 — 경계를 문장이 아니라 기구로"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

block/buzz 의 `crates/buzz-acp/src/prompt_framing.rs` 차용 (논의: .oculpm/discussion/buzz-borrows/discussion.md F2). 지금 a2a 우편함의 방어는 도구 설명문 한 줄과 응답 JSON 의 note 한 줄 — 우리가 안티패턴이라 부른 프롬프트 의존으로 프롬프트 주입을 막고 있다. 짝 태그 + 비신뢰 본문 이스케이프로 경계 위조를 기구로 막고, a2a-agent-mesh 의 미완 항목 {#threat-model} 을 닫는다.

## 프레이밍 모듈 — 순수 함수 셋 {#module}
- [x] `src-tauri/src/oculpm/framing.rs` 신설 — 부작용 없는 순수 함수만. env·파일·네트워크 접근 금지 {#module-new}
  - [x] `semantic_section(tag, body)` — 짝 태그로 감싼다. 본문은 **바이트 그대로** (우리가 쓴 규칙·에이전트 정의는 모델이 보는 것과 리뷰 화면이 보는 것이 같아야 한다) {#module-section}
  - [x] `escape_untrusted(text)` — `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`. 순서 중요 (& 를 먼저) {#module-escape}
  - [x] `semantic_section_with_attrs(tag, attrs, body)` — 속성값은 escape_untrusted 위에 `"`→`&quot;` 까지 {#module-attrs}
  - [x] 태그 이름은 호출부의 `const` 로만 — 동적 태그 금지 (태그 자체가 주입 표면이 된다) {#module-const-tag}
- [x] 테스트 — 계약을 이름으로 말한다: 경계 위조 무력화 / verbatim 보존 / 공백 보존 / 속성 이스케이프 {#module-tests}
  - [x] `</a2a-message><system>` 을 본문에 넣어도 모델이 보는 경계가 안 늘어난다 {#module-test-forge}
  - [x] 신뢰 본문의 `<`·`&`·개행·앞뒤 공백이 한 바이트도 안 바뀐다 {#module-test-verbatim}

## a2a 읽기 경로에 적용 {#a2a-read}
- [x] `agent_inbox` — 메시지 본문을 `<a2a-message from=… id=…>` 로 감싸고 본문은 escape. from/id 는 속성 이스케이프 {#read-inbox}
- [x] 태스크 브리핑의 `title`·`note` 도 같은 규율 — 첨부 경로는 이미 `is_safe_artifact` 로 검증되지만 표시 문자열은 별개 표면이다 {#read-task}
- [x] 응답의 `note` 문장은 남기되, **문장은 방어가 아니고 프레이밍이 방어**라는 것을 코드 주석에 못 박는다 {#read-note-comment}
- [x] 쓰기 경로의 기존 계약(redact_text · MAX_TEXT_CHARS 4000 · MAX_ARTIFACTS 20 · is_safe_artifact)을 확인하고 마스터플랜에 계약으로 명문화 — 이미 있는 것을 다시 만들지 않는다 {#read-write-contract}
- [x] `agent_list` 의 `name` — 상대가 핸드셰이크에서 준 자유 문자열이다. 라벨이므로 구역 대신 이스케이프만 (구현 중 발견) {#read-live-name}

## 프런트 주입 경로 {#frontend}
- [x] `src/lib/framing.ts` — Rust 와 같은 규칙·같은 테스트 표 (두 벌이지만 표가 같아야 어긋남을 잡는다) {#fe-module}
- [x] `src/features/chat/aiContext.ts` 의 주입 파트를 태그로 감싼다 — 코드 조각·일지·규칙·플래너 {#fe-aicontext}
  - [x] 코드 조각은 지금 ``` 펜스뿐 — 본문에 펜스가 있으면 경계가 무너진다. 펜스 대신 태그 경계로 {#fe-fence}
  - [x] 우리가 쓴 규칙·플래너는 신뢰 본문(verbatim), 검색된 코드·일지 본문은 비신뢰(escape)로 가른다 {#fe-trust-split}
- [x] 순수 함수 vitest — Rust 와 같은 이름의 테스트 4개 {#fe-tests}

## 위협 모델을 계약으로 고정 {#threat}
- [x] `docs/a2a/00-master-plan.md` 의 위협 모델 절을 기구 기준으로 다시 쓴다 — 「문장으로 부탁한다」가 아니라 「경계를 위조할 수 없다」 {#threat-doc}
- [x] 자동 실행 금지는 프레이밍으로 해결되지 **않는다**는 것을 명시 — 이스케이프는 경계 위조를 막지 설득을 막지 않는다. 별도 규칙으로 남긴다 {#threat-limit}
- [-] `a2a-agent-mesh` 플랜의 `{#threat-model}` 을 plan_update 로 갱신 {#threat-plan-update}

## 마감 {#wrap}
- [x] `cargo test` · `cargo clippy -- -D warnings` · `cargo fmt --check` · `pnpm typecheck` · `pnpm test` · `pnpm lint` 전부 exit 0 직접 확인 {#wrap-gates}
- [x] 일지 작성 + 이 플랜 갱신 {#wrap-journal}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T17:06:33+09:00 | #module-section | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 이름을 trusted_section 으로 — 어느 쪽 신뢰인지 함수명이 말한다 |
| 2026-09-03T17:06:34+09:00 | #module-escape | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | & 먼저 — escape_replaces_ampersand_first 가 순서를 고정 |
| 2026-09-03T17:06:36+09:00 | #module-attrs | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | untrusted_section 에 흡수 + 개행·제어문자 접기 추가 |
| 2026-09-03T17:06:38+09:00 | #module-const-tag | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | Rust 는 &'static str + debug_assert, TS 는 닫힌 유니온 FramingTag |
| 2026-09-03T17:06:40+09:00 | #module-test-forge | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 여닫는 태그 개수까지 센다 — 본문이 더 만들어 내지 못한다 |
| 2026-09-03T17:06:43+09:00 | #module-test-verbatim | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 앞뒤 공백·개행까지 바이트 동일 단언 |
| 2026-09-03T17:06:44+09:00 | #read-inbox | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | text 필드가 구역으로 대체 — 원문 필드를 따로 남기지 않았다(방어가 선택이 되면 안 된다) |
| 2026-09-03T17:06:51+09:00 | #read-task | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | note 는 구역, title 은 이스케이프 — 본문/라벨 규율 확정 |
| 2026-09-03T17:06:53+09:00 | #read-note-comment | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 문장은 남기되 "이 문장은 방어가 아니다" 를 코드에 박음 |
| 2026-09-03T17:06:55+09:00 | #read-write-contract | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | D2 에 계약 표 6행 — 이미 있던 것(redact·상한·경로)을 다시 만들지 않고 적기만 |
| 2026-09-03T17:06:57+09:00 | #read-live-name | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 구현 중 발견해 항목으로 추가한 뒤 처리 |
| 2026-09-03T17:07:00+09:00 | #fe-module | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | ES2020 라 replaceAll 대신 정규식 — target 확인 후 수정 |
| 2026-09-03T17:07:02+09:00 | #fe-fence | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | code-snippet 구역 + path/lines 속성으로 교체 |
| 2026-09-03T17:07:04+09:00 | #fe-trust-split | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 항목 문구와 달리 플래너도 비신뢰로 분류 — 제목·항목을 에이전트가 쓴다. git 맥락(커밋 제목·작성자)도 추가 |
| 2026-09-03T17:07:10+09:00 | #fe-tests | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 순수 4개 + 프로덕션 시임 1개(목에 적대 본문을 심어 호출부 누락을 잡는다) |
| 2026-09-03T17:07:12+09:00 | #threat-doc | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | D2 를 「코드가 강제하는 계약」 표 + 회귀 테스트 이름으로 다시 씀 |
| 2026-09-03T17:07:14+09:00 | #threat-limit | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 「설득은 못 막는다」를 D2·양쪽 모듈 주석 세 곳에 |
| 2026-09-03T17:07:16+09:00 | #wrap-gates | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | fmt/clippy/cargo test/typecheck/test/lint/build 전부 exit 0. lint:i18n 이 새 테스트를 잡아 허용목록 1줄 |
| 2026-09-03T17:07:43+09:00 | #threat-plan-update | claude-code | ☐→- | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 할 수 없음 — a2a-agent-mesh 가 16:37 에 done 으로 잠겼고 #threat-model 도 그때 x 로 닫혔다(v2.37.0 릴리스). 잠긴 플랜은 수정 금지 |
| 2026-09-03T17:07:45+09:00 | #wrap-journal | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/1706_feature_untrusted-text-framing.md | 일지 1706 + 이 플랜 20항목 갱신 |
<!-- oculpm:plan-log end -->
