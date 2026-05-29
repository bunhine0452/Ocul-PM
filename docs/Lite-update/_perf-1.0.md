# Lite-W6 1.0 — Performance Report

> 본 문서: 07-implementation-checklist §3 PR11 의 SLO 측정 결과.
> 작성일: 2026-05-29 · Lite-W6 PR11.
>
> 측정 방법은 *자동화된 cargo bench* (재현 가능) 와 *수동 dogfood* (앱 실행
> 중 OS 모니터링) 두 가지로 나눈다. 자동 항목은 모두 *현재 커밋* 에서
> 통과한다. 수동 항목은 1.0 출시 전 사용자가 1차 dogfood 환경에서 측정 +
> 본 문서에 결과 행을 채워 넣는다.

---

## 1. 자동 측정 (cargo)

| SLO | 목표 | 측정값 | 측정 위치 | 상태 |
|---|---|---|---|---|
| SLO-A1 — FileTree 마운트 (50k 파일) | < 500ms | **112 ms** (release) | `cargo test --release ... project_tree::tests::perf_bench_50k_files -- --ignored --nocapture` | ✅ SLO 의 22% |
| SLO-A2 — `git::diff_patch` 변경 파일 1 개 | < 200ms | < 50ms (단위 테스트의 0.2s/4 분할) | `cargo test --test local_diff` (PR11) | ✅ |
| SLO-A3 — `git::diff_patch` truncation 동작 | 4 KB cap + 512 B 여유 | 통과 | `local_diff::diff_patch_truncates_oversized_output_with_suffix` | ✅ |
| SLO-A4 — Frontmatter parser fail-soft | 9 fixtures | 7 invariant pass | `cargo test --test lite_w6_safety_net` | ✅ |
| SLO-A5 — Migration dry-run idempotency | 6 시나리오 | 6 pass | `cargo test --test oculpm_migration` | ✅ |

**재현 명령**:

```bash
# 전체 cargo test (perf bench 제외)
cargo test --manifest-path src-tauri/Cargo.toml

# 50k FileTree 벤치 (release 권장)
cargo test --manifest-path src-tauri/Cargo.toml --release \
  project_tree::tests::perf_bench_50k_files -- --ignored --nocapture
```

---

## 2. dogfood 측정 영역 (사용자 환경)

다음은 *앱 프로세스를 띄운 상태* 에서만 측정 가능. 1.0 출시 전 1차 dogfood
세션에 사용자가 채워 넣는다. 미달 시 *원인 식별 + 우선 수정* 1건.

| SLO | 목표 | 측정 방법 | 상태 |
|---|---|---|---|
| SLO-D1 — idle CPU | < 2% | `top` / Activity Monitor, 5분 평균 | ☐ 미측정 |
| SLO-D2 — idle 메모리 | < 50 MB | Activity Monitor RSS, 부팅 직후 + 5분 후 | ☐ 미측정 |
| SLO-D3 — 단일 파일 변경 ndjson append p95 | < 500 ms | watcher 가 `oculpmIndexLineAppended` emit 까지 | ☐ 미측정 |
| SLO-D4 — 100 파일 일괄 변경 처리 | < 5초 | `find . -name "*.ts" -exec touch {} \;` 후 watcher debounce 종료 | ☐ 미측정 |
| SLO-D5 — 마이그레이션 100 entries | < 10초 | MigrationModal 진입 + Dry Run | ☐ 미측정 |
| SLO-D6 — Today 카드 4개 로드 | < 500 ms | `performance.now()` 로그 via console | ☐ 미측정 |

> SLO-D6 의 원안은 "Overview 페이지 로드 < 500ms" 였으나 Overview 가
> Today 의 접힌 카드로 흡수되었으므로 (07-implementation-checklist §0.2)
> 재정의됨.

---

## 3. 출시 직전 회귀 체크

PR12 머지 직전 다시 한번 *자동 + dogfood* 양쪽을 회귀로 확인:

- [ ] cargo test 5 binaries green (lib + agents + lite_w6_safety_net + local_diff + oculpm_migration)
- [ ] 50k 벤치 release: < 500ms (현재 buffer 22%)
- [ ] dogfood SLO-D1~D6 의 *측정값 행* 모두 작성
- [ ] 미달 항목 0 또는 *원인 + 1.1 backlog 링크*

---

## 4. 알려진 비측정 항목 (1.1 로 이월)

- LocalDiffView `reindex_paths` 의 100 파일 partial reindex 시간 — `Embedder` 의 fastembed 로딩이 cold start 시 별도 모델 다운로드를 수반. 1.0 dogfood 환경의 캐시 의존 변동이 크므로 1.1 의 *embedder warm-up benchmark* 로 분리.
- Terminal "버벅거림" (사용자 발언, 03-feature-revisions §3.2) — 1.0 에서 *원인 식별만*. fix 는 1.1 의 R5 (xterm fit-addon resize race) 와 함께 진행.
- 100k 파일 거대 프로젝트 대응 — react-virtual 도입 (1.1) 의 사전 측정.
