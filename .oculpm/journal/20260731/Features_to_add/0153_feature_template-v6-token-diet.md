---
schema_version: 1
type: feature
slug: "template-v6-token-diet"
status: done
difficulty: high
created_at: "2026-07-31T01:53:01+09:00"
session_id: "mcp-20260731-015301"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agents/templates/master_ko.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/templates/master_en.md.tpl"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/discussion_spec_ko.md.tpl"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/discussion_spec_en.md.tpl"
    op: create
  - path: "src-tauri/src/oculpm/agents/templates/claude_code.md.tpl"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/oculpm/config.rs"
    op: update
  - path: "src-tauri/src/oculpm/session.rs"
    op: update
related: []
tags:
  - "token-diet"
  - "agents-template"
  - "template-v6"
  - "plugin-round"
  - "mcp-tool"
---
[x] 템플릿 v6 — 마스터 60% 압축 + discussion-spec 분리 + wrapper 탈임포트 + en 변형 (TK1)

## 추가 기능

plugin-round TK1. 전 추적 프로젝트·전 세션에 상시 주입되던 AGENTS.md 템플릿(v5, 8,031 chars ≈ ~2,900 tok)을 template_version **6** 으로 재구성:

1. **마스터 압축** — `master_ko.md.tpl` 8,031→**3,229 chars(−60%, ≈ ~1,100-1,200 tok)**. §3 YAML 예시→인라인 필드 목록(마찰 top3 ⚠ 는 필드 옆에 보존), §7 plan-log 예시 블록→행 형식 한 줄, 새 plan 은 `plan_create` 도구 우선(TK0 가 전제). 트리거·금지·글리프 어휘·"한 줄 항목"·"잠긴 plan 불변" 같은 준수 담보 규칙은 전부 생존.
2. **§8 분리** — discussion 규격 전문(1,696 chars)을 `.oculpm/agents/discussion-spec.md` 로: sync/upgrade 가 수렴 유지하는 **앱 관리 파일**(사용자 편집 미보존 — `_template.md` 와 다른 계약), 마스터엔 트리거+포인터 3줄만. 저빈도 규격의 상시 과금 소멸.
3. **claude wrapper 탈임포트** — `@../AGENTS.md` 임포트 제거(임포트 확장 런타임의 마스터 2중 주입 위험 소멸), MCP 도구 우선 1문단으로 교체(470 chars).
4. **en 변형** — `master_en.md.tpl`(4,582 chars)+`discussion_spec_en.md.tpl`. 선택은 신규 config `agents.template_language`(serde default "ko" — 기존 config 무영향), 시드/업그레이드 시 반영. 본문 강제 헤더(`## 발생 원인` 등)는 파서 계약이라 en 에서도 한국어 유지.

## 동작 흐름

앱이 프로젝트 열기 → template v6 업그레이드 감지·승인 → `_template.md` 교체(+.bak)·discussion-spec 시드 → 어댑터 재동기화로 AGENTS.md·래퍼 전파.

## 검증

- 신규 가드 테스트: 마스터 크기 상한(ko 4,800/en 5,200 — 다이어트 회귀 차단), ko/en 버전 패리티, plan_create·discussion-spec 포인터 존재, wrapper 임포트 금지, en 시드+discussion-spec 손상 복원. 기존 가드 2건은 v6 계약으로 갱신(discussion-log 는 spec 파일이 보유).
- cargo 전체 FAILED 0(agents 22) · vitest 335 · typecheck/lint/build 그린. bindings.ts +6줄(template_language).

## 메모

세션당 상시 비용(추적 프로젝트): 템플릿 ~2,900→~1,150 tok(−60%) + 래퍼 임포트 이원화 위험 소멸 + §8 on-demand 화. 이 레포 자신의 AGENTS.md/.claude/CLAUDE.md 는 v5 상태 — **다음 앱 실행에서 업그레이드 승인 필요**(A0d 실기기 확인에 동승). template_language 의 설정 UI 노출은 후속(현재 config.toml 직접 편집).