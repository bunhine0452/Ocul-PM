# 01. Claude Code 훅 payload — 실측 기록 (PR-CI0 스파이크)

> 실측일 2026-07-20 · Claude Code **2.1.207** · macOS. 방법: 스크래치 프로젝트에
> SessionStart/UserPromptSubmit/PostToolUse/Stop/SessionEnd 훅(`cat >> events.jsonl`)을 걸고
> `claude -p` 헤드리스 세션 2회 실행. 마스터플랜 §1 팩트 시트의 검증본.
> ⚠ payload 는 버전 종속 — 파서는 여기 없는 필드를 무시하고, 없는 필드를 필수로 삼지 말 것.

## 1. 검증된 핵심 가정

| 가정 | 결과 |
|---|---|
| 모든 이벤트에 `session_id` / `transcript_path` / `cwd` / `hook_event_name` 포함 | ✅ 4/4 이벤트에서 확인 |
| `.claude/settings.local.json` 의 훅도 발화하는가 (D2 설치 위치) | ✅ 2차 런에서 4 이벤트 전부 발화 |
| `${CLAUDE_PROJECT_DIR:-.}` + `cat` append 커맨드가 동작하는가 (D1) | ✅ 프로젝트 루트에 정확히 append |
| **프로덕션 커맨드**(`install()` 이 쓰는 `mkdir -p … && cat >> ….oculpm/hooks/claude-events.jsonl`) E2E | ✅ 3차 런 — 실세션에서 SessionStart/Stop/SessionEnd 3건이 인박스에 정확히 적재 |
| 헤드리스(`claude -p`)에서도 훅이 발화하는가 | ✅ (CI·자동화 시나리오 커버) |

## 2. 이벤트별 실측 payload (stdin JSON 1줄)

공통 필드: `session_id`(UUID) · `transcript_path`(절대경로) · `cwd` · `hook_event_name`.

```jsonc
// SessionStart — 추가: source ("startup" 확인; resume 계열 값은 미실측)
{"session_id":"8e48…","transcript_path":"/Users/…/.claude/projects/<경로슬러그>/<session_id>.jsonl",
 "cwd":"/…/프로젝트","hook_event_name":"SessionStart","source":"startup"}

// UserPromptSubmit — 추가: prompt_id, permission_mode, prompt(사용자 입력 원문!)
{…공통, "prompt_id":"0913…","permission_mode":"default","hook_event_name":"UserPromptSubmit",
 "prompt":"Reply with exactly: ok"}

// Stop — 추가: prompt_id, permission_mode, stop_hook_active,
//        last_assistant_message(마지막 응답 텍스트!), background_tasks[], session_crons[]
{…공통, "prompt_id":"0913…","permission_mode":"default","hook_event_name":"Stop",
 "stop_hook_active":false,"last_assistant_message":"ok","background_tasks":[],"session_crons":[]}

// SessionEnd — 추가: prompt_id, reason ("other" 확인; 값 집합 미실측)
{…공통, "prompt_id":"0913…","hook_event_name":"SessionEnd","reason":"other"}
```

주의:

- **payload 에 타임스탬프가 없다.** 소비자가 수신 시각을 스스로 찍어야 한다 — 앱 러닝 중이면
  watcher 픽업 시각 ≈ 이벤트 시각. 앱이 꺼져 큐잉된 이벤트는 파일 mtime 이 상한, 정밀 시각이
  필요하면 transcript 의 `timestamp` (PR-CI1)로 보강.
- `UserPromptSubmit.prompt` / `Stop.last_assistant_message` 는 **대화 내용** — 인박스 파일은
  gitignore 필수(마스터플랜 §5), 로컬 밖 반출 금지. `last_assistant_message` 는 PR-CI1 에서
  transcript 파싱 실패 시의 값싼 폴백 요약 소스로 쓸 수 있다.
- PostToolUse 는 툴 미사용 세션이라 미발화(예상대로). v1 미구독이므로 실측 보류.

## 3. transcript JSONL 실측 (PR-CI1 참고용)

`~/.claude/projects/<경로슬러그>/<session_id>.jsonl`. 경로슬러그 = cwd 절대경로의 비영숫자를
`-` 치환. 라인 `type` 실측: `queue-operation` · `user` · `attachment` · `file-history-snapshot`
· `assistant` · `last-prompt`.

- `user`/`assistant` 라인: `message`(role/content) · `timestamp`(ISO) · `cwd` · `gitBranch` ·
  `sessionId` · `uuid`/`parentUuid` · `version` 등.
- **형식 비보장** — 파서는 `type ∈ {user, assistant}` 만 취하고 나머지는 통째로 무시,
  모르는 type/필드에 관용, 실패 시 세션 메타 강등(D4).

## 4. 미실측 (후속 확인 항목)

- `SessionStart.source` 의 resume/clear 계열 값, `SessionEnd.reason` 값 집합.
- PostToolUse payload (v1 미구독).
- 인터랙티브 세션(비 `-p`)에서의 차이 — 구조 동일 추정, PR-CI0 실기기 검증에서 확인.
