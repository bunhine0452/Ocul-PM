---
schema_version: 1
type: chore
slug: "v241-doc-surface-lies"
status: done
difficulty: medium
created_at: "2026-09-04T13:01:20+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/index.html"
    op: correct
  - path: "landing/en/index.html"
    op: correct
  - path: "README.md"
    op: correct
  - path: "README.en.md"
    op: correct
  - path: "CLAUDE.md"
    op: correct
  - path: "docs/README.md"
    op: create
  - path: "src/windows/SettingsOverlay.tsx"
    op: correct
  - path: "src-tauri/src/oculpm/redact.rs"
    op: correct
related: []
tags:
  - "docs"
  - "landing"
  - "honesty"
  - "v241"
  - "mcp-tool"
---
[x] 문서와 랜딩이 하던 거짓말을 지운다 — 없어진 화면·FTS5·CLAUDE.md 8건

플랜 `v241-errors-first` Phase `lies`. 코드는 옳은데 그것을 설명하는 면이 틀린 것들 — 사용자에게는 이게 거짓말이고, 에이전트에게는 오답의 원천이다.

## 고친 거짓 넷

**① 없어진 화면으로 안내하던 6곳.** v2.40.0 이 A2A 카드를 Today 에서 「세션」 화면으로 옮겼는데, 랜딩 한/영이 여전히 *"Today 의 「함께 일하는 중」에서 세션을 골라 묶으면"* 이라고 **현재형으로** 안내했다 — JSON-LD FAQPage `acceptedAnswer` · 벤토 셀 · FAQ `<details>` × 양 언어. `README:96` 과 랜딩의 v2.37.0 `<li>` 는 역사라 그대로 두었다.

**② FTS5 를 세 면이 주장.** `README.md:355`·`README.en.md:355`·`landing/index.html:369`. 실제로는 `code_index.rs` 의 `search_text` 가 `LIKE` 풀스캔이고 FTS5 는 등록된 적 없이 2026-08-30 폐기됐다. 같은 랜딩의 JSON-LD `featureList` 는 이미 "정확 일치"로 고쳐져 있었다 — **사람이 읽는 3면만 안 고쳐진** 릴리스 5면 규율의 구멍이었다.

**③ 루트 `CLAUDE.md` 의 구조 주장 8건.** `src/App.tsx` 없음(진입은 `main.tsx` + `parseWindowRoute` 3갈래) · "12 screens"(실제 16) · 채팅 표면이 하나라는 서술(실제 셋) · `features/overview` 없음 · localStorage 키가 **프로젝트별** `aipm:workspace:v2:p<id>` · `github.rs` 없음 · `db.rs`/`manager.rs` 등이 디렉터리 · `src/legacy/` 없음.

가장 위험한 한 줄은 마이그레이션 안내였다 — *"add the next `0NN_*.sql`"* 만 적혀 있고 **`db/mod.rs` 의 `include_str!` 표에 등록하는 두 번째 단계가 빠져 있었다.** 파일만 있고 무력한 마이그레이션이 실제로 릴리스에 나간 적이 있다(`025_fts.sql`).

**④ `docs/` 206개에 색인이 없었다.** 그런데 `CLAUDE.md` 는 그 안의 마스터플랜을 SSOT 로 가리킨다. 문서 2/3 가 3~4개월 전 역사인데 스스로를 *"단일 소스 오브 트루스"* 로 선언한다(`refactor/MASTER-GUIDE.md`, 2026-05-20 — 그 안의 "코드를 직접 수정하지 않고"는 현재 `code_write`·LSP rename·DAP 가 정면 반박한다). `docs/README.md` 를 신설해 **살아 있는 SSOT 21행 / 역사 7행**으로 가르고, 아카이브 4곳에 배너를, 잠갔다고 선언했다 뒤집힌 결정 6개에 인라인 정정을 달았다.

## 조사가 감사 보고서를 정정한 것

- `redact.rs` 호출부는 19개가 아니라 **22개**(비-테스트 기준).
- osaurus 의 "유일한 채팅 표면"은 뒤집힌 결정이 아니라 **쓸 때부터 틀린 문장**이다 — `ClaudeCodeScreenV2` 가 그 문서보다 17일 먼저 있었다. 결정 자체(오버레이 미복원)는 유효해 "전제 정정"으로 남겼다.
- `commands/overview.rs` 는 **존재한다.** 없는 것은 프런트 `features/overview` 쪽이다.
- `major_update/` 는 통째로 아카이브가 **아니다** — `major_update/oculpm/00-spec.md` 는 `spec.rs`·`lock.rs`·`redact.rs` 가 조항 번호로 인용하는 살아 있는 SSOT 다.
- grep 으로 같은 계열을 더 찾았다: 랜딩 한/영에 **"12개 화면"이 현재형으로 4곳**(JSON-LD + FAQ). 수를 다시 박으면 또 썩으므로 "화면 전체"로 바꿨다.

## 검증

랜딩 두 파일의 **JSON-LD 4블록이 편집 전후 모두 `json.loads` 통과**(깨지면 구조화 데이터가 통째로 죽는다). 편집한 md 전부의 상대 링크 깨짐 0. 두 소스 파일의 diff 가 주석 줄뿐임을 `git diff` 로 확인. 고친 주장은 전부 코드로 재확인한 뒤 썼다.

## 메모

`landing/wiki-src/screens.md`(+`en/`)의 화면 표에 Codex·세션 화면이 빠져 있다. 고치려면 `build.mjs` 재빌드가 `changelog.html`·`sitemap.xml` 까지 함께 굽는 릴리스 절차라 `{#release-surfaces}` 로 넘겼다.