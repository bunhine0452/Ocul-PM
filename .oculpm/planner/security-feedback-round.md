---
oculpm_plan: v1
id: security-feedback-round
title: "보안 피드백 라운드 (2026-10-07)"
status: active
created: 2026-10-07
updated: 2026-10-07
owner: claude-code
---

외부 보안 피드백 2건을 코드로 검증해 맞는 것만 고친다. 판정: 대부분 사실, 일부는 더 넓었고(일지 경로·append·.oculpm), 훅 설치 주장은 틀렸다.

## 링크 부류 {#links}
- [x] 에디터 저장 임시 파일·append_ndjson·.oculpm 링크 가드·일지 경로 끝까지 풀기·플러그인 훅 {#symlink-class}

## 마스킹 {#redaction}
- [x] 기본 패턴 확장 + 내장 바닥 (저장소 config 가 못 지운다, 기존 프로젝트에도 적용) {#redact-floor}
- [x] 일지 초안·대화 임포트·자동화의 모델 입력 마스킹 + egress 원장 문구 정정 {#redact-input}

## 저장소 설정 신뢰 {#trust}
- [x] 배경 LLM 작업은 이 기기의 동의가 있을 때만 — 저장소 config 만으로 켜지지 않게, 열 때 안내 + 모델 자동 시드도 동의 뒤로 {#automation-consent}

## 에이전트·설치 {#agent}
- [x] bypassPermissions·dontAsk 를 메뉴에서 고를 때 확인 {#dangerous-mode-confirm}
- [x] ACP 어댑터 설치를 동봉 lockfile + npm ci --ignore-scripts 로 {#acp-lockfile}
- [x] Windows 승격 앱은 파이프 서버도 승격됐는지 확인 {#elevated-pipe-check}

## 웹뷰 {#webview}
- [x] CSP 켜기 — 인라인 스크립트·eval 차단, 필요한 출처만 {#csp}
- [x] create_project 의 파일시스템 루트·홈 거부, 그린필드 스캐폴더 허용 목록 {#ipc-narrowing}

## Notion {#notion}
- [~] OAuth 토큰을 리다이렉트 URL 에 싣지 않기 (code 중계 + 하위 호환) {#notion-token-url}
- [ ] 랜딩 exchange 배포 뒤 한 릴리스가 지나면 옛 ?token= 흐름 지우기 (앱 OAuthCallback::Token · callback.ts 교환 분기) {#notion-legacy-token-removal}

## 플러그인 {#plugins}
- [x] 설치 미리보기가 MCP 서버가 실행할 명령을 보여 준다 (hooks/·bin/ 은 원래 안 놓는다) {#plugin-mcp-preview}

## 이월 {#carry}
- [~] egress 원장의 자리 스캔이 하위 프로세스 송출(npm 어댑터 설치)을 못 센다 + CLAUDE.md 송출 목록에 어댑터 다운로드가 없다 {#egress-subprocess}
- [ ] CSP 로 막힌 원격 이미지(일지·답의 ![](https://…))를 깨진 아이콘 대신 링크로 그리기 {#remote-image-placeholder}

## 확인 {#eyes}
- [ ] 실기기 확인 — CSP 전 화면·위험 모드 확인·자동화 동의 안내·Notion 연결·링크 거부 문구 {#eyes-security-round}

## 결정

### Decision 1 — 배경 자동화 동의는 프로젝트 단위, 기존 설치 승계 없음 {#d-consent-unit}
2026-10-07 · claude-code. VS Code 작업 영역 신뢰와 같은 단위 — 한 번 허락한 프로젝트에서 나중에 켜진 스위치는 다시 묻지 않는다(스위치별·정의별 승인은 복잡도 대비 이득이 작다). 업데이트 때 이미 켜져 있던 프로젝트를 일괄 승계하지 않는다 — 그러면 이미 추가된 남의 저장소도 승계된다. 켜 두었던 사용자는 오늘 카드에서 한 번 누른다. 영향: #automation-consent

### Decision 2 — 유닉스 PTY 호스트 소켓에는 인증을 더하지 않는다 {#d-pty-socket}
2026-10-07 · claude-code. 사용자 전용 앱 데이터 폴더의 0600 소켓이고, 같은 사용자 프로세스를 경계로 보지 않는 것은 tmux·VS Code 와 같은 모델이다. 토큰 파일을 둬도 같은 사용자(샌드박스 안 에이전트 포함)가 읽을 수 있어 막는 것이 없다 — 샌드박스 탈출은 샌드박스의 유닉스 소켓 차단이 막을 자리다. Windows 는 승격 파이프 선점이 실제 틈이라 고쳤다. 영향: #elevated-pipe-check

### Decision 3 — Claude 어댑터의 "없으면 묻지 않고 설치" 는 유지 {#d-adapter-autoinstall}
2026-10-07 · claude-code. 설치 내용이 이제 고정 lockfile·sha512·스크립트 없음으로 묶이므로 묻는 단계를 더하지 않았다(사용자가 Claude Code 화면을 연 것이 곧 시작이라는 기존 판단). Codex 는 여전히 묻는다. 영향: #acp-lockfile

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-07T09:35:38+09:00 | #symlink-class | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/0935_bug_symlink-escape-hardening.md | 5825202a — 저장 임시 파일·append·.oculpm 전수 가드·일지 경로·훅 |
| 2026-10-07T09:47:53+09:00 | #redact-floor | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/0947_bug_redaction-floor-and-input-masking.md | 113972af — 내장 바닥 24종, 설정 목록은 추가 패턴 |
| 2026-10-07T09:48:04+09:00 | #redact-input | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/0947_bug_redaction-floor-and-input-masking.md | 113972af — 초안·임포트·러너 입력 마스킹, 원장 문구 정정 |
| 2026-10-07T10:10:21+09:00 | #automation-consent | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/1010_bug_automation-device-consent.md | 4bfc42aa — 발동 세 문 + 시드를 기기 동의 뒤로, 오늘 카드·자동화 탭 안내 |
| 2026-10-07T10:17:34+09:00 | #dangerous-mode-confirm | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/1017_bug_dangerous-mode-confirm-and-elevated-pipe.md | 72791622 — 메뉴의 위험 모드 3종 danger 확인 |
| 2026-10-07T10:17:41+09:00 | #elevated-pipe-check | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/1017_bug_dangerous-mode-confirm-and-elevated-pipe.md | 04abb955 — 승격 앱은 서버 TokenElevation 확인. Windows 실행 검증은 portability CI |
| 2026-10-07T10:27:52+09:00 | #acp-lockfile | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/1027_bug_acp-adapter-locked-install.md | 3e3be0ef — 고정 lockfile·npm ci --ignore-scripts·Codex 형제 prefix. EINTEGRITY 실측 |
| 2026-10-07T10:48:59+09:00 | #csp | claude-code | ☐→~ | .oculpm/journal/20261007/Bugs/1048_bug_webview-csp-enabled.md | 57209dba — 정책 + 위반 관측 + e2e 게이트. e2e 실행 결과 대기 |
| 2026-10-07T10:49:11+09:00 | #ipc-narrowing | claude-code | ☐→x | .oculpm/journal/20261007/Bugs/1048_bug_unsafe-project-root-guard.md | d6e8145d — 루트·홈 거부(create_project·init). 스캐폴더 허용 목록은 npx 때문에 무의미 — CSP 가 방어 |
| 2026-10-07T10:56:48+09:00 | #notion-token-url | claude-code | ☐→~ | .oculpm/journal/20261007/Bugs/1056_bug_notion-oauth-code-relay.md | e146d47c — 코드 완료·양방향 하위호환. 랜딩 배포(vercel --prod)·실제 왕복 확인 남음 |
| 2026-10-07T11:05:21+09:00 | #notion-legacy-token-removal | claude-code | →☐ |  | 신규 — 하위 호환 갈래의 수명 |
| 2026-10-07T11:05:21+09:00 | #plugin-mcp-preview | claude-code | →x | .oculpm/journal/20261007/Bugs/1103_bug_plugin-preview-mcp-launches.md | 신규·완료 — McpMerge.launches |
| 2026-10-07T11:05:21+09:00 | #egress-subprocess | claude-code | →☐ | .oculpm/journal/20261007/Bugs/1027_bug_acp-adapter-locked-install.md | 신규 — 원장 공백 |
| 2026-10-07T11:05:21+09:00 | #remote-image-placeholder | claude-code | →☐ | .oculpm/journal/20261007/Bugs/1048_bug_webview-csp-enabled.md | 신규 — CSP 후속 UX |
| 2026-10-07T11:28:34+09:00 | #notion-token-url | claude-code | ~→~ | .oculpm/journal/20261007/Chores/1128_chore_landing-deploy-notion-relay.md | 랜딩 배포됨(exchange 405/400/no-store·state f=code 실측). 남은 것: 새 앱 릴리스 뒤 실제 Notion 왕복 |
| 2026-10-07T11:47:38+09:00 | #csp | claude-code | ~→x | .oculpm/journal/20261007/Bugs/1048_bug_webview-csp-enabled.md | e2e 두 OS 위반 0 + 강제 탐침 통과(run 37560126223). macOS 육안은 #eyes-security-round |
| 2026-10-07T11:47:45+09:00 | #egress-subprocess | claude-code | ☐→~ |  | 6d2af80b — CLAUDE.md·개인정보·랜딩 FAQ·위키 송출 목록을 여섯(어댑터 설치 포함)으로 맞춤. 남은 것: 원장 자리 스캔의 하위 프로세스 공백 |
| 2026-10-07T12:43:43+09:00 | #notion-token-url | claude-code | ~→~ | .oculpm/journal/20261007/Chores/1243_chore_release-v3-8-0.md | v3.8.0 공개 — 설치본을 3.8.0 으로 올린 뒤 실제 Notion 연결 1회로 브라우저 기록에 token= 이 없는지 확인하면 닫는다 |
<!-- oculpm:plan-log end -->
