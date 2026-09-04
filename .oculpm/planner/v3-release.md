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

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
