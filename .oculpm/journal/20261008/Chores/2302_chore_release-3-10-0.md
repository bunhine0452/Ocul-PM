---
schema_version: 1
type: chore
slug: "release-3-10-0"
status: done
difficulty: low
created_at: "2026-10-08T23:02:46+09:00"
session_id: "20261008-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "SECURITY.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "release"
  - "mcp-tool"
---
[x] v3.10.0 릴리스 — 신뢰한 뒤에만 도는 언어 서버, 다시 만든 논의 편집기

## 실린 것
PR #74(보안 피드백 3차 — 경로 3건 · 상위 폴더 · 자동화 동의 범위), #75(SECURITY.md · 비공개 신고 · 리뷰 주기 경고), #76(언어 서버 신뢰 관문 · RAG 조각 마스킹 · 비밀 파일 색인 제외 · 기동 색인 화해 · 비활성 창 애니메이션 정지), #77(논의 편집기 개편).

## 절차 (docs/RELEASE.md)
- `bump-version 3.10.0` 으로 6파일 + 랜딩 ko/en 각 6곳을 고쳤다. SECURITY.md 「다음 릴리스」(3차 리뷰 행)가 v3.10.0 으로 자동 채워졌고, 리뷰 주기 경고는 없었다(마지막 반영 v3.9.0 대비 마이너 1).
- CHANGELOG `## v3.10.0` 을 증상 → 변화의 서술형으로 썼다. **기존 프로젝트도 언어 서버를 한 번 신뢰해야 한다**는 안내를 넣었다.
- README ko/en 하이라이트를 바꾸고(🚀 이동), 랜딩 ko/en 에 변경 이력 `<li>` 를 더했다. 코드 편집기 FAQ 4곳(JSON-LD · details × 2언어)에 「v3.10.0 부터 신뢰한 뒤에 켜집니다」 를 더해 거짓이 되지 않게 했다. plugin 배지 ko/en, `build.mjs` 재빌드.
- 게이트: typecheck · lint · test 3,294 · build · cargo test 2,017 전부 0. Cargo.lock 함께 커밋.
- 릴리스 커밋 fa29fd5a 의 CI 초록을 확인한 뒤 태그 `v3.10.0` 을 단독 push → run 37769668600 하나(중복 없음).

## 검증
run 의 meta · gate · macOS 서명/공증 · win/linux 번들 · 스모크 · E2E · 공개가 전부 success 였다. 12:19Z 에 공개됐고 자산은 10개, latest = v3.10.0, latest.json 키 5개(darwin ×2 · windows ×2 · linux-appimage)다. 랜딩은 `vercel --prod`(링크 ocul-pm-landing)로 배포했고, oculpm.com · /en 의 softwareVersion 3.10.0 과 /changelog 에 v3.10.0 이 있는 것을 확인했다.

## 메모
설치본 자동 업데이트 뒤 실기기 확인이 남았다 — 코드 화면 「신뢰하고 켜기」 → 서버 기동, 기동 로그의 「기동 화해」 줄, 비활성 창 유휴 CPU 전후(플랜 perf-security-audit #idle-cpu-animations), 논의 편집기의 한글 입력 · 초안 복원, 3차 보안 항목(security-feedback-round-3 #eyes-round3).