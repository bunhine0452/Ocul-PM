---
schema_version: 1
type: chore
slug: "docs-catch-up-with-notarization"
status: done
difficulty: low
created_at: "2026-09-08T12:52:05+09:00"
session_id: "20260908-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/RELEASE.md"
    op: update
  - path: "docs/launch/channels.md"
    op: update
  - path: "docs/Lite-update/06-release-1.0-plan.md"
    op: correct
  - path: "docs/20260607_dogfooding/02-implementation-checklist.md"
    op: correct
  - path: "landing/wiki-src/getting-started.md"
    op: update
  - path: "landing/wiki-src/en/getting-started.md"
    op: update
related: []
tags:
  - "docs"
  - "release"
  - "notarization"
  - "wiki"
  - "mcp-tool"
---
[x] 공증이 끝났다 — 무서명 시절을 말하던 문서를 정정했다

## 동기

v2.45.0 이 첫 Developer ID 서명·공증 배포였고 README ko/en 과 랜딩은 그때 함께 고쳐졌다. 그런데 **그 밖의 문서 여럿이 아직 "공증 전이라 `xattr` 이 필요하다" 시절을 말하고** 있었다. 앱이 `./docs` 를 「문서」 화면으로 그대로 보여 주므로, 이 어긋남은 사용자 눈에도 닿는다.

## 변경 요약

**살아 있는 문서는 사실을 고쳤다** (`docs/README.md` 의 「살아 있는 설계」 표 기준).

- `docs/launch/channels.md` — Show HN 칸의 "앱(.dmg, 공증 전 xattr 필요)이 아니라…" 서술과, 추천 우선순위 6번의 "가급적 공증(로드맵 항목) 후 권장". 둘 다 v2.45.0 으로 해소된 전제였다.
- `docs/RELEASE.md` §7 — **인증서 만료 2027-02-01** 알람을 새로 넣었다. 예행연습 일지가 "릴리스 문서와 별도로 어딘가 알람이 필요하다"고 남긴 항목이다. 타임스탬프가 붙은 서명은 만료 뒤에도 유효하므로 나간 빌드는 안전하지만, 그날 이후 갱신 없이 태그를 밀면 **서명 단계가 실패하지 않고 조용히 무서명으로 떨어진다** — §6 의 `spctl` 두 줄이 그 그물이라는 것까지 적었다.
- `landing/wiki-src/getting-started.md` · `en/getting-started.md` — 설치 2단계가 "확인 창이 뜨면 열기"에서 "서명·공증본이라 경고 없이 열린다"로. `build.mjs` 재빌드 후 배포했다.

**아카이브는 본문을 남기고 어긋나는 줄에만 날짜를 박은 정정을 달았다.** 끝난 라운드의 기록을 소급해 고치면 그 문서가 무엇을 보고 결정했는지가 사라진다 (`docs/README.md` 의 "읽어도 좋지만 따르지는 말 것" 원칙).

- `docs/Lite-update/06-release-1.0-plan.md` — "가입 ✅ / ❌" 분기 아래에 정정 블록. 표의 「1.0: ad-hoc 수용 가능」 행이 더는 현재가 아니라는 것과 현행 절차의 위치.
- `docs/20260607_dogfooding/02-implementation-checklist.md` — "DMG 미서명" 한계 줄에 취소선 + 정정.

README ko/en 은 **이미 v2.45.0 에서 정리돼 있었다** (설치 문단·로드맵 모두). 확인만 하고 손대지 않았다.

## 검증

- `grep -rniE "quarantine|공증|notariz|손상되었|미서명"` 전수 — 남은 것은 CHANGELOG·랜딩 변경이력·일지(전부 그 시점의 기록)와 `docs/RELEASE.md`(현행 절차)뿐이다.
- `pnpm test` **2455 passed** (`landing_pages.test.ts` 가 위키·changelog 생성물을 함께 잰다).
- 라이브 확인 — `oculpm.com/wiki/getting-started` 와 `/wiki/en/getting-started` 둘 다 새 문구가 떠 있다.