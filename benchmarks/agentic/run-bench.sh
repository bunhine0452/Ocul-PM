#!/bin/bash
# run-bench.sh — B2 에이전틱 A/B 벤치마크 실행기
#
# 목적: Ocul-PM 규칙 주입(AGENTS.md v8 + Claude Code 플러그인)의 비용(토큰·턴·시간)과
# 효과(과제 성공 무손상 + 기록 준수)를 같은 과제 2팔 비교로 측정한다.
#
#   A 팔: 순정 claude 헤드리스 세션 (규칙 주입 없음)
#   B 팔: project_init 스캐폴드(.oculpm/ + AGENTS.md v8) + oculpm 플러그인(--plugin-dir)
#
# 사용:
#   ./run-bench.sh --arm A --ticket t1 --rep 1 --workdir /path/to/scratch
#   ./run-bench.sh --all --reps 2 --workdir /path/to/scratch
#
# 옵션 환경변수:
#   BENCH_MODEL   (기본 sonnet)   BENCH_TIMEOUT (기본 600초)
#   OCULPM_MCP_BIN (기본 리포 debug 빌드)
#
# 산출: results/raw/<runid>/<arm>-<ticket>-<rep>.json (claude JSON 원본)
#       + .meta.json / .check.txt / .stderr.txt / .numstat.txt / .oculpm/ (B 팔 일지 사본)
set -u

BENCH_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"
TEMPLATE_DIR="$BENCH_DIR/target-template"
TICKETS="$TEMPLATE_DIR/tickets.json"
PLUGIN_DIR="$REPO_ROOT/plugin/oculpm"
MCP_BIN="${OCULPM_MCP_BIN:-$REPO_ROOT/src-tauri/target/debug/oculpm-mcp}"
MODEL="${BENCH_MODEL:-sonnet}"
TIMEOUT_SECS="${BENCH_TIMEOUT:-600}"

die() { echo "오류: $*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

# ─── 인자 파싱 ───────────────────────────────────────────────────────────────
ARM="" TICKET="" REP=1 REPS=1 WORKDIR="" ALL=0 RUNID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --arm)     ARM="$2"; shift 2 ;;
    --ticket)  TICKET="$2"; shift 2 ;;
    --rep)     REP="$2"; shift 2 ;;
    --reps)    REPS="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --runid)   RUNID="$2"; shift 2 ;;
    --all)     ALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "알 수 없는 인자: $1 (--help 참조)" ;;
  esac
done

[ -n "$WORKDIR" ] || die "--workdir 는 필수입니다 (레포 오염 금지 — scratch 경로를 쓰세요)"
case "$WORKDIR" in
  "$REPO_ROOT"*) die "--workdir 가 리포 내부입니다 — 리포 밖 scratch 경로를 쓰세요" ;;
esac
if [ "$ALL" -eq 0 ]; then
  [ -n "$ARM" ] && [ -n "$TICKET" ] || die "--arm 과 --ticket 이 필요합니다 (또는 --all)"
  case "$ARM" in A|B) ;; *) die "--arm 은 A 또는 B" ;; esac
fi

command -v claude >/dev/null || die "claude CLI 가 없습니다"
command -v pnpm   >/dev/null || die "pnpm 이 없습니다"
command -v jq     >/dev/null || die "jq 가 없습니다"
command -v rsync  >/dev/null || die "rsync 가 없습니다"
[ -f "$TICKETS" ] || die "tickets.json 이 없습니다: $TICKETS"
[ -f "$TEMPLATE_DIR/pnpm-lock.yaml" ] || die "템플릿 lockfile 이 없습니다 (결정성 요건)"

RUNID="${RUNID:-$(date +%Y%m%d-%H%M%S)}"
RAW_DIR="$BENCH_DIR/results/raw/$RUNID"
mkdir -p "$RAW_DIR" "$WORKDIR"

# macOS 기본에는 timeout(1) 이 없다 — perl alarm 으로 대체 (타임아웃 시 exit 142).
with_timeout() { perl -e 'alarm shift; exec @ARGV' "$TIMEOUT_SECS" "$@"; }

# ─── B 팔 스캐폴드: 실제 제품 경로(oculpm-mcp project_init)로 .oculpm/ 생성 ──
scaffold_oculpm() {
  local dir="$1" log="$2" out
  [ -x "$MCP_BIN" ] || { echo "oculpm-mcp 바이너리가 없습니다: $MCP_BIN (cargo build 필요)" >&2; return 1; }
  out=$(printf '%s\n%s\n%s\n' \
    '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bench-harness","version":"0.1"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"project_init","arguments":{"confirm":true}}}' \
    | "$MCP_BIN" --root "$dir" 2>>"$log")
  printf '%s\n' "$out" >> "$log"
  if [ ! -d "$dir/.oculpm" ] || [ ! -f "$dir/AGENTS.md" ]; then
    echo "B 팔 스캐폴드 실패 — project_init 이 .oculpm/AGENTS.md 를 만들지 못했습니다. 로그: $log" >&2
    return 1
  fi
  return 0
}

# ─── 단일 실행 ───────────────────────────────────────────────────────────────
run_one() {
  local arm="$1" ticket="$2" rep="$3"
  local name="${arm}-${ticket}-${rep}"
  local run_dir="$WORKDIR/$name"
  local prompt check
  prompt=$(jq -er --arg id "$ticket" '.[] | select(.id==$id) | .prompt' "$TICKETS") \
    || die "티켓 '$ticket' 을 tickets.json 에서 찾지 못했습니다"
  check=$(jq -er --arg id "$ticket" '.[] | select(.id==$id) | .check' "$TICKETS")

  echo "══ [$name] 준비 → $run_dir"
  rm -rf "$run_dir"
  mkdir -p "$run_dir"
  rsync -a --exclude node_modules --exclude .git "$TEMPLATE_DIR/" "$run_dir/"

  if [ "$arm" = "B" ]; then
    scaffold_oculpm "$run_dir" "$RAW_DIR/$name.scaffold.txt" || die "[$name] 스캐폴드 중단"
  fi

  git -C "$run_dir" init -q
  git -C "$run_dir" config user.name "bench"
  git -C "$run_dir" config user.email "bench@bench.local"
  git -C "$run_dir" add -A
  git -C "$run_dir" commit -qm "baseline" || die "[$name] 베이스라인 커밋 실패"

  (cd "$run_dir" && pnpm install --frozen-lockfile --silent) || die "[$name] pnpm install 실패"

  local raw="$RAW_DIR/$name.json" errlog="$RAW_DIR/$name.stderr.txt"
  local args=( -p "$prompt" --output-format json --setting-sources project,local \
               --dangerously-skip-permissions --model "$MODEL" )
  [ "$arm" = "B" ] && args+=( --plugin-dir "$PLUGIN_DIR" )

  echo "── [$name] claude 세션 시작 (팔 $arm, 타임아웃 ${TIMEOUT_SECS}s)"
  local started ended claude_exit
  started=$(date +%s)
  if [ "$arm" = "B" ]; then
    (cd "$run_dir" && OCULPM_MCP_BIN="$MCP_BIN" with_timeout claude "${args[@]}") >"$raw" 2>"$errlog"
    claude_exit=$?
  else
    (cd "$run_dir" && with_timeout claude "${args[@]}") >"$raw" 2>"$errlog"
    claude_exit=$?
  fi
  ended=$(date +%s)
  local wall=$((ended - started))
  local timed_out=false
  [ "$claude_exit" -eq 142 ] && timed_out=true

  echo "── [$name] 성공 판정: $check"
  local check_exit
  (cd "$run_dir" && sh -c "$check") >"$RAW_DIR/$name.check.txt" 2>&1
  check_exit=$?
  local success=false
  [ "$check_exit" -eq 0 ] && success=true

  # 변경량: intent-to-add 로 untracked 포함 numstat
  git -C "$run_dir" add -A -N
  git -C "$run_dir" diff --numstat HEAD >"$RAW_DIR/$name.numstat.txt"
  local numstat_total numstat_code changed_files
  numstat_total=$(awk -F'\t' '{f+=1; a+=$1; d+=$2} END {printf "{\"files\":%d,\"insertions\":%d,\"deletions\":%d}", f, a, d}' "$RAW_DIR/$name.numstat.txt")
  numstat_code=$(git -C "$run_dir" diff --numstat HEAD -- . ':(exclude).oculpm' \
    | awk -F'\t' '{f+=1; a+=$1; d+=$2} END {printf "{\"files\":%d,\"insertions\":%d,\"deletions\":%d}", f, a, d}')
  changed_files=$(cut -f3 "$RAW_DIR/$name.numstat.txt" | jq -R . | jq -s .)

  # B 팔: 일지·플래너 산출물 사본 (준수 채점용 — 없으면 없다고 기록한다)
  local journal_files="[]" oculpm_captured=false
  if [ "$arm" = "B" ]; then
    local cap="$RAW_DIR/$name.oculpm"
    rm -rf "$cap"; mkdir -p "$cap"
    [ -d "$run_dir/.oculpm/journal" ] && cp -R "$run_dir/.oculpm/journal" "$cap/journal" && oculpm_captured=true
    [ -d "$run_dir/.oculpm/planner" ] && cp -R "$run_dir/.oculpm/planner" "$cap/planner"
    journal_files=$( (cd "$run_dir" && find .oculpm/journal -type f -name '*.md' 2>/dev/null | sort) | jq -R . | jq -s .)
  fi
  local oculpm_dir_exists=false
  [ -d "$run_dir/.oculpm" ] && oculpm_dir_exists=true

  jq -n \
    --arg runid "$RUNID" --arg arm "$arm" --arg ticket "$ticket" --argjson rep "$rep" \
    --arg model "$MODEL" --arg workdir "$run_dir" \
    --argjson started "$started" --argjson ended "$ended" --argjson wall_secs "$wall" \
    --argjson claude_exit "$claude_exit" --argjson timed_out "$timed_out" \
    --arg check_cmd "$check" --argjson check_exit "$check_exit" --argjson success "$success" \
    --argjson numstat_total "$numstat_total" --argjson numstat_code "$numstat_code" \
    --argjson changed_files "$changed_files" \
    --argjson journal_files "$journal_files" --argjson oculpm_dir_exists "$oculpm_dir_exists" \
    --argjson oculpm_captured "$oculpm_captured" \
    '{runid: $runid, arm: $arm, ticket: $ticket, rep: $rep, model: $model, workdir: $workdir,
      started: $started, ended: $ended, wall_secs: $wall_secs,
      claude_exit: $claude_exit, timed_out: $timed_out,
      check_cmd: $check_cmd, check_exit: $check_exit, success: $success,
      numstat_total: $numstat_total, numstat_code: $numstat_code, changed_files: $changed_files,
      journal_files: $journal_files, oculpm_dir_exists: $oculpm_dir_exists,
      oculpm_captured: $oculpm_captured}' \
    >"$RAW_DIR/$name.meta.json"

  echo "── [$name] 완료: success=$success claude_exit=$claude_exit wall=${wall}s → $RAW_DIR/$name.json"
}

# ─── 실행 ────────────────────────────────────────────────────────────────────
echo "runid=$RUNID  model=$MODEL  raw=$RAW_DIR"
if [ "$ALL" -eq 1 ]; then
  for t in $(jq -r '.[].id' "$TICKETS"); do
    for arm in A B; do
      rep=1
      while [ "$rep" -le "$REPS" ]; do
        run_one "$arm" "$t" "$rep"
        rep=$((rep + 1))
      done
    done
  done
else
  run_one "$ARM" "$TICKET" "$REP"
fi
echo "완료. 집계: node $BENCH_DIR/score.mjs $RUNID"
