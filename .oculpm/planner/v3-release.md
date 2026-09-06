---
oculpm_plan: v1
id: v3-release
title: "3.0 을 내보내기 전에 — 육안 확인 부채와 영문 표면 (3.0.0)"
status: active
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

이 저장소에서 「완료」의 실제 의미는 "코드는 들어갔고 사람 눈으로는 안 봤다"였다. done 플랜 40개에 그런 항목이 약 25건 남아 있고, UI 손맛이 본질인 라운드가 통째로 미확인인 채 done 이다. 3.0 은 그 부채를 갚는 라운드이기도 하다.

## 육안 확인 부채 {#eyes}
- [ ] drag-and-drop-round 미확인 6건 — 탭 드래그·떼어내기·창간 이동 {#eyes-dnd}
- [ ] terminal-identity-round 3건 + search-and-terminal-survival PTY 수동 확인 + tab-reattach-regression 1건 {#eyes-terminal}
- [ ] skills-star-round 2건 · mobile-bridge 검증 · claude-integration 런타임 확인 2건 {#eyes-skills}
- [ ] first-run-and-english-landing 의 마법사 실기기 확인 (wizard-eyes) {#eyes-wizard}
- [ ] 혼합 DPI 커서 좌표계 — improvement-audit-round 에서 이관했는데 받은 플랜에 항목이 없어 유실됐다 {#eyes-mixed-dpi}
- [ ] v2.42.0 미확인 ~20건 — 큰 붙여넣기(raw 모드 터미널에 수백 KB: 다른 탭 반응·나중에 순서대로 도착)·한국어 IME 조합 순서·리사이즈와 타이핑 겹침·Kill 뒤 셸 종료·글자크기/터미널폰트 슬라이더 드래그 체감과 놓을 때 저장·드래그 중 탭이동 flush·나머지 슬라이더 7개 라벨 추종·터미널 도크 리사이즈/분리/복귀·⌘K 이동과 사이드바 접기·실패 토스트 문구·index_project 실경로 1회·큐 오버플로 실경로(경고→만회→토스트)·프로젝트 닫은 뒤 색인/히스토리 정지·LSP 서버 일람·임베딩 진행 배너·읽기전용에서 주인 회수 {#eyes-v242}
- [ ] 글리프 위생 — codex-acp 6건이 [~] 인데 done(release-gates 미확정 포함) · skill-catalog-round-2 는 archived 여야 · drag-and-drop Phase 8 의 4건은 [-] 여야 · menubar-tray 의 v2.3.0 항목은 죽은 항목 {#glyph-hygiene}

## v2.42.0 이월 — 네 세션이 소유 밖에서 발견한 것 {#v242-carry}

받는 플랜에 항목이 없어 유실된 전례(`{#eyes-mixed-dpi}`)를 되풀이하지 않으려고 여기에 적는다.

- [ ] `manager/lifecycle.rs::watcher_stop` 이 전역 맵 write 락을 쥔 채 `watcher.stop().await` 로 드레인을 기다린다 — 기준선이 잰 드레인이 4.3초다. v2.42.0 의 `{#manager-write-lock}` 과 같은 병리인데 그 3항목 밖이라 남았다 {#v242-watcher-stop-lock}
- [ ] `oculpm/lock.rs` 의 `LockGuard::drop` 이 "디스크 pid == 내 pid" 로만 소유를 판정한다 — 한 프로세스 안에 같은 경로의 가드가 둘이면 서로의 파일을 지운다. 지금은 `lifecycle_lock` 이 그 상황을 막고 있을 뿐이고, 근본 해결은 가드 무장 해제나 프로세스 내 경로별 소유권 등록이다 {#lockguard-disarm}
- [ ] 워처 드레인 시간 자체 — 유계 큐는 메모리 상한만 고쳤다. 줄이려면 gitignore 판정을 채널 **앞**으로 당기거나(`target/` 55,663 파일이 큐에 안 들어오게) 소비를 배치화해야 한다 {#watcher-drain-time}
- [ ] `WatcherStatus.dropped_total` 노출 — 지금 큐 버림은 로그와 토스트로만 보이고 진단 화면에서 볼 수 없다. `spec.rs` + `bindings.ts` + 프런트가 함께 움직여야 한다 {#dropped-total-surface}
- [ ] 소유 밖 `void set(...)` 8자리를 `useSaveSetting` 으로 — `features/theme/ThemeGallery.tsx:68,101` · `features/onboarding/WelcomeWizard.tsx:98,130,135,229,252` · `lib/theme.tsx:38`. 지금도 사용자에게 보이긴 하지만 계약이 갈려 있다 {#void-set-remainder}
- [ ] `MenubarSection` 의 마운트 시 `settingsGetAll` 이 조용히 실패한다 — 트레이 토글이 이유 없이 비활성으로 남는다 {#menubar-silent-fetch}
- [ ] 떠 있는 프로미스 약 100개가 플랜이 지목한 경로 밖에 남아 있다 {#floating-promises-rest}
- [ ] 스케줄링을 재는 계측이 없다 — "런타임 워커가 얼마나 막혔나 · 큐가 얼마나 찼나 · 버림이 몇 번인가". 지금 하니스는 날것의 일만 잰다 (perf-baseline §7) {#scheduling-telemetry}
- [ ] `scripts/check-no-hardcoded-korean.mjs` 의 `TESTS` 허용목록에 `__tests__/workspace_slice_consumers.test.tsx`·`__tests__/settings_deferred_commit.test.tsx` 두 줄 — 지금 그 둘만 테스트 이름이 영어라 집 문체에서 벗어나 있다 {#test-name-allowlist}
- [ ] `package.json` 의 `--max-warnings=61` 에 여유가 0 이다 — 다음 라운드가 경고 하나만 늘려도 붉어진다. 래칫을 내리는 정리 패스가 필요하다 {#eslint-ratchet-slack}

## v3-record-integrity 이월 — 기둥 1 이 소유 밖에서 남긴 것 {#pillar1-carry}

기둥 1(19항목)을 2026-09-05 에 마감하며 나온 빚. 일지에만 적으면 유실되므로(`{#eyes-mixed-dpi}` 가 그 사고 기록) 여기에 항목으로 적는다.

- [ ] **병렬 세션에서 배달 게이트가 아예 발화하지 않는다** — 살아 있는 옆 대화가 하나라도 있으면 전부 `undecided` 다. 오탐보다 미탐을 고른 결과지만, 이 저장소의 주 사용 방식이 병렬 세션이라 게이트가 사실상 꺼져 있다. 넘어설 재료는 이미 있다: Stop 페이로드의 `transcript_path` 에 그 대화 자신의 Edit/Write 도구 호출이 들어 있어 **대화별 양성 귀속**이 가능하다 {#gate-positive-attribution}
- [ ] **제품 약속 문구가 사실보다 좁다** — `CLAUDE.md`·README ko/en·랜딩의 "LLM 호출과 업데이트 확인 말고는 기기 밖으로 안 나간다"는 실제로 예외를 다섯 개 더 갖는다: Notion API + `https://oculpm.com/api/notion/oauth/start` **OAuth 브로커**(우리 서버가 사용자 인증 흐름 한가운데 있다) · 플러그인 zip · 테마 다운로드 · fastembed 모델. 원장(`tests/egress_inventory.rs`)이 사실을 적었으니 다음은 문구다 {#promise-text-truth}
- [ ] `tauri.conf.json` 의 `csp: null` — 웹뷰에 CSP 가 없어 아무 데나 갈 수 있다. 지금은 프런트 유출 원장이 대신 지킨다 {#webview-csp}
- [ ] `oculpm::reconcile` 이 CAS 문지기 밖 — 앱 내부 화해기가 여전히 인프로세스 `plan_write_lock` 만 써서, 앱과 MCP 서버가 동시에 같은 플랜을 고치는 창이 남아 있다 {#reconcile-file-guard}
- [ ] 진짜 2-프로세스 CAS 테스트 — 지금은 스레드 동시성 + "남의 락 파일을 존중하는가"로 대신 물었다 {#cas-two-process-test}
- [ ] `HonestyAudit`(`today/HonestyAudit.tsx:97`)에 같은 자기은닉이 남아 있다. 가르는 선은 **주장하는 카드는 0을 말하고 제안하는 카드는 숨어도 된다** — 이건 "누락 없음"을 주장하므로 앞쪽이다 {#honesty-audit-unhide}
- [ ] MCP 서버가 신원을 읽는 변수를 `OCULPM_SESSION_ID` 로 완전 이행 — 지금은 옛 `CLAUDE_CODE_SESSION_ID` 폴백이 남아 있어 Claude 어댑터가 자기 값으로 덮어쓸 가능성이 있다 {#neutral-session-env}
- [ ] SQLite 캐시 `oculpm_journal` 에 `agent_session` 컬럼이 없다(`cache/query.rs:395` 가 `None`) — 캐시 경유 판정은 영원히 `None` 이다. 마이그레이션 2단계 + `ADDITIVE_COLUMNS` {#cache-agent-session}
- [ ] 앱 종료·ACP 어댑터 사망 시 세그먼트가 안 닫힌다 — `process.rs`(1241/1241)가 크기 래칫 상한이라 손대지 않았다. 그 6시간 동안 옆 대화의 게이트가 침묵한다 {#acp-segment-close}
- [ ] 삭제만 한 대화는 판정을 빠져나간다 — 삭제된 파일은 mtime 을 물을 자리가 없다(셸 판정에서 물려받은 한계) {#verdict-deletions}
- [ ] Codex 훅 배포 경로 미확정 — 매니페스트 `hooks` 는 Codex 검증기가 거부하고(실측), `oculpm-codex` 는 스킬만 싣는다. 훅을 원하는 Codex 사용자는 Claude 플러그인을 써야 하는데 지금은 스킬 문서 한 줄로만 안내된다 {#codex-hook-delivery}
- [ ] `claude-events.jsonl` 에 타임스탬프 필드가 없고, `hooks.json` 의 인라인 append 훅이 `cat >>` 라 개행을 안 붙여 깨진 줄 5건이 실재한다 (`session-end.sh` 는 `printf '%s\n'` 을 쓴다) {#event-ledger-hygiene}
- [ ] CAS 필수화가 두 문서 표면에 미반영 — `src/features/skills/pluginDocs.ts:90` 과 `mcp/protocol.rs` 의 `MCP_INSTRUCTIONS` {#cas-doc-surfaces}
- [ ] `src/i18n/errors.ts` 에 `automation_bad_condition` 이 없다 — 지금은 파서 경고가 카드에 뜨고 실행은 fail-closed 로 막힌다 {#automation-error-key}
- [ ] `config.toml` 의 `forbid_journal_for_paths` 에 있는 `**/*token*` 이 **디자인 토큰 파일을 시크릿으로 오인**해 `files_touched` 에 못 넣는다(`styles/tokens.css`·`design_tokens.test.ts`). 2026-09-04 에 기록된 오탐이 이번에도 그대로 물렸다 {#token-glob-false-positive}
- [ ] 사이드바 스크롤 실기기 육안 확인 — 낮은 창에서 발(터미널 도크·테마·설정)이 늘 보이는가 · 넘치는 쪽만 페이드가 뜨는가 · **접힌 오버레이**에서도 같은가 · 스크롤바가 떴을 때 활성 항목의 링 그림자가 안 잘리는가 {#eyes-sidebar-scroll}

## 영문 표면 {#english}
- [ ] 영문 스크린샷 촬영 — landing/en/index.html 이 한국어 UI 스크린샷을 참조하고 landing/shots/en/ 이 없다 {#en-shots}
- [ ] /keynote · /plugin 영문판 — 지금 링크가 한국어판뿐이다 {#en-subpages}
- [ ] i18n 잔여 ~500줄 + 영어 모드 전 화면 순회 (three-features-round 의 i18n-rest·i18n-overflow) {#i18n-rest}

## 죽은 표면 정리 {#dead-surfaces}
- [ ] 죽은 커맨드 20개 판정 — overview.rs 표면 전체(폴더도 없다) · oculpm_open_entry_in_editor(opener-scope 3회 회귀 끝에 만든 우회로인데 호출부 0) · acp_stop(멈춘 어댑터를 화면에서 내릴 길이 없다) · dap_clear_breakpoints 등. 각각 제거할지 UI 를 붙일지 {#dead-commands}
- [ ] 죽은 API 래퍼 7개 — 백엔드가 모바일 브리지에서 쓰이는 것과 구분해서 {#dead-wrappers}
- [ ] Today 변경된 파일 43% 과대(파일 터치 횟수) + 링 k=400 이 매일 상한에 붙는 문제 (today-ring-followup 이월) {#today-overcount}
- [ ] oculpm_reindex_cache · oculpm_watcher_stop 에 UI 경로 — 지금 워처는 켜만 있고 끔을 수 없고, 일지 캐시 재색인 복구 버튼이 없다 {#revive-recovery-cmds}

## 릴리스 3.0.0 {#release-300}
- [ ] EVALS.md 기준 실행 {#evals}
- [ ] 게이트 전수 exit 0 {#gates-green-300}
- [ ] 릴리스 5면 + 태그 + 랜딩 배포 (landing 에서 vercel --prod) {#release-300-2}

## 기둥 2 이월 — v3-surface 가 소유 밖에서 남긴 것 {#pillar2-carry}

기둥 2(32항목)를 2026-09-06 에 5레인 병렬로 마감하며 나온 빚. 일지에만 적으면
유실되므로(`{#eyes-mixed-dpi}` 가 그 사고 기록) 여기에 항목으로 적는다.

- [ ] **Today 에 「지금 무엇을 하고 있는가」 표면이 아예 없다** — `TodayMonitor.tsx:36` 의 「활동 시간」은 집계만 말한다. `{#activity-vocab-reuse}` 가 Today 도 같은 어휘를 쓰라고 했지만 그건 새 행을 만드는 일이라 범위 밖으로 뒀다. 재료는 준비됐다: `features/chat/activity/ActivityLine.tsx`(kind+detail 두 값) + `features/sessions/sessionActivity.ts:seatActivity()` {#today-activity-row}
- [ ] `agentColor.ts` 의 `PALETTE[0]`(#d97a4f)이 Claude 코랄(#d97757)과 거의 같다 — **모르는 에이전트가 Claude 처럼 보인다.** 해시 버킷이라 코랄로 통일하지 않았고(뜻이 다르다), 대신 구별되는 색이 필요하다 {#palette-claude-collision}
- [ ] `--code-*` 가 테마 스키마 화이트리스트에 없다 — `features/theme/schema.ts` 와 `src-tauri/src/themes/mod.rs` 를 **함께** 늘려야 한다(`theme_schema.test` 가 둘의 일치를 단언). 지금은 프리셋 5종만 문법색을 정할 수 있고 내려받은 커스텀 테마는 못 정한다 {#code-tokens-theme-schema}
- [ ] 화면별 CSS 의 글자 리터럴 잔여 ~40곳 — `projects/graph/code/docs/tray/skills/discussion/welcome/home/mobile` + `agent.css` 3곳(:892 14px · :1465 19px · :2086 13.5px). 전부 램프로 기계 치환 가능 (`bootsplash.css:77` 은 테마 CSS 이전 첫 페인트라 의도적 예외) {#fs-literals-rest}
- [ ] 임의 z 값 5곳을 새 어휘로 — `CommandPalette z-[100]` · `AppDialog z-[95]` · `windows/Dialog z-[110]` · `SettingsOverlay z-[90]` · `GreenfieldWizard z-[90]`. `z-popover`/`z-modal`/`z-top` 은 이미 깔려 있다 {#z-vocab-adopt}
- [ ] `.empty-hint` 잔여 호출부를 EmptyState 로 — `chat/ConversationHistoryModal.tsx:112,114` · `settings/automation/AutomationHistory.tsx:56,57` · `settings/automation/AutomationTab.tsx:225,287` · `shell/ShellV2.tsx:520` · `features/projects` 의 리치 빈 상태 4번째. 끝나면 `primitives.css` 의 `.empty-hint` 와 죽은 CSS(`.docs-empty*`·`.code-empty-*`·`.search-noindex*`)를 지울 수 있다 {#empty-hint-rest}
- [ ] `PlannerScreenV2.tsx`(1,149줄)·`DiffScreenV2.tsx`(799/800줄) 분할 — 파일 크기 래칫 때문에 새 빈 상태 JSX 를 **압축된 형태**로 넣어야 했다(가독성 나쁨). 래칫이 부채를 정확히 가리키고 있다 {#planner-diff-split}
- [ ] 브랜치 축의 세 한계 — ① 중첩 저장소(git 루트가 프로젝트 루트 아래)면 `.oculpm/journal/**` 가 git 출력에 안 나와 `Entry` 근거가 통째로 사라지고 조용히 약해진다(코드에 명시 주석 없음) ② `Files` 겹침이 과잉 귀속한다(같은 창의 두 브랜치가 같은 파일을 건드리면 양쪽에 잡히고 배제할 손잡이가 없다) ③ 기준 없는 브랜치는 최근 300 커밋을 보는데 성능 미측정 {#branch-axis-limits}
- [ ] ACP 화면의 `@/lib/bindings` 직접 호출 5파일을 `api/acp.ts` 로 — 분해로 갈라 나온 것이라 총량은 안 늘었지만, 옮기려면 envelope→throw 로 오류 처리를 전부 바꿔야 한다 {#acp-api-wrapper}
- [ ] `PluginSetupCard` 에 닫기 버튼이 없다 — 영구 닫기는 설정 키가 필요하다. 지금은 일지 0건 조건으로 좁혀 첫 일지 한 건이면 사라진다 {#plugin-card-dismiss}
- [ ] `AcpConversation.tsx` 749줄 · `ShellV2.tsx` 711줄 — 둘 다 한계 안이지만 여유가 적다. 다음 라운드가 여기 붙이면 곧 걸린다 {#big-files-watch}

## 기둥 2 육안 확인 부채 {#pillar2-eyes}

이번 라운드는 **보이는 것**을 바꿨는데 앱을 한 번도 띄우지 않았다.

- [ ] Tailwind 글자 크기 축소(`text-sm` 14→13 · base 16→14 · lg 18→15 · xl 20→17 · 2xl 24→20 · 3xl 30→26) — 설정 12탭 · 회고 · 새 프로젝트 마법사 · 모바일 셸 · 시작 탭/⌘K 팔레트 다섯 면 {#eyes-tw-scale}
- [ ] 문법 강조 — 라이트·다크 **+ 프리셋 5종** × 언어별(TS/Rust/Python/JSON/셸/마크다운)로 일지·논의 코드블록 · 변경 diff · 검색 스니펫, **그리고 편집기와 나란히**. 주석이 진해지고 키워드가 빨강→마젠타, 함수명이 보라→파랑 {#eyes-hljs}
- [ ] 모달 3종(설정 API 키 · 수동 일지 작성 · 대화 기록) — 스크림이 검정→테마색. **Solarized·Sepia 에서 꼭** {#eyes-modal-scrim}
- [ ] IA 재편 — 낮은 창에서 갈래가 펼쳐졌을 때 사이드바 스크롤·페이드 · **접힌 오버레이**에서의 갈래 목록 · ⌘번호 재배정 안내가 업데이트 뒤 1회만 뜨는지(첫 설치엔 안 뜨는지) {#eyes-ia}
- [ ] 활동 의미 층 — 접힌 묶음·원장 강조·곁가지·원본 레일의 **밀도**. 특히 `oculpm journal_write` 를 실제로 돌려 「일지 기록」이 뜨는지 · 긴 Bash 에서 15초 침묵 문턱이 적절한지 · 접힌 원본 레일을 펼쳐 JSON 이 읽히는지 {#eyes-activity}
- [ ] 브랜치 화면 — 툴바 브랜치 선택기 폭 · `.stat` 4칸 · 접이식 카드 · 빈 상태 · **네이티브 저장 대화상자** {#eyes-branch}
- [ ] 첫 5분 — 플러그인 카드는 Claude Code 가 실제로 깔린 기기에서만 뜬다 · 코드 화면 빈 패널의 flex 중앙 정렬 · 코드 맵 빈 캔버스 {#eyes-firstrun}
- [ ] 설정 검색 — embedded(가로 탭 줄 오른쪽)와 비-embedded(세로 탭 위) 양쪽 {#eyes-settings-search}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
