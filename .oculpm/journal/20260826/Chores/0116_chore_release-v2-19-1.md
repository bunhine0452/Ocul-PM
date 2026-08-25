---
schema_version: 1
type: chore
slug: "release-v2-19-1"
status: done
difficulty: low
created_at: "2026-08-26T01:16:00+09:00"
session_id: "manual-20260826-011600"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
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
related: ["20260825/Refactors/2344_refactor_today-ring-salvage.md"]
tags: ["release", "chore"]
---

[x] v2.19.1 릴리스 준비 — 5면 갱신 완료, 태그 푸시 대기

## 무엇이 들어가나

v2.19.0 이후 main 에 쌓인 **11커밋**. 사용자에게 보이는 것은 하나다:

- **Today 활동 링** (`ae8589f`) — 화면 낭독기에 무음이던 것(`aria-label` 이 암묵
  `generic` 인 `<div>` 에 붙어 무시됨 + svg `aria-hidden` + 툴팁 마우스 전용),
  툴팁이 `role="status"` 라 포인터가 스칠 때마다 공지하던 것, 프로젝트 전환 시
  헛 리플, 리플 잔존, 천단위 구분

나머지 10건은 내부 작업이다 — CI 게이트 신설, 백엔드 3파일 분할(manager·db·cache),
프런트 2파일 분해(AcpConversation·SettingsPanel), 훅 추출 1/5, 특성화 테스트.
전부 "동작 무변경"을 시그니처 집합 비교로 단언했다.

패치 버전을 고른 이유: 기능 추가가 없고 버그 수정뿐이다.

## 5면 갱신

| 면 | 상태 |
|---|---|
| 버전 5파일 | package.json · tauri.conf.json · Cargo.toml · plugin.json · marketplace.json → 2.19.1 (+ Cargo.lock 동기) |
| CHANGELOG.md | `## v2.19.1` 최상단. release.yml 의 awk 로 추출 확인(1,276바이트) |
| README.md · README.en.md | `## 🚀 v2.19.1` 신설, 이전 섹션 🚀 강등. 양쪽 같은 사실 |
| landing/index.html | 버전 문자열 **6곳** + 변경 이력 `<li>` 1건 |

랜딩의 6곳: JSON-LD `softwareVersion` · `nav-ver` 배지 · `ap-new` NEW 배지 ·
다운로드 버튼 2곳(히어로·CTA) · CTA `eyebrow`.

**남은 `2.19.0` 5곳은 의도적으로 두었다** — FAQ 4곳은 "v2.19.0 부터는 끊기지
않습니다" 같은 **사실 진술**이라 바꾸면 거짓이 되고, 나머지 하나는 v2.19.0 의 변경
이력 항목이다. 기능 추가가 없어 JSON-LD `featureList`·FAQ 신설·벤토 셀·plugin.html
은 손대지 않았고, 기존 FAQ 가 이번 변경으로 거짓이 되는지도 확인했다(해당 없음).

## 검증

`cargo test --locked` **exit 0** — 이게 Cargo.lock 동기와 `plugin_manifest` 의
**버전 5파일 일치**를 동시에 증명한다. 18스위트 888 passed / 0 failed.
프런트 typecheck · test(1,311) · lint · build 전부 exit 0. bindings drift 없음.

## 남은 단계

태그를 밀지 않았다 — 사용자가 "준비"까지 요청했다. 남은 것:

```bash
git push origin main
git push origin v2.19.1        # 단독으로 (--tags 금지)
cd landing && vercel --prod --yes
```

## 메모

**이번 판은 앱을 한 번도 띄우지 않고 준비했다.** 만 줄 넘는 구조 변경(manager 4,514 ·
db 3,292 · cache 3,435 · AcpConversation 3,542 · SettingsPanel 1,871)을 테스트와
타입으로만 검증했다. 테스트가 못 덮는 경로가 있다는 것은 이번 라운드에서 두 번
확인했으므로(rustup shim 에 속는 스킵 가드, jsdom 에서 안 도는 animationend),
태그 전에 `pnpm tauri dev` 로 핵심 흐름을 눈으로 보는 편이 낫다.
플래너 [today-ring-followup] 의 실기기 확인 2건도 이때 함께 볼 수 있다.
