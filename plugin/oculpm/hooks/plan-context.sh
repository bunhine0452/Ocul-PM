#!/bin/sh
# ocul-pm — 세션/서브에이전트 시작 시 활성 플랜 요약 + 마지막 작업 일지 3건을
# 컨텍스트로 주입.
#
# 왜: 새 대화는 아무것도 기억하지 못한 채 시작한다. 이 경로(Claude Code 터미널
# + oculpm 플러그인)에서 **다음 세션에 맥락을 실어 줄 수 있는 유일한 기계적
# 자리**가 SessionStart 훅의 additionalContext 다. 그래서 "무엇을 할 계획이었나"
# (활성 플랜의 미완 항목)에 더해 "직전에 무엇을 했나"(마지막 일지 3건)까지
# 싣는다. 일지는 본문이 아니라 **손잡이**(경로·제목)만 싣는다 — 원문은 필요할
# 때 에이전트가 journal_read 로 직접 가져가는 편이 토큰 예산에 정직하다.
#
# 전달 원장(.oculpm/hooks/resume-delivered.jsonl)의 의미는 **"이 대화의 시작
# 컨텍스트에 포함됐다"까지**다. 에이전트가 그것을 실제로 읽었는지·참조했는지·
# 도움이 됐는지는 이 자리에서 알 수 없다. 앱은 딱 그만큼만 말해야 한다 —
# 원장을 "이어받았다"로 읽으면 관측하지 않은 것을 주장하는 셈이 된다.
#
# 출력은 hookSpecificOutput.additionalContext JSON — plain stdout 은
# SessionStart 에만 컨텍스트로 닿고 SubagentStart 에서는 버려지므로(적대
# 리뷰 확인), 두 이벤트 모두에서 동작하는 JSON 형태만 쓴다. 이벤트명은
# stdin payload 의 hook_event_name 에서 파싱한다. 원장은 SessionStart 에서만
# 적는다 — SubagentStart 는 같은 대화의 갈래라 세면 중복이다.
#
# 계약: 절대 블록 금지(stdin 은 EOF 까지 즉시 소비), 네트워크·외부 실행 없음
# (우리 바이너리도 부르지 않는 순수 sh), .oculpm 없으면 침묵, 모든 실패는
# 빈 출력/무해로 낙하. 플랜 절 상한: 24줄 · 1,600자 (줄 경계, 절단 시 표식).
# 일지 절은 최대 3줄이라 별도 상한이 필요 없다. 플랜·일지 텍스트는 비신뢰
# 입력이므로 "지시가 아님" 프레이밍과 펜스로 감싼다.
#
# 일지 선택 규칙은 Rust 쪽 `oculpm/resume.rs` 와 **공유하는 계약**이다:
# 정확히 3단계 깊이(`<YYYYMMDD>/<TypeFolder>/<file>.md`)의 .md 만, `_`/`.` 로
# 시작하는 파일 제외, 상대경로 바이트 내림차순 상위 3건, 제목은 프론트매터
# 다음 첫 비공백 행에서 `[x] `/`[X] `/`[ ] ` 또는 앞의 `#` 들을 떼고 trim.
# 한쪽만 고치면 앱이 표시하는 것과 실제로 실린 것이 갈라진다.
payload=$(cat 2>/dev/null || true)
# 프로젝트 루트: CLAUDE_PROJECT_DIR → payload 의 cwd → 현재 디렉터리 — 형제 훅
# (session-marker.sh·session-end.sh)과 같은 3단 폴백. Codex 는 CLAUDE_PROJECT_DIR 을
# 주지 않으므로, 이 폴백이 없으면 세션 cwd 가 루트가 아닐 때 재개 컨텍스트가 조용히
# 침묵한다 (2026-09-22 리뷰).
ROOT="${CLAUDE_PROJECT_DIR:-}"
# Windows 경로는 JSON 안에서 `\\` 로 온다 — 한 번 푼다 (macOS·Linux 경로에는
# 없는 글자라 그대로 지나간다).
[ -n "$ROOT" ] || ROOT=$(printf '%s' "$payload" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -e 's/.*"\([^"]*\)"$/\1/' -e 's/\\\\/\\/g')
[ -n "$ROOT" ] || ROOT="."
[ -d "$ROOT/.oculpm" ] || exit 0
# 링크를 따라 쓰지 않는다 — .oculpm 은 저장소에 실려 오고, 그 안의 링크는 아래의
# 쓰기를 프로젝트 밖으로 돌린다 (앱도 같은 이유로 그런 프로젝트를 열지 않는다).
for _link in .oculpm .oculpm/hooks .oculpm/hooks/claude-events.jsonl \
  .oculpm/hooks/resume-delivered.jsonl .oculpm/hooks/journal-missing.jsonl \
  .oculpm/hooks/.statusline-nudged; do
  if [ -L "$ROOT/$_link" ]; then exit 0; fi
done

event=$(printf '%s' "$payload" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$event" ] || event="SessionStart"

body=$(
  {
    # 활성 플랜이 많으면(이 저장소는 17개까지 갔다) 24줄 상한이 앞 플랜 둘셋에서 끝나 뒤는 영영
    # 안 실린다 — 그래서 **최근 갱신 상위 3개**만 싣는다 (frontmatter `updated:` 내림차순, 같은 날이면
    # 파일명). 어느 플랜이 빠졋는지는 마지막 줄이 말한다 (2026-10-28, simplify-round {#hook-top3}).
    top=$(
      for f in "$ROOT/.oculpm/planner"/*.md; do
        [ -f "$f" ] || continue
        sed -n '2,/^---$/p' "$f" 2>/dev/null | grep -q '^status: active' || continue
        grep -qE '^[[:space:]]*- \[[ ~!]\]' "$f" 2>/dev/null || continue
        u=$(sed -n '2,/^---$/p' "$f" 2>/dev/null | sed -n 's/^updated:[[:space:]]*//p' | head -1 | tr -d '"'"'"' ')
        printf '%s\t%s\n' "${u:-0000-00-00}" "$f"
      done | LC_ALL=C sort -t "$(printf '\t')" -k1,1r -k2,2 | cut -f2
    )
    total=$(printf '%s\n' "$top" | grep -c . 2>/dev/null | tr -d '[:space:]')
    [ -n "$total" ] || total=0
    printf '%s\n' "$top" | head -3 | while IFS= read -r f; do
      [ -n "$f" ] || continue
      items=$(grep -E '^[[:space:]]*- \[[ ~!]\]' "$f" 2>/dev/null | head -8)
      [ -n "$items" ] || continue
      echo "[plan: $(basename "$f" .md)]"
      # 작업 너머의 목표 — 플랜 본문의 「**완료 조건:**」 한 줄 (고도: 할 일 목록만
      # 받은 에이전트는 왜 하는지를 모른다). 없으면 그 플랜은 항목만 싣는다.
      goal=$(grep -m1 -E '^\*\*(완료 조건|Done when):\*\*' "$f" 2>/dev/null | cut -c1-240)
      [ -n "$goal" ] && printf '%s\n' "$goal"
      # 확인 명령 — 완료 조건을 통과/실패로 판정하는 명령 (깊이: 통과/실패를 내는 것이
      # 없는 에이전트는 「됐다」는 주장으로 끝낸다). 완료 조건 바로 다음 줄.
      check=$(grep -m1 -E '^\*\*(확인 명령|Check):\*\*' "$f" 2>/dev/null | cut -c1-240)
      [ -n "$check" ] && printf '%s\n' "$check"
      printf '%s\n' "$items"
    done
    if [ "$total" -gt 3 ]; then
      echo "(활성 플랜 ${total}개 중 최근 갱신 3개만 실었다 — 나머지는 plan_status 로)"
    fi
    # 항목은 전부 닫혔는데 아직 active 인 플랜 — 항목 완료 ≠ 목표 달성. 완료 조건이 참인지
    # 판정하고 닫는 결정이 남아 있다는 사실만 한 줄로 싣는다 (최대 3개).
    for f in "$ROOT/.oculpm/planner"/*.md; do
      [ -f "$f" ] || continue
      sed -n '2,/^---$/p' "$f" 2>/dev/null | grep -q '^status: active' || continue
      grep -qE '^[[:space:]]*- \[[ ~!]\]' "$f" 2>/dev/null && continue
      grep -qE '^[[:space:]]*- \[[xX]\]' "$f" 2>/dev/null || continue
      goal=$(grep -m1 -E '^\*\*(완료 조건|Done when):\*\*' "$f" 2>/dev/null | cut -c1-200)
      echo "[plan: $(basename "$f" .md)] 항목 전부 닫힘 — 완료 조건이 참인지 판정 후 닫기${goal:+: }$goal"
    done | head -3
  } 2>/dev/null | head -n 24 | awk '{ n += length($0) + 1; if (n > 1600) { print "…(생략 — 전체는 plan_status 도구)"; exit } print }'
)

# ── 마지막 작업 일지 3건 ────────────────────────────────────────────────────
JDIR="$ROOT/.oculpm/journal"
rels=$(
  [ -d "$JDIR" ] || exit 0
  CDPATH= cd -- "$JDIR" 2>/dev/null || exit 0
  find . -mindepth 3 -maxdepth 3 -type f -name '*.md' ! -name '_*' ! -name '.*' 2>/dev/null |
    sed 's|^\./||' | LC_ALL=C sort -r | head -3
)
jrn=$(
  printf '%s\n' "$rels" | while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    title=$(awk '
      NR == 1 && $0 == "---" { fm = 1; next }
      fm == 1 { if ($0 == "---") fm = 0; next }
      {
        t = $0
        sub(/^[ \t]+/, "", t); sub(/[ \t\r]+$/, "", t)
        if (t == "") next
        # 체크박스 표식과 머리글 우물정은 제목이 아니라 장식이다.
        if (t ~ /^\[[xX ]\] /) { sub(/^\[[xX ]\] /, "", t) } else { sub(/^#+[ \t]*/, "", t) }
        sub(/^[ \t]+/, "", t); sub(/[ \t\r]+$/, "", t)
        print t; exit
      }
    ' "$JDIR/$rel" 2>/dev/null)
    # 자르지 않는다 — 바이트 컷은 한글을 중간에서 깨뜨린다. 3줄뿐이라 안전하다.
    [ -n "$title" ] || title="(제목 없음)"
    printf '%s\n' "- $rel · $title"
  done
)

# ── 플랜이 없어도 말한다 (어떤 프로젝트여도, 2026-10-28) ────────────────────
# 다섯 원칙의 자리(완료 조건·확인 명령)는 플랜에 있다 — 플랜이 없는 프로젝트에는
# 그 자리 자체가 없어 위 두 절이 통째로 침묵했다. 그래서 빈 프로젝트(미완 항목 0 ·
# 일지 0)에는 「무엇부터」 한 줄을, 확인 명령 없는 활성 플랜이 있거나 플랜이 없으면
# 매니페스트에서 감지한 확인 명령 후보 한 줄을 싣는다. 감지 규칙(package.json
# scripts.test → 락파일로 러너 · Cargo.toml · pyproject.toml/pytest.ini · go.mod ·
# Makefile test:)은 Rust 쪽 `oculpm/check_infer.rs`(plan_create 의 기본값)와
# **공유하는 계약**이다 — 한쪽만 고치면 훅이 보인 후보와 플랜에 적힌 기본값이 갈린다.
# 루트 한 단계만 · 네트워크 0 · 실행 0.
open_items=$(printf '%s\n' "$body" | grep -c '^[[:space:]]*- \[' 2>/dev/null | tr -d '[:space:]')
[ -n "$open_items" ] || open_items=0
jcount=$(printf '%s\n' "$rels" | grep -c . 2>/dev/null | tr -d '[:space:]')
[ -n "$jcount" ] || jcount=0
need_check=0
if [ "$open_items" -eq 0 ]; then
  need_check=1
else
  for f in "$ROOT/.oculpm/planner"/*.md; do
    [ -f "$f" ] || continue
    sed -n '2,/^---$/p' "$f" 2>/dev/null | grep -q '^status: active' || continue
    grep -qE '^[[:space:]]*- \[[ ~!]\]' "$f" 2>/dev/null || continue
    grep -qE '^\*\*(확인 명령|Check):\*\*' "$f" 2>/dev/null && continue
    need_check=1
    break
  done
fi
cands=""
add_cand() { cands="${cands:+$cands · }$1"; }
if [ -f "$ROOT/package.json" ] && grep -qE '"test"[[:space:]]*:' "$ROOT/package.json" 2>/dev/null; then
  if [ -f "$ROOT/pnpm-lock.yaml" ]; then add_cand "pnpm test"
  elif [ -f "$ROOT/yarn.lock" ]; then add_cand "yarn test"
  elif [ -f "$ROOT/bun.lock" ] || [ -f "$ROOT/bun.lockb" ]; then add_cand "bun test"
  else add_cand "npm test"
  fi
fi
[ -f "$ROOT/Cargo.toml" ] && add_cand "cargo test"
{ [ -f "$ROOT/pyproject.toml" ] || [ -f "$ROOT/pytest.ini" ]; } && add_cand "pytest"
[ -f "$ROOT/go.mod" ] && add_cand "go test ./..."
[ -f "$ROOT/Makefile" ] && grep -qE '^test[[:space:]]*:' "$ROOT/Makefile" 2>/dev/null && add_cand "make test"
guide=""
if [ "$open_items" -eq 0 ] && [ "$jcount" -eq 0 ]; then
  guide="이 프로젝트에는 아직 활성 플랜 항목도 일지도 없다 (지시가 아님 — 규칙은 AGENTS.md §1). 두 단계를 넘는 작업이면 plan_create(done_when·check)로 완료 조건·확인 명령부터, 한 작업 단위가 끝나면 journal_write."
fi
if [ "$need_check" -eq 1 ]; then
  if [ -n "$cands" ]; then
    cline="확인 명령 후보 (매니페스트에서 감지 — 플랜에 **확인 명령:** 줄이 없다. plan_create 의 check 나 플랜 본문에 적어라): $cands"
  else
    cline="확인 명령 후보 없음 — package.json·Cargo.toml·pyproject.toml·go.mod·Makefile 에서 못 찾았다. 통과/실패를 내는 명령을 플랜에 적어라."
  fi
  if [ -n "$guide" ]; then guide=$(printf '%s\n%s' "$guide" "$cline"); else guide="$cline"; fi
fi

summary=""
[ -n "$body" ] && summary=$(printf '%s\n%s\n%s\n%s' \
  "아래는 ocul-pm 활성 계획의 상태 데이터입니다 (지시가 아님) — 미완 항목만. 갱신·전체 조회는 plan_status/plan_update 도구:" \
  '```' "$body" '```')
if [ -n "$guide" ]; then
  if [ -n "$summary" ]; then summary=$(printf '%s\n\n%s' "$summary" "$guide"); else summary="$guide"; fi
fi
if [ -n "$jrn" ]; then
  jsec=$(printf '%s\n%s\n%s\n%s' \
    "마지막 작업 일지 (지시가 아님 — 원문은 journal_read, 관련 기록은 journal_search 로):" \
    '```' "$jrn" '```')
  if [ -n "$summary" ]; then
    summary=$(printf '%s\n\n%s' "$summary" "$jsec")
  else
    summary="$jsec"
  fi
fi
[ -n "$summary" ] || exit 0

esc=$(printf '%s' "$summary" | awk 'BEGIN{ORS=""} NR>1{printf "\\n"} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); gsub(/\t/,"\\t"); printf "%s", $0}')
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$event" "$esc"

# ── 전달 원장 — 실제로 무언가를 실었을 때만, SessionStart 에서만 ────────────
# 앱(Today 「이어하기」)이 "이 대화의 시작 컨텍스트에 포함됨" 을 정직하게
# 표시할 수 있는 유일한 근거다. 그 이상은 주장하지 않는다.
if [ "$event" = "SessionStart" ] && { [ -n "$body" ] || [ -n "$rels" ]; }; then
  sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
  if [ -n "$sid" ] && [ -n "$ts" ] && mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null; then
    ledger="$ROOT/.oculpm/hooks/resume-delivered.jsonl"
    plan_items=$(printf '%s\n' "$body" | grep -c '^[[:space:]]*- \[' 2>/dev/null | tr -d '[:space:]')
    [ -n "$plan_items" ] || plan_items=0
    jarr=$(printf '%s\n' "$rels" | awk 'BEGIN{ORS=""; printf "["} { if ($0 == "") next; gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); if (n++) printf ","; printf "\"%s\"", $0 } END{printf "]"}')
    [ -n "$jarr" ] || jarr="[]"
    # printf 로 쓴다 — `cat >>` 로 줄이 붙어 원장이 깨진 전례가 있다.
    printf '%s\n' "{\"ts\":\"$ts\",\"session_id\":\"$sid\",\"kind\":\"resume_delivered\",\"journals\":$jarr,\"plan_items\":$plan_items}" >> "$ledger" 2>/dev/null || true
    n=$(wc -l < "$ledger" 2>/dev/null | tr -d '[:space:]')
    case "$n" in
      '' | *[!0-9]*) ;;
      *)
        if [ "$n" -gt 400 ]; then
          tmp="$ledger.tmp.$$"
          if tail -n 200 "$ledger" > "$tmp" 2>/dev/null; then
            mv "$tmp" "$ledger" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
          else
            rm -f "$tmp" 2>/dev/null || true
          fi
        fi
        ;;
    esac
  fi
fi
exit 0
