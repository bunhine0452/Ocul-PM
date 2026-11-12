---
oculpm_plan: v1
id: two-machines-20261113
title: "두 기기를 오갈 때"
status: active
created: 2026-11-13
updated: 2026-11-13
owner: claude-code
---

맥과 윈도우에 Ocul 을 깔고 같은 저장소를 번갈아 쓸 때 걸리는 넷 — 앱 관리 파일의 되돌려 쓰기, pull 뒤 거짓 「통과 뒤 바뀜」, 이 기기에만 있는 것을 모름, 기기마다 다른 프로젝트 색.

**완료 조건:** 두 OS 를 오가도 앱 관리 규격 파일이 더 옛 앱에게 되돌려지지 않고, 다른 OS 에서 받은 ✓ 가 「통과 뒤 바뀜」이 아니라 「여기선 아직」으로 서며, 오늘 화면이 이 기기에만 있는 변경·커밋을 한 줄로 말하고, 프로젝트 색이 config.toml 을 따라 양쪽에서 같다
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 앱 관리 파일 {#managed}
- [x] 규격 파일은 더 새 판이면 내려쓰지 않는다 {#spec-no-downgrade}
- [x] 더 새 Ocul 이 쓴 프로젝트임을 알린다 {#newer-notice}

## 판정이 어디서 돌았나 {#verdict}
- [x] 판정 줄 끝에 돌린 OS 를 붙인다 {#verdict-os}
- [x] 다른 OS 의 ✓ 는 「여기선 아직」으로 {#verdict-elsewhere}
- [x] 시작 훅이 다른 OS 판정임을 말한다 {#hook-os}

## 오늘 화면 {#today}
- [x] 이 기기에만 있는 것 한 줄 {#local-only}

## 프로젝트 색 {#color}
- [x] 프로젝트 색을 config.toml 로 옮긴다 {#color-config}

## 이월 {#carry}
- [ ] 도착 줄 — 다른 기기에서 한 일 N건 {#arrival}
- [ ] [사용자] 윈도우·맥 설치본에서 눈 확인 {#eyes}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-13T00:58:39+09:00 | #spec-no-downgrade | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | 규격 v3 · 더 새 판은 두고 핀 테스트로 번호 올리기를 강제 |
| 2026-11-13T00:58:43+09:00 | #newer-notice | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | 기존 「규칙이 앱보다 새로워요」 알림이 규격 파일도 본다 |
| 2026-11-13T00:58:47+09:00 | #verdict-os | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | plan_update 가 판정 메모 끝에 OS 를 붙인다 (judge::stamp) |
| 2026-11-13T00:58:51+09:00 | #verdict-elsewhere | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | 오늘 「여기선 아직」 행 · 이 OS 에서 통과한 뒤 안 바뀌었으면 조용 |
| 2026-11-13T00:58:55+09:00 | #hook-os | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | Claude · Codex 훅 두 벌 · uname 판별은 맥에서만 돌려 봤다 |
| 2026-11-13T00:58:58+09:00 | #local-only | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | 행이 아니라 한 줄 · 배지에 안 센다 · 받아 오지 않는다 |
| 2026-11-13T00:59:02+09:00 | #color-config | claude-code | ☐→x | .oculpm/journal/20261113/Features_to_add/0058_feature_two-machines-round.md | 판정 ✓ pnpm test 1083 passed · cargo test 1127 passed 0 failed · typecheck/lint/build/clippy exit 0 · 설치본 눈 확인은 안 함 · mac |
<!-- oculpm:plan-log end -->
