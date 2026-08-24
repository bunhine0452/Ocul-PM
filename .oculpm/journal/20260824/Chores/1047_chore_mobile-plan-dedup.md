---
schema_version: 1
type: chore
slug: mobile-plan-dedup
status: done
difficulty: low
created_at: "2026-08-24T10:47:00+09:00"
session_id: "manual-20260824-104700"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/three-features-round.md"
    op: update
  - path: ".oculpm/planner/mobile-bridge.md"
    op: update
related:
  - "20260824/Chores/1026_chore_mobile-bridge-plan.md"
tags: [mobile, planner, dedup]
---

[x] 모바일 플랜 일원화 — three-features 구 Phase 3 삭제, mobile-bridge 로 흡수

mobile-bridge 플랜을 만든 직후 사용자가 중복을 지적: three-features-round 에
Tailscale 모바일 Phase 3(#p3-mobile, 2026-08-11 설계, 읽기 전용 안)이 이미 있었다.
원인은 새 플랜 설계 전 과거 플랜 검색(§0)을 건너뛴 것 — 검색했으면 처음부터
그 위에서 시작했을 것.

사용자 결정으로 mobile-bridge 를 단일 플랜으로 유지하고 구 Phase 3(항목 8+6)를
삭제. 단, 구 설계가 더 정교했던 결정 4건은 삭제 전 mobile-bridge 로 흡수:

- **3조건 바인드** — 100.64/10 은 ISP CGNAT 도 쓰므로 대역+점대점(/32·bcast 없음)
  +tailscale CLI 교차검증. TailscaleBindAddr newtype·local_addr 되읽기·peer IP
  가드·경계 테스트까지 (D5 재작성 + MB0 하위 항목 3개).
- **페어링 코드** — 6자리·TTL 5분·1회용 → Bearer, blake3 해시만 저장,
  029_mobile_devices.sql (028 선점 확인).
- **정적 서빙 가드** — resource_dir ServeDir + 경로 탈출 차단(secure_docs_join
  패턴) + dev 폴백.
- **검증 게이트** — tailnet 폰 성공 AND 같은 LAN 비-tailnet 기기 실패.

접근 차이는 기각 사유를 D3 에 기록: 구 안의 mobile.html 별도 엔트리(Tauri 의존 0)는
읽기 전용 전제, 신 플랜은 쓰기+훅 재사용이라 vite alias 셤 유지. R6(디스크 직독
금지)은 invoke 미러링이 자동 충족. 설계 문서 02-mobile-tailscale.md 는 참조로 유지.

## 검증

- 삭제 후 three-features-round 에 `mob-` 참조 0건 grep 확인.
- 양 플랜 frontmatter·{#id} 줄끝·plan-log 블록 경계 보존 확인.

## 메모

- 교훈: 새 플랜을 만들기 전 `.oculpm/planner/*.md` 부터 grep — §0 규칙이 정확히
  이 사고를 막으라고 있다.
