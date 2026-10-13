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

## 구현 {#build}
- [x] Notion 연동 제거 — 백엔드·프런트·원장·랜딩 API·문서, 기동 때 남은 토큰·설정 1회 정리 {#drop-notion}
- [x] oculpm-mcp board 서브커맨드 — plan_status 재료로 마스킹된 보드 문서·페이지 파일 출력 {#board-cli}
- [x] /oculpm:board 커맨드 + help·next·plugin.html ko/en·앱 플러그인 문서 탭 {#board-command}
- [x] plan_status 응답의 플랜·항목 문구 마스킹 + 회귀 시험 {#plan-status-mask}

## 합류·출시 {#ship}
- [ ] PR → CI 초록 → 머지 {#merge}
- [ ] 릴리스 5면 — CHANGELOG(Notion 제거·/oculpm:board·plan_status 마스킹)·README ko/en·랜딩 ko/en·버전 6파일, 플러그인 버전 {#release}
- [ ] landing vercel --prod — Notion OAuth 엔드포인트가 이때 사라진다(옛 앱의 Notion 연결 끊김) {#landing-deploy}

## 실기기 확인 {#eyes}
- [ ] Notion 을 연결했던 설치본을 업데이트 → 키체인 notion_api_key 가 프롬프트 없이 지워지고 설정 데이터 탭에 Notion 이 없다 {#eyes-keychain}
- [ ] 마켓플레이스 설치 플러그인에서 /oculpm:board 실행 — ${CLAUDE_PLUGIN_ROOT} 가 커맨드 본문에서 풀리는지, 아니면 폴백 경로로 찾는지 {#eyes-plugin-root}
- [ ] 폰 claude.ai 앱에서 보드 열기 — 좁은 폭·다크·남은 항목 토글 {#eyes-board-phone}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-14T05:59:25+09:00 | #drop-notion | claude-code | ☐→x | .oculpm/journal/20261014/Refactors/0558_refactor_remove-notion-integration.md |  |
| 2026-10-14T05:59:28+09:00 | #board-cli | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md |  |
| 2026-10-14T05:59:31+09:00 | #board-command | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md | ai-pm 보드 실발행·동기화 확인 |
| 2026-10-14T05:59:34+09:00 | #plan-status-mask | claude-code | ☐→x | .oculpm/journal/20261014/Features_to_add/0559_feature_artifact-plan-board.md |  |
<!-- oculpm:plan-log end -->
