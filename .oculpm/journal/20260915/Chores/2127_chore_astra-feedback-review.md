---
schema_version: 1
type: chore
slug: "astra-feedback-review"
status: done
difficulty: medium
created_at: "2026-09-15T21:27:46+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/Astra feedback/Ocul-PM_10점_개선_마스터보고서.md"
    op: update
  - path: "docs/Astra feedback/Ocul-PM_개선_백로그_48개.csv"
    op: update
  - path: "docs/Astra feedback/Ocul-PM_10점_개선_마스터보고서.html"
    op: update
related: []
tags:
  - "review"
  - "external-feedback"
  - "backlog"
  - "release"
  - "concurrency"
  - "mcp-tool"
---
[x] Astra 외부 리뷰(10점 마스터보고서·백로그 48건) 수용 가능성 검토 — 핵심 주장 코드 대조

## 작업 내용

사용자가 받아 둔 외부 리뷰 `docs/Astra feedback/` (기준 커밋 ebbeb1b, 3.1.1) 를 읽기 전용으로 검토했다. 코드는 바꾸지 않았다 — 산출물은 대화의 판정문.

보고서 자체의 품질: 증거 등급(A/B/C/H/T) 을 지키고, §2.4 에서 "CAS 없다·성능 측정 없다" 류 오독을 스스로 정정하며, 수치는 전부 제안 목표로 표기. 약점은 Rust 테스트·설치본 미실행(정적 분석) 과 2인 팀 12주 가정.

### 코드로 대조한 핵심 주장 — 틀린 것 없음

- **신규 일지 생성 경쟁 (E06)**: 맞음. 쓰기 진입점 3곳 모두 `pick_nonconflicting_path`(exists 확인) 뒤 `write_atomic`(tmp+rename), 배타적 생성 없음 — `mcp/tools/mod.rs:791`, `manager/journal.rs:536`, `manager/indexing.rs:334`.
- **오래된 락 회수 경쟁 (12.4)**: 맞음(협소). `file_guard.rs` 는 mtime 10초로 `remove_file` 후 `create_new`, `Drop` 은 소유 확인 없이 경로로 삭제 → 회수당한 원주인이 새 주인의 락을 지운다.
- **배포 게이트 부재 (E04)**: 맞음. `release.yml` 은 `v*` 태그만으로 빌드·공개, CI 통과 조회 없음.
- **툴체인 불일치 (18.3)**: 맞음. ci.yml 은 `rust-toolchain.toml` 을 grep, release.yml 은 `dtolnay/rust-toolchain@stable`.
- **서명 실패가 조용히 unsigned (18.4)**: 맞음. release.yml 주석이 인정, 사후 `codesign`/`spctl`/`stapler` 검증 단계 없음.
- **확장 테스트 CI 미실행 (E13)**: 맞음. tsc+eslint 만, `vitest`/`vscode-test` 안 돎.
- `csp: null`, 헤드리스 0/12 인용, rename≠전원장애 영속성(디렉터리 fsync 없음) — 모두 맞음.

### 판정

- **A 바로 수용(싸고 실재)**: B04/B05 비덮어쓰기 생성(`write_atomic` create_new 변형 + `__N` 재선택, 2프로세스 테스트면 충분) · file_guard Drop 소유 검증(nonce) · B31/B32/B33 release.yml 3종(CI check-run 조회·툴체인 grep·서명 사후 검증) · B35 확장 `test:unit` CI · B45 지원 등급 문구.
- **B 이미 활성 플랜에 있음**: B27→#csp, B41→#big-files, B30→#mobile-bridge-rest, B13→#acp-journal-draft. **B10 `reviewed_hash`(검토 후 내용 변경 시 효력 만료) 는 열려 있는 #verified-loop 결정의 답으로 채택 권고.**
- **C 보류**: B06 request_id(응답 유실은 `__2` 중복이지 덮어쓰기 아님; 같은 slug·분·본문 해시 dedup 이 더 쌈) · B09/B11 record_id 스키마 · B15/B16 180세션 실험(축소판 48 이면 검토) · B08/B36/B37~39 하니스류.
- **D 기각/사용자 결정**: B21 Today·탐색 재편(전면 리디자인 반대 결정과 충돌) · B43/B44 사용자 실험 · B47/B48 100점표 독립 검토(1인 개발 비현실). 점수 체계와 백로그는 분리해 받을 것.

추천 착수 순서: B04+file_guard → release.yml 3종 → B35 → B10 을 #verified-loop 답으로. 사용자 결정 뒤 A군 + B10 을 활성 플랜 항목으로 옮길 것 (이월은 살아 있는 플랜의 항목으로).

## 검증

- 위 대조는 전부 현재 main(ebbeb1b) 소스 grep·열람으로 확인. 테스트·빌드는 돌리지 않음(코드 무변경).
- `git status` — 워킹트리 변경 없음, `docs/Astra feedback/` 는 사용자가 놓은 미추적 파일.