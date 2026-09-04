---
oculpm_plan: v1
id: v241-errors-first
title: "오류부터 — 눈먼 게이트를 뜨게 하고, 거짓을 지우고, 확정 결함을 닫는다 (v2.41.0)"
status: done
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

v3-round 감사 5갈래가 찾은 확정 결함 중 소~중 비용을 3.0 앞으로 당긴다. 순서의 요지 하나 — 게이트가 오류보다 먼저다. 지금 고쳐도 막는 게 없으면 같은 결함이 3.0 동안 다시 생긴다. 전면 리디자인은 기각됐으므로 시각 작업은 "안 지킨 규칙 닫기"까지다.

## 게이트를 먼저 뜨게 한다 {#gates}
- [x] ESLint + typescript-eslint + eslint-plugin-react-hooks 도입, pnpm lint 6번째로. 기존 위반은 경고 래칫으로 시작 — 현재 eslint-disable 주석 33개가 돌지 않는 검사를 억제하고 있다 {#eslint}
- [x] rust-toolchain.toml 핀 (3줄) — CI 가 dtolnay/rust-toolchain@stable 이라 stable 이 움직이면 어제 그린이 오늘 레드다 {#toolchain-pin}
- [x] deny.toml + cargo-deny CI 잡 — 지금 의존성 취약점·라이선스 게이트가 전혀 없다 {#cargo-deny}
- [x] F6 래칫 fail-open 수정 — check-file-sizes.mjs:157-163 이 git show 실패를 전부 신규파일로 삼켜 상한이 800으로 풀린다. 신규는 git 상태코드로 판정, 읽기 실패는 던진다, stderr 보존 {#ratchet-fail-open}
- [x] 래칫 정책을 데이터로 분리 + 모양을 무는 테스트 + 진입 판정을 realpathSync 비교로 (심링크 경유 실행) {#ratchet-policy}
- [x] design_tokens.test.ts:72 의 hex 블랙리스트를 화이트리스트로 — tokens.css·code.css 밖 CSS 의 색 리터럴 금지 + 명시 예외 목록 (현재 누락 58개) {#design-whitelist}

## 지금 보이는 거짓을 지운다 {#lies}
- [x] 랜딩 한/영 6곳의 Today 의 함께 일하는 중 문구를 세션 화면으로 정정 — JSON-LD FAQPage acceptedAnswer·벤토 셀·FAQ details × 양 언어 (전부 현재형 서술이라 역사가 아니다) {#landing-a2a-target}
- [x] 활성 플랜 sessions-screen 의 readme-koen-landing-today 항목 대상 정정 + 미완 항목을 둔 채 done 으로 뒤집힌 것 바로잡기 {#fix-sessions-plan}
- [x] FTS5 주장 3면 정정 — README.md:355·README.en.md:355·landing/index.html:369. 코드에는 없다 (db/mod.rs:68 — 등록된 적 없이 2026-08-30 폐기) {#fts5-claim}
- [x] 루트 CLAUDE.md 재작성 — 구조 주장 12개 중 8개 오류. 가장 위험한 한 줄은 마이그레이션 안내 — 0NN_*.sql 파일만으론 안 되고 db/mod.rs 의 include_str! 표에 등록도 해야 한다 {#claudemd-rewrite}
- [x] docs/README.md 색인 신설 + refactor·major_update·Lite-update·20260606_refactor 에 아카이브 배너 — 문서 2/3 가 역사인데 스스로를 SSOT 로 선언한다 {#docs-index}
- [x] 잠갔다고 선언했다가 코드에서 뒤집힌 결정 6개에 인라인 정정 주석 (a2a 의 D8 방식) — osaurus:206·code-editor:85,86·lsp:130·acp-panel:81·three-features:11 {#reversed-decisions}
- [x] 소스 주석 드리프트 정정 — ShellV2.tsx:88 화면 8개(실제 16)·SettingsOverlay.tsx:6,57 탭 10/8개(실제 12)·redact.rs:15-19 세 곳에 wired(실제 19파일) {#source-comment-drift}

## 시각 확정 결함 — 안 지킨 규칙을 닫는다 {#visual-defects}
- [x] 액센트 배경 위 하드코딩 #fff 4곳을 토큰으로 — screens.css:572 플래너 체크·:407-410 A/M/D 배지·:2079 토글 노브. --text-on-accent 사용 + .dstatus.M/.D 용 --on-warn/--on-danger 신규 (다크 1.98:1, 고대비 1.43:1) {#hardcoded-white}
- [x] 한국어 조판 — base.css 본문에 word-break keep-all + overflow-wrap break-word 짝 도입, 한국어 산문 9곳의 break-word/anywhere 제거 (.entry-narrative·.msg-md 포함). 칩·툴바의 기존 nowrap 대증요법은 남긴다 {#keep-all}
- [x] 문법 강조 중복 제거 — App.css:23 벤더 github.css import 와 :404-472 다크 블록 삭제, screens.css 한 벌로. 동률 명시도로 충돌하던 hljs 토큰 4개가 닫힌다 (통합·프리셋 연결은 3.0) {#hljs-dedupe}
- [x] --text-3 승격 패스 — 읽어야 하는 문장 자리만 --text-2 로 (.empty-hint 52곳·.toolbar-sub 등). 대비 매트릭스를 문서가 아니라 vitest 케이스로 이관 {#text3-promotion}

## 파괴적 동작과 조용한 실패 {#destructive-and-silent}
- [x] ⌘W 페인 닫기에 실행 중 명령 확인 — 탭 층의 runTabCloseGuard/ptyForegroundCommand 판정 로직이 이미 있고 페인 층에서만 안 부른다 (TerminalSurface.tsx:442,458,408) {#cmdw-pane-guard}
- [x] 화면 단위 ErrorBoundary — ShellV2 화면 ternary 를 ErrorBoundary 로 감싼다. 지금 16화면 중 하나가 throw 하면 프로젝트 탭 전체가 대체 UI 가 되고 탈출로가 사라진다 {#screen-error-boundary}
- [x] WorkspaceContext 의 localStorage 접근을 try/catch 로 (:191-196, :337-344) — 단일 키라 웹뷰가 throw 하면 전 화면이 한 번에 흰 화면이 된다 {#localstorage-guard}
- [x] ACP 세션당 in-flight 1개 강제 (~50줄) — 지금 가드가 0건이라 같은 대화에 프롬프트 2개를 보내면 set_sink() 가 sink 를 덮을 뿐이고 히스토리가 꼬인다 {#acp-inflight}
- [x] RAII 턴 종료 표식 (~40줄) — Done/Failed 가 두 match arm 에만 있어 Tauri 태스크가 드롭되면 UI 가 영원히 생각 중이다 (commands/acp.rs:424-449) {#acp-raii-completion}
- [x] 정직성 감사·일지없는세션 카드의 catch 가 빈 배열로 삼키는 것 — 검사 실패를 말하게. 지금 검사 실패와 깨끗함이 화면에서 구별되지 않는다 (HonestyAudit.tsx:58, JournalMissingCard.tsx:61) {#honesty-catch}
- [x] Diff 화면의 조회 실패 4건이 변경 없음으로 위장하는 것 정정 (DiffScreenV2.tsx:105·:128·:197·:366) + 첫 프레임 로딩 게이트 {#diff-false-empty}
- [x] IPC 거절에 무한 로딩으로 굳는 6화면(graph·search·planner·retro·docs·discussion) — typedError 가 진짜 Error 를 재throw 하는 경로를 받고 재시도 버튼을 로딩 분기 밖으로 {#infinite-loading-six}
- [x] 구독 누수 15곳에 alive 가드 — 최악은 WorkspaceContext.tsx:881-1044 의 구독 10개(닫은 탭이 계속 sticky 토스트를 띄운다), TabbedWindow.tsx:385-407 은 deps 가 zoom 이라 배율마다 재무장한다 {#listener-leaks}
- [x] 일지 타임라인 상한 — oculpm_list_journal_entries 에 limit 추가(백엔드·API·프런트) + 일자당 더 보기. 지금 검색창 한 글자에 14일 창과 날짜 접기가 동시에 풀려 전 이력이 렌더된다 (537건, 가상화 없음) {#journal-timeline-limit}

## 릴리스 v2.41.0 {#release-241}
- [x] 게이트 전수 — typecheck·test·lint(6종)·build·cargo test·cargo clippy 각각 exit 0 을 직접 확인 {#gates-green}
- [x] 릴리스 5면 — 버전 6파일·CHANGELOG·README ko/en 양쪽·landing ko/en 각 6곳 + plugin.html + build.mjs 재빌드. 태그 푸시로 release.yml 이 빌드(로컬 빌드 금지), 랜딩은 landing 에서 vercel --prod {#release-surfaces}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-04T13:04:48+09:00 | #eslint | claude-code | ☐→x | 20260904/Chores/1300_chore_v241-gates-eslint-deny-ratchet.md | flat config, rules-of-hooks=error(위반0), 실측 위반 6규칙만 warn. 상한 61 |
| 2026-09-04T13:04:51+09:00 | #toolchain-pin | claude-code | ☐→x | 20260904/Chores/1300_chore_v241-gates-eslint-deny-ratchet.md | 1.98.0 + rustfmt/clippy/rust-analyzer. dtolnay 액션은 이 파일을 안 읽어 ci.yml 이 grep 해 넘긴다 |
| 2026-09-04T13:04:53+09:00 | #cargo-deny | claude-code | ☐→x | 20260904/Chores/1300_chore_v241-gates-eslint-deny-ratchet.md | 첫 실행에 취약점 4건 적발 — 3건 cargo update, quick-xml 2건은 해제조건 달아 ignore. licenses 차단으로 |
| 2026-09-04T13:04:56+09:00 | #ratchet-fail-open | claude-code | ☐→x | 20260904/Chores/1300_chore_v241-gates-eslint-deny-ratchet.md | 피해 방향이 플랜 서술과 반대였다 — 상한이 800으로 내려가 큰 파일을 줄이는 PR 이 거짓으로 붉었다 |
| 2026-09-04T13:04:58+09:00 | #ratchet-policy | claude-code | ☐→x | 20260904/Chores/1300_chore_v241-gates-eslint-deny-ratchet.md | file-size-policy.mjs 분리 + 순서까지 deepEqual + realpathSync 진입판정. 사보타주로 4건 붉어짐 확인 |
| 2026-09-04T13:05:01+09:00 | #design-whitelist | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 화이트리스트로 전환 + 예외 5개(사유 필수·개수 상한·죽은 예외 검출) + 대비 계산 vitest 이관 |
| 2026-09-04T13:05:04+09:00 | #landing-a2a-target | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | 한/영 6곳(JSON-LD FAQ·벤토·details) → 「세션」 화면. JSON-LD 4블록 파싱 확인 |
| 2026-09-04T13:05:06+09:00 | #fix-sessions-plan | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | sessions-screen 을 active 로 되돌리고 해당 항목 완료 처리 |
| 2026-09-04T13:05:09+09:00 | #fts5-claim | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | README ko/en + landing 3면을 「정확 일치」로. JSON-LD featureList 는 이미 맞았다 |
| 2026-09-04T13:05:11+09:00 | #claudemd-rewrite | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | 8건 정정. 마이그레이션 2단계(파일+db/mod.rs 등록) 명시가 가장 중요 |
| 2026-09-04T13:05:13+09:00 | #docs-index | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | docs/README.md 신설(살아있는 21행/역사 7행) + 아카이브 배너 4곳. major_update/oculpm/00-spec.md 는 살아 있어 예외 |
| 2026-09-04T13:05:16+09:00 | #reversed-decisions | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | 6건 + 부수 3건. osaurus 는 뒤집힘이 아니라 쓸 때부터 틀린 문장이라 「전제 정정」으로 |
| 2026-09-04T13:05:18+09:00 | #source-comment-drift | claude-code | ☐→x | 20260904/Chores/1301_chore_v241-doc-surface-lies.md | SettingsOverlay 10/8→12, ShellV2 8→navRegistry 위임, redact.rs 세곳→22파일(감사의 19 도 틀렸다) |
| 2026-09-04T13:05:27+09:00 | #hardcoded-white | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 4곳 + 추가 발견 3곳(agent/discussion/tray). --on-warn 5.82~7.57 · --on-danger 4.91~6.17 |
| 2026-09-04T13:05:30+09:00 | #keep-all | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | base.css + App.css 양쪽(base 는 셸 청크 전용이라 시작화면·트레이에 안 닿는다). 산문 9곳 정리, line-height 1.45→1.55 |
| 2026-09-04T13:05:33+09:00 | #hljs-dedupe | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 벤더 import + 다크블록 93줄 삭제, 벤더만 덮던 5토큰 보충. 라이트 검색 스니펫 흰 블록→투명(육안 확인 필요) |
| 2026-09-04T13:05:36+09:00 | #text3-promotion | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 토큰 자체 4.0 + 본문 17곳 승격. solarized 는 램프 역전 때문에 3단 함께 조정, 내장테마 JSON 재생성 |
| 2026-09-04T13:05:39+09:00 | #cmdw-pane-guard | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 탭 층 판정을 foregroundCommands 로 export 해 재사용. closeFocusedPane 의 13줄 복붙 중복도 접었다 |
| 2026-09-04T13:05:41+09:00 | #screen-error-boundary | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | key={view} 로 전환 시 리셋. keep-alive ACP 화면은 key 없이 자기 경계 — 안 그러면 돌던 턴이 끊긴다 |
| 2026-09-04T13:05:43+09:00 | #localstorage-guard | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 출입구 4개로 접고 직접 호출 17줄 이주. 첫 실패만 로그 |
| 2026-09-04T13:05:46+09:00 | #acp-inflight | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | TurnRegistry + 토큰. 어댑터 사망 후 죽은 턴 가드가 새 턴 자리를 푸는 경합을 토큰 비교로 차단 |
| 2026-09-04T13:05:49+09:00 | #acp-raii-completion | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | TurnGuard::Drop 이 싱크정리+턴해제+미소비 Failed 를 덮는다. 폴백 제거하면 3건 붉어짐 확인 |
| 2026-09-04T13:05:51+09:00 | #honesty-catch | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 로딩/검사실패/결과 3상태로. JournalMissingCard 는 봉투 오류까지 새로 잡는다 |
| 2026-09-04T13:05:54+09:00 | #diff-false-empty | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 아직 모름/못 물어봄/정말 없음 셋으로. 테스트 목이 ok(null) 을 주며 같은 증상을 재현하고 있었다 |
| 2026-09-04T13:05:57+09:00 | #infinite-loading-six | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 6화면 전부 try/catch/finally + 재시도를 로딩 분기 밖으로. useTodayBrief 관용구를 따랐다 |
| 2026-09-04T13:06:00+09:00 | #listener-leaks | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | createUnlistenBag 으로 15곳 전부 이주 — bag.add 가 alive 를 소유해 새 구독이 구조적으로 안전 |
| 2026-09-04T13:06:02+09:00 | #journal-timeline-limit | claude-code | ☐→x | 20260904/Bugs/1304_bug_v241-destructive-and-silent-failures.md | 신규 커맨드 oculpm_list_journal_entries_page(limit/offset/total) + 일자당 더보기 + 그리는 개수 상한 25 |
| 2026-09-04T06:06:19.705767+00:00 | #gates-green | user | ☐→~ |  |  |
| 2026-09-04T06:06:20.829451+00:00 | #release-surfaces | user | ☐→~ |  |  |
| 2026-09-04T06:06:23.157392+00:00 | #gates-green | user | ~→x |  |  |
| 2026-09-04T06:06:28.725356+00:00 | #release-surfaces | user | ~→x |  |  |
| 2026-09-04T06:06:30.775749+00:00 | #gates-green | user | x→☐ |  |  |
| 2026-09-04T06:06:31.414857+00:00 | #release-surfaces | user | x→☐ |  |  |
| 2026-09-04T15:07:35+09:00 | #gates-green | claude-code | ☐→x | 20260904/Chores/1507_chore_release-v241.md | 로컬 8종 + cargo-deny 전부 exit 0. CI 는 PR·main 양쪽 세 잡 success (cancelled run 하나는 판정에서 제외) |
| 2026-09-04T15:07:37+09:00 | #release-surfaces | claude-code | ☐→x | 20260904/Chores/1507_chore_release-v241.md | 항목 문구의 「버전 3파일」은 내 오기 — 실제는 6파일이고 그렇게 했다. 랜딩 ko/en 각 6곳 + plugin.html + build.mjs 재빌드. 라이브 2.41.0 확인 |
| 2026-09-04T15:09:35+09:00 | #gates-green | claude-code | x→x |  | v2.41.0 태그(fe7f3ea)로 release.yml 이 빌드·서명·릴리스 완료 — 게이트 통과가 그 전제였다 |
| 2026-09-04T15:09:41+09:00 | #release-surfaces | claude-code | x→x |  | gh release view v2.41.0 확인 — dmg·app.tar.gz·sig·latest.json 4종 게시(2026-09-04T05:42Z) |
<!-- oculpm:plan-log end -->
