---
description: Ocul 플러그인의 명령 · 도구 · 스킬 · 훅 한눈에 보기 (직접 부를 때만 — /oculpm:help)
disable-model-invocation: true
---

# /oculpm:help

아래 레퍼런스 카드를 사용자에게 **그대로 보여주고**, 상황에 맞는 다음 한 걸음을 한 줄로 추천하세요 (`.oculpm/` 이 없으면 ocul-pm 앱에서 프로젝트 추가 또는 `project_init` 도구, 활성 플랜이 있으면 `/oculpm:next`).

## 커맨드 4종

| 커맨드 | 언제 |
|---|---|
| `/oculpm:inception` | 새 프로젝트/기능 영역의 시작 — 결과(그다음) → 깊이 네 질문 → 분야의 방법 → 어려운 숫자 목표 → 지금 빨간 확인 명령이 첫 항목인 계획 |
| `/oculpm:next` | 구현 루프 — 다음 미완 리프를 `[~]` 로 잡고 구현 → 확인 명령 → 일지 → 플랜 갱신. `until-done` 이면 판정이 통과할 때까지 이어서 |
| `/oculpm:redteam` | 플랜·일지의 주장을 원재료와 대조하고 직접 돌려 반례만 보고 — 합류·릴리스 직전 |
| `/oculpm:help` | 이 카드 |

## MCP 도구 8종

`journal_search`(과거 일지 찾기 — 작업 전에) · `journal_read`(일지 원문) · `journal_write`(일지 작성) · `plan_status`(플랜 조회 — 응답의 `plans[].hash` 가 `plan_update` 의 `base_hash` 재료) · `plan_update`(항목 상태 갱신 · 항목 더하기 `add` · 결정 잠그기 `decision` · 확인 결과 남기기 `verdict` — **`base_hash` 필수**, 병렬 세션 보호) · `plan_create`(새 플랜 — `done_when` · `check` 는 꼭 적기를 권해요) · `project_init`(추적 초기화, 사용자 확인 필수) · `ask_user`(사람의 결정을 앱의 오늘 화면에 묻고 답을 기다림 — 사람이 터미널을 안 볼 때, 25분 안)

## 다른 에이전트 (Codex · Cursor · Gemini CLI · Copilot)

같은 도구, 같은 검사. Codex 는 플러그인 `oculpm-codex`(next · inception · redteam 스킬 포함), Cursor · Gemini CLI 는 앱 설정 → 에이전트 연결의 「등록」(그 프로젝트의 `.cursor/mcp.json` · `.gemini/settings.json`). MCP 가 없으면 앱 실행 파일이 곧 셸 CLI 다 — `<실행 파일> <도구> [json|-]`, 실행 파일은 macOS `/Applications/Ocul-PM.app/Contents/MacOS/ocul-pm` · Windows `%LOCALAPPDATA%\Ocul-PM\ocul-pm.exe` · Linux `/usr/bin/ocul-pm`. 예: `… tools` · `… plan_status '{}'` · `… journal_write -`(stdin JSON). 종료 코드 5 = 쓰기 충돌(hash 를 다시 읽고 다시). 둘 다 없을 때만 `oculpm-journal` 규격으로 손으로.

## 스킬 1종 (자동 발동)

`oculpm-journal` — MCP 도구가 없을 때 파일로 기록하는 규격의 전문.

## 훅 (자동)

세션 시작·종료 이벤트 기록(API 오류로 끝난 턴 포함) · Claude 가 사람을 기다리는 순간(Notification) — 앱 오늘 화면의 「Claude 가 기다려요」 · 활성 플랜의 완료 조건·확인 명령·마지막 판정(plan-log 메모의 `판정 ✓|✗`)·미완 항목 + 마지막 일지 3건 주입(세션·서브에이전트) · 플랜·일지가 없는 프로젝트엔 「무엇부터」 한 줄과 확인 명령 후보 · 일지 미작성 세션 감지 + 배달 게이트(코드 변경에 일지가 없으면 세션당 1회 안내) · 재수정 경고(최근 7일 버그 일지가 고친 파일을 다시 고치기 직전, 그 버그와 그때 확인 명령을 알려 줌 — 막지 않음, 대화당 파일마다 1회) · statusline 배지(옵인: `/statusline` 에서 `hooks/oculpm-statusline.sh` 지정)

전체 문서: oculpm.com/plugin
