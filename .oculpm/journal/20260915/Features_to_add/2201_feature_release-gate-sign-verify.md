---
schema_version: 1
type: feature
slug: "release-gate-sign-verify"
status: done
difficulty: medium
created_at: "2026-09-15T22:01:30+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/workflows/ci.yml"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: []
tags:
  - "ci"
  - "release"
  - "signing"
  - "astra-feedback"
  - "parallel-session"
  - "mcp-tool"
---
[x] 배포 파이프라인 4건 — 태그 커밋 CI 게이트 · 툴체인 핀 · draft→서명/공증 검증→공개 · 확장 vitest CI

## 추가 기능

Astra 리뷰 E04/18.3/18.4/E13 — 전부 코드로 확인된 빈틈. 병렬 세션 Y1 이 worktree 에서 구현, 커밋 4개 `8dd8fc5`·`d74015c`·`f29424b`·`6826f63`.

**발견**: 이 게이트가 없던 동안 **v3.1.1 은 cargo-deny 잡이 붉은 커밋(5432b6e, RUSTSEC-2026-0285 미수정)에서 그대로 릴리스됐다.** release.yml 은 테스트를 돌리지 않으니 "main 이 초록인지 보고 태그를 민다"는 사람의 습관이 유일한 방어였다.

### 동작 흐름

1. **gate 잡** (`#release-ci-gate`): 태그를 API 로 커밋까지 해석(주석 태그도) → `actions/runs?head_sha=` 를 `.path == ci.yml` 로 필터(이름이 아니라 경로; Release 자신도 같은 sha 에 잡히므로) → 60초×45회 폴링 → 가장 최근 run 의 `conclusion == success` + 잡 단위 전부 success 요구. run 없음·타임아웃·비-success 각각 한국어 `::error::`. **판정은 conclusion 필드로** — `gh run watch` 는 취소된 run 도 exit 0. `build: needs: gate`, 잡 권한 `contents: read, actions: read`, 체크아웃 없이 `GH_REPO` 명시.
2. **툴체인** (`#release-toolchain`): ci.yml 의 "툴체인 버전 읽기" 단계를 그대로 옮겨 `dtolnay/rust-toolchain@master` + `toolchain:` + `targets:`. @stable 제거.
3. **draft→검증→공개** (`#release-sign-verify`): `releaseDraft: true`. `.app` 에 `codesign --verify --deep --strict` · `-dvv` Authority=Developer ID Application(adhoc 차단) · `spctl -a -t exec` accepted+`source=Notarized Developer ID` · `stapler validate`. `.dmg` 는 Developer ID 서명만 단언, 공증·스테이플은 로그만 — **tauri-bundler 는 `.app` 만 공증하고 dmg 는 서명만 한다**는 걸 업스트림 소스로 확인하고 v3.1.1 실제 dmg 로 실측(`spctl -t open → rejected source=Unnotarized Developer ID`). 업데이터: 디스크 `.app.tar.gz`+`.sig`, draft 자산, `latest.json` 의 version==태그·url 이 실제 자산·signature 비어있지 않음. `.vsix` 첨부 뒤 마지막에 `gh release edit --draft=false --latest`. 하나라도 실패하면 draft 로 남아 `releases/latest` 에 안 뜬다(업데이터 노출 0).
4. **확장 vitest** (`#ci-ext-unit`): ci.yml 프런트 잡에 `pnpm test:unit`(extension/). vscode-test 는 xvfb 필요로 후속 주석.
5. `docs/RELEASE.md`: §0 게이트, §5 태그 뒤 6단계, 신설 §6-1 로그별 원인·조치 + 복구(`gh release delete` → `gh run rerun`, 손으로 `--draft=false` 금지), 자산 4→5.

## 검증

- 두 워크플로 ruby YAML 파싱 + 모든 `run:` 블록(release 9·ci 12) `bash -n` 통과.
- gate 스크립트를 **실제 GitHub API** 에 대고 실행: v3.1.1(ebbeb1b) → 통과 / 5432b6e → `conclusion=failure` 차단 / 없는 sha → "CI 가 이 커밋에서 돌지 않았다" 차단.
- 검증 스크립트를 v3.1.1 실제 `.dmg`/`.app`/`.sig` 로 조립한 bundle 디렉터리에 실행: 정상 통과 / 애드혹 재서명 `.app` 차단 / `.app` 없음 차단 / `.sig` 없음 차단 / 실제 릴리스 자산·latest.json 통과.
- 확장 `pnpm test:unit` 8파일/27테스트 통과.
- 미검증(러너에서만 가능): 첫 실제 태그에서 draft 상태의 `gh release download`·`spctl` 이 기대대로 도는지 → #eyes-release-gate. 실패해도 draft 로 남으므로 사용자 노출 없음.