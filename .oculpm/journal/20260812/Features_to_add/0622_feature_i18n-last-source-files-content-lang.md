---
schema_version: 1
type: feature
slug: "i18n-last-source-files-content-lang"
status: done
difficulty: high
created_at: "2026-08-12T06:22:33+09:00"
session_id: "mcp-20260812-062233"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/index.ts"
    op: update
  - path: "src/contexts/SettingsContext.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/features/projects/ProjectManager.tsx"
    op: update
  - path: "src/features/chat/aiActions.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "onboarding"
  - "content-language"
  - "mcp-tool"
---
[x] 마지막 소스 3파일 영어화 + AI 작성 언어 축 배선 — 소스 전량 완료

WorkspaceContext 9 · ProjectManager 39 · GreenfieldWizard 56. allowlist 47 → 44. **남은 44개는 전부 테스트 파일 — 소스는 한 개도 안 남았다.**

## 추가 기능 — AI 작성 언어 축을 실제로 배선했다

`settings.contentLanguage` 는 Phase 0 부터 존재했지만 **읽는 곳이 한 군데도 없었다**(grep 으로 확인). 그래서 그동안 "플래너에 기록되는 값은 contentLanguage 축이니 미배선 → 한국어 유지" 로 미뤄 왔는데, 그 결과 영어 UI 사용자가 새 프로젝트를 만들면 시드 목표·단계명·계획 제목이 전부 한국어로 디스크에 기록됐다. 영어화의 목적을 정면으로 배반하는 자리다.

`i18n/index.ts` 에 UI 스토어와 **평행한 작성 언어 스토어**를 넣었다:

- `getContentLang()` / `setContentLangSetting()` / `tc(key, vars)`
- `"system"` 은 **UI 언어를 따른다** — OS 로케일이 아니라. 산출물 언어의 자연스러운 기본값은 "지금 이 사람이 앱을 읽고 있는 언어"이고, 그래야 영어 사용자가 설정을 건드리지 않아도 영어 계획 항목을 받는다.
- `SettingsContext` 가 UI 언어와 같은 방식으로 스토어에 밀어넣는다.

`tc()` 로 옮긴 것: 그린필드 시드 목표 6개 · `초기 계획` · `초기 목표` 단계 · 폴더명 기본값 · 인셉션 킥오프 프롬프트, 그리고 **앞 회차에 "미배선이라 보류" 로 남겼던** `aiActions` 의 `DEFAULT_PHASE`/`DEFAULT_PLAN_TITLE`. 상수가 아니라 함수로 만들었다 — 모듈 상수면 임포트 시점에 언어가 굳는다.

테스트가 이 축의 계약을 못박는다: 화면 영어 + 산출물 한국어, 그 반대, `"system"` 이 UI 를 따르는 것, 깨진 값 폴백.

## 킥오프 프롬프트는 §4.5 의 예외

`project-inception` 발화 프롬프트는 터미널에 프리필돼 **사용자가 읽고 Enter 로 실행**한다. §4.5 가 명시한 예외("사용자가 붙여넣는 프롬프트는 본문도 번역")에 해당하고, 응답 언어가 산출물 언어와 같아야 하므로 `t()` 가 아니라 `tc()` 를 썼다.

## 번역하지 않은 것

`STACK_PRESETS` 의 `name`(Vite + React · Next.js · Rust · Python · Go)은 **제품명**이라 그대로 뒀다. 배열이 제품명과 번역 대상("빈 프로젝트")을 섞고 있어 TS 가 키 타입을 넓혔고, `name?: string` + `nameKey?: I18nKey` 로 명시해 의도를 타입에 새겼다.

## 방법론 전환 — 줄번호 치환

들여쓰기를 눈으로 맞춰 문자열 매칭하다 이 라운드에서만 다섯 번 헛돌았다. **줄번호 + 부분 문자열**로 바꾸니 한 번에 맞는다. 여러 줄 블록은 파일에서 원문을 그대로 떠서 교체한다. 다음 사람도 이 방식으로 시작할 것.

JSX 속성 함정도 재발했다 — `aria-label="한글"` 을 `t()` 로 바꾸면 중괄호가 빠져 `aria-label=t(...)` 가 된다. 정규식 한 줄로 일괄 복구했고 typecheck 가 매번 잡았다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 667통과(+4) / lint(남은 44 = 전부 테스트) / build.