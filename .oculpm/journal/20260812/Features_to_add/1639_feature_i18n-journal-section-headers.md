---
schema_version: 1
type: feature
slug: "i18n-journal-section-headers"
status: done
difficulty: medium
created_at: "2026-08-12T16:39:58+09:00"
session_id: "mcp-20260812-163958"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/journal_draft.rs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "content-language"
  - "journal"
  - "mcp-tool"
---
[x] 일지 섹션 헤더 영어화 — 마이그레이션이 필요 없다는 걸 확인하고 진행

## 동기 — 내가 앞서 한 판단이 틀렸다

이 항목을 두 번이나 "`schema_version` 범프 + 기존 일지 마이그레이션이 필요한 별도 라운드" 라고 보고했다. SSOT §1 도 그렇게 적혀 있다. **확인해 보니 아니었다.**

헤더 이름으로 파싱하는 코드가 **한 곳도 없다**:

- `markdown::extract_headers` 는 pulldown-cmark 로 **어떤 텍스트든** 일반적으로 걷어낸다. 이미 영어 헤더를 검사하는 테스트가 있다 (`assert_eq!(pb.headers, vec!["Section"])`).
- 그 `ParsedBody.headers` 필드를 읽는 소비처가 없다 (`markdown.rs` 밖에서 `.headers` 참조 0건).
- 프런트에도 없다 — `## 발생 원인` 은 테스트 픽스처·플레이스홀더·프롬프트 문구뿐이다.

그래서 **기존 한국어 일지는 한 글자도 안 바뀐 채 그대로 파싱되고**, 새 일지만 설정 언어를 따른다. 마이그레이션도 스키마 범프도 필요 없다.

SSOT §1 의 그 항목은 세 가지(`AGENTS.md 템플릿` · `일지 섹션 규격` · `플래너 글리프`)를 묶어 뒀는데, **플래너 글리프(`[x]`·`[~]`)는 실제로 파싱되고** AGENTS.md 는 관리 블록 계약이 있다. 일지 섹션 헤더만 성질이 달랐고, 묶여 있느라 같이 미뤄져 있었다.

## 변경 요약

`compose_body` / `compose_degraded_body` 의 헤더가 `ContentLang` 을 따른다:

| ko | en |
|---|---|
| 발생 원인 / 해결 방법 | Root cause / Fix |
| 추가 기능 / 동작 흐름 | What was added / How it works |
| 동기 / 변경 요약 | Motivation / Summary of changes |
| 검증 / 메모 | Verification / Notes |

영어 이름은 **프런트가 먼저 정한 것**을 따랐다 — `manual.bodyPlaceholder` 가 이미 `## Root cause` / `## Fix` 였다. 수동 작성과 자동 초안이 다른 헤더를 쓰면 한 프로젝트 안에서 갈린다.

## 회귀 방지를 먼저 고정했다

`korean_path_is_byte_identical_to_before` — `Unset`(설정 미지정)과 명시 `Korean` 둘 다 예전 헤더 그대로임을 단언한다. 이 라운드의 안전판이다: 기존 사용자는 설정을 안 건드렸으므로 `Unset` 이고, 그 경로가 안 바뀌는 한 아무 일도 일어나지 않는다.

앞 회차에 내가 쓴 테스트 2개가 "헤더는 한국어로 남아야 한다" 를 단언하고 있어서 깨졌다 — 판단이 바뀌었으니 테스트도 새 계약으로 고쳤다(이름도 `english_fallbacks_and_headers_are_english` 로).

## 남은 한계 (범위 밖)

**에이전트가 MCP 로 쓰는 일지는 여전히 한국어 헤더 안내를 받는다.** `tool_definitions()` 는 인자 없는 **정적 스키마**라 프로젝트별 언어를 알 수 없고, `plugin_manifest` 테스트·`plugin_docs_sync` 테스트·`landing/plugin.html` 이 함께 묶여 있다. AGENTS.md 템플릿도 관리 블록 계약이라 별개다.

즉 영어 모드에서 헤더가 영어로 나오는 건 **세션 종료 자동 초안**과 **앱 내 수동 작성**이고, 에이전트가 직접 쓰는 일지는 아직 아니다.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 670통과 / **cargo test 528통과**(+1) / lint(남은 44) / build.