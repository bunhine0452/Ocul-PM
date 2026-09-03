---
oculpm_plan: v1
id: first-run-and-english-landing
title: "첫 실행 마법사 · 영문 랜딩 — 처음 온 사람의 두 입구"
status: done
created: 2026-09-01
updated: 2026-09-02
owner: claude-code
---

처음 오는 사람이 마주치는 두 입구를 손본다. **웹**에서는 영어권 방문자가 한국어
랜딩에 떨어지고(위키만 2026-08 에 ko/en 이 됐다), **앱**에서는 설치하고 처음 켠
사람이 프로젝트 0개인 시작 탭을 본다 — Cursor·Antigravity 가 첫 실행에 언어·테마를
묻고 폴더 하나를 열게 하는 그 자리가 비어 있다.

## Phase 1 — 첫 실행 마법사 {#first-run}
- [x] 세 판 창 — 언어 · 모양(테마+강조색) · 첫 프로젝트, 고르는 즉시 적용(미리보기 상자 없음) {#wizard-panels}
- [x] 뜨는 조건 — `onboarded=false` **그리고** 프로젝트 0개. 기존 설치본이 업데이트 후 안내를 다시 받지 않게 하는 유일한 방어 {#wizard-gate}
- [x] 모든 출구가 `onboarded` 를 적는다 (끝내기·건너뛰기·Esc) + 지연 청크 분리 {#wizard-seal}
- [x] 회귀 테스트 13 — 게이트 5 · 흐름 8 {#wizard-tests}
- [ ] 실기기 확인 — 설치본을 끄고 `onboarded` 를 지운 뒤 눈으로 한 바퀴 (설치본 도는 중 dev 빌드 금지 규율) {#wizard-eyes}

## Phase 2 — 영문 랜딩 {#en-landing}
- [x] `/en` 전체 번역 — 히어로·3막·벤토 30셀·변경 이력·FAQ 19·CTA (직역 아님, README.en 목소리) {#en-page}
- [x] SEO — canonical·hreflang 3(양쪽 페이지)·og:locale(+alternate)·JSON-LD 2벌 영어·sitemap `/en` {#en-seo}
- [x] 언어 전환 알약(네비·푸터 양쪽) + 영문 위키 네비가 `/en` 으로 (`build.mjs` 로케일 `home`) {#en-switcher}
- [x] README.en 링크를 영문 표면으로 (`/en` · `/wiki/en`) {#en-readme}
- [ ] 영문 UI 스크린샷 재촬영 → `landing/shots/en/` (지금은 한국어 화면이 실려 있다 — 영문 페이지의 가장 큰 미완) {#en-shots}
- [ ] 키노트 `/keynote` · 플러그인 `/plugin` 영문판 (지금은 배너에 "한국어 내레이션" 한 줄로 정직하게 적어 둠) {#en-keynote-plugin}
- [ ] 배포 — `cd landing && vercel --prod` (git 연동 없음 · 사용자 승인 대기) {#en-deploy}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | agent | 변화 | 일지 | 메모 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-01T18:45:00+09:00 | #wizard-panels | claude-code | →☐→[x] | 20260901/Features_to_add/1845_feature_first-run-wizard.md | 언어는 AI 작성 언어까지 함께 맞춘다 |
| 2026-09-01T18:45:00+09:00 | #wizard-gate | claude-code | →☐→[x] | 20260901/Features_to_add/1845_feature_first-run-wizard.md | 프로젝트 0개 조건이 기존 사용자 방어 |
| 2026-09-01T18:45:00+09:00 | #wizard-seal | claude-code | →☐→[x] | 20260901/Features_to_add/1845_feature_first-run-wizard.md | WelcomeWizard-*.js/css 청크 확인 |
| 2026-09-01T18:45:00+09:00 | #wizard-tests | claude-code | →☐→[x] | 20260901/Features_to_add/1845_feature_first-run-wizard.md | 13 통과 · 전체 1678 그린 |
| 2026-09-01T18:45:00+09:00 | #wizard-eyes | claude-code | →☐ | 20260901/Features_to_add/1845_feature_first-run-wizard.md | 설치본 종료 후로 미룸 |
| 2026-09-01T18:50:00+09:00 | #en-page | claude-code | →☐→[x] | 20260901/Chores/1850_chore_english-landing-page.md | 태그 균형·JSON-LD 파싱·크롬 육안 확인 |
| 2026-09-01T18:50:00+09:00 | #en-seo | claude-code | →☐→[x] | 20260901/Chores/1850_chore_english-landing-page.md | sitemap 36 URL |
| 2026-09-01T18:50:00+09:00 | #en-switcher | claude-code | →☐→[x] | 20260901/Chores/1850_chore_english-landing-page.md | 위키 재생성 diff 는 영문 16쪽 두 줄뿐 |
| 2026-09-01T18:50:00+09:00 | #en-readme | claude-code | →☐→[x] | 20260901/Chores/1850_chore_english-landing-page.md | /en · /wiki/en |
| 2026-09-01T18:50:00+09:00 | #en-shots | claude-code | →☐ | 20260901/Chores/1850_chore_english-landing-page.md | 앱을 English 로 두고 재촬영 필요 |
| 2026-09-01T18:50:00+09:00 | #en-keynote-plugin | claude-code | →☐ | 20260901/Chores/1850_chore_english-landing-page.md | 배너에 한국어 내레이션 고지 |
| 2026-09-01T18:50:00+09:00 | #en-deploy | claude-code | →☐ | 20260901/Chores/1850_chore_english-landing-page.md | vercel --prod 는 사용자 승인 후 |
<!-- oculpm:plan-log end -->
