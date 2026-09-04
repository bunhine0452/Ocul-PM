---
schema_version: 1
type: bug
slug: "v241-destructive-and-silent-failures"
status: done
difficulty: superhigh
created_at: "2026-09-04T13:04:31+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/base.css"
    op: update
  - path: "src/App.css"
    op: update
  - path: "src/features/terminal/TerminalSurface.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/lib/unlisten.ts"
    op: update
  - path: "src/features/today/HonestyAudit.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/__tests__/errors_first_round.test.tsx"
    op: create
  - path: "src-tauri/src/acp/turn.rs"
    op: create
  - path: "src-tauri/src/commands/journal_page.rs"
    op: create
  - path: "src-tauri/tests/journal_page_limit.rs"
    op: create
related: []
tags:
  - "a11y"
  - "honesty"
  - "acp"
  - "terminal"
  - "v241"
  - "mcp-tool"
---
[x] 확인 없이 죽이고, 실패를 깨끗함으로 보이던 것들 — 시각·프런트·백엔드 확정 결함

플랜 `v241-errors-first` 의 Phase `visual-defects` + `destructive-and-silent`. `[v3-round]` 감사 다섯 갈래가 확정한 결함 중 소~중 비용을 3.0 앞으로 당겼다.

## 발생 원인

셋으로 갈린다.

**① 토큰을 만들어 놓고 안 쓴 자리.** `--text-on-accent` 가 테마별 7값 존재하는데 액센트 배경 위에 `#fff` 를 박은 곳이 넷이었다 — 기본 다크에서 플래너 완료 체크가 **1.98:1**, 변경 파일 `M` 배지는 **모든 테마에서** 실패(앰버 위 흰 글자), 접근성용 고대비 프리셋에서 **1.43:1** 로 사실상 사라졌다. 라이트에서만 통과한 이유는 그 테마의 `--text-on-accent` 가 마침 `#ffffff` 라서다.

**② 실패를 표현할 자리를 안 만든 것.** `catch` 뒤 빈 배열을 세우고 렌더를 건너뛰면 "검사 실패"와 "깨끗함"이 화면에서 구별되지 않는다(정직성 감사·일지없는세션 카드). Diff 는 조회 실패 4건을 "변경 없음"과 **글자 하나 다르지 않게** 보여 줬다. 6화면은 `typedError` 가 재throw 하는 전송 계층 실패를 안 받아 무한 로딩으로 굳었고, 재시도 버튼이 로딩 분기 뒤에 있어 나올 길이 없었다.

**③ 수명과 동시성을 아무도 소유하지 않은 것.** `listen()` 프로미스가 언마운트 뒤 resolve 하면 리스너가 남는다 — `WorkspaceContext` 한 이펙트에 그런 구독이 **10개**였고, 남는 핸들러가 sticky 토스트를 띄워 **닫은 탭이 계속 말을 걸었다.** ACP 는 세션당 in-flight 가드가 **0건**이라 같은 대화에 프롬프트를 두 번 보내면 `set_sink()` 가 sink 를 덮을 뿐이었고, 턴 종료 이벤트가 match arm 둘에서만 나가 태스크가 드롭되면 UI 가 영원히 "생각 중"이었다.

## 해결 방법

**시각** — `#fff` 4곳을 토큰으로, 앰버/레드용 `--on-warn`/`--on-danger` 신설(4.91~7.57). `--text-3` 은 6개 테마 전부 AA 미달이었는데 382곳을 다 바꾸는 대신 **토큰 자체를 4.0 으로 올리고 본문 성격 17곳만** `--text-2` 로 승격(Solarized 는 램프가 뒤집혀 `--text`·`--text-2` 까지 함께 조정). `word-break: keep-all` + `overflow-wrap: break-word` 짝을 본문 기본에 도입 — 전체 CSS 에 `keep-all` 이 **0회**였고 그래서 "「수정됨」이 세로로 선다" 는 `nowrap` 대증요법이 네 벌 있었으며, 정작 가장 긴 한국어 산문 둘은 반대로 문자 단위 분해가 켜져 있었다. hljs 중복 4벌 중 벤더 import + 다크 블록 93줄 삭제(동률 명시도로 충돌하던 4토큰 해소). 게이트는 hex 블랙리스트에서 **화이트리스트**로 뒤집고(팔레트 층 밖 CSS 는 색 리터럴 금지, 예외 5개는 사유 필수 + 개수 상한 + 죽은 예외 검출) 대비 계산을 vitest 로 이관했다.

**프런트** — ⌘W 페인 닫기가 탭 층의 `foregroundCommands` 판정을 재사용해 확인창을 띄운다(로직은 이미 있었고 페인 층에서만 안 불렀다). 화면 단위 `ErrorBoundary`(keep-alive ACP 화면은 key 없이 자기 경계 — 바깥 key 안에 넣으면 화면 전환마다 재마운트돼 돌던 턴이 끊긴다). localStorage 출입구 4개로 접고 try/catch. `createUnlistenBag()` 으로 15곳 전부 이주 — `bag.add()` 가 alive 검사를 소유하므로 **새 구독은 자루에 넣는 것만으로 안전**하다.

**백엔드** — `TurnRegistry` + `TurnGuard`. 토큰을 둔 이유는 경합이다: 어댑터 사망 → `clear_target` → 새 턴 시작 → 죽은 턴의 가드가 뒤늦게 드롭되며 **새 턴의 자리를 푸는** 순서가 있었다. `Drop` 이 싱크 정리 + 턴 해제 + 미소비 시 `Failed` 발행을 덮는다. 일지 목록에 `limit`/`offset` 과 `total` 을 더하고(신규 커맨드 `oculpm_list_journal_entries_page`) 일자당 「더 보기」 — 검색창 한 글자에 14일 창과 날짜 접기가 **동시에** 풀려 전 이력(537건)이 렌더되던 것을 막는다.

## 검증

가드를 실제로 무력화해 테스트가 붉어지는지 확인했다 — ACP `Drop` 폴백 제거 → 3건, busy 검사 제거 → 1건, ⌘W 가드 제거 → 4/11건, 저장소 출입구 우회 → 저장소 테스트, 일지 상한 무력화 → 프런트 2건. ACP 테스트는 트레이트 흉내가 아니라 **실제 `tauri::ipc::Channel`** 을 쓰고, 비정상 종료는 `tokio::time::timeout` 으로 future 를 드롭시켜 재현했다.

게이트 전수: `typecheck`·`lint`(6종)·`build`·`test`(2256건)·`cargo fmt`·`clippy`·`cargo test` 전부 exit 0.

**앱은 돌리지 않았다** — 사용자 설치본과 락이 경합한다. 육안 확인이 필요한 것 13건(hljs 삭제 후 diff·검색 스니펫 색, 켜진 토글 노브, 변경 상태 배지 3종, 흐린 글자 승격 후 위계, `line-height` 1.45→1.55, `keep-all` 좁은 창, ⌘W 확인창 3화면, 화면 경계 폴백, 일지 「더 보기」 레이아웃)는 릴리스 전 `v3-release {#eyes}` 로 넘긴다.

## 메모

파일 크기 래칫이 설계를 개선하게 만들었다 — 백엔드 초기 구현이 4파일을 한계 위로 밀자 커맨드를 `commands/journal_page.rs` 로, 캐시 테스트를 통합 테스트로, 싱크 배선을 `acp/turn.rs` 로 쪼갰고 결과적으로 `commands/oculpm.rs`·`cache/tests.rs` 는 무변경으로 되돌아갔다.

이 일지를 쓰다가 오탐 하나를 발견했다 — `config.toml` 의 `forbid_journal_for_paths` 에 `**/*token*` 이 있어 **디자인 토큰 파일**(`styles/tokens.css`, `design_tokens.test.ts`)이 시크릿으로 오인돼 `files_touched` 에 못 들어간다. 그 두 파일도 이 작업에서 함께 고쳤다. 패턴을 좁히는 것은 후속으로.

남은 것 둘: `acp_load_session` 이 아직 가드 밖에서 `set_sink` 를 한다(종료 이벤트는 자기 채널로 가므로 "생각 중" 굳음은 없다 — `turn.rs` 독에 기록). 액센트 위 글자색 조합 자체가 라이트 가족 6팔레트에서 AA 미달(4.35 ~ 3.00)이라 팔레트 재조율은 3.0 몫이고, 테스트에 래칫으로 박아 뒀다.