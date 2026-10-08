---
oculpm_plan: v1
id: external-review-2026-10-08
title: "외부 코드 리뷰 수용 — 범위 동결 · 리뷰 주기화 · 생성물 diff (2026-10-08)"
status: active
created: 2026-10-08
updated: 2026-10-08
owner: claude-code
---

외부 리뷰 4지적(범위 과다 · 리뷰어 부족 · 버스 팩터 1 · 생성물 diff)을 실측으로 대조해 전부 수용. 버스 팩터는 데이터가 .oculpm/ 마크다운이라 잠기지 않아 조치 없이 수용. 걷기 후보 수치: 커밋·fix 는 git log 경로 집계(이름 바뀐 파일 미추적), 사용 원격측정은 설계상 없어 사용 신호는 사용자만 안다.

## 범위 동결 {#freeze}
- [x] CLAUDE.md 범위 동결 규칙 — 새 화면·외부 연동·상주 리스너 금지, 교체는 옛 경로 제거로 끝낸다 (근거: 60일 fix 211건 중 주변 95 · 핵심 80) {#freeze-rule}
- [x] improvement-round-2026-09-14 Phase 5 의 확장 백로그 보류 — dap-more · lsp-settings · plugin-marketplace · session-to-window · skill-catalog-b {#freeze-backlog}
- [ ] [사용자 결정] native-agent-drivers 의 새 능력 P3(앱 안 /rc)·P4(승인 영속·무인 실행)가 동결 대상인지 — P0~P2·P5 는 ACP 교체라 허용 {#decide-native-new}
- [ ] [사용자 결정] 걷기 후보 — 줄 수 · 전체 fix · 60일 fix {#decide-removal}
  - [ ] 모바일 브리지 — 3.5k줄 · fix 2 · Tailscale 상주 리스너 · 폰 E2E 미검증(improvement-round #mobile-bridge-rest) {#remove-mobile}
  - [ ] DAP 디버거 — 3.1k줄 · fix 2 · 디버거 프로세스 기동 · debugpy·dlv 왕복 미검증 {#remove-dap}
  - [ ] Notion — 0.9k줄 + oculpm.com 교환 서버 의존 · 루프백 리스너 · 보안 라운드 미완 2건(security-feedback-round #notion-token-url #notion-legacy-token-removal) {#remove-notion}
  - [ ] 코드 그래프 — 3.7k줄 · fix 2 · 전체 커밋 38 {#remove-graph}
  - [ ] VS Code 확장 — 2.7k줄(src) · 배포 채널 2곳(마켓·Open VSX) · 별도 릴리스 워크플로 {#remove-vscode}
  - [ ] 테마 원격 갤러리 — 테마 2.5k줄 중 GitHub 받기 부분 · 송출 1자리 {#remove-theme-gallery}

## 외부 리뷰 주기화 {#review-cadence}
- [x] SECURITY.md — 비공개 신고 창구 · 경계 넷(프로젝트·송출·비밀·기기 동의) · 외부 리뷰 이력 표 {#security-md}
- [x] GitHub 비공개 취약점 신고 켜기 (repos/…/private-vulnerability-reporting) {#pvr-on}
- [x] RELEASE.md §0-1 + bump-version — 마지막 리뷰 반영에서 마이너 5개째 경고(막지 않음) · 「다음 릴리스」 자동 채움 {#cadence-nudge}
- [ ] [사용자 액션] 다음 외부 리뷰 청하기 — 범위 v3.9.0 이후(PR #74 · 이 라운드), 리뷰 반영 뒤 SECURITY.md 표에 한 줄 {#next-review}

## 생성물 diff {#generated-diff}
- [x] .gitattributes linguist-generated — bindings.ts · landing/wiki/** · changelog.html · themes.html · sitemap.xml {#linguist-generated}

## 합류 {#merge}
- [x] PR → CI 초록 → 머지 {#pr-merge}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-08T17:57:19+09:00 | #freeze-rule | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | 680ef167 (PR #75) |
| 2026-10-08T17:57:23+09:00 | #freeze-backlog | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | 5건 deferred, #notion-oauth 는 이미 구현된 낡은 항목으로 보여 손대지 않음 |
| 2026-10-08T17:57:26+09:00 | #security-md | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | 3f693aca (PR #75) |
| 2026-10-08T17:57:30+09:00 | #pvr-on | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | gh api PUT → enabled:true 확인 |
| 2026-10-08T17:57:33+09:00 | #cadence-nudge | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | 3f693aca — 테스트 3건, dry-run 확인 |
| 2026-10-08T17:57:37+09:00 | #linguist-generated | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | 1c64b0d4 — git check-attr 로 대상만 걸리는 것 확인 |
| 2026-10-08T17:57:41+09:00 | #pr-merge | claude-code | ☐→x | .oculpm/journal/20261008/Chores/1757_chore_external-review-scope-freeze.md | PR #75 CI 3잡 SUCCESS → rebase 머지 680ef167, 브랜치·워크트리 삭제 |
<!-- oculpm:plan-log end -->
