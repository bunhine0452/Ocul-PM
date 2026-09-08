---
schema_version: 1
type: bug
slug: "desktop-mcp-status-tcc-prompt-on-mount"
status: done
difficulty: medium
created_at: "2026-09-08T15:16:34+09:00"
session_id: "20260908-004"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/McpServerBlock.tsx"
    op: create
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/api/oculpm.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
related: []
tags:
  - "macos"
  - "tcc"
  - "privacy"
  - "settings"
  - "mcp"
  - "refactor"
  - "mcp-tool"
---
[x] 연동 탭을 여는 것만으로 앱이 "다른 앱의 데이터" 권한을 물었다

Developer ID 서명·공증을 붙였는데도 앱이 권한을 묻는다는 사용자 신고에서 출발했다. 프롬프트는 `'Ocul-PM.app'이(가) 다른 앱의 데이터에 접근하려고 합니다` — macOS Sonoma(14) 이후의 App Data 보호(`kTCCServiceSystemPolicyAppData`)다.

## 발생 원인

**공증은 TCC 와 무관하다.** Gatekeeper 는 "실행해도 되는가", TCC 는 "저 데이터를 읽어도 되는가"를 묻는 별개 관문이다. 게다가 TCC 승인 기록은 코드 서명 요구사항에 묶여 있어, **애드혹 → Developer ID 로 서명 주체가 바뀌면 기존 승인이 전부 무효**가 된다 (설치본 2.45.1, 오늘 14:33 기동). 그래서 새 신원으로 남의 앱 데이터를 처음 건드리는 순간 한 번 다시 묻는다.

실제로 그 프롬프트를 띄운 것은 **이 세션 자신**이었다. 프로세스 계보가 `셸 → claude → /bin/zsh → ocul-pm --pty-host` 였고, 앱 로그를 찾으려고 돌린 `find ~/Library -maxdepth 3` 이 `Containers`·`Group Containers`·`Application Support/*` 를 훑었다. TCC 는 자식의 접근을 **책임 프로세스**에 귀속시키므로 문구가 `Ocul-PM.app` 으로 떴다. 즉 내장 터미널은 앱의 TCC 신원을 물려준다 — 앱 결함이 아니라 터미널을 품은 앱의 구조적 성질이다(VS Code·iTerm 동일).

**다만 그 조사에서 앱 코드 자체의 결함이 하나 드러났다.** 소스 전체에서 남의 앱 데이터 디렉터리를 건드리는 곳은 `oculpm/mcp/register.rs` 의 `desktop_config_path()`(`~/Library/Application Support/Claude/claude_desktop_config.json`) 하나뿐인데, `McpServerBlock` 이 **마운트되자마자** `mcpDesktopStatus` 를 무조건 불렀다. `desktop_status_at` 은 파일을 읽기 전에 부모 폴더를 `Path::exists` 로 확인하므로 **stat 하나만으로도** 프롬프트가 뜬다. 결과적으로 사용자는 설정 → 연동 서브탭을 연 것뿐인데 앱이 스스로, 아무 맥락 없이 남의 앱 데이터 접근을 요청했다. 나머지 경로는 전부 `app_data_dir()`(자기 것)이거나 `~/.claude`·`~/.codex` 같은 홈 닷파일이라 TCC 대상이 아니다.

## 해결 방법

- **조회를 버튼 뒤로.** `refresh()` 에서 Desktop 조회를 떼고 `checkDesktop()` 으로 분리했다. 확인 전 배지는 새 상태 `확인 안 함`, 버튼은 `Desktop 확인` 하나만 뜨고, 왜 버튼을 눌러야 하는지(그 확인이 남의 앱 데이터를 읽는다는 것)를 문구로 밝힌다. 프로젝트가 바뀌면 등록 키가 폴더명 기반이라 판정이 달라지므로 확인 상태를 되돌린다.
- **폴백은 열어 둔다.** `Desktop 스니펫 복사` 는 `mcpStatus` 산출물이라 확인 없이도 동작한다 — Claude Desktop 을 안 쓰는 사용자는 그 폴더를 영영 건드리지 않는다.
- **파일 분리.** 변경으로 `OculpmSettings.tsx` 가 크기 래칫(1491줄)을 넘어, 형제인 `CodexMcpServerBlock` 과 같은 자리·같은 모양으로 `McpServerBlock.tsx` 를 떼어냈다 (1524 → 1256 + 289).
- **래퍼 경유.** 새 파일이 `bindings` 게이트에 걸려 `oculpmApi` 에 MCP 등록 6개(`mcpStatus`/`mcpRegister`/`mcpUnregister` + Desktop 3종)를 추가하고 봉투 분기를 `try/catch` 로 접었다. 오류 문구도 `tError(toAppError(...))` 를 타 로컬라이즈된다.

## 검증

`pnpm typecheck` · `test`(190파일 2469케이스) · `lint`(6게이트, 0 error / 46 warning — 래칫 47 이하) · `build` 넷 다 exit 0. 회귀 테스트를 추가했다 — 「마운트만으로는 mcpDesktopStatus 를 부르지 않는다」가 호출 수 0 과 `확인 안 함` 배지, 그리고 스니펫 복사 버튼이 확인 없이도 활성인 것까지 단언한다. 기존 Desktop 테스트 3건은 확인 클릭을 앞에 붙였고, 두 배지 동시 「미등록」을 준비 신호로 쓰던 테스트 7건은 단일 배지 단언으로 고쳤다.

**확인 못 한 것**: 실기기에서 연동 탭을 열었을 때 프롬프트가 실제로 안 뜨는지는 이미 승인을 준 상태라 이 기기에서 재현할 수 없다 — `tccutil reset SystemPolicyAppData com.kimhyunbin.ocul-pm` 후 육안 확인이 남았다.

## 메모

내장 터미널이 앱의 TCC 신원을 물려준다는 사실은 사용자 눈에 "왜 이 앱이 남의 데이터를?" 로 읽힌다. README 나 온보딩에 한 줄이 필요한데 이번 변경에는 넣지 않았다 — 릴리스 5면에 걸리는 문서 작업이라 별도 항목으로 다뤄야 한다.