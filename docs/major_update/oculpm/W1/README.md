# W1 — 작업 트래커

> 페이즈 명세: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W1-PR1 | Cargo 의존성 + 모듈 스켈레톤 | ✅ 완료 | [`PR1-cargo-deps-skeleton.md`](./PR1-cargo-deps-skeleton.md) |
| W1-PR2 | `spec.rs` 핵심 타입 + specta 노출 | ✅ 완료 | [`PR2-spec-types.md`](./PR2-spec-types.md) |
| W1-PR3 | `paths.rs` (`WorkdayResolver`) + 단위 테스트 | ✅ 완료 | [`PR3-workday-resolver.md`](./PR3-workday-resolver.md) |
| W1-PR4 | `config.rs` 기본값 + 검증 | ✅ 완료 | [`PR4-config.md`](./PR4-config.md) |
| W1-PR5 | `atomic_io.rs` + `lock.rs` + 단위 테스트 | ✅ 완료 | [`PR5-atomic-io-lock.md`](./PR5-atomic-io-lock.md) |
| W1-PR6 | 4개 커맨드: init / get_status / get_config / set_config | ✅ 완료 | [`PR6-init-commands.md`](./PR6-init-commands.md) |
| W1-PR7 | `OculpmManager` + lib.rs 부트스트랩 | ✅ 완료 | [`PR7-manager-bootstrap.md`](./PR7-manager-bootstrap.md) |
| W1-PR8 | `.gitignore` 관리 블록 자동 작성 | ✅ 완료 | [`PR8-gitignore-managed-block.md`](./PR8-gitignore-managed-block.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

---

## 페이즈 종료 조건

- W1 의 모든 PR 이 ✅
- `phases/W1-foundation.md` §6 의 Definition of Done 11개 항목 ✅
- W2 의 선행 조건 (`phases/W1-foundation.md` §7) 5개 ✅

---

## 페이즈 회고 (W1 끝나면 작성)

(아래 빈 칸은 W1 종료 시 채움)

- 예상 대비 실제 소요:
- 발견된 함정 vs 가이드 예측:
- W2 로 넘기는 결정/주의:
