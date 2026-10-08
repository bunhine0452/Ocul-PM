---
schema_version: 1
type: chore
slug: "external-review-scope-freeze"
status: done
difficulty: medium
created_at: "2026-10-08T17:57:15+09:00"
session_id: "20261008-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".gitattributes"
    op: update
  - path: "SECURITY.md"
    op: create
  - path: "scripts/bump-version.mjs"
    op: update
  - path: "src/__tests__/bump_version.test.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "security"
  - "release"
  - "external-review"
  - "scope"
  - "mcp-tool"
---
[x] 외부 코드 리뷰 수용 — 범위 동결 · 리뷰 주기화 · 생성물 diff 접기 (PR #75)

## 대조
외부 리뷰의 지적 넷을 저장소 실측으로 대조했다. 과장은 한 곳뿐이다 — 「주변 기능 각각이 독립 제품 규모」. 실제로는 Notion 0.9k · DAP 3.1k · 모바일 3.5k 줄의 얇은 연동이다. 다만 주변을 다 합치면(≈8.4만 줄) 핵심인 일지·플래너·Today(≈7.9만 줄)와 맞먹고, 60일 fix 커밋 211건 중 95건이 주변, 80건이 핵심을 건드렸다. 결론은 맞다.
- 공동 저자: 커밋 1,166/1,263 · 31만 줄(Rust 15.5만 + TS 14.8만 + CSS 1.8만) · 스타 7 · 포크 2 — 사실.
- 외부 리뷰가 찾은 결함: v3.2.0 · v3.8.0 · v3.9.0 노트가 스스로 그렇게 적고 있다. 심볼릭 링크 방어는 그 전에 창구 하나씩 세 번(v2.13.2 · v2.44.1 · v3.5.0) 덧대졌다.
- 버스 팩터: 커밋 1,257/1,263 이 한 사람이다. 데이터가 `.oculpm/` 마크다운이라 잠기지 않으므로 조치 없이 수용.
- unwrap/expect: 전체 3,509 중 프로덕션은 41, 대부분 락 poisoning 의 `expect`. 리뷰 판정이 맞다.

## 변경
- `.gitattributes` — `bindings.ts`(6,579줄, 192커밋이 건드림)와 `build.mjs` 생성물 넷을 `linguist-generated` 로.
- `SECURITY.md` 신규 — 비공개 신고 창구, 경계 넷(프로젝트 · 송출 · 비밀 · 기기 동의)과 지키는 자리, 듣는 자리 둘(모바일 Tailscale · Notion OAuth 루프백 3분), 외부 리뷰 이력 표. GitHub private vulnerability reporting 을 켰다(`enabled:true` 확인).
- `bump-version.mjs` — 이력 표 「반영」 칸의 최고 버전에서 마이너 5개째면 경고(막지 않음 — 리뷰어는 기계가 부를 수 있는 자원이 아니다). 표를 못 읽으면 그 사실을 경고하고, 「다음 릴리스」 는 이번 버전으로 채운다. 리뷰 칸의 「v3.8.0 이 막지 못한…」 이 반영 버전으로 읽히지 않게 마지막 칸만 읽는다. RELEASE.md §0-1.
- `CLAUDE.md` 범위 동결 — 새 화면 · 외부 연동 · 상주 리스너 금지, 수정 · 축소 · 교체는 허용, 교체는 옛 경로 제거로 끝.
- 플랜: `external-review-2026-10-08` 신규(걷기 후보 6 · native P3/P4 결정 · 다음 리뷰). improvement-round-2026-09-14 확장 백로그 5건 보류.

## 검증
origin/main 워크트리에서 typecheck · lint · test(253파일 3,275건) · build 모두 exit 0. bump-version dry-run 이 「다음 릴리스」 를 채우는 것을 확인했다. PR #75 CI 3잡 SUCCESS → rebase 머지(680ef167).

## 메모
- 사용 원격측정이 설계상 없어서 걷기 후보의 사용 신호는 사용자만 안다. 로그(INFO)에도 DAP · LSP · 모바일 사용 흔적이 남지 않는다. 수치는 비용(줄 · fix)뿐이다.
- 주변의 버그 부하는 터미널(60일 fix 33) · ACP(32)에 몰려 있다. DAP · Notion · 모바일은 fix 가 적다 — 걷어도 버그 부하는 별로 줄지 않고, 줄어드는 건 공격 표면과 유지 부담이다.
- improvement-round 의 #notion-oauth 는 `notion_oauth_start` 가 이미 있어 낡은 항목으로 보인다. 손대지 않았다.