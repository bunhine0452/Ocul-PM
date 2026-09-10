---
schema_version: 1
type: chore
slug: "release-2-46-0"
status: done
difficulty: medium
created_at: "2026-09-10T20:26:56+09:00"
session_id: "20260910-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "55cc0fcc-d3a8-4c54-a4d1-ef78c5bd3ef6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: "plugin/oculpm-codex/.codex-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
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
  - path: "landing/wiki-src/retro.md"
    op: delete
  - path: "landing/wiki-src/en/retro.md"
    op: delete
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/en/screens.md"
    op: update
related: []
tags:
  - "release"
  - "landing"
  - "docs"
  - "mcp-tool"
---
[x] v2.46.0 릴리스 — 회고·문서 삭제의 미반영분을 함께 갚는다

## 변경 요약

v2.45.2 이후 64 커밋을 **v2.46.0** 으로 내보냈다. 알맹이는 Monaco 이관 라운드
(편집기를 통째로 갈고 ⌘K 인라인 편집·시맨틱 강조를 얹음)와 디자인 일관성
라운드(글자·여백·곡률·말투를 한 램프로)다.

다섯 면 전부: 버전 6파일 + `Cargo.lock` · `CHANGELOG.md` · README ko/en ·
랜딩 ko/en 각 6곳 + `plugin.html` 배지 둘 · `build.mjs` 재빌드.

## 회고·문서 삭제의 미반영분

2026-09-08 에 두 화면을 걷어내면서 문서 표면은 **일부러** 손대지 않았다 — 그때
다운로드되는 것은 두 화면이 아직 있는 v2.45.2 였기 때문이다. 이 릴리스가
따라잡았다.

- README ko/en — 화면 목록의 두 항목 + 현재 상태를 말하던 문장 넷
- 랜딩 ko/en — meta · og · JSON-LD description · `featureList` · 히어로 · 액트
  불릿, 그리고 **FAQ 를 두 곳에서**. `docs/RELEASE.md` 가 경고한 대로 같은
  문답이 JSON-LD 와 `<details>` 양쪽에 있어, 한쪽만 고치면 검색엔진과 사람이
  다른 말을 듣는다.
- 위키 `retro.md` ko/en 삭제 + 그것을 가리키던 12곳

**「기록만 남기나요? 산출물도 만들어 주나요?」 FAQ 가 거짓이 되어 있었다** —
PR 본문·주간 보고는 회고 화면에 딸려 함께 사라졌는데 답변은 그대로였다. 지금
실제로 있는 것(Today 「스탠드업 복사」 · 브랜치 마크다운 내보내기)으로 다시
썼다. 릴리스 체크리스트가 "새 항목을 더하는 것보다 기존 FAQ 가 거짓이 되지
않는지가 먼저" 라고 적어 둔 이유가 이것이다.

덤으로 위키 `screens.md` 의 ⌘번호 표가 **2026-09-06 IA 재편 이전에 멈춰
있던 것**을 발견해 지금 배치로 바로잡았고(⌘3 이 논의가 아니라 변경, ⌘8 이
문서가 아니라 코드, ⌘9·⌘0 이 에이전트·AI 패널), 편집기·⌘K 항목을 새로 실었다.

## 검증

typecheck · test(200파일 2,599) · lint 6종 · build · cargo test(33스위트
1,591) 전부 exit 0. **main CI 세 잡(프런트 · Rust · cargo-deny) 초록 확인 후**
태그를 밀었다 — release.yml 은 테스트를 안 돌리고 번들만 굽기 때문에 붉은
main 에 태그를 밀면 깨진 빌드가 그대로 나간다. 랜딩 배포 후 라이브 확인:
ko·en `softwareVersion` 2.46.0 · `/wiki/retro` 404 · `/plugin` 배지 v2.46.0 ·
changelog 앵커 100개.