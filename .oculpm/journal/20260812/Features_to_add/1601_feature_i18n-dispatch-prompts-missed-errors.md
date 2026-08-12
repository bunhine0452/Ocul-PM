---
schema_version: 1
type: feature
slug: "i18n-dispatch-prompts-missed-errors"
status: done
difficulty: high
created_at: "2026-08-12T16:01:48+09:00"
session_id: "mcp-20260812-160148"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/dispatch.rs"
    op: update
  - path: "src-tauri/src/commands/retro.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/journal_draft.rs"
    op: update
  - path: "src-tauri/src/commands/greenfield.rs"
    op: update
related: []
tags:
  - "i18n"
  - "rust"
  - "content-language"
  - "dispatch"
  - "mcp-tool"
---
[x] 디스패치 프롬프트 2종 영어화 + 앞 회차가 놓친 에러 30곳

## 추가 기능 — 디스패치 프롬프트 2종

03-i18n.md §4.5 가 **이름을 집어** 번역 대상으로 지목한 것들이다 (사용자가 읽고 터미널에서 실행하는 프롬프트). 둘 다 `ContentLang` 을 받게 했다.

**`build_retro_dispatch_prompt` 에 "한국어 회고로 종합하라" 가 박혀 있었다.** 산출물 언어를 English 로 둬도 **디스패치 회고만 한국어로 돌아왔다** — 설정이 무시되는 게 아니라 프롬프트가 정반대를 지시하고 있었다. 이번 라운드에서 찾은 것 중 가장 조용한 버그다.

**`build_dispatch_prompt`(플래너)** — 에이전트가 이 프롬프트를 읽고 `journal_write` 로 일지를 쓴다. 즉 **여기 언어가 곧 일지 언어**라 산출물 축을 따라야 한다.

## 계약은 글자 단위로 지켰다

회고 디스패치의 frontmatter(`oculpm_retro: v1` · `range_key` · `signature` · `generated_by`)와 `.oculpm/retro/{rk}.md` 경로는 `retro_file::parse_retro_file` 이 읽는 **계약**이다. 여기가 갈리면 저장된 회고를 앱이 못 알아본다. 파서를 직접 읽어 frontmatter만 파싱되고 본문 헤딩은 자유 산문임을 확인한 뒤, 테스트로 양 언어의 계약 문자열이 동일함을 못박았다.

플래너 쪽도 마찬가지 — `journal_write`/`plan_update` 도구명과 `plan_id=`/`item_id=` 는 언어와 무관하게 그대로다.

## 앞 회차의 놓침 — 줄 단위 grep 의 거짓 음성

지난 라운드에서 "Rust 에러 114곳 영어화" 라고 보고했는데, **30곳을 놓쳤다.** 원인은 내 스캔 방식이었다:

```
grep 'Err(\|map_err\|ok_or' | grep '[가-힣]'
```

`return Err(format!(` 과 한글 문자열이 **다른 줄**이면 한 줄도 매치되지 않는다. `dispatch.rs:36` 이 정확히 그 모양이었다. 이번엔 토큰이 있는 줄부터 **뒤 3줄까지** 훑어 다시 찾았고, MCP 등록·Claude 훅·규칙 관리 블록·그린필드·회고 기간 검증 등 30곳이 나왔다.

교훈: 여러 줄로 감싸는 게 흔한 Rust 에서 줄 단위 grep 은 완결성 근거가 못 된다.

## 분류

남은 한글은 전부 의도한 것이다 — `tracing::*` 진단 로그 5곳, 문서 주석, 프롬프트 증거 자리표시자 2곳(§4.5, 사유 주석 추가), 일지 섹션 헤더 인용 1곳, LLM 프롬프트 입력 1곳(`overview.rs` 의 언어 요약). 강등 사유(`transcript 파일을 읽지 못함` · `LLM 호출 실패`)는 **일지 본문에 박히므로** `ContentLang::pick` 으로 옮겼다.

## cargo test 가 4건을 잡았다

`심볼릭 링크` · `상한` · `검증` 을 단언하던 테스트 3개와, 영어 단언을 너무 세게 건 내 새 테스트 1개. 마지막 것은 실패 출력이 **남은 한글이 사용자 데이터**(픽스처의 플랜/항목 제목)임을 보여줬다 — 그건 번역 대상이 아니므로 그것만 벗겨내고 검사하도록 고쳤다.

## 검증

게이트 5종 exit 0 직접 확인 — typecheck / vitest 670통과 / **cargo test 527통과**(+2) / lint(남은 44 = 전부 테스트) / build.