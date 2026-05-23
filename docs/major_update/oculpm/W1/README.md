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
- `phases/W1-foundation.md` §6 의 Definition of Done 7개 항목 ✅ (아래 §6 verification)
- W2 의 선행 조건 (`phases/W1-foundation.md` §7) 5개 ✅ (아래 §7 handoff)

---

## §6 DoD verification (페이즈 가이드 §6 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| 모든 PR 의 DoD ✅ | ✅ | PR1~PR8 워킹 doc 의 DoD 체크박스 전수 ✅ |
| §4 의 수동 QA 11개 항목 | ✅ (PR 노트 분산) | PR6/PR7/PR8 의 실행 노트에 분산 검증 — 회귀 0, `.oculpm/` 생성/lock/.gitignore/두 윈도우/강제 종료/clippy/build 검증 흔적 존재 |
| `cargo test --workspace` green | ✅ | 46/46 oculpm tests + 기존 회귀 0 (`cargo test --lib oculpm::` 1.07s) |
| `cargo clippy -- -D warnings` green (oculpm 격리) | ✅ | oculpm 영역 lint **0건**. 워크스페이스 차원 35 warnings 잔존 — 모두 main 브랜치 pre-existing (`changelog.rs::unused_mut`, `db.rs::dead_code` 등), oculpm 외부 → W1 책임 외. 전체 `-D warnings` 강제는 별도 워크스페이스-wide cleanup PR 로 분리 (W6 stabilize 후보) |
| `pnpm tauri build` green (macOS dmg) | ✅ | PR7 §실행 노트: 28.11s 에 `ai-pm_0.1.0_aarch64.dmg` 생성 |
| 신규 public item `///` doc | ✅ (의도적 예외 1건) | `atomic_io / config / error / lock / manager / paths / commands::oculpm` 모두 doc 부착. `spec.rs` 의 ~47개 type 은 의도적으로 per-type doc 생략 — 모듈 doc 에 "각 type 은 `00-spec.md` 의 직접 port; per-type paraphrase 는 drift 위험" 명시 |
| `00-spec.md` 와 구현 일치 (특히 ndjson 4 KB 캡) | ✅ | `00-spec.md §4.3` 에 "한 라인 ≤ 4096 바이트 + path-truncated 보정" 불변식 추가, 코드 `NDJSON_LINE_CAP` const 와 cross-reference |

---

## §7 W2 선행 조건 handoff (페이즈 가이드 §7 기준)

| 항목 | 상태 | 위치 |
|---|---|---|
| `OculpmManager` + `ProjectEntry` (watcher/session_actor 빈 자리) 살아있음 | ✅ | `src-tauri/src/oculpm/manager.rs` — 현재 `ProjectEntry { root, config, resolver, lock }`. W2 가 `watcher`, `session_actor` 필드 추가 예정 (PR7 §넘기는 메모 참조) |
| `WorkdayResolver` 정상 동작 | ✅ | `src-tauri/src/oculpm/paths.rs` — 12 단위 테스트 그린. `workday_of`, `next_boundary`, `local_boundary_utc` (DST gap 안전) 검증 |
| `atomic_io::append_ndjson` 동작 | ✅ | `src-tauri/src/oculpm/atomic_io.rs` — `NDJSON_LINE_CAP=4096`, `append_ndjson` 의 single-line atomic write + fsync. 동시 호출 / 4 KB 경계 / newline 거부 3 케이스 그린 |
| `LockGuard` 정상 동작 (W2 워처 시작 시 lock 검증) | ✅ | `src-tauri/src/oculpm/lock.rs` — `acquire/Held/Recovered`, heartbeat, RAII drop 모두 검증 |
| `OculpmConfig.watcher` / `.session` 살아있고 검증 | ✅ | `src-tauri/src/oculpm/config.rs` — `validate()` 가 `debounce_ms 1..=10000`, `inactivity_timeout_minutes ≥ 1` 등 확인. 라운드트립 + invalid tz 거부 그린 |

→ 5/5 ✅ — **W2 진입 가능**.

---

## 페이즈 회고

- **예상 대비 실제 소요**: 8개 PR 모두 가이드의 예측 범위 안에서 완료. 예상보다 빨랐던 항목 = PR3 (chrono-tz + DST 처리가 `from_local_datetime().earliest()` 1줄로 해결), PR5 (atomic_io 의 managed_block 매처가 정규식 없이 line-iterator + comment-strip 으로 단순). 예상보다 길었던 항목 = PR6 (specta + tauri-specta 의 `app.manage()` 등록 위치 디버깅), PR7 (Tauri 2 의 `.build().run(callback)` 분리 패턴 발견).

- **발견된 함정 vs 가이드 예측**:
  - 가이드가 맞춘 것 — Windows CRLF 보존 (PR5/PR8 모두 그대로 적용), `chrono_tz` 빌드 시간, advisory lock 의 의미.
  - 가이드가 못 잡은 것 (PR7 #1) — `commands/project.rs::open_project` 백엔드 커맨드가 main 에 없음. 프론트 `useEffect` 로 우회 — 더 단순한 통합으로 귀결.
  - 가이드가 못 잡은 것 (PR6 #1) — `OculpmManager` 에 `AppHandle` 미보유. W2 에서 emit 이 필요해질 때 함수 인자로 통과하기로 결정.
  - 가이드가 못 잡은 것 (PR8 §5 #1) — managed_block 실패 시 직전 LockGuard 회수 누락 위험. `drop(guard)` 명시 + 테스트로 검증.

- **W2 로 넘기는 결정/주의**:
  1. `OculpmManager` 에 `AppHandle` 주입 시점 — W2-PR5 (이벤트 emit) 에서 결정. 함수 인자 vs weak handle 보유 둘 중 하나.
  2. inotify 한도 대응 — W2-PR3 §6 에 (b) recursive root + `should_track` 채택 명시. W6 성능 측정 후 (a) WalkBuilder 화이트리스트로 전환 가능.
  3. clippy `-D warnings` workspace-wide green — 본 W1 의 책임 외로 두기로 결정 (oculpm 격리는 0건). W6 stabilize 페이즈에서 별도 cleanup PR.
  4. `spec.rs` 의 per-type doc 의도적 생략 — 모듈 doc 의 SSOT 노트 유지. W3/W4 에서 새 타입 추가 시 같은 정책 따름.
  5. ndjson 4 KB 캡 — `00-spec.md §4.3` 와 코드 `NDJSON_LINE_CAP` 가 SSOT. W2-PR1 의 `IndexWriter::append_file_change` 에서 단축 로직은 호출자 (Watcher) 책임으로 분리 — PR3 워킹 doc §3 에 명시.
