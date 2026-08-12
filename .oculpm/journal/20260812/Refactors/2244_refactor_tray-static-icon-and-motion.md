---
schema_version: 1
type: refactor
slug: tray-static-icon-and-motion
status: done
created_at: 2026-08-12T22:44:47+09:00
session_id: "manual-20260812-224447"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/features/onboarding/home/projectAppearance.ts
    op: update
  - path: src/styles/tokens.css
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/features/onboarding/home.css
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260812/Features_to_add/2224_feature_project-appearance.md
tags: [tray, motion, icons, a11y]
---

[x] 트레이 회전 애니메이션 제거 · 아이콘 교체 · 모션 곡선 재조율

## 동기

사용자 피드백 셋. ① 메뉴바 아이콘이 세션 중 계속 도는 게 거슬린다 ② 내가 직접 그린 프로젝트 아이콘이 이상하다 ③ 모션이 부자연스럽다.

## 변경 요약

### ① 트레이 회전 제거

애니메이션 루프뿐 아니라 **위상 인자 자체를 제거**했다 (`render_frame(pulse, attention)` → `render_icon(attention)`, `Ring.dir` 필드, `PULSE_FRAMES`/`PULSE_TICK_MS`/`RECONCILE_EVERY`). 인자만 남겨 두면 언젠가 다시 돌게 된다.

트레이는 이제 2상태다: 유휴(정적) / 주의(점). **"세션이 돈다" 는 신호를 잃지는 않았다** — 팝오버의 "세션 N 활성" 줄과 탭 스트립의 활동 점에 그대로 있다. 유령 세션 정리(`reconcile_active`)는 남겼다: 아이콘은 안 돌지만 활성 집합이 부풀면 주의 신호 판정이 어긋난다.

회귀 방지 테스트는 "위상을 줘도 같은 그림" 이 아니라 **`icon_is_deterministic_and_static`** 으로 뒀다 — 위상 인자가 다시 생기면 컴파일부터 깨진다.

### ② 아이콘 — 직접 그리기를 되돌렸다

15px 에서 고양이가 눈처럼, 선인장이 막대사탕처럼, 꽃이 민들레처럼 보였다. **작은 크기의 선화는 곡률·간격이 조금만 어긋나면 다른 물건이 된다** — 내가 좌표를 눈으로 확인할 수 없는 조건에서 할 작업이 아니었다.

lucide 의 검증된 10종으로 교체: 고양이 · 토끼 · 유령 · 로켓 · 새싹 · 아이스크림 · 커피 · 도넛 · 물고기 · 보석. 고르는 기준은 그대로 **실루엣 구별**(뾰족·긴귀·물결·삼각·기둥·고리).

### ③ 모션

토큰을 다시 잡았다.

| | 이전 | 이후 | 왜 |
|---|---|---|---|
| `--dur-1` | 120ms | **90ms** | hover 즉답용. 120ms 는 "클릭 반응" 으로 읽히기 시작하는 경계다 |
| `--ease-out` | `.22,.61,.36,1` | **`.16,.84,.24,1`** | 초반 가속이 완만해 "미끄러지는" 느낌이었다. 첫 30% 에 거리 절반 이상을 소화하고 길게 정착시킨다 |
| `--ease-spring` | `.34,1.25,.4,1` | **`.2,1.12,.3,1`** | 오버슈트 1.25 는 팝오버가 튀어 장난스러웠다 |
| `--ease-in-out` | 없음 | **신규** | 왕복(레이아웃 이동)용 대칭 곡선 |

개별 조정 셋: 카드의 **그림자만 한 박자 길게**(색과 같은 시간이면 깊이가 색을 못 따라잡아 어긋나 보인다), 탭 활동 점 펄스에 중간 키프레임 추가(두 지점만 두면 선형 페이드 = 깜빡임), 스켈레톤 시머 주기 1.4→1.8초(등속은 무한 반복이라 맞지만 조급했다).

## 검증

`pnpm typecheck` · `pnpm test`(738) · `pnpm lint` · `pnpm build`(+CSS 가드) · `cargo test`(552 단위 + 12스위트 0실패) 전부 exit 0.

## 메모

- 회전 제거로 죽은 코드가 함께 드러났다 — `open_window_count`/`window_count` 는 창 종료 판정이 트레이로 옮겨간 뒤 아무도 안 부르고 있었다. 같이 지웠다.
- **모션은 눈으로 확인하지 못했다.** 곡선 값의 근거는 설명할 수 있지만 실제 감각은 실기기에서 봐야 한다.
- ②의 교훈: 검증 수단이 없는 영역(픽셀 좌표)에서는 직접 만들기보다 검증된 자산을 쓰는 편이 낫다. 두 번 만에 되돌렸다.
