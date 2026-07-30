---
schema_version: 1
type: bug
slug: "claude-adapter-import-path-never-loaded"
status: done
difficulty: medium
created_at: "2026-07-30T23:14:46+09:00"
session_id: "mcp-20260730-231446"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agents/templates/claude_code.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/copilot.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
related: []
tags:
  - "agents"
  - "adapter"
  - "claude-code"
  - "rules-delivery"
  - "dogfooding-finding"
  - "mcp-tool"
---
[x] .claude/CLAUDE.md 의 @AGENTS.md 가 해석되지 않아 Claude Code 에 규칙이 전달되지 않던 문제

## 발생 원인

Claude 어댑터는 `.claude/CLAUDE.md` 에 위임 stub 을 쓰고, 본문 규칙은 루트
`AGENTS.md` 에서 `@AGENTS.md` 임포트로 끌어오는 설계다 (W4 도그푸딩 2026-05-25
결정 — 외부 LLM 이 `_template.md` 를 자발적으로 안 읽어서 루트 AGENTS.md 를 1차
표면으로 삼았다).

그런데 Claude Code 공식 문서는 이렇게 말한다:

> Both relative and absolute paths are allowed. **Relative paths resolve
> relative to the file containing the import, not the working directory.**

즉 `.claude/CLAUDE.md` 안의 `@AGENTS.md` 는 **`.claude/AGENTS.md`** 를 찾는다.
그런 파일은 없다(실제 파일은 저장소 루트). 임포트는 조용히 아무것도 확장하지
않고, Claude Code 는 565바이트짜리 stub 만 받는다.

이 세션의 부팅 컨텍스트로 직접 확인했다 — `.claude/CLAUDE.md` 블록이 `@AGENTS.md`
**리터럴 그대로** 들어왔고 12KB 본문은 어디에도 없었다. 루트 `CLAUDE.md`(7.9KB)는
전문이 들어와 있었으므로 주입 자체는 정상 작동한다.

실패 방향이 최악이다: 에러도 경고도 없고, 에이전트는 그냥 **일지라는 것이 존재하는
줄 모른다**. 이 저장소가 여태 괜찮아 보인 건 사용자가 손으로 쓴 루트 `CLAUDE.md`
가 AGENTS.md 를 언급하기 때문이지, 어댑터가 동작해서가 아니다. 일반 추적 프로젝트는
아무것도 못 받는다.

## 해결 방법

`claude_code.md.tpl` 의 임포트를 `@../AGENTS.md` 로 고쳤다. `.claude/../AGENTS.md`
= 저장소 루트이고, 작업 디렉터리 안이므로 외부 임포트 승인 대화상자도 뜨지 않는다.

같은 함정에 빠진 어댑터를 전수 조사했다. 하위 디렉터리 + 독립 행 `@AGENTS.md`
조합은 **claude-code 와 copilot 둘뿐** 이다(둘 다 depth 1). gemini-cli(`GEMINI.md`)·
aider(`CONVENTIONS.md`)·zed(`.rules`)는 루트라 정상이고, cursor·antigravity·
windsurf·cline 은 임포트 없이 산문으로만 가리킨다. copilot 도 같이 고쳤다 — 그쪽이
임포트를 지원하든 안 하든 `../AGENTS.md` 가 그 위치에서 맞는 경로다.

**template_version 은 올리지 않았다.** `render_claude_code` 는 마스터에서 파생되지
않고 `.tpl` 을 그대로 돌려주며(mod.rs:188), `sync_active` 는 호출될 때마다 전 어댑터를
다시 렌더한다. 마스터 본문(AGENTS.md §1~§8)은 그대로이므로 추적 프로젝트에 재동기화
토스트가 뜨지 않는다 — 다음 sync 때 조용히 교정된다.

## 검증

- `cargo test` 431 통과. 회귀 테스트 신설
  `adapter_agents_imports_resolve_to_the_root_agents_md`: 모든 어댑터에 대해
  `adapter_path` 의 디렉터리 깊이만큼 `../` 가 붙었는지 검사한다. 하위 디렉터리에
  새 어댑터를 추가하면서 bare `@AGENTS.md` 를 쓰면 즉시 깨진다.
- 실제 전파 확인: 이 저장소의 `.claude/CLAUDE.md`(gitignore 대상, 생성물)가 앱
  재빌드 후 `@../AGENTS.md` 로 다시 렌더됐고, `.claude/../AGENTS.md` 가 12,159바이트
  루트 파일로 해석되는 것을 확인했다.

## 메모

이 발견은 토큰 절감 라운드의 부산물이다. "AGENTS.md 가 세션당 ~2,895 토큰을
먹으니 줄이자" 를 검증하려다, 애초에 **상주하지 않는다** 는 사실이 나왔다. 절감
대상이 아니라 전달 버그였던 셈 — 측정 전에 최적화했으면 없는 비용을 줄이려고
규칙을 더 깎을 뻔했다.