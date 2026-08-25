---
oculpm_plan: v1
id: today-ring-followup
title: "Today 링 후속 — 버려진 브랜치에서 건진 것과 남은 것"
status: active
created: 2026-08-25
updated: 2026-08-25
owner: claude-code
---

2026-08-15 브랜치 `fix/today-ring-line-delta-and-audit`(29915fb)는 Today 링 전수
점검으로 **9건**을 고쳤다. 5일 뒤 main 이 `69b1cc5` 로 그중 **①②만** 다른 스키마로
재작업했고(브랜치는 `oculpm_journal` entry 단위 + `diff_mtime`, main 은
`oculpm_journal_files` 파일 단위), 나머지 7건은 어느 쪽에도 들어가지 않은 채 남았다.

브랜치 코드는 백엔드가 죽었다(스키마 충돌 + `cache.rs` 8파일 분할로 적용 불가).
다만 main 이 `bytesAdded→linesAdded` 개명을 **독립적으로 똑같이** 한 덕에 프런트
hunk 들은 문맥이 맞아 그대로 살릴 수 있었다 — 두 버전 차이는 +28/−56 뿐이었다.

## Phase 1 — 건져 온 것 {#p1-salvaged}
- [x] a11y — 링 컨테이너에 `role="img"`. `aria-label` 은 암묵 generic(`<div>`)에 금지라, svg 는 aria-hidden 이고 툴팁은 마우스 전용이라 위젯 전체가 무음이었다. axe 가 못 잡는 케이스 {#ring-role-img}
- [x] a11y — 호버 툴팁의 `role="status"` 제거(→ `aria-hidden`). 라이브 리전이라 포인터가 스칠 때마다 공지가 나갔다 {#tip-not-live}
- [x] 프로젝트 전환 시 헛 리플 — `key={projectId}` 로 인스턴스 리셋. 링은 changedToday 증가를 "새 기록"으로 읽는데 전환은 그냥 다른 프로젝트 수치다(2→9 가 새 기록으로 오인) {#ripple-project-key}
- [x] 리플 span 영구 잔존 — `pulse: number|null` + `onAnimationEnd` 언마운트. `animation-fill-mode: forwards` 라 끝나도 opacity 0 으로 DOM 에 남았다 {#ripple-unmount}
- [x] 천단위 구분 — 링 호버값 3종 + 스탯 카드 라인 증감 {#thousands-sep}
- [x] brief mock 타입 고정 — `satisfies WorkdayBrief`. mock 이 `bytes_added/removed` 를 반환하는데 DTO 는 `lines_added/removed` 라 **조용히 낡아 있었다**(테스트가 라인 표시를 검증하지 못하고 있었다) {#brief-mock-pin}
- [x] 회귀 테스트 3건 — role=img · 툴팁 비-라이브 · 천단위 {#ring-tests}

## Phase 2 — 남은 것 {#p2-open}
- [ ] **변경 파일 수 중복 집계** — `useTodayBrief.ts:186` 의 `reduce((s,e) => s + e.files_count, 0)` 는 파일 **터치 횟수**라 같은 파일을 여러 일지가 건드리면 부풀린다(브랜치 실측 20260811: 117 vs 실제 82, **43% 과대**). 백엔드에 `COUNT(DISTINCT file_path)` 신설 필요 — 브랜치 구현은 못 쓴다(cache.rs 분할) {#distinct-file-count}
- [ ] **라인 링의 k 값 재검토** — main 은 `fillFraction(lineChurn, 400)`, 브랜치는 실측 근거로 `4000` 을 주장했다(*"활발한 날은 5k–20k 라인"*). 400 이면 매일 상한(0.97)에 붙어 링이 정보를 안 나른다. main 의 400 이 나중 값이라 의도적 재측정일 수도 있으니 실제 데이터로 확인부터 {#churn-k-value}
- [ ] **리플 언마운트 실기기 확인** — jsdom 은 CSS 애니메이션을 안 돌려 `animationend` 가 자연 발생하지 않고, 합성 이벤트도 React 19 의 `onAnimationEnd` 에 닿지 않는다(fireEvent 기본·bubbles:true·수동 dispatch 셋 다 0회 실측). 단위 테스트로 못 덮으므로 브라우저에서 눈으로 {#ripple-manual-verify}
- [ ] **Today 라인 표시 커버리지** — brief mock 이 낡은 채였는데도 1,308건이 전부 통과했다. 즉 라인 증감 표시를 검증하는 테스트가 없다 {#lines-display-coverage}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-25T23:44:00+09:00 | #ring-role-img | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | role="img" — bare div 의 aria-label 은 무시된다 |
| 2026-08-25T23:44:00+09:00 | #tip-not-live | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | 툴팁 role=status → aria-hidden |
| 2026-08-25T23:44:00+09:00 | #ripple-project-key | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | key={projectId} 로 전환 시 헛 리플 제거 |
| 2026-08-25T23:44:00+09:00 | #ripple-unmount | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | onAnimationEnd → setPulse(null) |
| 2026-08-25T23:44:00+09:00 | #thousands-sep | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | toLocaleString — 링 3곳 + 스탯 카드 |
| 2026-08-25T23:44:00+09:00 | #brief-mock-pin | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | satisfies WorkdayBrief — bytes_* 로 낡아 있던 mock 정정 |
| 2026-08-25T23:44:00+09:00 | #ring-tests | claude-code | ☐→x | 20260825/Refactors/2344_refactor_today-ring-salvage.md | 회귀 3건 (1,308 → 1,311) |
<!-- oculpm:plan-log end -->
