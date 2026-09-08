---
oculpm_plan: v1
id: hardening-and-optimization
title: "감사 후속 — 패닉 경로 · 경계 좁히기 · 최적화 원장"
status: done
created: 2026-09-07
updated: 2026-09-07
owner: claude-code
---

2026-09-07 코드 감사(정적 스캔 + clippy + eslint + 프로덕션 빌드 + 패닉 실증)에서 확정한 것만 닫는다. 게이트는 전부 초록이었으므로 이 라운드도 "깨진 것"이 아니라 **"돌아가지만 잘못돼 있는 것"** 을 다룬다. 추정은 싣지 않는다 — 실증한 것과 grep 으로 호출자 0을 확인한 것만.

## 패닉 경로 — 실증 완료 {#panics}
- [x] percent-decode 가 str 을 바이트 인덱스로 슬라이스해 `%` + 멀티바이트에서 패닉 — 같은 코드 3벌 (deeplink.rs:182 · notion.rs:405 · lsp/registry.rs:130). 딥링크는 웹페이지가 유발 가능. 공용 헬퍼 하나로 통합 + 경계 테스트 {#percent-decode}
- [x] overview.rs:268 매니페스트 절단이 char 경계를 안 본다 — `&content[..min(len, 24KB)]`. 이 저장소 README.md(97KB)는 24576이 마침 리드 바이트라 1바이트 차이로 살아 있다. 같은 파일의 절단 3곳(llm/mod.rs:167 · commands/oculpm.rs:1047 · acp/session.rs:751)은 이미 막혀 있고 여기만 빠졌다 {#overview-truncate}

## 경계 좁히기 {#boundaries}
- [x] notion.rs oauth_nonce() 가 CSPRNG 가 아님 — blake3(nanos+pid+counter). 로컬 프로세스가 nonce+포트를 맞히면 180초 창 안에 공격자 Notion 토큰을 키체인에 주입. 같은 저장소 mobile_bridge/pairing.rs 는 이미 uuid v4 를 쓴다 {#oauth-nonce}
- [x] capabilities/default.json 의 `opener:allow-open-path {path: **}` 제거 — 웹뷰 호출자 0 (plugin-opener 임포트는 OculpmSettings 의 revealItemInDir 하나뿐) {#opener-open-path}
- [x] plugins/install.rs:205 secure_join 주석이 구현을 앞선다 — "심링크 탈출을 전부 거절한다"인데 어휘적 검사만. 심링크 성분 거부를 실제로 넣거나 주석을 사실로 내린다 {#symlink-guard}
- [ ] tauri.conf.json `csp: null` — XSS 표면 자체는 지금 깨끗하지만(hljs 이스케이프 출력 · rehype-raw 부재 확인) 방어층이 0. **실기기 확인 필요** — wasm 포매터·xterm webgl·CodeMirror·GitHub 릴리스 fetch 가 전부 걸린다. 정책 초안만 두고 실행은 앱 실행 라운드에서 {#csp}

## 최적화 {#perf}
- [x] aiContext.ts 의 IPC 직렬 루프 — :132 플랜마다 planGet 순차, :195 일지 3건 순차. 메시지 하나에 최대 8왕복이 직렬. Promise.all 로 접는다 {#ai-context-parallel}
- [x] forEach(async …) 떠 있는 프로미스 — AiPanelScreenV2.tsx:318 · GreenfieldWizard.tsx:222. 뒤쪽은 취소 체크도 없고 cliChecks 스테일 클로저까지 겹친다 {#floating-promises}
- [x] ~~진입 청크 606KB(gzip 207KB)~~ **문구가 틀렸다** (2026-09-07 실측) — 606KB 는 CodeMirror 청크이고 이미 `React.lazy` 뒤에서 지연 로드된다(빌드 경고의 최대 청크를 진입으로 오인). 진짜 진입 청크는 288.40KB 였다. `manualChunks` 로 React 를 가르면 합계가 288.07KB 로 같아 라벨만 옮기는 짓이라 되돌렸다. 실제로 뺀 것은 `settings/uiScale.ts` 의 `@tauri-apps/api/webview` 정적 import(→ 동적): **288.40 → 261.86KB, −9.2%**. 측정은 `scripts/measure-entry-chunk.mjs` 로 재현된다 {#entry-chunk}
- [x] 워처가 루트 전체 recursive 감시 + 필터는 사후 — perf-baseline M1 이 이미 확정한 자리(체크아웃 1회 = 1,058 이벤트, 드레인 4.3초). 큐는 4096 bounded 로 막혔지만 사전 필터는 아직 {#watcher-prefilter}

## 기록 {#ledger}
- [x] docs/optimization/ 최적화 원장 개설 — 앞으로의 최적화는 여기 적는다. docs/README.md 「살아 있는 설계」 표에 등재 {#opt-ledger}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-07T16:44:10+09:00 | #percent-decode | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md | 새 text.rs 로 3벌 통합 + 회귀 테스트. 딥링크 유발 경로 실증됨 |
| 2026-09-07T16:44:17+09:00 | #overview-truncate | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md | floor_char_boundary + read_manifests 추출해 3위상 회귀 테스트. 맞던 절단 3곳도 같은 헬퍼로 |
| 2026-09-07T16:44:23+09:00 | #oauth-nonce | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md | uuid v4 (getrandom) — pairing.rs 규약에 맞춤 |
| 2026-09-07T16:44:30+09:00 | #opener-open-path | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md | 제거. plugin-opener 임포트는 revealItemInDir 하나뿐임을 전수 확인 |
| 2026-09-07T16:44:37+09:00 | #symlink-guard | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md | symlink_metadata 성분 검사로 주석을 사실로. 나머지 가드 4벌의 강도 차이는 원장에 기록 |
| 2026-09-07T16:44:43+09:00 | #ai-context-parallel | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/1644_refactor_serial-ipc-and-floating-promises.md | 계획 5→2 · 일지 4→2 직렬 단계. 호출부 합치기는 {#ai-context-callsite} 로 원장에 이월 |
| 2026-09-07T16:44:50+09:00 | #floating-promises | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/1644_refactor_serial-ipc-and-floating-promises.md | 조각 훅 2개로. ESC 스테일 클로저가 초안을 날리던 진짜 버그도 같이 닫음. eslint 상한 61→50 |
| 2026-09-07T16:44:56+09:00 | #opt-ledger | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/1644_refactor_serial-ipc-and-floating-promises.md | docs/optimization/00-ledger.md 개설 + docs/README 살아있는설계 표 등재. 기각 6건도 기록 |
| 2026-09-07T20:27:29+09:00 | #watcher-prefilter | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2027_refactor_lock-scope-and-watcher-prefilter.md | PreFilter 로 gitignore 를 채널 앞으로. 빌드 폭풍 5,000건 → 링에 1건. 이 플랜이 status:done 으로 잘못 닫혀 있어 active 로 되돌림 (csp·entry-chunk 미완) |
<!-- oculpm:plan-log end -->
