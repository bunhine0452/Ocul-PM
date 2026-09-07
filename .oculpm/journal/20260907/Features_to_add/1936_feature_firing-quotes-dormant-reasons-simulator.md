---
schema_version: 1
type: feature
slug: "firing-quotes-dormant-reasons-simulator"
status: done
difficulty: high
created_at: "2026-09-07T19:36:04+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "6cb813ef-9c7c-4e4f-9662-101b24e03c73"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/migrations/036_firing_quotes.sql"
    op: create
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/db/registry.rs"
    op: create
  - path: "src-tauri/src/db/firings.rs"
    op: update
  - path: "src-tauri/src/db/tests.rs"
    op: update
  - path: "src-tauri/src/oculpm/firing_ledger.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src-tauri/src/commands/firing_ledger.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/termMatch.ts"
    op: create
  - path: "src/features/chat/contextLoad.ts"
    op: update
  - path: "src/features/skills/useFiringQuotes.ts"
    op: create
  - path: "src/features/skills/FiringBadge.tsx"
    op: update
  - path: "src/features/skills/contextModel.ts"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
  - path: "src/features/skills/ContextProposals.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/__tests__/term_match.test.ts"
    op: create
related: []
tags:
  - "skills"
  - "agent-discipline"
  - "ui_v2"
  - "db"
  - "i18n"
  - "mcp-tool"
---
[x] 원장이 사전을 답한다 — 발동 인용 · 휴면 3분화 · 발동 시뮬레이터

## 추가 기능

플랜 `skill-invocation-visibility` 의 남은 Phase 2·3. Phase 1 이 frontmatter 에 이미 있던 사실을 드러냈다면, 여기는 **원장을 늘려 실제로 일어난 일을 근거로 삼는다.**

### 발동 순간의 인용 (`#firing-quotes`)

스캐너는 이미 transcript 를 읽고 있었다. 새로 읽을 것은 없고, 지나가던 사용자 프롬프트를 붙잡아 두기만 하면 됐다. `parse_chunk` 가 줄을 **순서대로** 걸으며 마지막 사용자 프롬프트를 들고 다니고, 발동은 그 프롬프트가 부른 것으로 본다.

세 가지를 조심해야 했다.

**① `type:"user"` 는 사람의 말만 담지 않는다.** 도구 결과도 user 역할로 돌아오고, 훅이 심는 합성 메시지(`isMeta`)와 `<system-reminder>` 도 같은 자리에 실린다. 그걸 인용하면 "이 스킬은 언제 걸리나" 의 답이 도구 출력이 된다. 그래서 **사람이 썼다고 확신할 수 있는 것만** 통과시킨다 — `tool_result` 블록이 하나라도 섞이면 그 줄은 사람의 차례가 아니고, 사람의 말에 리마인더가 딸려 오면 태그 구간만 걷어낸다.

**② 청크 경계.** 증분 스캔의 재개점이 프롬프트와 그것이 부른 Skill 호출 **사이**에 놓이면(스캔이 턴 중간에 돌면) 그 발동은 인용을 영원히 잃는다. `context_firing_scan` 에 이월 슬롯을 하나 두어 청크 너머로 한 줄을 들고 넘어간다. 회전(파일이 줄어 0부터 다시 읽음)이면 이월도 버린다 — 옛 파일의 프롬프트가 새 파일 첫 발동의 인용이 되면 거짓말이다.

**③ 시크릿.** 인용은 **사용자가 쓴 말**이다. 적재 전에 `redact::patterns_for_project` 를 태운다. 유출 원장(`egress_inventory`)이 리댁션 호출 파일 수가 하나 늘었다고 붉어졌다 — 설계대로 작동했고, `CALL_SITE_FILES` 를 같은 커밋에서 23→24 로 고쳤다.

집계 행에 얹었다(별도 표가 아니라). 행 단위가 (kind, key, workday, session_file) 이라 "그날 그 세션에서 마지막으로 이걸 부른 말" 한 줄이 남는다. UPSERT 는 횟수·바이트는 가산하고 인용만 **가장 늦은 것으로 교체**한다 — SQLite 의 `DO UPDATE SET` 은 우변을 갱신 전 행으로 평가하므로 두 줄의 순서에 의존하지 않는다.

### 휴면 3분화 (`#dormant-three-ways`)

분류기(`classifyDormantSkill`)는 이미 있었다 — 존 3 제안 인박스에만 살고 있었을 뿐이다. 그걸 **존 2 배지**로 끌어올렸다: 제안 카드까지 안 내려가도 답이 나온다. 점선 테두리(손댈 자리)는 `genuine` 에만 붙인다.

그 과정에서 분류기 자체의 결함 하나를 고쳤다. `user_invoked` 스킬은 지금까지 `genuine` 으로 분류돼 **「설명 고쳐 쓰기」 제안을 받고 있었다.** 틀린 처방이다 — 그 description 은 에이전트가 읽는 트리거가 아니라 사람이 읽는 한 줄 요약이고, 무엇을 적든 자동 발동은 일어나지 않는다. 이제 가장 먼저 걸러진다.

### 발동 시뮬레이터 (`#prompt-simulator`)

존 2 의 검색칸에 두 번째 모드(`찾기` | `걸릴까`). 친 말에 무엇이 잡히는지 예측한다.

**약속을 정직하게 좁혔다.** 이건 Claude Code 의 스킬 라우터가 아니다 — 그건 모델의 판단이라 재현할 수 없고, 그렇게 읽히면 화면이 거짓말을 한다. 예측하는 것은 이 앱의 **AI 패널 능력 검색** 하나이고, 그 사실을 목록 위 한 줄로 적었다.

그리고 채점기를 `src/lib/termMatch.ts` 로 빼서 `contextLoad.discover()` 와 **공유**했다. 따로 두면 보여 준 예측이 실제와 다를 수 있고, 그러면 시뮬레이터는 예측이 아니라 창작이 된다. 공유하면 보여 주는 것이 정의상 진짜다.

## 곁다리 — 게이트가 잡은 것 둘

`lint:filesize` 래칫이 `db/mod.rs` 827줄(허용 823)을 잡았다. 마이그레이션 등록부(`MIGRATIONS` + `ADDITIVE_COLUMNS`)를 `db/registry.rs` 로 분리했다(701줄). 크기 때문만은 아니다 — 두 표는 **선언**이고 나머지 `mod.rs` 는 그걸 실행하는 코드라, 표 한 줄 늘리는 일이 러너 코드를 스크롤해 지나가야 하는 일이 아니게 됐다.

`lint:bindings` 는 `useFiringQuotes` 가 `commands` 를 직접 부르는 것을 잡았다. 허용목록에 더하지 않고 `claudeSurface.firingApi` 로 옮겼다 — 새로 난 경로는 `call` 규약을 따르는 게 맞다.

## 검증

`pnpm typecheck` 0 · `pnpm test` 186파일 2,419개 · `pnpm lint` 0 · `pnpm build` 0 · `cargo test` 29 스위트 전부 ok · `cargo clippy --all-targets -D warnings` 0 · `cargo fmt`.

새 테스트: Rust 4종 — 직전 프롬프트 부착 · 청크 경계 이월 · **기계가 쓴 user 줄 4가지를 인용으로 안 삼음**(tool_result·isMeta·system-reminder·assistant, 그리고 리마인더가 섞인 사람 말은 살아남음) · 버킷당 가장 늦은 인용만 남김. DB 1종 — reset 뒤 인용 교체. 프런트 3파일 — `rankByTerms` 5종(순위·0건·본문 미색인·**discover 와 같은 답**·limit), 분류기의 `user-invoked` 우선순위와 `indexDormantReasons`, 컴포넌트 2종(걸릴까 모드가 잡는 것과 0건을 사실로 말함 · 상세가 인용을 보여 줌).

육안 확인은 아직 — 설치본이 도는 중엔 dev 빌드를 안 띄우는 규율이라 다음 앱 실행 라운드에서 본다. 특히 인용은 실제 transcript 를 스캔해야 채워진다(테스트는 커맨드를 모킹한다).