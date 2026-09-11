---
oculpm_plan: v1
id: v3-release
title: "3.0 을 내보내기 전에 — 육안 확인 부채와 영문 표면 (3.0.0)"
status: active
created: 2026-09-04
updated: 2026-09-08
owner: claude-code
---

이 저장소에서 「완료」의 실제 의미는 "코드는 들어갔고 사람 눈으로는 안 봤다"였다. done 플랜 40개에 그런 항목이 약 25건 남아 있고, UI 손맛이 본질인 라운드가 통째로 미확인인 채 done 이다. 3.0 은 그 부채를 갚는 라운드이기도 하다.

## 육안 확인 부채 {#eyes}
- [x] drag-and-drop-round 미확인 6건 — 탭 드래그·떼어내기·창간 이동 {#eyes-dnd}
- [x] terminal-identity-round 3건 + search-and-terminal-survival PTY 수동 확인 + tab-reattach-regression 1건 {#eyes-terminal}
- [x] skills-star-round 2건 · mobile-bridge 검증 · claude-integration 런타임 확인 2건 {#eyes-skills}
- [x] first-run-and-english-landing 의 마법사 실기기 확인 (wizard-eyes) {#eyes-wizard}
- [x] 혼합 DPI 커서 좌표계 — improvement-audit-round 에서 이관했는데 받은 플랜에 항목이 없어 유실됐다 {#eyes-mixed-dpi}
- [x] v2.42.0 미확인 ~20건 — 큰 붙여넣기(raw 모드 터미널에 수백 KB: 다른 탭 반응·나중에 순서대로 도착)·한국어 IME 조합 순서·리사이즈와 타이핑 겹침·Kill 뒤 셸 종료·글자크기/터미널폰트 슬라이더 드래그 체감과 놓을 때 저장·드래그 중 탭이동 flush·나머지 슬라이더 7개 라벨 추종·터미널 도크 리사이즈/분리/복귀·⌘K 이동과 사이드바 접기·실패 토스트 문구·index_project 실경로 1회·큐 오버플로 실경로(경고→만회→토스트)·프로젝트 닫은 뒤 색인/히스토리 정지·LSP 서버 일람·임베딩 진행 배너·읽기전용에서 주인 회수 {#eyes-v242}
- [ ] macOS 권한 프롬프트 — 설정 → ocul-pm → 연동 탭을 열었을 때 **아무것도 안 뜨는지**, 그리고 [Desktop 확인] 을 눌렀을 때**만** 「다른 앱의 데이터」를 묻는지. 승인을 지우고 봐야 한다: `tccutil reset SystemPolicyAppData com.kimhyunbin.ocul-pm`. 코드는 회귀 테스트(마운트 시 호출 0)로 잠갔지만 프롬프트가 뜨는 순간은 사람 눈으로만 본다 — 설치본 2.45.1 에는 이 수정이 없으므로 다음 릴리스 뒤에 {#eyes-tcc-desktop}
- [x] 플래너 리디자인 실기기 육안 확인 — 라이트/다크 × 프리셋 5종에서 CSS 상태 마크(`.pmark` 여섯 상태 · 체크 정렬 · 막힘 `!` 대비) · 단계 스트립 조각 색과 hover 늘림 · 스티키 단계 머리 바탕이 시트와 같은지 · 행 hover 동작 무리(▾ ✎ 🗑 실행)의 노출 · 보드 열 위 선 · 좁은 폭(컨테이너 720 이하)에서 메타 열이 제목 아래로 내려가는지. 하네스(vitest DOM 덤프 + 실제 CSS)로는 봤고 WKWebView 실기기는 안 봤다 {#eyes-planner-redesign}
- [x] 작업 일지 원장 리디자인 실기기 육안 확인 — 라이트/다크 × 프리셋 5종에서 종류색 척추(`.jl-spine`)와 색띠(`.jl-strip`)의 `--t-*` 대비 · 스티키 날짜 머리글 바탕이 본문과 같은지 · 툴바 `.seg` 안 종류색 점 정렬 · 행 hover/focus 링 · 날짜 레일 막대 · 좁은 폭(컨테이너 640 이하)에서 레일이 숨고 명단이 아래 줄로 내려가는지 · Today→일지 초점 1.6초 강조. 하네스(vitest DOM 덤프 + 실제 CSS)로는 봤고 WKWebView 실기기는 안 봤다 {#eyes-journal-ledger}
- [x] 플래너 계획 레일 리디자인 실기기 육안 확인 — 라이트/다크 × 프리셋 5종에서 진행 파이(`.pln-pie` conic-gradient 채움·완료 꽉 찬 원·보관 점선)의 대비 · ⋯ 옵션 메뉴가 레일 폭 170px 에서도 화면 안에 서는지(오른쪽 레일이면 왼쪽으로 여는지) · 접힌 띠의 세로 라벨 · 제목 2줄 클램프와 hover 카드의 역할 분담 · 섹션 머리 sticky 바탕. 하네스로는 봤고 WKWebView 실기기는 안 봤다 {#eyes-planner-rail}
- [x] 시작 탭 원장 리디자인 실기기 육안 확인 — 라이트/다크 × 프리셋 5종에서 사령탑 밴드(`.hl-lead` 이름 fs-9 · 맥박 200×48 의 액센트 막대 · 플랜 진행 막대) · 원장 행 커서(왼쪽 3px 액센트)와 hover 이름 프로젝트색 · 묶음 헤더 hairline 꼬리 대비 · 조용함 묶음 0.6 흐림 · 흐름 레일의 `--bg-sidebar` 면과 왼쪽 hairline · 1080px 이하에서 레일이 아래로 접히고 맥박이 숨는지 · macOS 신호등과 레일 좌단 정렬. 하네스(vitest DOM 덤프 14프로젝트 + 빌드 CSS)로는 봤고 WKWebView 실기기는 안 봤다 {#eyes-start-ledger}
- [x] 글리프 위생 — codex-acp 6건이 [~] 인데 done(release-gates 미확정 포함) · skill-catalog-round-2 는 archived 여야 · drag-and-drop Phase 8 의 4건은 [-] 여야 · menubar-tray 의 v2.3.0 항목은 죽은 항목 {#glyph-hygiene}

## v2.42.0 이월 — 네 세션이 소유 밖에서 발견한 것 {#v242-carry}

받는 플랜에 항목이 없어 유실된 전례(`{#eyes-mixed-dpi}`)를 되풀이하지 않으려고 여기에 적는다.

- [x] `manager/lifecycle.rs::watcher_stop` 이 전역 맵 write 락을 쥔 채 `watcher.stop().await` 로 드레인을 기다린다 — 기준선이 잰 드레인이 4.3초다. v2.42.0 의 `{#manager-write-lock}` 과 같은 병리인데 그 3항목 밖이라 남았다 {#v242-watcher-stop-lock}
- [x] `oculpm/lock.rs` 의 `LockGuard::drop` 이 "디스크 pid == 내 pid" 로만 소유를 판정한다 — 한 프로세스 안에 같은 경로의 가드가 둘이면 서로의 파일을 지운다. 지금은 `lifecycle_lock` 이 그 상황을 막고 있을 뿐이고, 근본 해결은 가드 무장 해제나 프로세스 내 경로별 소유권 등록이다 {#lockguard-disarm}
- [x] 워처 드레인 시간 자체 — 유계 큐는 메모리 상한만 고쳤다. 줄이려면 gitignore 판정을 채널 **앞**으로 당기거나(`target/` 55,663 파일이 큐에 안 들어오게) 소비를 배치화해야 한다 {#watcher-drain-time}
- [x] `WatcherStatus.dropped_total` 노출 — 지금 큐 버림은 로그와 토스트로만 보이고 진단 화면에서 볼 수 없다. `spec.rs` + `bindings.ts` + 프런트가 함께 움직여야 한다 {#dropped-total-surface}
- [x] 소유 밖 `void set(...)` 8자리를 `useSaveSetting` 으로 — `features/theme/ThemeGallery.tsx:68,101` · `features/onboarding/WelcomeWizard.tsx:98,130,135,229,252` · `lib/theme.tsx:38`. 지금도 사용자에게 보이긴 하지만 계약이 갈려 있다 {#void-set-remainder}
- [x] `MenubarSection` 의 마운트 시 `settingsGetAll` 이 조용히 실패한다 — 트레이 토글이 이유 없이 비활성으로 남는다 {#menubar-silent-fetch}
- [x] 떠 있는 프로미스 약 100개가 플랜이 지목한 경로 밖에 남아 있다 {#floating-promises-rest}
- [>] 스케줄링을 재는 계측이 없다 — "런타임 워커가 얼마나 막혔나 · 큐가 얼마나 찼나 · 버림이 몇 번인가". 지금 하니스는 날것의 일만 잰다 (perf-baseline §7) {#scheduling-telemetry}
- [x] `scripts/check-no-hardcoded-korean.mjs` 의 `TESTS` 허용목록에 `__tests__/workspace_slice_consumers.test.tsx`·`__tests__/settings_deferred_commit.test.tsx` 두 줄 — 지금 그 둘만 테스트 이름이 영어라 집 문체에서 벗어나 있다 {#test-name-allowlist}
- [x] `package.json` 의 `--max-warnings=61` 에 여유가 0 이다 — 다음 라운드가 경고 하나만 늘려도 붉어진다. 래칫을 내리는 정리 패스가 필요하다 {#eslint-ratchet-slack}

## v3-record-integrity 이월 — 기둥 1 이 소유 밖에서 남긴 것 {#pillar1-carry}

기둥 1(19항목)을 2026-09-05 에 마감하며 나온 빚. 일지에만 적으면 유실되므로(`{#eyes-mixed-dpi}` 가 그 사고 기록) 여기에 항목으로 적는다.

- [x] **병렬 세션에서 배달 게이트가 아예 발화하지 않는다** — 살아 있는 옆 대화가 하나라도 있으면 전부 `undecided` 다. 오탐보다 미탐을 고른 결과지만, 이 저장소의 주 사용 방식이 병렬 세션이라 게이트가 사실상 꺼져 있다. 넘어설 재료는 이미 있다: Stop 페이로드의 `transcript_path` 에 그 대화 자신의 Edit/Write 도구 호출이 들어 있어 **대화별 양성 귀속**이 가능하다 {#gate-positive-attribution}
- [x] **제품 약속 문구가 사실보다 좁다** — `CLAUDE.md`·README ko/en·랜딩의 "LLM 호출과 업데이트 확인 말고는 기기 밖으로 안 나간다"는 실제로 예외를 다섯 개 더 갖는다: Notion API + `https://oculpm.com/api/notion/oauth/start` **OAuth 브로커**(우리 서버가 사용자 인증 흐름 한가운데 있다) · 플러그인 zip · 테마 다운로드 · fastembed 모델. 원장(`tests/egress_inventory.rs`)이 사실을 적었으니 다음은 문구다 {#promise-text-truth}
- [x] `tauri.conf.json` 의 `csp: null` — 웹뷰에 CSP 가 없어 아무 데나 갈 수 있다. 지금은 프런트 유출 원장이 대신 지킨다 {#webview-csp}
- [x] `oculpm::reconcile` 이 CAS 문지기 밖 — 앱 내부 화해기가 여전히 인프로세스 `plan_write_lock` 만 써서, 앱과 MCP 서버가 동시에 같은 플랜을 고치는 창이 남아 있다 {#reconcile-file-guard}
- [x] 진짜 2-프로세스 CAS 테스트 — 지금은 스레드 동시성 + "남의 락 파일을 존중하는가"로 대신 물었다 {#cas-two-process-test}
- [x] `HonestyAudit`(`today/HonestyAudit.tsx:97`)에 같은 자기은닉이 남아 있다. 가르는 선은 **주장하는 카드는 0을 말하고 제안하는 카드는 숨어도 된다** — 이건 "누락 없음"을 주장하므로 앞쪽이다 {#honesty-audit-unhide}
- [-] MCP 서버가 신원을 읽는 변수를 `OCULPM_SESSION_ID` 로 완전 이행 — 지금은 옛 `CLAUDE_CODE_SESSION_ID` 폴백이 남아 있어 Claude 어댑터가 자기 값으로 덮어쓸 가능성이 있다 {#neutral-session-env}
- [x] SQLite 캐시 `oculpm_journal` 에 `agent_session` 컬럼이 없다(`cache/query.rs:395` 가 `None`) — 캐시 경유 판정은 영원히 `None` 이다. 마이그레이션 2단계 + `ADDITIVE_COLUMNS` {#cache-agent-session}
- [x] 앱 종료·ACP 어댑터 사망 시 세그먼트가 안 닫힌다 — `process.rs`(1241/1241)가 크기 래칫 상한이라 손대지 않았다. 그 6시간 동안 옆 대화의 게이트가 침묵한다 {#acp-segment-close}
- [x] 삭제만 한 대화는 판정을 빠져나간다 — 삭제된 파일은 mtime 을 물을 자리가 없다(셸 판정에서 물려받은 한계) {#verdict-deletions}
- [x] Codex 훅 배포 경로 미확정 — 매니페스트 `hooks` 는 Codex 검증기가 거부하고(실측), `oculpm-codex` 는 스킬만 싣는다. 훅을 원하는 Codex 사용자는 Claude 플러그인을 써야 하는데 지금은 스킬 문서 한 줄로만 안내된다 {#codex-hook-delivery}
- [x] `claude-events.jsonl` 에 타임스탬프 필드가 없고, `hooks.json` 의 인라인 append 훅이 `cat >>` 라 개행을 안 붙여 깨진 줄 5건이 실재한다 (`session-end.sh` 는 `printf '%s\n'` 을 쓴다) {#event-ledger-hygiene}
- [x] CAS 필수화가 두 문서 표면에 미반영 — `src/features/skills/pluginDocs.ts:90` 과 `mcp/protocol.rs` 의 `MCP_INSTRUCTIONS` {#cas-doc-surfaces}
- [x] `src/i18n/errors.ts` 에 `automation_bad_condition` 이 없다 — 지금은 파서 경고가 카드에 뜨고 실행은 fail-closed 로 막힌다 {#automation-error-key}
- [x] `config.toml` 의 `forbid_journal_for_paths` 에 있는 `**/*token*` 이 **디자인 토큰 파일을 시크릿으로 오인**해 `files_touched` 에 못 넣는다(`styles/tokens.css`·`design_tokens.test.ts`). 2026-09-04 에 기록된 오탐이 이번에도 그대로 물렸다 {#token-glob-false-positive}
- [x] 사이드바 스크롤 실기기 육안 확인 — 낮은 창에서 발(터미널 도크·테마·설정)이 늘 보이는가 · 넘치는 쪽만 페이드가 뜨는가 · **접힌 오버레이**에서도 같은가 · 스크롤바가 떴을 때 활성 항목의 링 그림자가 안 잘리는가 {#eyes-sidebar-scroll}

## 영문 표면 {#english}
- [x] 영문 스크린샷 촬영 — landing/en/index.html 이 한국어 UI 스크린샷을 참조하고 landing/shots/en/ 이 없다 {#en-shots}
- [x] /keynote · /plugin 영문판 — 지금 링크가 한국어판뿐이다 {#en-subpages}
- [x] i18n 잔여 ~500줄 + 영어 모드 전 화면 순회 (three-features-round 의 i18n-rest·i18n-overflow) {#i18n-rest}

## 죽은 표면 정리 {#dead-surfaces}
- [x] 죽은 커맨드 20개 판정 — overview.rs 표면 전체(폴더도 없다) · oculpm_open_entry_in_editor(opener-scope 3회 회귀 끝에 만든 우회로인데 호출부 0) · acp_stop(멈춘 어댑터를 화면에서 내릴 길이 없다) · dap_clear_breakpoints 등. 각각 제거할지 UI 를 붙일지 {#dead-commands}
- [x] 죽은 API 래퍼 7개 — 백엔드가 모바일 브리지에서 쓰이는 것과 구분해서 {#dead-wrappers}
- [x] Today 변경된 파일 43% 과대(파일 터치 횟수) + 링 k=400 이 매일 상한에 붙는 문제 (today-ring-followup 이월) {#today-overcount}
- [x] oculpm_reindex_cache · oculpm_watcher_stop 에 UI 경로 — 지금 워처는 켜만 있고 끔을 수 없고, 일지 캐시 재색인 복구 버튼이 없다 {#revive-recovery-cmds}

## 릴리스 3.0.0 {#release-300}
- [-] ~~EVALS.md 기준 실행~~ — **이 저장소에는 `EVALS.md` 가 없다**(git 이력에도 없다). `oculpm/evals.rs` 는 추적 *대상* 프로젝트에 제공하는 기능이고 파일 부재를 `None` 으로 처리한다. 이 저장소 자신의 완료 기준 문서는 만든 적이 없으므로 「실행」할 대상이 없다 — 3.0 의 완료 기준을 새로 쓸지는 별도 판단 {#evals}
- [x] 게이트 전수 exit 0 — 2026-09-08, main(`547cc41`) 에서 CI 3잡 전부 success: `cargo test`(33 스위트)·bindings 신선도·`clippy -D warnings`·`cargo fmt --check`·cargo-deny · `typecheck`·`test`(190파일)·`lint`(6게이트, 경고 9/9)·`build`. **릴리스 직전에 다시 돌릴 것** — 이 표시는 그 시점의 사실이다 {#gates-green-300}
- [ ] 릴리스 5면 + 태그 + 랜딩 배포 (landing 에서 vercel --prod) {#release-300-2}

## 기둥 2 이월 — v3-surface 가 소유 밖에서 남긴 것 {#pillar2-carry}

기둥 2(32항목)를 2026-09-06 에 5레인 병렬로 마감하며 나온 빚. 일지에만 적으면
유실되므로(`{#eyes-mixed-dpi}` 가 그 사고 기록) 여기에 항목으로 적는다.

- [x] **Today 에 「지금 무엇을 하고 있는가」 표면이 아예 없다** — `TodayMonitor.tsx:36` 의 「활동 시간」은 집계만 말한다. `{#activity-vocab-reuse}` 가 Today 도 같은 어휘를 쓰라고 했지만 그건 새 행을 만드는 일이라 범위 밖으로 뒀다. 재료는 준비됐다: `features/chat/activity/ActivityLine.tsx`(kind+detail 두 값) + `features/sessions/sessionActivity.ts:seatActivity()` {#today-activity-row}
- [x] `agentColor.ts` 의 `PALETTE[0]`(#d97a4f)이 Claude 코랄(#d97757)과 거의 같다 — **모르는 에이전트가 Claude 처럼 보인다.** 해시 버킷이라 코랄로 통일하지 않았고(뜻이 다르다), 대신 구별되는 색이 필요하다 {#palette-claude-collision}
- [x] `--code-*` 가 테마 스키마 화이트리스트에 없다 — `features/theme/schema.ts` 와 `src-tauri/src/themes/mod.rs` 를 **함께** 늘려야 한다(`theme_schema.test` 가 둘의 일치를 단언). 지금은 프리셋 5종만 문법색을 정할 수 있고 내려받은 커스텀 테마는 못 정한다 {#code-tokens-theme-schema}
- [x] 화면별 CSS 의 글자 리터럴 잔여 ~40곳 — `projects/graph/code/docs/tray/skills/discussion/welcome/home/mobile` + `agent.css` 3곳(:892 14px · :1465 19px · :2086 13.5px). 전부 램프로 기계 치환 가능 (`bootsplash.css:77` 은 테마 CSS 이전 첫 페인트라 의도적 예외) {#fs-literals-rest}
- [x] 임의 z 값 5곳을 새 어휘로 — `CommandPalette z-[100]` · `AppDialog z-[95]` · `windows/Dialog z-[110]` · `SettingsOverlay z-[90]` · `GreenfieldWizard z-[90]`. `z-popover`/`z-modal`/`z-top` 은 이미 깔려 있다 {#z-vocab-adopt}
- [x] `.empty-hint` 잔여 호출부를 EmptyState 로 — `chat/ConversationHistoryModal.tsx:112,114` · `settings/automation/AutomationHistory.tsx:56,57` · `settings/automation/AutomationTab.tsx:225,287` · `shell/ShellV2.tsx:520` · `features/projects` 의 리치 빈 상태 4번째. 끝나면 `primitives.css` 의 `.empty-hint` 와 죽은 CSS(`.docs-empty*`·`.code-empty-*`·`.search-noindex*`)를 지울 수 있다 {#empty-hint-rest}
- [x] `PlannerScreenV2.tsx`(1,149줄)·`DiffScreenV2.tsx`(799/800줄) 분할 — 파일 크기 래칫 때문에 새 빈 상태 JSX 를 **압축된 형태**로 넣어야 했다(가독성 나쁨). 래칫이 부채를 정확히 가리키고 있다 {#planner-diff-split}
- [x] 브랜치 축의 세 한계 — ① 중첩 저장소(git 루트가 프로젝트 루트 아래)면 `.oculpm/journal/**` 가 git 출력에 안 나와 `Entry` 근거가 통째로 사라지고 조용히 약해진다(코드에 명시 주석 없음) ② `Files` 겹침이 과잉 귀속한다(같은 창의 두 브랜치가 같은 파일을 건드리면 양쪽에 잡히고 배제할 손잡이가 없다) ③ 기준 없는 브랜치는 최근 300 커밋을 보는데 성능 미측정 {#branch-axis-limits}
- [x] ACP 화면의 `@/lib/bindings` 직접 호출 5파일을 `api/acp.ts` 로 — 분해로 갈라 나온 것이라 총량은 안 늘었지만, 옮기려면 envelope→throw 로 오류 처리를 전부 바꿔야 한다 {#acp-api-wrapper}
- [x] `PluginSetupCard` 에 닫기 버튼이 없다 — 영구 닫기는 설정 키가 필요하다. 지금은 일지 0건 조건으로 좁혀 첫 일지 한 건이면 사라진다 {#plugin-card-dismiss}
- [x] `AcpConversation.tsx` 749줄 · `ShellV2.tsx` 711줄 — 둘 다 한계 안이지만 여유가 적다. 다음 라운드가 여기 붙이면 곧 걸린다 {#big-files-watch}

## 기둥 2 육안 확인 부채 {#pillar2-eyes}

이번 라운드는 **보이는 것**을 바꿨는데 앱을 한 번도 띄우지 않았다.

- [x] Tailwind 글자 크기 축소(`text-sm` 14→13 · base 16→14 · lg 18→15 · xl 20→17 · 2xl 24→20 · 3xl 30→26) — 설정 12탭 · 회고 · 새 프로젝트 마법사 · 모바일 셸 · 시작 탭/⌘K 팔레트 다섯 면 {#eyes-tw-scale}
- [x] 문법 강조 — 라이트·다크 **+ 프리셋 5종** × 언어별(TS/Rust/Python/JSON/셸/마크다운)로 일지·논의 코드블록 · 변경 diff · 검색 스니펫, **그리고 편집기와 나란히**. 주석이 진해지고 키워드가 빨강→마젠타, 함수명이 보라→파랑 {#eyes-hljs}
- [x] 모달 3종(설정 API 키 · 수동 일지 작성 · 대화 기록) — 스크림이 검정→테마색. **Solarized·Sepia 에서 꼭** {#eyes-modal-scrim}
- [x] IA 재편 — 낮은 창에서 갈래가 펼쳐졌을 때 사이드바 스크롤·페이드 · **접힌 오버레이**에서의 갈래 목록 · ⌘번호 재배정 안내가 업데이트 뒤 1회만 뜨는지(첫 설치엔 안 뜨는지) {#eyes-ia}
- [x] 활동 의미 층 — 접힌 묶음·원장 강조·곁가지·원본 레일의 **밀도**. 특히 `oculpm journal_write` 를 실제로 돌려 「일지 기록」이 뜨는지 · 긴 Bash 에서 15초 침묵 문턱이 적절한지 · 접힌 원본 레일을 펼쳐 JSON 이 읽히는지 {#eyes-activity}
- [x] 브랜치 화면 — 툴바 브랜치 선택기 폭 · `.stat` 4칸 · 접이식 카드 · 빈 상태 · **네이티브 저장 대화상자** {#eyes-branch}
- [x] 첫 5분 — 플러그인 카드는 Claude Code 가 실제로 깔린 기기에서만 뜬다 · 코드 화면 빈 패널의 flex 중앙 정렬 · 코드 맵 빈 캔버스 {#eyes-firstrun}
- [x] 설정 검색 — embedded(가로 탭 줄 오른쪽)와 비-embedded(세로 탭 위) 양쪽 {#eyes-settings-search}
- [x] 디자인 램프 라운드 — 프리셋 5종 × 라이트/다크에서 **스크롤바 손잡이**(고정 회색 → `--text-3` 혼합) · **포커스 링**(흐린 `--accent-ring` → `--accent`, 역할 선택자로 목록/트리/메뉴 항목까지 링이 생겼는지) · **토글 노브 그림자**(검정 → 잉크) · **접힌 곡률**(칩·배지·kbd·입력이 한 램프에 스냅됐는지, `.seg` 동심원에 틈이 안 보이는지). 무게는 76곳이 50 단위 이하로 움직였으니 나란히 선 배지·제목이 같은 굵기로 보이는지도 함께 {#eyes-design-ramp}

## 3.0 라운드 1차 이월 — 6레인이 소유 밖에서 남긴 것 {#round1-carry}

2026-09-07, 6레인 병렬로 17항목을 닫으며 나온 빚. 일지에만 적으면 유실되므로
(`{#eyes-mixed-dpi}` 가 그 사고 기록) 여기에 항목으로 적는다.

- [x] `.empty-hint` 완전 소거 — 이번에 5곳을 `EmptyState` 로 옮겼지만 `primitives.css` 의 정의는 못 지웠다. 남은 실사용 4화면: `branch/BranchScreenV2.tsx` · `today/WhatsNewCard.tsx`(2) · `today/CoreModelSeededCard.tsx` · `diff/DiffScreenV2.tsx` · `oculpm/JournalScreenV2.tsx`. 이 넷이 옮겨지면 정의와 죽은 CSS 를 함께 지울 수 있다 {#empty-hint-final}
- [x] z 어휘가 3단(popover/modal/top)뿐이라 `AppDialog`(옛 95)와 `CommandPalette`(옛 100)가 같은 층으로 합쳐졌다. 지금은 **DOM 순서**가 타이를 가르고(팔레트가 `ShellV2` 뒤에 마운트되어 결과가 종전과 같다) 결과는 맞지만, 값이 아니라 마운트 순서에 기대는 상태다. 넷째 단이 필요해지면 그때 어휘를 늘린다 {#z-vocab-fourth-step}
- [-] `usePlanDocument.ts` 546줄 — 한계(800) 안이지만 집 규율("200~400 보통") 위다. 읽기/쓰기로 더 가를 수 있으나 `selectedId`·`setDetail`·`busy`·`refreshPlans` 를 전부 공유해 배관이 커진다. 지금은 응집이 이긴다고 판단했고, 다음 라운드가 여기 붙이면 재판단 {#use-plan-document-size}
- [-] `JournalEntrySummary`(목록 행)에는 `agent_session` 을 안 넣었다 — 037 이 채우는 자리는 `get_entry` 하이드레이션 하나다. 목록에 칸을 늘리려면 `spec.rs`+`bindings.ts`+프런트가 함께 움직여야 한다 {#list-agent-session}
- [-] `plugin/oculpm/.mcp.json` 에 `OCULPM_SESSION_ID` 매핑 — `{#neutral-session-env}` 를 푸는 열쇠이자 그 항목이 `blocked` 인 이유. 넣은 뒤 **실측으로 채워지는지** 확인해야 한다 {#mcp-json-session-env}
- [x] 플랜 status 가 미완 항목을 남긴 채 `done` 으로 닫히는 일이 이 라운드 **중에도** 났다 (`hardening-and-optimization` 이 `{#csp}`·`{#entry-chunk}` 를 남기고 닫혀 있었다). `{#glyph-hygiene}` 는 과거를 청소했을 뿐 재발을 막지 못한다 — 미완 항목이 있는 플랜의 `done` 전이를 거부하는 가드가 필요하다 {#done-transition-guard}
- [-] `claude-events.jsonl` 의 이미 깨진 5줄(2257·2259·2260·2261·2263)은 소비자가 건너뛰어 인박스를 막지는 않지만 **그 이벤트는 잃은 것**이다. 복구할지 그대로 둘지 판정 {#broken-event-lines}

## 3.0 라운드 2차 이월 — 5레인이 소유 밖에서 남긴 것 {#round2-carry}

2026-09-07 2차 웨이브(11항목)에서 나온 빚. 1차와 같은 이유로 여기에 항목으로 적는다.

- [x] `acp_stop` 에 UI — 지우지 않고 남긴 유일한 죽은 커맨드다. `acp::process::stop` 의 유일한 호출부라 지우면 떠 있는 어댑터를 내릴 길이 사라지고 원장 세그먼트를 닫는 부수효과도 잃는다. 자리는 ACP 화면(`features/chat/**`) {#acp-stop-ui}
- [x] `EntryDetailView` 에 "파일로 열기" — `openEntryInEditor` 는 새는 게 아니라 **미구현 어포던스**였다(일지 .md 를 OS 로 여는 코드가 아예 없다). 래퍼는 opener-scope 회귀 4번째를 막으려고 남겼으니, 이제 그 버튼을 붙이면 짝이 맞는다 {#entry-open-affordance}
- [x] 진짜 워처 「중지」 — `supervisor.rs` 가 워처 없는 프로젝트를 먹통으로 판정해 60초 안에 되살리므로(`is_deaf(None,_)=>true`) 지금 코드의 끄기는 60초짜리 거짓말이다. 감독관이 존중할 사용자 일시정지 상태(예: `entry.user_paused`)가 선행돼야 한다 {#watcher-user-pause}
- [x] 고아가 된 백엔드 함수 5개 — `manager::overview_stats` · `Db::conversation_rename` · `Db::conversation_set_context` · `DapStateStore::breakpoint_lines` · `DapStateStore::clear_breakpoints` · `Db::get_blueprint`. 커맨드를 지우며 호출부가 사라졌고 전부 `pub` 이라 경고가 안 난다 {#orphaned-db-fns}
- [x] `files` 링도 상한에 붙는다 — `k=8` 문턱이 약 80개인데 이 저장소는 고유 110개/일이다. `lines` 는 k=4000 으로 고쳤지만 이건 저장소 하나로 모든 사용자의 하루를 정할 수 없어 눈금을 안 건드렸다(대신 화면이 「상한」이라고 말한다). 판단이 필요한 값 {#files-ring-scale}
- [x] 고유 파일 수의 제 자리는 백엔드 — 지금은 프런트가 오늘 엔트리 상세를 걷어 합집합을 센다(첫 진입 N회 IPC, 캐시 뒤엔 새 일지당 1회). `oculpm_workday_brief` 에 `COUNT(DISTINCT file_path)` 가 생기면 그 걷기와 캐시를 통째로 지울 수 있다 {#distinct-files-backend}
- [x] 문법색 편집기 UI — `--code-*` 가 테마 화이트리스트에 들어가 내려받은 테마가 값을 실을 수는 있게 됐지만, 앱에서 점 찍어 고르는 섹션은 없다. 새 편집기 섹션은 `I18nKey` 가 필요하다 {#code-color-editor}
- [x] `tests/lite_w6_safety_net.rs` invariant #6 의 주석이 아직 "greenfield `generate_seed_goals` 가 쓴다" 고 적고 있다 — 그 커맨드는 지웠고 이제 `plan_migrate_goals` 하나만 남았다(테스트 자체는 통과) {#w6-comment-stale}
- [x] eslint 래칫에 **진짜 여유**가 아직 없다 — 50→46 으로 내렸지만 46이 곧 현재 개수라 여유는 여전히 0이다. 남은 46건을 실제로 걷어야 다음 라운드가 숨을 쉰다 {#eslint-slack-real}

## 3.0 라운드 3차 이월 {#round3-carry}

2026-09-07 3차 웨이브(12항목)에서 나온 빚.

- [x] `read_branch_git` 되맞춤은 「저장소가 프로젝트 루트 **아래**」 방향만 고친다. 반대 방향(프로젝트 루트가 더 큰 저장소에 중첩된 흔한 모노레포)은 `root_relative` 가 손대지 않고 지나간다 — `uncommitted_changes`·`changes_in_range` 도 같은 한계다. 플랜 문구는 한 방향만 언급했지만 코드상 둘 다 걸린다 {#rebase-other-direction}
- [x] `BranchStory` 에 「저장소 루트 ≠ 프로젝트 루트」 신호 필드가 없어, 근거가 빠진 화면이 그 사실을 **말할 수가 없다**. 지금은 코드 주석만 안다 {#branch-nested-signal}
- [x] 에이전트가 `Edit`/`Write` 로 플랜 프론트매터를 손수 고치는 길은 `{#done-transition-guard}` 가 못 막는다 — 규칙 문서로만 다룰 수 있다 {#guard-manual-edit}
- [x] `archived` 로 접은 미완은 여전히 `plan_status` 에 안 보인다. 보이게 하려면 「잠긴 플랜의 미완 항목」을 경고로 싣는 도구 출력 계약 변경이 필요하다 {#archived-open-items-visibility}
- [x] `cargo check`/`clippy --all-targets` 가 `target/debug/<bin>` 을 0바이트 자리표시자로 덮는다. 지금은 `CARGO_BIN_EXE_*` 를 쓰는 테스트가 없어 무해하지만, 다음 사람이 쓰면 같은 함정에 빠진다 {#cargo-bin-exe-trap}
- [x] `commands/oculpm.rs` 가 파일 크기 천장에 붙어 있어 `oculpm_workday_brief` **안에서만** `.map_err(AppError::from)?` 를 맨 `?` 로 바꿨다 — 같은 파일에 두 관용구가 생겼다(나머지 33곳은 옛 꼴) {#oculpm-cmd-idiom-split}
- [x] `lines_workday` 파라미터 이름이 이제 거짓말이다 — 라인 증감과 고유 파일 수 **둘**의 초점 워크데이다. `focus_workday` 로 고치려면 `useJournalDays.ts` + bindings 가 함께 움직여야 한다 {#lines-workday-misnomer}
- [x] 후속 고아 — `BreakpointStore::clear`(`dap/session.rs`)가 호출부 0 이 됐고, `Db::get_goal` 도 프로덕션 호출부가 없다 {#orphans-round2}
- [x] `Unplug` 아이콘을 `components/Icons.tsx` 재수출 목록으로 (지금은 `AcpToolbar` 가 `lucide-react` 를 직접 부른다 — 전례는 있지만 집 규약은 Icons 경유다) {#unplug-icon-reexport}
- [x] `journal_v2.test.tsx` 의 브리프 mock 이 폐기된 `bytes_added`/`bytes_removed` 를 쓰고 `files_touched` 가 없다. `satisfies WorkdayBrief` 가 안 붙어 아무도 안 잡는다 {#journal-mock-drift}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-07T16:52:28+09:00 | #today-overcount | claude-code | ☐→☐ | .oculpm/journal/20260907/Bugs/1652_bug_today-ring-arc-geometry.md | 상한에 붙었을 때의 렌더 결함만 닫음(캡 미셈 클램프→반지름별). k=400 포화 자체와 파일 43% 과대는 그대로 todo |
| 2026-09-07T20:29:29+09:00 | #v242-watcher-stop-lock | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2027_refactor_lock-scope-and-watcher-prefilter.md | 가드 수명을 핸들 꺼내기까지로. manager/** 41자리 전수 확인 — write 락은 이곳뿐, 대신 session_ops.rs read 가드 4자리를 같이 고침 |
| 2026-09-07T20:29:35+09:00 | #lockguard-disarm | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2027_refactor_lock-scope-and-watcher-prefilter.md | 프로세스 내 경로별 등록(LOCK_REGISTRY). 회귀 테스트 추가. watcher_commit 의 mem::forget 회피책도 되돌림 |
| 2026-09-07T20:29:41+09:00 | #watcher-drain-time | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2027_refactor_lock-scope-and-watcher-prefilter.md | PreFilter 로 gitignore 를 채널 앞으로. target/ 5,000건 폭풍 → 링에 1건, dropped 0 |
| 2026-09-07T20:29:48+09:00 | #dropped-total-surface | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2027_refactor_lock-scope-and-watcher-prefilter.md | WatcherStatus 를 내보내는 커맨드가 아예 없어, 닥터가 이미 읽는 OculpmStatus 봉투에 watcher_dropped_total 한 칸을 실었다. 버림이 있으면 닥터가 warn + 재색인 손잡이 |
| 2026-09-07T20:29:54+09:00 | #cache-agent-session | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | 037 + MIGRATIONS 등록 + ADDITIVE_COLUMNS. 기존 행은 COERCION_VERSION 1→2 재투영으로 백필 (안 하면 앞으로 쓸 일지에만 걸린다) |
| 2026-09-07T20:30:01+09:00 | #reconcile-file-guard | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | MCP 가 쓰던 CAS 문지기를 plan_ops::acquire_plan_guard 로 내리고 화해기가 그 문을 지나게. 획득→재확인→쓰기를 한 함수로 묶음 |
| 2026-09-07T20:30:08+09:00 | #token-glob-false-positive | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | 좁히는 축은 파일명이 아니라 확장자. config.toml 과 config.rs::default_forbid_paths() 를 함께 — 한쪽만 고치면 새 프로젝트만 옛 오탐을 물려받는다. secrets.rs 도 같이 풀림 |
| 2026-09-07T20:30:14+09:00 | #event-ledger-hygiene | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | printf '%s\n' + oculpm_ts 주입. 기존 깨진 5줄(2257·2259·2260·2261·2263)은 소비자가 건너뛰므로 인박스는 안 막히지만 그 이벤트는 잃은 것 |
| 2026-09-07T20:30:21+09:00 | #cas-doc-surfaces | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | MCP_INSTRUCTIONS + pluginDocs.ts 를 실제 강제(base_hash 필수·우회로 없음)에 맞춤. rule_canary 단언으로 못박음 |
| 2026-09-07T20:30:27+09:00 | #automation-error-key | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | 플랜 전제가 틀렸다 — 백엔드가 그 코드를 낸 적이 없고 조건 오류는 한국어 원문 경고로만 떴다(영어 모드에서도). spec_error 가 코드를 내게 하고 ko/en 사전에 키 추가. errors.ts 는 고칠 것 없음 |
| 2026-09-07T20:30:34+09:00 | #honesty-audit-unhide | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | JournalMissingCard 의 {#card-unhide} 와 같은 선 — 0건일 때 경고색 없이 0과 판정의 한계를 함께. 옛 은닉을 단언하던 테스트도 새 계약으로 교체 |
| 2026-09-07T20:30:41+09:00 | #void-set-remainder | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | 8자리 전부 useSaveSetting 으로. WelcomeWizard.seal() 이 await set 을 쓰고 있어 동기로 바꾸고 호출 체인 정리 — SettingsContext.set 이 절대 reject 안 함을 확인한 뒤라 계약 통일이지 동작 변경 아님 |
| 2026-09-07T20:30:46+09:00 | #menubar-silent-fetch | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | 같은 컴포넌트의 toggle() 이 이미 쓰는 표면(reportRejection + 토스트)으로 통일. 새 문구·새 패턴 없음 |
| 2026-09-07T20:30:53+09:00 | #test-name-allowlist | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | 플랜 전제가 반대였다 — 두 파일은 애초에 허용목록에 없었다(이름이 영어라 안 걸렸을 뿐). 이름을 한국어로 옮기고 집 관례대로 TESTS 에 두 줄 추가 |
| 2026-09-07T20:30:59+09:00 | #fs-literals-rest | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | 40곳 전량 램프로. 매핑 실패 0건. bootsplash.css 는 의도적 예외로 유지 |
| 2026-09-07T20:31:06+09:00 | #z-vocab-adopt | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | 5곳 전부. 쌍별 쌓임 순서 보존 확인 — AppDialog(95)/CommandPalette(100)만 같은 층이 되어 DOM 순서가 타이를 가르는데, 팔레트가 ShellV2 뒤에 마운트되므로 결과는 종전과 같다 |
| 2026-09-07T20:31:13+09:00 | #planner-diff-split | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2028_refactor_front-vocab-contracts-and-splits.md | Planner 1,149→376 · Diff 799→335. 압축돼 있던 빈 상태 JSX 되폄. 순수 계산 셋을 changeList.ts 로 빼고 테스트 7케이스. file-size-policy 는 고칠 것 없음 — 기준선은 merge-base 에서 매번 읽는다 |
| 2026-09-07T20:31:20+09:00 | #en-subpages | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2029_feature_english-subpages-and-promise-truth.md | en/keynote·en/plugin 신설 + sitemap 재빌드. 겸사겸사 잡은 버그 — 영문 홈의 /keynote·/plugin 링크 8자리가 전부 한국어판으로 가고 있었다 |
| 2026-09-07T20:31:27+09:00 | #promise-text-truth | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2029_feature_english-subpages-and-promise-truth.md | egress_inventory.rs 원장과 대조 — CLAUDE.md·랜딩 ko/en 은 이미 브로커를 명시하고 있었고 빠진 곳은 README ko/en 둘뿐이라 거기만 채움 |
| 2026-09-07T20:31:35+09:00 | #glyph-hygiene | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2029_feature_english-subpages-and-promise-truth.md | codex-acp 는 done→active 로 되돌리고 근거 확인한 2건만 [x]. dnd Phase 8 4건·menubar v2.3.0 은 [-]. 같은 병이 라운드 중에도 나서 hardening-and-optimization 이 미완 2건을 남긴 채 done 으로 닫힌 것도 되돌림 |
| 2026-09-07T20:31:49+09:00 | #neutral-session-env | claude-code | ☐→! | .oculpm/journal/20260907/Features_to_add/2028_feature_record-integrity-cache-cas-hooks.md | 폴백은 죽은 코드가 아니라 터미널 경로의 유일한 신원 근거다 — .mcp.json 에 env 가 없어 물려받은 CLAUDE_CODE_SESSION_ID 하나로만 얻고, 실측상 OCULPM_SESSION_ID 는 비어 있다. 해제 조건: .mcp.json 에 매핑을 넣고 실측 확인 |
| 2026-09-07T21:15:58+09:00 | #eyes-terminal | claude-code | ☐→☐ | .oculpm/journal/20260907/Features_to_add/2115_feature_terminal-file-link-menu-and-underline.md | 터미널 육안 부채 3건 추가 — 한글 줄 링크 밑줄이 경로 위에 얹히는가 · ⌘클릭 팝오버 자리 · Quick Look 창이 앞으로 오는가 |
| 2026-09-07T21:21:28+09:00 | #dead-commands | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2119_refactor_dead-surfaces-and-recovery-handles.md | 17개 중 16개 제거(354→340). mobile_bridge 디스패치 표·MCP·deeplink·tests 전수 확인 결과 백엔드 호출부 0. acp_stop 만 유지 — acp::process::stop 의 유일한 호출부라 지우면 어댑터를 내릴 길이 사라진다 |
| 2026-09-07T21:21:36+09:00 | #dead-wrappers | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2119_refactor_dead-surfaces-and-recovery-handles.md | openEntryInEditor 는 새는 게 아니라 미구현 어포던스였다(일지를 OS 로 여는 코드가 아예 없다) — 유지하고 doc 에 못박음. watcherStart 는 진짜 우회라 래퍼 경유로 되돌림. 모바일 브리지가 쓰는 백엔드 커맨드는 남기고 래퍼만 제거 |
| 2026-09-07T21:21:44+09:00 | #revive-recovery-cmds | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2119_refactor_dead-surfaces-and-recovery-handles.md | 닥터에 「일지 캐시 재색인」 + 워처 「다시 시작」. 「중지」가 아닌 이유가 핵심 발견 — supervisor 가 워처 없는 프로젝트를 60초 안에 되살려서 지금 코드의 끄기는 60초짜리 거짓말이다. 진짜 off 는 감독관 opt-out 상태 선행 필요(이월) |
| 2026-09-07T21:21:52+09:00 | #today-overcount | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md | 고유 파일 합집합으로 교체(실측 14일 0~105% 과대). 링 k=400→4000 — 26 워크데이 중앙값 15,400줄인데 상한이 4,081줄이라 22/26 이 상한에 붙어 있었다. capped 를 값으로 내보내 호버가 「상한」을 말한다. files 링은 여전히 붙는다(이월) |
| 2026-09-07T21:21:59+09:00 | #today-activity-row | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md | seatActivity + ActivityLine 어휘 재사용(새로 만들지 않음). 정직성 3단 — 세션 0 / 아는 일 없음(「조용함」) / 원장 못 읽음(아무 말 안 함). 폴링 없이 onA2aChanged 구독 |
| 2026-09-07T21:22:06+09:00 | #acp-api-wrapper | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2121_refactor_acp-wrapper-entry-chunk-theme-palette.md | 다섯을 함께(allowlist 주석의 약속). 호출부 18곳의 실패 동작을 한 글자도 안 바꿈 — 유일한 변화는 전송 실패가 예전엔 unhandled rejection 으로 샜다는 것 |
| 2026-09-07T21:22:14+09:00 | #code-tokens-theme-schema | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2121_refactor_acp-wrapper-entry-chunk-theme-palette.md | --code-* 10개를 schema.ts 와 themes/mod.rs 양쪽에 같은 순서로. 라운드트립 테스트로 실제 칠해지는지까지 확인. 문법색 편집기 UI 섹션은 새 I18nKey 가 필요해 이월 |
| 2026-09-07T21:22:21+09:00 | #palette-claude-collision | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2121_refactor_acp-wrapper-entry-chunk-theme-palette.md | #d97a4f(코랄과 4도) → #cb4db2(62.9도). 나머지 팔레트와 최소 50.9도, 라이트·다크 6배경 대비비 3.5~4.3. 팔레트 6색 전부가 코랄과 떨어져 있음을 단언하는 회귀 가드 추가 |
| 2026-09-07T21:23:17+09:00 | #empty-hint-final | claude-code | ☐→x | .oculpm/journal/20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md | branch·diff·journal·today(3) 이관 후 호출부 0 확인 → primitives.css 정의와 죽은 CSS 삭제. JournalScreenV2 만 EmptyState 를 안 썼다 — 빈 상태가 아니라 「다 못 실었다」 알림이라 오용의 사고 기록이 이미 screens.css 에 있다 |
| 2026-09-07T21:24:10+09:00 | #eslint-ratchet-slack | claude-code | ☐→~ | .oculpm/journal/20260907/Bugs/2120_bug_today-counts-ring-scale-and-now.md | 래칫 50→46 (죽은 커맨드 제거분 + no-console 규칙이 설정에 아예 없어 처음부터 무의미했던 지시문 3줄). 다만 46이 곧 현재 개수라 **여유는 여전히 0** — 진짜 정리 패스는 {#eslint-slack-real} 로 이월 |
| 2026-09-07T22:24:17+09:00 | #eyes-terminal | claude-code | ☐→~ |  |  |
| 2026-09-07T23:10:00+09:00 | #watcher-user-pause | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2308_feature_watcher-pause-and-done-guard.md | 감독관이 존중하는 user_paused. 상태는 **프로세스 메모리** — 디스크면 자리가 .oculpm/config.toml 인데 그건 저장소에 커밋돼서 내 일시정지가 동료의 갱신까지 끈다. 반증 확인(가드 지우면 테스트 빨개짐) |
| 2026-09-07T23:11:00+09:00 | #orphaned-db-fns | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2308_feature_watcher-pause-and-done-guard.md | 6개 전부 호출부 0 재확인 후 삭제. cache/stats.rs 의 overview_stats 는 살아 있는 테스트 5개가 불러 남김 |
| 2026-09-07T23:12:00+09:00 | #w6-comment-stale | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2308_feature_watcher-pause-and-done-guard.md | invariant #6 주석을 사실로. get_goal 이 프로덕션 호출부 0 이라는 다음 청소 후보도 함께 적음 |
| 2026-09-07T23:13:00+09:00 | #done-transition-guard | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2308_feature_watcher-pause-and-done-guard.md | 원시 수술 함수를 비공개로 내리고 공개 진입점이 Result 를 반환 — 새 호출자도 거부를 처리해야 컴파일된다. 막은 자리 3곳 중 mobile_bridge/dispatch.rs 가 요점(프런트만 막았으면 거기로 샜다). archived 는 일부러 안 막음, 강제 옵션 없음 |
| 2026-09-07T23:14:00+09:00 | #cas-two-process-test | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/2308_feature_watcher-pause-and-done-guard.md | 테스트 실행 파일 자기 재진입으로 진짜 OS 프로세스. 6 프로세스 재시도에서 6 전이 전부 생존. 계측으로 5/6 이 실제 크로스프로세스 충돌을 겪음을 확인(공허하지 않다). 3회 연속 0.15초 |
| 2026-09-07T23:15:00+09:00 | #distinct-files-backend | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2309_refactor_distinct-files-branch-axis-affordances.md | 마이그레이션 불필요 — 012 의 oculpm_journal_files 가 이미 자료를 든다. 44 워크데이 전부에서 옛 프런트 합집합과 새 SQL 차이 0. 프런트 걷기·캐시 통째 삭제(−71/+18) |
| 2026-09-07T23:16:00+09:00 | #files-ring-scale | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2309_refactor_distinct-files-branch-axis-affordances.md | k=8→20. 실측 분포(44일 중앙값 55·8월↑ 81·max 209), 옛 문턱 108 에서 9/44 가 상한에 붙었다 → 새 문턱 271 에서 0/44. 플랜의 「110개/일·문턱 80」 은 둘 다 틀렸다 |
| 2026-09-07T23:17:00+09:00 | #branch-axis-limits | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2309_refactor_distinct-files-branch-axis-affordances.md | 진짜 버그 발견·수정 — read_branch_git 이 저장소 상대 경로를 프로젝트 기준으로 안 되맞춰 중첩 배치에서 Files 귀속이 조용히 0건이 됐다. 겹침은 그대로(설계 원칙과 충돌) 툴팁만 강화. 300커밋 캡은 재고 유지(5만 커밋에서도 <10ms) |
| 2026-09-07T23:18:00+09:00 | #acp-stop-ui | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2309_refactor_distinct-files-branch-axis-affordances.md | ACP 상단바 「어댑터 내리기」 — useConfirm 경유, 내린 뒤 기존 AgentGoneNotice 경로로 |
| 2026-09-07T23:19:00+09:00 | #entry-open-affordance | claude-code | ☐→x | .oculpm/journal/20260907/Refactors/2309_refactor_distinct-files-branch-axis-affordances.md | EntryDetailView 「파일로 열기」 — 반드시 oculpmApi.openEntryInEditor 경유(우회가 opener-scope 회귀 3번을 만든 원인) |
| 2026-09-08T00:32:00+09:00 | #gate-positive-attribution | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | Stop 의 transcript_path 로 대화별 양성 귀속. 오탐 방지로 일부러 놓치는 것 4가지(전부 미탐 방향). 실바이너리 E2E 3케이스 — 옆 대화 파일만 적힌 트랜스크립트는 오탐 없이 판정불가 |
| 2026-09-08T00:32:00+09:00 | #acp-segment-close | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | SessionBook 을 갈라 자리 만들고(1241→1060) 등록부가 우리가 연 세그먼트만 닫는다. 폴더 훑기는 남의 마커를 쓸 위험이 있어 안 골랐다 |
| 2026-09-08T00:32:00+09:00 | #verdict-deletions | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | 시각은 여전히 못 가른다. 대신 거짓 무결을 없앴다 — Clear(NothingToRecord) 였던 것이 Undecided::UntimeableDeletions 로 |
| 2026-09-08T00:33:00+09:00 | #codex-hook-delivery | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | 플랜 전제가 틀렸다 — 매니페스트 hooks 필드만 거부되고 hooks/hooks.json 파일은 설치·실행된다(실측, codex exec 로 이벤트 적재 확인). Codex 가 훅 신뢰를 한 번 묻는 게 앞선 오판의 원인 |
| 2026-09-08T00:33:00+09:00 | #guard-manual-edit | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | AGENTS.md + 마스터 템플릿 ko/en(template_version 10→11). 마스터를 같이 안 고치면 다른 사용자에게 안 나가고 다음 업그레이드 때 지워진다 |
| 2026-09-08T00:33:00+09:00 | #webview-csp | claude-code | ☐→x | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | 초안만 — tauri.conf.json 이 미지 키를 거부해 원장 테스트로 넣고 csp:null 을 못박음. 걸림돌 목록을 실제 코드에서 확인. 켜기는 육안 확인 가능한 라운드의 몫 |
| 2026-09-08T00:34:00+09:00 | #broken-event-lines | claude-code | ☐→- | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | 복구 안 함으로 판정 — 11개 전부 복원 가능하지만 현재형 활동 신호라 4일 지난 SessionStart 재생은 유령 세션을 만든다. 실제 기록엔 무영향. 「지나간 11건은 잃었다」로 닫음 |
| 2026-09-08T00:34:00+09:00 | #mcp-json-session-env | claude-code | ☐→- | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | 이 경로로 불가능함을 실측 확정 — .mcp.json env 에서 ${CLAUDE_CODE_SESSION_ID} 는 리터럴로 나간다. 넣으면 모든 대화가 같은 신원을 쓴다(폴백보다 나쁨). 회귀 가드 추가 |
| 2026-09-08T00:34:00+09:00 | #rebase-other-direction | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | RepoNesting 4갈래로 양방향. 프로젝트 밖 파일은 None 으로 떨궈 분모가 안 부푼다. 양쪽 루트 canonicalize 가 load-bearing(/private/var vs /var) |
| 2026-09-08T00:35:00+09:00 | #branch-nested-signal | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | BranchStory 에 repo_nesting/repo_subpath + NestingNote. 배치마다 잃는 근거가 달라 방향별 문구를 따로 뒀다 |
| 2026-09-08T00:35:00+09:00 | #archived-open-items-visibility | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 미완 있을 때만 locked_open 요약 + include_locked 로 목록. 두 모집단 안 섞음(잠긴 플랜은 plan_update 가 거부). 실측 잠긴 18개에 58건 — 덤으로 done 플랜 2개에 5건 발견 |
| 2026-09-08T00:35:00+09:00 | #big-files-watch | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | AcpConversation 791→677 · ShellV2 712→553. 기존 conversation/** 조각 규약을 이어 5개 신설 |
| 2026-09-08T00:36:00+09:00 | #oculpm-cmd-idiom-split | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | .map_err(AppError::from) 34곳 전부 맨 ? 로 통일. 1062→1008 |
| 2026-09-08T00:36:00+09:00 | #lines-workday-misnomer | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | focus_workday 로. useJournalDays 는 위치 인자라 무변경. 모바일 프로토콜 키도 맞춤 |
| 2026-09-08T00:36:00+09:00 | #unplug-icon-reexport | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | Icons.tsx 재수출 경유로 |
| 2026-09-08T00:37:00+09:00 | #journal-mock-drift | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 폐기된 bytes_* → lines_*/files_touched + satisfies WorkdayBrief 로 못박음 |
| 2026-09-08T00:37:00+09:00 | #orphans-round2 | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | BreakpointStore::clear 삭제. Db::get_goal 은 lite_w6 테스트가 아직 불러 근거 주석만 남기고 후속으로 |
| 2026-09-08T00:37:00+09:00 | #cargo-bin-exe-trap | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | docs/cargo-bin-exe-trap.md — 코드로 못 막는 종류다. 같은 target 을 공유하는 병렬 cargo 사이에서도 재현됨을 새로 확인 |
| 2026-09-08T00:38:00+09:00 | #z-vocab-fourth-step | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 합칠 때의 근거가 틀렸다 — ⌘K 는 window 전역이라 AppDialog 위에서도 열린다. --z-command(200) 로 이제 DOM 순서가 아니라 값이 정한다 |
| 2026-09-08T00:38:00+09:00 | #code-color-editor | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | CODE_TOKENS 를 6번째 그룹으로 승격 — 화이트리스트가 TOKEN_GROUPS 에서 파생돼 「그룹엔 있는데 화이트리스트엔 없는」이 구조적으로 불가능해졌다. 견본은 var(--code-*) 를 참조해 값 복제 없음 |
| 2026-09-08T00:38:00+09:00 | #eslint-slack-real | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 47→9, eslint-disable 0줄. 빚 0 된 규칙 4개는 error 로 되돌림. exhaustive-deps 에서 진짜 stale 1건 발견(RetroScreenV2 핸드오프가 옛 탭 목록을 읽고 있었다) |
| 2026-09-08T00:39:00+09:00 | #eslint-ratchet-slack | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 래칫 47→9. 이제 여유가 실재한다 |
| 2026-09-08T00:39:00+09:00 | #floating-promises-rest | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 플랜의 「약 100개」는 틀렸다 — 실측 16건(나머지 494는 이미 void 표식). 12건 정리, 2건은 일부러 남김(void 를 붙이면 잘못된 의도를 못박는 자리) |
| 2026-09-08T00:39:00+09:00 | #scheduling-telemetry | claude-code | ☐→> | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 못 함 — 「버림」은 이미 됐고 나머지 둘은 tokio 내부값이라 백엔드가 필요. 프런트 대체 불가(이벤트에 발신 시각이 없어 단방향 지연 계산 불가, IPC 왕복은 큐 대기와 느린 일을 구분 못 함). 절반짜리를 안 만듦 |
| 2026-09-08T00:40:00+09:00 | #list-agent-session | claude-code | ☐→- | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 칸 안 늘림 — agent_session 은 목록은 물론 상세 화면에서도 렌더되지 않는다(037 의 소비처가 아직 UI 로 안 이어짐). 쓸 데 없는 칸은 부채 |
| 2026-09-08T00:40:00+09:00 | #use-plan-document-size | claude-code | ☐→- | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 다시 보고 쪼개지 않기로 — 쓰기가 읽기 상태를 만지는 자리 68곳, setStatus 는 롤백용 prevDetail 을 읽는 쓰기이자 읽기. 소비자도 하나뿐 |
| 2026-09-08T00:40:00+09:00 | #empty-hint-rest | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 1·2차에서 이미 끝났는데 파생 항목({#empty-hint-final})만 닫고 원본을 안 닫았다 — 호출부 0 확인 후 정정 |
| 2026-09-08T00:41:00+09:00 | #plugin-card-dismiss | claude-code | ☐→x | .oculpm/journal/20260908/Refactors/0031_refactor_nesting-visibility-splits-and-warnings.md | 2차에서 이미 끝났는데 원본 항목을 안 닫았다 — pluginCardDismissed 설정 키와 X 버튼 확인 후 정정 |
| 2026-09-08T00:41:00+09:00 | #neutral-session-env | claude-code | ☐→- | .oculpm/journal/20260908/Features_to_add/0030_feature_gate-attribution-segments-codex-hooks.md | blocked → dropped. 「미확인」이 아니라 「이 경로로는 불가」로 확정됐다(위 {#mcp-json-session-env} 실측). 폴백이 정답이다 |
| 2026-09-08T15:32:58+09:00 | #eyes-tcc-desktop | claude-code | ☐→☐ | .oculpm/journal/20260908/Bugs/1516_bug_desktop-mcp-status-tcc-prompt-on-mount.md | 신규 항목 — 연동 탭 마운트가 남의 앱 데이터를 stat 하던 것을 버튼 뒤로 옮겼다. 코드 쪽은 회귀 테스트로 잠갔고 프롬프트가 안 뜨는 순간만 사람 눈이 필요하다. 설치본 2.45.1 에는 이 수정이 없으니 다음 릴리스 뒤에 tccutil reset 후 확인 |
| 2026-09-08T17:40:20+09:00 | #eyes-terminal | claude-code | ~→~ | .oculpm/journal/20260908/Bugs/1740_bug_retire-empty-stale-pty-host.md | 빈 옛 PTY 호스트 자동 교체 추가 — 육안 확인 1건 더: 이 판 설치 뒤 터미널을 안 쓴 채 다음 업데이트를 받고, 새 호스트가 /Applications 실행파일로 떴는지(lsof -p) + 화면 기록 승인이 유지되는지 |
| 2026-09-11T00:54:54+09:00 | #eyes-journal-ledger | claude-code | ☐→☐ | .oculpm/journal/20260911/Features_to_add/0054_feature_entry-detail-reading-column.md | 일지 열람(읽는 칸) 리디자인도 같은 격자로 — 마스트헤드 척추 --c 대비 · 인라인 코드 바탕 · 절 실선 · 파일 메뉴(.efb-menu) 그림자 · 리사이저 hover · 720 이하 위아래 쌓임. 하네스로만 봤다 |
| 2026-09-11T01:00:06+09:00 | #eyes-sidebar-scroll | claude-code | ☐→☐ |  | 2026-09-11 사이드바 리디자인(활자 머리·섹션 척추·발 한 줄) 뒤 같은 격자로 다시 봐야 — 프리셋 5종에서 척추(--sep-strong)·활성 막대 대비, 접힌 오버레이의 발 아이콘 칸. 하네스로만 봤다 |
| 2026-09-11T11:31:41+09:00 | #eyes-start-ledger | claude-code | ☐→☐ | .oculpm/journal/20260911/Features_to_add/1125_feature_start-tab-ledger-redesign.md | 시작 탭 리디자인 이월 — 하네스로만 봤다. 미커밋(refs/backup/start-tab-ledger-20260911) |
| 2026-09-11T17:59:51+09:00 | #i18n-rest | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/1759_feature_i18n-english-screens-walk.md | "잔여 500줄" 은 이미 0. 순회는 두 겹: i18n_english_screens 스위트(사이드바+15화면 영어 렌더, 한글 0·오류경계 0) + DOM 덤프→빌드 CSS→Chrome 1280/960 육안. 잡은 것: agents 단위·folder 복수형·스킬 머리 4줄 접힘·검색칸 짜부라짐·일지 부제. f390ee4. 실기기 영어는 eyes 격자에서 |
| 2026-09-11T22:55:00+09:00 | #en-shots | claude-code | ☐→x | .oculpm/journal/20260911/Features_to_add/2254_feature_en-landing-shots-and-acp-today-fallback.md | 설치본을 TCC(화면기록+손쉬운사용)로 직접 조작해 7장 촬영, en/index·keynote 가 /shots/en/ 을 가리킴. 회귀 2 동승 수정(ACP 위 Today 폴백·툴바 날짜 로케일). 3.0.0 뒤 재촬영하면 2.47.0 흔적(agents 단위·한국어 날짜) 사라짐. c938e0f |
| 2026-09-11T23:12:38+09:00 | #eyes-wizard | claude-code | ☐→x | .oculpm/journal/20260911/Bugs/2312_bug_wizard-empty-draft-autosave.md | 육안 원장에서 사용자 판정 fail 1건 — 빈 마법사 autosave 가 「새 프로젝트」 초안을 남겨 시작 탭 명령과 둘로 보임 → 문턱+초안 배지+회귀 테스트 e55eba9. 마법사 자체 단계 진행은 사용자가 봄 |
| 2026-09-11T23:12:45+09:00 | #eyes-design-ramp | claude-code | ☐→x |  | 설치본 자동 조작으로 7테마(light/dark/Solarized/Sepia/Nord/Dracula/HiContrast)×6화면 격자 촬영·판정 — 포커스 링·배지 무게·seg 동심원·토글 노브 OK. 사용자 원장 pass 와 일치 |
| 2026-09-11T23:12:50+09:00 | #eyes-tw-scale | claude-code | ☐→x |  | 설정 12탭·시작탭·⌘K 7테마 격자에서 램프 어색한 곳 없음. 사용자 원장 pass |
| 2026-09-11T23:12:55+09:00 | #eyes-modal-scrim | claude-code | ☐→x |  | Solarized·Sepia 에서 수동 일지·대화 기록 모달 스크림 테마색(크림/세피아) 확인 — 검정 아님 |
| 2026-09-11T23:13:02+09:00 | #eyes-hljs | claude-code | ☐→x |  | diff(HTML)·편집기(Python) 7테마 — 주석 회색 이탤릭·키워드 마젠타/보라·문자열 초록·태그 빨강, 편집기와 diff 같은 계열. 사용자 원장 pass. monaco-editor-round fin-eyes 는 이미 x |
| 2026-09-11T23:13:07+09:00 | #eyes-ia | claude-code | ☐→x |  | 640 높이에서 갈래 펼침·접힌 오버레이 갈래 목록 OK. ⌘번호 안내 1회는 이미 지나가 미확인(다음 업데이트 뒤). 사용자 원장 pass |
| 2026-09-11T23:13:13+09:00 | #eyes-sidebar-scroll | claude-code | ☐→x |  | 640 높이 — 발 고정·핀 상태 아래쪽만 페이드·오버레이는 다 들어가 페이드 없음·활성 링 안 잘림 |
| 2026-09-11T23:13:19+09:00 | #eyes-settings-search | claude-code | ☐→x |  | 960 폭(가로 탭 줄 위)·1512(세로 탭 위) 둘 다 검색칸 제자리 |
| 2026-09-11T23:13:24+09:00 | #eyes-planner-redesign | claude-code | ☐→x |  | WKWebView 7테마 격자 — pmark 6상태·막힘 !·단계 스트립·스티키 머리 OK, 960 폭에서 메타 열 제목 아래로. 사용자 원장에도 pass |
| 2026-09-11T23:13:30+09:00 | #eyes-journal-ledger | claude-code | ☐→x |  | WKWebView 7테마 — 척추·색띠 대비·날짜 레일·스티키 머리 OK, 640 폭에서 레일 숨고 명단 아래줄. 초점 1.6초는 미확인 |
| 2026-09-11T23:13:36+09:00 | #eyes-planner-rail | claude-code | ☐→x |  | 진행 파이·완료 원 7테마 OK. ⋯ 메뉴 위치·접힌 띠 세로 라벨은 미확인(사용자 원장 pass 로 갈음) |
| 2026-09-11T23:13:42+09:00 | #eyes-start-ledger | claude-code | ☐→x |  | 사용자 육안 원장 pass (2026-09-11 21:25) |
| 2026-09-11T23:13:48+09:00 | #eyes-dnd | claude-code | ☐→x |  | 사용자 육안 원장 pass (2026-09-11 21:33) |
| 2026-09-11T23:13:54+09:00 | #eyes-terminal | claude-code | ~→x |  | 사용자 육안 원장 pass (21:32). 덤으로 PTY 재접속은 오늘 세션 자체가 증거 — 호스트 kill·앱 재시작 3회 뒤 claude --resume 로 이어짐 |
| 2026-09-11T23:13:59+09:00 | #eyes-skills | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:33) |
| 2026-09-11T23:14:03+09:00 | #eyes-mixed-dpi | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:33) |
| 2026-09-11T23:14:08+09:00 | #eyes-v242 | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:33) |
| 2026-09-11T23:14:13+09:00 | #eyes-activity | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:32) |
| 2026-09-11T23:14:17+09:00 | #eyes-branch | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:31) |
| 2026-09-11T23:14:22+09:00 | #eyes-firstrun | claude-code | ☐→x |  | 사용자 육안 원장 pass (21:29) |
<!-- oculpm:plan-log end -->
