---
schema_version: 1
type: feature
slug: "gate-attribution-segments-codex-hooks"
status: done
difficulty: superhigh
created_at: "2026-09-08T00:30:00+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/verdict/transcript.rs"
    op: create
  - path: "src-tauri/src/acp/segments.rs"
    op: create
  - path: "src-tauri/src/acp/session_book.rs"
    op: create
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: update
  - path: "src-tauri/tests/webview_csp_draft.rs"
    op: create
  - path: "plugin/oculpm-codex/hooks/hooks.json"
    op: create
  - path: "AGENTS.md"
    op: update
tags:
  - "verdict"
  - "acp"
  - "codex"
  - "v3-release"
---
[x] 게이트가 대화를 가려내고, 세그먼트가 닫히고, Codex 도 훅을 받는다

## 추가 기능

### 배달 게이트가 병렬 세션에서 발화한다 {#gate-positive-attribution}

옆 대화가 하나라도 살아 있으면 전부 `undecided` 였다 — 이 저장소의 주 사용 방식이 병렬
세션이라 게이트가 **사실상 꺼져 있었다**. 이제 Stop 페이로드의 `transcript_path` 를 읽어
그 대화 **자신의** `Edit`/`Write`/`MultiEdit`/`NotebookEdit` 호출만 뽑고 더티 목록과
교집합을 낸다.

오탐 방지로 **일부러 놓치는** 것 넷(전부 미탐 방향): `Bash` 편집 · `is_error` 인 호출 ·
`tool_result` 를 못 본 호출 · 64MiB 초과분. 저장소 밖 경로도 버린다. 실바이너리 E2E 로
셋을 확인했다 — 트랜스크립트 없음 → 판정불가(옛 동작) / 있음 → 이의 / **옆 대화 파일만
적힌 트랜스크립트 → 오탐 없이 판정불가**.

### 세그먼트가 닫힌다 {#acp-segment-close}

앱 종료·어댑터 사망 시 원장 세그먼트가 안 닫혀 그 6시간 동안 옆 대화의 게이트가 침묵했다.
`process.rs` 가 크기 래칫 상한이라 `SessionBook` 을 `acp/session_book.rs` 로 갈라 자리를
만들고(1241→1060), 새 `acp/segments.rs` 등록부가 **우리가 연 세그먼트만** 들고 있다가
닫는다 — 폴더를 훑으면 남의 대화 마커를 쓸 위험이 있어 등록부를 골랐다.

### 삭제만 한 대화가 더는 「깨끗함」이 아니다 {#verdict-deletions}

mtime 이 없어 시각을 못 가르는 건 여전히 못 고친다. 대신 **거짓 무결을 없앴다** —
`Clear(NothingToRecord)`("읽기만 했다")로 기록되던 것을 `Undecided::UntimeableDeletions`
로 바꿨다. 원장에 `"basis":"untimeable_deletions"` 로 남는다.

### Codex 도 훅을 받는다 {#codex-hook-delivery}

**플랜의 전제가 틀렸다.** 실측(Codex 0.153.4, 격리 `CODEX_HOME`): 매니페스트 `hooks`
**필드**만 거부되고 플러그인 루트의 `hooks/hooks.json` **파일**은 정상 설치되며 실행 비트도
살아남는다. 그리고 실제로 돈다 — `codex exec` 한 번에 SessionStart·SessionEnd 가 인박스에
적재됐다. 앞선 조사가 "안 된다"고 결론 낼 뻔한 이유는 Codex 가 훅에 신뢰를 한 번 묻기
때문이었다. `plugin/oculpm-codex/` 에 Claude 판과 바이트 동일하게 싣고 드리프트를 테스트가
막는다.

## 못 한 것 — 근거와 함께

**`{#neutral-session-env}` · `{#mcp-json-session-env}` 는 이 경로로 불가능하다.** 실측으로
확정했다 — `.mcp.json` 의 `env` 에서 `${CLAUDE_PLUGIN_ROOT}` 는 풀리지만
`${CLAUDE_CODE_SESSION_ID}` 는 **리터럴 문자열 그대로** 자식에게 간다(못 푸는 이름은 전부
리터럴). `ps eww` 로 확인한 바 그 변수는 부모 `claude` 프로세스 환경에 없고 자식마다 새로
실린다. 매핑을 넣으면 **모든 대화가 같은 문자열을 신원으로 쓴다 — 폴백보다 나쁘다.**
폴백을 유지하고 회귀 가드를 붙였다.

**`{#broken-event-lines}` 는 복구하지 않는다.** 깨진 5줄에서 이벤트 11개를 전부 복원할 수는
있다. 그런데 이것은 `apply_event` 가 쓰는 **현재형 활동 신호**라 4일 지난 SessionStart 를
재생하면 유령 세션이 생기고, 소비 오프셋을 되감으려면 뒤 200여 건도 함께 재생해야 한다.
실제 기록(일지·플래너)에는 영향이 없다. 「지나간 11건은 잃었다」로 닫는다.

**`{#webview-csp}` 는 초안만.** `tauri.conf.json` 은 미지 키를 거부하므로(실측) 원장
테스트 `tests/webview_csp_draft.rs` 에 초안과 근거를 넣고 `csp: null` 을 못박았다. 켜는
것은 육안 확인이 가능한 라운드의 몫이다.

## 곁들여 고친 것

**같은 개행 버그가 앱 쪽에 살아 있었다.** 플러그인 `hooks.json` 은 고쳤는데 **앱 설정
토글이 설치하는 커맨드**(`claude_hooks.rs::hook_command`)는 여전히 날 `cat >>` 라, 깨진
5줄을 만든 그 코드가 그대로 있었다. 플러그인과 같은 문구로 바꾸고 실행으로 확인했다 —
개행 없는 payload 두 건이 이제 **2줄의 유효한 JSON** 으로 남고 각각 `oculpm_ts` 를 갖는다.

**`{#guard-manual-edit}`** 규칙을 `AGENTS.md` 와 **마스터 템플릿**(`master_ko`/`master_en`,
`template_version` 10→11)에 넣었다. 마스터를 같이 안 고치면 규칙이 다른 사용자에게 안 나가고
다음 업그레이드 때 이 저장소에서도 지워진다. en 템플릿이 상한 6,100 에 25자만 남아 있어
규칙을 231자로 압축하고 상한을 6,320 으로 **의도적으로** 올렸다 — 근거를 assert 메시지에
적어 다음 사람이 그 자리에서 읽게 했다.

## 검증

`cargo test`(33 스위트) · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` ·
`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9) · `pnpm test`(190파일) · `pnpm build`
전부 exit 0.
