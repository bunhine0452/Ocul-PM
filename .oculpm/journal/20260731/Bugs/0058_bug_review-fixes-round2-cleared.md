---
schema_version: 1
type: bug
slug: "review-fixes-round2-cleared"
status: done
difficulty: medium
created_at: "2026-07-31T00:58:00+09:00"
session_id: "mcp-20260731-005800"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/oculpm/rule_promotion.rs"
    op: update
  - path: "src/features/skills/RulesTab.tsx"
    op: update
  - path: "src/features/retro/RuleCandidates.tsx"
    op: update
related: []
tags:
  - "code-review"
  - "rules-hub"
  - "cursor-mirror"
  - "plugin-round"
  - "mcp-tool"
---
[x] 리뷰 잔여 5건 청산 — sync_mirrors 1패스 수렴·frontmatter 수평선 오인·읽기 상한 외 (A0c)

## 발생 원인

2026-07-20 적대 리뷰(PR-CI3~8)에서 백로그로 미뤄졌던 5건 (claude-integration #review-fixes-round2):

1. **sync_mirrors 비fixpoint** — 평탄화가 겹치는 rename(`api/validation.md`→`api-validation.md`, 둘 다 `api-validation.mdc`)에서 낡은 마커 미러가 새 쓰기를 conflict 로 막은 채, 쓰기 **뒤에** 도는 고아 정리에 지워져 1패스 후 미러가 사라짐(2패스에야 복구).
2. **split_frontmatter 수평선 오인** — 접두/부분 문자열 매칭이라 `----` 수평선·`--- 제목` 을 frontmatter 로 오인 → Cursor 미러 본문 유실(원본 무사).
3. **읽기 크기 상한 부재** — 저장(MAX_RULE_BYTES 512KB)과 달리 읽기 경로(목록·미러·가드)는 무제한이라 거대 파일이 통째로 메모리에 올라옴.
4. **gather_evidence 누락 삼킴** — 일지 파일 읽기 실패를 빈 발췌로 삼켜 "증거 없음" 과 "증거 유실" 이 구분 불가.
5. **미러 충돌 안내 문구 부정확** — conflict 는 평탄화 충돌(다른 규칙의 미러)로도 나는데 문구가 "ocul-pm 소유가 아닌 파일" 로 단정.

## 해결 방법

1. 고아 정리를 쓰기 루프 **앞**으로 이동 — 원본이 살아있는 미러는 정리 단계가 건드리지 않으므로 안전 (리뷰어가 양 순서 수동 추적으로 회귀 없음 확인).
2. 여닫는 구분자를 "정확히 `---` 한 줄"(CRLF 관용)로 재작성, 닫는 줄 미발견 시 전체를 본문으로.
3. `read_capped` 헬퍼(512KB, Ok(Some)/Ok(None)/Err=검증불능) 신설 — 목록·overview·미러 상태/쓰기/삭제·sync 스캔에 적용. `read()` 는 명시적 에러, `guard_managed_block` 은 검증 불능 시 저장 거부("해석 불가 대상은 쓰지 않는다" 계약 확장). 검증 불능 .mdc 는 쓰기/삭제 모두 conflict + 파일 보존.
4. 읽기 실패 시 발췌 자리에 "(일지 파일을 읽지 못했습니다: rel)" 명시.
5. RulesTab·RuleCandidates 문구를 두 원인(다른 규칙의 미러/사용자·어댑터 파일) 모두 포괄하게 수정.

## 검증

- 신규 Rust 테스트 5: rename 1패스 수렴, 수평선/제목/미종결 frontmatter 5케이스+render_mirror 본문 보존, 상한 초과 목록 제외+read 에러, 검증 불능 대상 불가침(save 거부·conflict·보존), 증거 유실 명시.
- cargo test 전체 그린(FAILED 0) + typecheck/lint/vitest 332/build 그린.
- 적대 리뷰 2차(rust-reviewer): CRITICAL/HIGH 0, Warning — MEDIUM "검증 불능 분기 테스트 부재" 는 본 커밋에서 테스트 추가로 해소.

## 메모

리뷰가 남긴 후속(비파괴, 보이스카웃 백로그): 상한 초과 CLAUDE.md 슬롯이 `exists=false` 로 접혀 허브에 "만들기" 버튼이 뜸(save 가 안전 거부하므로 데이터 손실 없음 — `readable` 필드 신설감), 상한 초과 규칙이 목록에서 무신호 실종, read() 의 상한 로직 중복, read_capped TOCTOU(로컬 신뢰 수준에서 무시 가능).