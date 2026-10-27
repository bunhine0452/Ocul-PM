---
oculpm_plan: v1
id: artifact-board-drop-notion
title: "Notion 걷고 아티팩트 보드로 (2026-10-14)"
status: active
created: 2026-10-14
updated: 2026-10-14
owner: claude-code
---

Notion 연동(0.9k줄·OAuth 교환 서버·루프백 리스너)을 걷고, 밖에서 보기는 /oculpm:board(claude.ai 비공개 아티팩트)가 맡는다.

**완료 조건:** 육안 3건(`{#eyes-keychain}` · `{#eyes-plugin-root}` · `{#eyes-board-phone}`)이 설치본에서 확인되면 끝. 확인 날은 polish-round-20261027 `{#sweep-board}`.

## 구현 {#build}
- [x] Notion 연동 제거 — 백엔드·프런트·원장·랜딩 API·문서, 기동 때 남은 토큰·설정 1회 정리 {#drop-notion}
- [x] oculpm-mcp board 서브커맨드 — plan_status 재료로 마스킹된 보드 문서·페이지 파일 출력 {#board-cli}
- [x] /oculpm:board 커맨드 + help·next·plugin.html ko/en·앱 플러그인 문서 탭 {#board-command}
- [x] plan_status 응답의 플랜·항목 문구 마스킹 + 회귀 시험 {#plan-status-mask}

## 합류·출시 {#ship}
- [x] PR → CI 초록 → 머지 {#merge}
- [x] 릴리스 5면 — CHANGELOG(Notion 제거·/oculpm:board·plan_status 마스킹)·README ko/en·랜딩 ko/en·버전 6파일, 플러그인 버전 {#release}
- [x] landing vercel --prod — Notion OAuth 엔드포인트가 이때 사라진다(옛 앱의 Notion 연결 끊김) {#landing-deploy}

## 실기기 확인 {#eyes}
- [x] Notion 을 연결했던 설치본을 업데이트 → 키체인 notion_api_key 가 프롬프트 없이 지워지고 설정 데이터 탭에 Notion 이 없다 {#eyes-keychain}
- [ ] 마켓플레이스 설치 플러그인에서 /oculpm:board 실행 — ${CLAUDE_PLUGIN_ROOT} 가 커맨드 본문에서 풀리는지, 아니면 폴백 경로로 찾는지 {#eyes-plugin-root}
- [ ] 폰 claude.ai 앱에서 보드 열기 — 좁은 폭·다크·남은 항목 토글 {#eyes-board-phone}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-14T05:59:25+09:00 | #drop-notion | claude-code | ☐→x | .oculpm/journal/20261014/Refactors/0558_refactor_remove-notion-integration.md |  |
| 2026-10-14T05:59:28+09:00 | #board-cli | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md |  |
| 2026-10-14T05:59:31+09:00 | #board-command | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md | ai-pm 보드 실발행·동기화 확인 |
| 2026-10-14T05:59:34+09:00 | #plan-status-mask | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md |  |
| 2026-10-14T07:16:24+09:00 | #merge | claude-code | ☐→x |  | PR #84 rebase 머지 — e7942d74 |
| 2026-10-14T07:16:26+09:00 | #landing-deploy | claude-code | ☐→x |  | softwareVersion 3.13.0 · /api/notion/oauth/start 404 확인 |
| 2026-10-14T07:16:29+09:00 | #release | claude-code | ☐→~ |  | v3.13.0 공개(mac·win). linux E2E 사이드카 일지 반영 60s 타임아웃으로 빠짐 → §6-2 rerun --failed 진행 |
| 2026-10-14T07:20:50+09:00 | #release | claude-code | ~→x |  | rerun --failed 로 linux E2E 통과(플레이크) → 자산 10·run 초록 |
| 2026-10-27T19:48:27+09:00 | #eyes-keychain | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | 기계 확인: security find-generic-password -s com.kimhyunbin.ocul-pm -a notion_api_key → 없음, 키체인 덤프 notion 0건, settings notion_retired=1 |
| 2026-10-27T19:49:00+09:00 | #eyes-plugin-root | claude-code | ☐→☐ |  | 사전 조사: 이 기기의 oculpm 플러그인은 project 스코프 3.3.0(installed_plugins.json), 캐시 최신은 3.13.2 — board.md 는 ${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp + ls ~/.claude/plugins/cache/*/oculpm/*/bin 폴백을 안내하고 캐시 3.13.2/bin 에 바이너리 있음. 실행 확인은 플러그인을 3.13.6+ 로 올린 뒤 /oculpm:board 한 번 |
<!-- oculpm:plan-log end -->
