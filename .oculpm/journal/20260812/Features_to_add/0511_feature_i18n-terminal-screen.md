---
schema_version: 1
type: feature
slug: "i18n-terminal-screen"
status: done
difficulty: medium
created_at: "2026-08-12T05:11:40+09:00"
session_id: "mcp-20260812-051140"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/i18n_lint_scanner.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/terminal/TerminalScreenV2.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstance.tsx"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/TerminalErrorBoundary.tsx"
    op: update
  - path: "src/features/terminal/shellStatus.ts"
    op: update
  - path: "src/features/terminal/useAgentRuns.ts"
    op: update
  - path: "src/features/terminal/tabTitle.ts"
    op: update
  - path: "src/features/terminal/imeBridge.ts"
    op: update
related: []
tags:
  - "i18n"
  - "terminal"
  - "lint"
  - "scanner"
  - "mcp-tool"
---
[x] 터미널 화면 영어화 + 게이트 스캐너의 정규식 오독 수정

터미널 묶음 10파일. allowlist 75 → 66. 12개 ui_v2 화면 중 터미널까지 완료 — 남은 화면은 AI 패널 하나.

## 추가 기능

`term.*` 키 57개. 툴바·탭·분할·검색 오버레이·상태바·단축키 힌트, 셸 통합 상태바(`summarizeShell`), 소요시간 포매터, 렌더러 크래시 경계, 에이전트 실행 종료 후 일지 제안 토스트, PTY 가 터미널 버퍼에 직접 써 넣는 두 문구(`[프로세스 종료됨]` · `[PTY 시작 실패]`).

## 게이트 스캐너가 정규식 리터럴을 못 읽고 있었다

`fileLinks.ts` 가 PENDING 에 9건으로 잡혀 있었는데 **전부 주석**이었다. 원인은 경로 정규식의 문자 클래스:

```js
/(?:^|[\s'"(\[<])((?:\.{1,2}\/)?…)/g
```

안의 `'` 를 문자열 시작으로 오독 → 닫는 작은따옴표가 끝까지 안 나와 **그 뒤 파일 전체가 "문자열 안"** 이 됐다. 그래서 주석 속 한글이 위반으로 보고됐다.

반대 방향이 더 위험하다: 정규식 안의 `//`(`/https:\/\//`)를 줄 주석으로 오독하면 같은 줄 뒤쪽 한글을 **놓친다** — 게이트가 조용히 뚫리는 경로다.

상태 기계에 정규식 상태 2개(리터럴·문자 클래스)를 추가했다. 판정은 직전 유효 문자 휴리스틱(`(`·`=`·`return` 뒤 = 정규식, 식별자·`)` 뒤 = 나눗셈)이고, **`<` `>` `}` 는 일부러 뺐다** — JSX 가 이 셋 뒤에 `/` 를 흔히 놓아서(`</div>`, `<A/></>`, `{dir}/{file}`) 정규식으로 오인하면 닫는 `/` 를 찾아 헤매다 뒤 코드를 통째로 삼킨다. 줄바꿈을 만나면 오인으로 보고 code 로 복귀해 피해를 그 줄에 가둔다.

정규식 **내용은 그대로 남긴다** — 문자 클래스의 한글(`[가-힣]`)은 여전히 보고되고 면제는 `i18n-ignore` 로 명시한다는 기존 관례를 유지했다.

전 소스 대조 결과 변화는 4파일뿐이고 **전부 감소**(거짓 양성 제거)였다: TrayPopover 70→45 · rulesModel 19→12 · fileLinks 9→0 · ai_context_parts 51→48. 사라진 25줄을 눈으로 확인했고 전부 주석이었다 — 숨어 있던 거짓 음성은 없었다. 양방향 회귀 테스트 6개를 추가했다.

## 결정 — 진단 로그는 번역하지 않는다

`oculpmLog` / `console` 의 한글 10곳(9곳이 TerminalInstanceImpl)은 번역 대상에서 뺐다. `oculpm.log` 는 지원·grep 용 산출물이라 UI 설정에 따라 언어가 바뀌면 패턴 매칭이 깨진다. 줄마다 `i18n-ignore-next-line` 에 사유를 적었다. 남은 PENDING 전체에서 10곳뿐이라 범위가 좁다.

## 함정 두 개

- **`t` 섀도잉 15곳** (누적 26회). `terminalTabs.map((t) => …)` 에서 `t` 가 탭이었다. 치환 전에 전부 `tab`(`tab` 이 이미 있는 스코프는 `candidate`)으로 개명했다. 모듈 헬퍼 `panesOfTab(t)` 도 같이 — 이 파일은 모듈 `t` 를 임포트하므로 그대로 두면 다음 사람이 밟는다.
- `tabTitle.ts` 의 `DEFAULT_LABEL = /^(zsh|…|셸)/` 은 죽은 분기였다. 기본 라벨을 만드는 경로가 `"zsh"` / `` `zsh ${n}` `` 둘뿐이라 `셸` 라벨은 생길 수 없다. 번역하거나 면제하는 대신 걷어냈다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 655통과(스캐너 회귀 6개 추가로 649→655) / lint(남은 미번역 66) / build.