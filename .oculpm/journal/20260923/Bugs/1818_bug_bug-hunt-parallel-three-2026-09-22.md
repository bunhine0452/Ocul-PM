---
schema_version: 1
type: bug
slug: "bug-hunt-parallel-three-2026-09-22"
status: done
difficulty: high
created_at: "2026-09-23T18:18:26+09:00"
session_id: "mcp-20260923-181826"
agent:
  id: "claude-code"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "bug-hunt"
  - "parallel-agents"
  - "webview"
  - "ime"
  - "tauri-events"
  - "lsp"
  - "symlink"
  - "log-aggregation"
  - "mcp-tool"
---
[x] 병렬 3세션 버그 헌팅 — 로그가 가리킨 여덟 갈래, 절반은 브라우저 기본 동작이었다

## 증상

사용자 요청은 "병렬세션(최대 3)으로 버그 조사 → 커밋 → 배포". 명시된 버그 목록이 없어, 설치본 로그(`oculpm.log.2026-09-*`)를 **모양별로 집계**해 대상을 골랐다. grep 은 포화라 쓸모가 없고, 날짜별 카운트가 "이미 고쳐진 것"과 "아직 사는 것"을 갈랐다 — `automation tick failed` 는 09-09 에 8,171건이지만 09-15 이후 1건(=v3.2.2 에서 닫힘), `Couldn't find callback id` 는 09-21 에도 22건(=현재 결함).

세 워크트리 에이전트에 영역을 갈라 맡겼다: A 터미널, B IPC/이벤트/탭 생명주기, C 코드화면·LSP·워처.

## 원인

**절반이 같은 뿌리였다 — 웹뷰에서 막히는 브라우저 기본 동작.**

1. **터미널 OSC 8 링크**(`TerminalInstanceImpl.tsx:301`) — `new Terminal({...})` 에 `linkHandler` 가 없어 xterm `OscLinkProvider.defaultActivate` 로 떨어짐. 거기서 `confirm()` → Tauri dialog 플러그인이 `window.confirm` 을 async 로 덮어써 `plugin:dialog|confirm` 호출 → **`dialog:default` 권한 세트에 `allow-confirm` 이 없어** ACL 거부. Promise 는 truthy 라 `window.open()` 까지 진행 → WKWebView 에서 null. 링크는 안 열리고 로그 두 줄만.
2. **Monaco URL ⌘클릭**(`monaco/setup.ts`) — 같은 부류. `OpenerService` 기본 외부 오프너가 `window.open(url,"_blank","noopener")`, wry 0.55 는 새 창 처리기가 없으면 nil. **오류도 로그도 없이** 죽었다.
3. **IME 확정 왕복**(`imeBridge.ts`) — 브리지 머리말이 "이 웹뷰는 조합 이벤트를 안 쏜다" 를 전제했지만 로그는 **두 모델 공존**을 말했다(`insertCompositionText` 09-12 하루 4,190건 vs `insertReplacementText` 0). 표준 모델의 확정은 `deleteCompositionText`+`insertFromComposition` 쌍인데 삭제 쪽을 동기화해 확정마다 DEL+재전송. 첫 음절이면 `echoed=""` 라 잔여분 진단이 **정상 확정마다** 울렸다. 트레이스 150건 전수 집계: inputType 150/150 `insertFromComposition`, echoed 150/150 "" — **글자 유실은 없었다.**
4. **`Couldn't find callback id` ×6**(`@tauri-apps/api` `event.js:41`) — `_unlisten` 이 **JS 콜백을 먼저 지우고** `plugin:event|unlisten` 을 나중에 보낸다. Rust 의 emit 은 `webview.eval` 이라 그 사이(그리고 eval 큐에 이미 실린 것)가 전부 없는 id 를 두드린다. **"6번" = 해제 순간 큐에 밀려 있던 이벤트 수**. 색인 채널은 반증됨 — 경고가 난 09-19·09-21 로그에 `indexing start` 가 0건이고, Rust `Channel` 의 `end` 는 `drop` 에서만 나가 "end 이후 send" 가 구조적으로 불가능하다.
5. **지운 프로젝트의 잔해**(`delete_project`) — 매니저에서 잊고 DB 행만 지워 탭이 `#22` 로 남았다. 더 큰 것은 `db.compact()`(VACUUM)를 **await** 한 것 — 연결이 하나라 그동안 모든 DB 호출이 줄을 서 init 이 3초 만에 실패했고(06:11:55 열기 → 06:11:59 실패), 탭 갱신까지 밀려 사용자가 없는 탭의 × 를 네 번 눌렀다(`레지스트리에 없는 탭` ×4 의 정체).
6. **설정 크래시**(4곳) — `useWorkspace()` 직접 호출. 넷 다 `projectId == null` 분기는 이미 갖고 있었고, 그 분기에 **닿기 전에** 던졌다.
7. **심링크 트리**(`code/tree.rs:read_dir_level`) — `DirEntry::metadata()`(lstat)로 링크를 파일처럼 실어, 클릭해야 "Path escapes the project root" 를 봤다. 겸해 자식 경로를 canonical `dir` 에서 만들고 있어 **루트 자체가 심링크 아래면**(`/tmp`→`/private/tmp`) 목록이 통째로 비는 잠복 결함도 있었다.
8. **LSP `ContentModified`**(`lsp/client.rs:385`) — `error_message()` 가 오류 객체를 `"{message} (code {n})"` 로 짓이겨 호출자가 코드로 구별할 길이 없었다. 취소 부류 셋(-32800/-32801/-32802)은 명세상 "다시 물으면 된다"인데 전부 ERROR.

## 변경 요약

- 터미널·Monaco 링크를 백엔드 `open_url` 한 통로로 (`features/terminal/urlLinks.ts`, `features/code/monaco/linkOpener.ts`, `api/fileOpen.ts` 파사드). http/https 만, 그 밖은 기존 오프너에 양보.
- `imeBridge`: `deleteCompositionText` 를 미루고(`deferredCompositionDelete`), 삽입 없이 `compositionend` 면(조합 취소) 그때 적용. 옛 모델 경로 무변경.
- `lib/transport/event.ts` 셤: 해제는 `plugin:event|unlisten` 을 **먼저**, JS 콜백은 2초 뒤(`UNREGISTER_GRACE_MS`). 핸들러 앞 `dead` 가드로 늦은 eval 을 조용히 버린다. vite alias 라 호출부 변경 0.
- `close_project_surfaces()` — 행 삭제 **전에** 탭·터미널 창을 닫는다. 여는 두 경로가 레지스트리 전에 DB 존재 확인. `compact()` 는 `spawn` 으로 분리.
- `settings/tabs/ui.tsx` 에 `useSettingsProjectId()`+`NeedsProject`, 네 곳이 사용.
- `CodeDirEntry.link: Option<SymlinkTarget>`(inside/outside/dangling), 프런트 `.unreachable` 흐림+사유 툴팁, 트리에서 여는 문 3개를 `openFromTree` 하나로.
- `RpcError { code, message }` + `is_stale()`, 읽기 질의 8곳은 빈 결과+debug 로 접고 파일을 고치는 셋(포맷·이름바꾸기·코드액션)은 오류 유지.
- 워처 `is_vanished()` — NotFound 계열 skip 은 debug, `UpsertFailed`·권한 오류는 WARN 유지.
- 확인 대화상자 리디자인(다른 세션 WIP 합류) + 그 라벨이 `<span>` 으로 들어가며 깨진 `index_usage_section.test.tsx` 선택자 교정.

## 검증

게이트 전부 exit 0 직접 확인: `pnpm typecheck` · `pnpm test`(239파일 2,846건) · `pnpm lint`(6게이트, eslint 0 errors) · `pnpm build` · `cargo fmt --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test`(36 스위트 전부 0 failed).

회귀 테스트 신규: `terminal_url_links`(9) · `monaco_link_opener`(5) · `ime_bridge` 조합 모델(7, **진단이 살아 있는 대조군 포함**) · `transport_event_unlisten`(9, 마지막 2건은 상류 결함을 못 박는 참조 테스트) · `settings_without_workspace`(6, 설정 트리 전수 스캔) · `tree_tests`(Rust 4) · LSP(Rust 3) · 워처(Rust 1) · `delete_project`(Rust 5).

## 이월

- **실기기 확인 이월**: 이벤트 해제 셤은 웹뷰의 **모든** Tauri 구독을 지난다 — 터미널 출력·재접속, 테마 다창 반영, 트레이 딥링크, ACP 스트림. IME 는 설치본 배포 뒤 `grep -c IME-DUMP` 가 0 근처면 성공.
- `commands/project.rs` 가 파일 크기 래칫 경계(800/800)에 붙었다 — 다음에 이 파일을 건드리는 작업은 쪼개야 한다.
- `dialog:default` 에 `allow-confirm` 이 없어 **웹뷰 어디서든 bare `window.confirm()` 은 항상 truthy Promise + ACL 에러**. 서드파티가 부르는 것이 재발 지점 — 린트 게이트 후보(미구현).
- JS 쪽 `listeners[event][eventId]` 표 엔트리 누수는 상류와 동일하게 남는다(내부 전역 이름 접근 불가, 객체 하나 크기).