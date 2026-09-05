---
schema_version: 1
type: feature
slug: "gate-beyond-claude-code-acp"
status: done
difficulty: superhigh
created_at: "2026-09-05T13:27:22+09:00"
session_id: "20260905-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "6a994a30-8c4f-47ba-a782-68dd1893c4d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/recording.rs"
    op: create
  - path: "src-tauri/src/acp/journal_gate.rs"
    op: create
  - path: "src-tauri/src/oculpm/verdict/markers.rs"
    op: create
  - path: "src-tauri/src/commands/acp_recording.rs"
    op: create
  - path: "src-tauri/src/commands/acp_gate.rs"
    op: create
  - path: "src-tauri/src/commands/acp_files.rs"
    op: create
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/chat/RecordingNotice.tsx"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src-tauri/tests/acp_journal_gate.rs"
    op: create
related: []
tags:
  - "acp"
  - "codex"
  - "기록무결성"
  - "v3"
  - "mcp-tool"
---
[x] 게이트가 Claude Code 밖에서도 선다 — ACP 신원과 크로스에이전트 상호 인식

## 추가 기능

앱 안에서 뜨는 ACP 대화(Claude Code 화면·Codex 화면)는 자기가 누구인지 기록에 못 남겼고, 기록 도구가 아예 안 붙은 채로도 조용히 열렸다. 그리고 셸 훅이 없어 배달 게이트 밖에 있었다.

**신원 — UUID 를 쓸 수 없는 이유.** MCP 서버 환경은 `session/new` **요청**에 실려 나가고 ACP UUID 는 **응답**에 실려 온다. 아는 순간엔 서버가 이미 그 환경으로 떠 있다. 그래서 세 번째 값을 우리가 먼저 발급한다 — `acp-<workday>-<hex8>`. 들어가는 자리는 `AgentRef.session`(에이전트 자신의 대화 id, 자유 문자열)이지 `session_id` 가 아니다: `SessionId` 방언에 새 접두를 만들지 않았다. 원장은 `<app_data>/acp/session-map.json` 에 두었다 — 기록이 아니라 **기계 종속 라우팅 표**라 커밋 트리에 이 기계의 UUID 를 흘리면 안 된다.

**같은 갈래에서 버그를 하나 더 잡았다.** `acp_load_session` 이 `mcp_servers` 를 아예 안 넘겨, **지난 대화를 이어 열면 기록 도구가 통째로 사라졌다.** 열 때는 있었는데. 일지가 안 남던 실제 경로였을 가능성이 크다.

**부재를 보이게.** 바이너리를 못 찾으면 빈 `Vec` 을 돌려주고 세션이 그냥 열렸다. 이제 "어디를 찾았는데 없었다"가 값으로 남아 대화 화면 배너까지 올라간다. 경로 목록은 셔틀과 같은 순서·같은 어휘를 쓰고 테스트가 그 순서를 문다. **부착 결과는 기록하고 재계산하지 않는다** — 재계산하면 "지금은 있는데 그때는 없었다"를 영영 말할 수 없다.

## 동작 흐름

**크로스에이전트 상호 인식은 파일 두 개다.** ACP 세션이 Claude Code 훅과 **정확히 같은 자리·같은 이름**의 흔적을 남긴다(`.session-start-<대화>`·`.session-live-<대화>`). 안 쓰면 `segment_started_at = None` 이라 늘 판정 불가이고, 더 중요하게는 **ACP 세션이 Claude Code 세션의 눈에 용의자로 보이지 않아** 같은 워킹트리에서 CC 쪽 게이트가 ACP 의 편집으로 오탐한다. 그 파일 두 개가 곧 상호 인식이다.

**차단 대신 배너 + 원장 한 줄.** ACP 프로토콜엔 "이 턴을 물리고 다시 시키기"가 없고, 있다 해도 사용자가 보고 있는 대화에서 앱이 말없이 턴을 한 번 더 도는 건 게이트가 아니라 유령이다. 소음 방지는 셸 게이트의 규율을 그대로 가져왔다 — 발화는 대화당 1회(`.delivery-gate-<대화>` 플래그를 CC 훅과 **같은 파일**로 공유해, 셸이 먼저 말했으면 또 안 적는다), 기록하면 배너가 스스로 걷히고, 닫으면 다음 턴에도 다시 안 세우고, 판정 불가는 침묵한다. 조용한 성공도 아니다: 발화 순간 원장에 한 줄이 남아 Today 카드와 회고 상시 한 줄이 센다.

판정 시점은 세션 종료가 아니라 **턴 끝**이다. 앱 안 대화에는 `SessionEnd` 가 없어 종료에만 걸면 판정이 영영 안 도는 대화가 대부분이 된다.

**Codex — 표면은 이미 열려 있었다.** 조사해 보니 Codex 0.153.4 가 우리 훅을 실제로 실행한 증거가 이벤트 원장에 있었다(`transcript_path` 가 `~/.codex/sessions/…` 인 SessionStart·Stop·SessionEnd 7건, payload 는 Claude 호환). 반면 매니페스트 경로는 막혀 있다 — `plugin.json` 에 `hooks` 를 넣으면 Codex 검증기가 `field 'hooks' is not accepted` 로 거부한다(실측). 억지로 넣지 않고 "넣으면 설치가 통째로 막힌다"는 회귀 가드만 세웠다. 대신 훅의 루트 해석을 `CLAUDE_PROJECT_DIR` → payload 의 `cwd` → `.` 로 바꿨다: Codex 바이너리에 `CLAUDE_PLUGIN_ROOT` 는 있어도 `CLAUDE_PROJECT_DIR` 은 없어, 지금까지 동작한 건 cwd 가 우연히 프로젝트였기 때문으로 보인다.

MCP 서버가 신원을 읽는 변수도 provider 중립 `OCULPM_SESSION_ID` 를 신설했다(옛 `CLAUDE_CODE_SESSION_ID` 는 낡은 설치본 폴백).

## 검증

오탐 방지 테스트에 **대조군을 같은 테스트 안에** 넣었다 — 먼저 흔적 없는 편집자로 진짜 `delivery-gate.sh` 를 돌려 exit 2 를 단언하고(막힌다), 그다음 ACP 가 흔적을 남긴 뒤 같은 편집으로 exit 0 을 단언한다. 대조군이 깨지면 테스트가 스스로 "이건 아무것도 안 지킨다"고 말한다. Codex 루트 폴백은 `git show HEAD:` 의 옛 훅과 손으로 대조했다(옛 것: 원장 없음 / 새 것: `{"verdict":"missing","changed":1}`).

통합 7 + 단위 12 + 프런트 8 신규. `cargo test` lib 1347(기준선 1334), `pnpm test` 177파일 2316.

## 메모

앱 종료·어댑터 사망 시 세그먼트가 안 닫힌다 — `process.rs` 가 크기 래칫 상한이라 손대지 않았다. 무해한 방향이지만(생존 흔적이 6시간 창을 벗어나면 용의자에서 빠진다) 그 6시간 동안 옆 대화의 게이트가 침묵한다.

Codex 훅 배포 경로는 미확정이다. `oculpm-codex` 는 스킬만 싣고, 훅을 원하는 Codex 사용자는 Claude 플러그인을 그대로 써야 하며 그건 지금 스킬 문서 한 줄로만 안내된다.