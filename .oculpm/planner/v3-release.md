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
- [ ] 글리프 위생 — codex-acp 6건이 [~] 인데 done(release-gates 미확정 포함) · skill-catalog-round-2 는 archived 여야 · drag-and-drop Phase 8 의 4건은 [-] 여야 · menubar-tray 의 v2.3.0 항목은 죽은 항목 {#glyph-hygiene}

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
