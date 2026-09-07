---
schema_version: 1
type: refactor
slug: "nesting-visibility-splits-and-warnings"
status: done
difficulty: high
created_at: "2026-09-08T00:31:00+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/git/nesting.rs"
    op: create
  - path: "src-tauri/tests/nested_repo_paths.rs"
    op: create
  - path: "src-tauri/src/oculpm/mcp/tools/plan_ops.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src/features/chat/conversation/useTranscripts.ts"
    op: create
  - path: "src/features/shell/useShellNav.ts"
    op: create
  - path: "src/features/theme/ThemeEditor.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "docs/cargo-bin-exe-trap.md"
    op: create
  - path: "package.json"
    op: update
tags:
  - "branch"
  - "planner"
  - "refactor"
  - "v3-release"
---
[x] 중첩 저장소를 양방향으로 되맞추고, 접힌 미완이 보이고, 경고를 47에서 9로

## 동기

3차 이월 10건 + 앞선 라운드가 남긴 잔가지들. 「완료 개수」가 아니라 **정직한 상태**가 목표라,
못 하는 것은 못 한다고 적었다.

## 변경 요약

### 되맞춤이 양방향이 됐다 {#rebase-other-direction}

3차가 고친 것은 「저장소가 프로젝트 루트 **아래**」 한 방향뿐이었다. 반대 방향(프로젝트가 더
큰 저장소에 중첩된 흔한 모노레포)은 그냥 지나갔다. `git/nesting.rs` 에 `RepoNesting`
(Same / RepoBelowRoot / RootInsideRepo / Disjoint) 한 벌을 두고 소비자 셋이 **같은 문**을
지나게 했다. 프로젝트 밖 파일은 `None` 으로 떨군다 — 화면이 열 수도 없는 경로이고, 기록률의
분모가 남의 저장소 분량으로 부풀면 그 숫자 자체가 거짓이 된다. 반환 타입을 `Option` 으로
바꿔 호출부가 무시할 수 없게 했다.

**load-bearing 이었던 것**: 양쪽 루트를 실경로로 펴야 한다. `rev-parse --show-toplevel` 은
macOS 에서 `/private/var/...` 를 주는데 DB 의 루트는 `/var/...` 라, 안 펴면 반대 방향이
`Disjoint` 로 떨어져 되맞춤이 통째로 건너뛰어진다(`canonicalize` 를 빼면 새 통합 테스트가
즉시 붉어진다).

### 화면이 근거의 한계를 말한다 {#branch-nested-signal}

`BranchStory` 에 `repo_nesting`·`repo_subpath` 를 싣고 `NestingNote` 카드를 붙였다. 배치마다
**잃는 근거가 다르므로** 한 문장으로 뭉뚱그리지 않았다 — 저장소가 루트 아래면
`.oculpm/journal/**` 이 그 저장소 밖이라 「일지 파일」 근거가 **구조적으로 불가능**하고, 반대
방향이면 프로젝트 밖 파일이 목록에서 빠진다.

### 접힌 미완이 보인다 {#archived-open-items-visibility}

3차가 `archived` 를 `done` 가드의 탈출구로 삼은 대가로, 접힌 미완이 어디에도 안 떴다. 이제
`plan_status` 가 미완이 있을 때만 `locked_open` 요약을 싣고 `include_locked: true` 로 목록을
편다. **두 모집단을 안 섞는다** — 잠긴 플랜은 `plan_update` 가 거부하므로 같은 TSV 에 넣으면
갱신 못 할 항목을 갱신하라고 시키는 셈이다. 「미완」 정의는 `open_leaves` 를 문지기와
공유한다(가드와 보고가 다른 정의를 쓰면 서로를 반박한다).

**실측**: 플랜 48개 = active 3 / archived 26 / done 19. **잠긴 플랜 18개에 미완 58건**
(archived 16개 53건). 덤으로 **`done` 플랜 2개에도 미완 5건** — 가드 이전에 닫힌 것이라
소급되지 않았고 지금까지 어느 목록에도 안 떴다. 비용은 11.2ms, 응답에 313바이트.

### 분할과 어휘 {#big-files-watch} {#oculpm-cmd-idiom-split} {#z-vocab-fourth-step}

`AcpConversation` 791→677, `ShellV2` 712→553 (기존 `conversation/**` 조각 규약을 이어
5개 신설). `commands/oculpm.rs` 의 `.map_err(AppError::from)` **34곳 전부**를 맨 `?` 로
통일하고 1062→1008. `lines_workday` → `focus_workday`(이제 두 스칼라의 초점이라 옛 이름이
거짓말이었다).

**z 어휘에 넷째 단을 넣었다.** 1차 때 「AppDialog 와 CommandPalette 는 동시에 안 뜬다」로
합쳤는데 **그 근거가 틀렸다** — ⌘K 는 `window` 전역 keydown 이고 `useModalBehavior` 는
Esc/Tab 만 막는다. 지금 순서가 맞는 건 두 값이 같아 **DOM 마운트 순서**로 갈리기 때문이라,
JSX 한 줄만 바꿔도 조용히 뒤집힌다. `--z-command`(200)을 두어 이제 **값**으로 정해진다.

### 경고 47 → 9 {#eslint-slack-real} {#eslint-ratchet-slack}

`eslint-disable` 은 한 줄도 안 썼다. `exhaustive-deps` 28→5(그중 하나는 **진짜 stale** —
`RetroScreenV2` 의 핸드오프가 옛 탭 목록을 읽고 있었다), `no-useless-assignment` 8→0,
`no-explicit-any` 3→0 등. 빚이 0이 된 규칙 4개는 래칫 블록에서 빼 **`error` 로 되돌렸다**.
남은 9건은 전부 이유가 문서화된 것(제어문자 매칭이 목적인 정규식 등)이다.

### 떠 있는 프로미스 — 플랜의 「약 100개」는 틀렸다 {#floating-promises-rest}

타입 인식 린트를 일회용으로 켜서 실측했다: `void` 를 계약으로 인정하면 **16건**이고, 나머지
494건은 이미 `void` 로 표식된 것이었다. 12건을 유형별로 정리하고 **2건은 일부러 남겼다** —
`GreenfieldWizard.handleClose`(저장 실패면 모달이 말없이 안 닫힌다)와 `DataTab` 클립보드
(실패해도 「복사됨」을 띄운다 = UI 가 거짓말). `void` 를 붙이면 **잘못된 의도를 못박는 것**
이라, 제대로 고치려면 UX 결정이 필요해 후속으로 넘겼다.

## 못 한 것

**`{#scheduling-telemetry}`** — §7 이 요구하는 셋 중 「버림」은 이미 됐고(`watcher_dropped_total`),
「워커가 얼마나 막혔나 · 큐가 얼마나 찼나」는 tokio 런타임 내부값이라 백엔드 없이는 못 만든다.
프런트 대체도 불가하다: 백엔드 이벤트에 **발신 시각이 안 실려** 단방향 지연을 계산할 수 없고,
IPC 왕복은 「큐 대기」와 「일이 느림」을 구분하지 못한다 — §7 이 요구하는 게 정확히 그 구분이다.
절반짜리를 만들지 않았다.

**`{#list-agent-session}`** — 칸을 늘리지 않았다. 조사 결과 `agent_session` 은 목록은 물론
**상세 화면에서도 렌더되지 않는다** — 037 마이그레이션이 의도한 소비처가 아직 UI 로 이어지지
않았다. 쓸 데가 없는 칸을 늘리는 것은 부채다.

**`{#use-plan-document-size}`** — 다시 보고 **쪼개지 않기로** 했다. 쓰기 15개가 읽기 상태를
만지는 자리가 **68곳**이고, 특히 `setStatus` 는 낙관적 갱신이라 롤백용 `prevDetail` 을 스스로
읽는 쓰기이자 읽기다. 가르면 사적인 것 다섯이 훅 간 계약이 되고 배관 25줄이 늘며 개념은
안 는다. 소비자도 하나뿐이다.

## 검증

`cargo test`(33 스위트) · `clippy -D warnings` · `cargo fmt --check` · `pnpm typecheck` ·
`pnpm lint`(6게이트) · `pnpm test`(190파일) · `pnpm build` 전부 exit 0.
`z-command` 유틸리티가 빌드 CSS 에 실제로 나오는 것까지 확인했다.
