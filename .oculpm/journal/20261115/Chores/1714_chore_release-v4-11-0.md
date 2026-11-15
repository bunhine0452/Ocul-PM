---
schema_version: 1
type: chore
slug: "release-v4-11-0"
status: done
difficulty: medium
created_at: "2026-11-15T17:14:03+09:00"
session_id: "20261115-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "docs/PROMISE.md"
    op: update
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
  - path: "landing/wiki-src/pages.mjs"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
related: []
tags:
  - "릴리스"
  - "release"
  - "quality-round"
  - "mcp-tool"
---
[x] 릴리스: v4.11.0 을 냈다

업그레이드 라운드(PR #176)와 두 기기 · 쌓인 기록 접기(PR #175)를 묶어 v4.11.0 으로 냈다(사용자 결정 11-13 「내일 4.11 내도록 해」, 11-15 「라운드 합친 뒤 4.11.0」).

- 머지 커밋의 E2E 가 Windows · Linux 둘 다 떨어졌다: 언어 줄이 설정 「표시」 칸에서 「앱」 칸으로 옮겨 가 시나리오가 밝기를 눌렀다 → radiogroup aria-label 로 찾게 고침(a837e41e). 단축키 표의 ⌥⌘ 번호 설명 · PROMISE 의 없어진 줄(52ec8e66).
- 릴리스 면: 버전 6파일 · Cargo.lock · CHANGELOG(리듬 이유 첫 줄) · README ko/en · 랜딩 ko/en(기능 목록 · FAQ · 칸 · 변경 이력) · 플러그인 페이지 · 생성물(a0f803c9). 위키 원본의 4.11 로 낡은 말 29개 파일과 개인정보 페이지(앱 안 터미널의 셸도 적음)는 뒤 커밋.
- 12:51~17:12 Ocul(이 세션의 터미널을 띄운 앱)이 데스크탑 폴더 TCC 거절을 붙잡아 저장소를 못 읽었다. 권한을 켜도 떠 있는 프로세스엔 안 먹어서 4.11.0 으로 업데이트하며 다시 열어 풀었다. 그동안 앱 잠금이 남긴 `.oculpm/.lock.*.tmp` 520개는 지웠다.

## 검증

- 태그 커밋 a0f803c9: CI success · E2E success(Windows · Linux). release run 43673415294 conclusion success — macOS 서명 · 비-mac 번들 · 설치 스모크 · 설치본 E2E 전부 통과, 자산 9개.
- `gh api releases/latest` → v4.11.0, latest.json version 4.11.0(플랫폼 키 5). 설치본 Info.plist 4.11.0.
- Portability(미리보기)는 11-11 부터 붉은 Windows git 실행 수 시험 그대로(tech-backlog #spawn-count-unix).