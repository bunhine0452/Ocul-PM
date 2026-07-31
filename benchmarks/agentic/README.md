# B2 — 에이전틱 A/B 벤치마크

Ocul-PM 규칙 주입의 **비용**(토큰·턴·시간)과 **효과**(과제 성공 무손상 + 기록 준수율)를
같은 과제를 두 팔로 풀게 해 측정한다.

> **정직성 규범: 측정하지 않은 수치를 쓰지 않는다.** 원본 JSON 에 없는 필드는 리포트에
> "—" 로 남는다. 일지가 안 남았으면 "안 남았다"가 측정값이다.

## 팔 정의

| 팔 | 환경 |
|---|---|
| **A (대조)** | 순정 `claude` 헤드리스 세션 — 규칙 주입 없음 |
| **B (처치)** | `oculpm-mcp project_init` 실제 제품 경로로 `.oculpm/` + AGENTS.md(v8) 스캐폴드 + `--plugin-dir plugin/oculpm` (훅 브리지 + 플랜 컨텍스트 주입 + oculpm MCP 도구) |

두 팔 모두 동일한 합성 대상 프로젝트(`target-template/` — 작은 TS 라이브러리 + vitest,
lockfile 커밋으로 의존성 결정성)에서 동일한 티켓 프롬프트를 받는다. 티켓 프롬프트는
**일지 작성을 언급하지 않는다** — 그건 규칙이 시켜야 하는 일이고, 그게 측정 대상이다.

## 오염 격리

- `--setting-sources project,local` — user 스코프(머신 전역 플러그인·규칙) 차단.
  벤치 workdir 에는 project/local 설정이 없으므로 A 팔은 순정 상태가 된다.
- workdir 는 리포 밖 scratch 경로 강제 (`run-bench.sh` 가 리포 내부 경로를 거부).
- B 팔 스캐폴드는 **베이스라인 커밋 전에** 수행 — 에이전트 변경량(numstat)에 스캐폴드가
  섞이지 않는다. `.oculpm/` 제외 numstat 을 별도 집계(`numstat_code`)한다.
- 검증: 리포트의 "격리 신호" 표 — A 팔 raw JSON 의 `oculpm` 언급 수(0 이어야)와
  workdir 의 `.oculpm` 존재 여부.
- 한계: `~/.claude/CLAUDE.md`(user 메모리)와 머신 관리 설정은 CLI 플래그로 차단하지
  못할 수 있다 — 두 팔에 동일하게 적용되므로 팔 간 비교는 유효하다.

## 티켓 (target-template/tickets.json)

| id | type | 내용 | 판정 |
|---|---|---|---|
| t1 | bug | median 짝수 길이 결함 (심어둔 레드 테스트) | `vitest run tests/t1` + base 그린 |
| t2 | bug | slugify 연속 공백·특수문자 결함 | `vitest run tests/t2` + base 그린 |
| t3 | feature | parseRange 미구현 스텁 | `vitest run tests/t3` + base 그린 |
| t4 | feature | formatDuration 미구현 스텁 | `vitest run tests/t4` + base 그린 |
| t5 | refactor | histogram 을 src/histogram.ts 로 분리 | base 그린 + 구조 grep |
| t6 | chore | tsconfig strict 켜기 (+타입 오류 수리) | grep + `tsc --noEmit` + base 그린 |

베이스라인 상태(커밋된 템플릿): base.test.ts 7 그린 / t1~t4 레드 / `tsc --noEmit` 그린
(strict 켜면 TS7006 1건 — t6 의 실작업).

## 지표

- **비용**: `num_turns`, `duration_ms`/`duration_api_ms`, usage 토큰(input/output/cache
  read/cache write), `total_cost_usd` — 전부 claude JSON 원본 그대로.
- **효과 (무손상)**: 티켓별 `check` 셸 명령 exit 0 여부 (팔 간 성공률 비교).
- **효과 (준수, B 팔만)**: 일지 존재 / §2 frontmatter 규격(schema_version·type·slug·
  status·created_at `+HH:MM` offset·session_id·agent id/version 매핑·language·
  verified_by_user·files_touched `[{path,op}]`) 정규식 검증 / files_touched ↔
  `git diff` 파일 목록 겹침(정직성 프록시).

## 재현

```bash
# 스모크 (티켓 1개, 두 팔 각 1회)
./run-bench.sh --arm A --ticket t1 --rep 1 --workdir /tmp/bench-work --runid smoke
./run-bench.sh --arm B --ticket t1 --rep 1 --workdir /tmp/bench-work --runid smoke
node score.mjs smoke

# 본실행 (2팔 × 6티켓 × n=2 = 24세션)
./run-bench.sh --all --reps 2 --workdir /tmp/bench-work
node score.mjs
```

요구: `claude` CLI(2.1.220+ 검증), `pnpm`, `jq`, `rsync`, `oculpm-mcp` debug 빌드
(`src-tauri/target/debug/oculpm-mcp` — `OCULPM_MCP_BIN` 으로 교체 가능).
모델/타임아웃: `BENCH_MODEL`(기본 sonnet) / `BENCH_TIMEOUT`(기본 600초).

## 산출 구조

```
results/raw/<runid>/<arm>-<ticket>-<rep>.json        # claude JSON 원본
results/raw/<runid>/<arm>-<ticket>-<rep>.meta.json   # 판정·numstat·시각·일지 목록
results/raw/<runid>/<arm>-<ticket>-<rep>.oculpm/     # B 팔 일지·플래너 사본
results/raw/<runid>/<arm>-<ticket>-<rep>.{check,stderr,numstat,scaffold}.txt
results/<YYYY-MM-DD>-agentic.md                      # score.mjs 리포트
```

`results/raw/` 는 gitignore 대상(세션 원본·비결정 출력). 리포트(.md)는 커밋 가능.
