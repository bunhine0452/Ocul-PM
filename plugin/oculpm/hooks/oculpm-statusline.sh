#!/bin/sh
# ocul-pm — Claude Code statusline: 디스패치된 플랜 항목을 상태줄에 표시.
#
# stdin 으로 statusline JSON({model, workspace{project_dir,current_dir}, …})을
# 받아, 프로젝트의 `.oculpm/index/dispatch/current.json` 플래그가 신선하면
# `⏵ OCULPM: <항목>` 배지를, 아니면 모델·폴더 기본 상태줄을 출력한다.
# 플래너 레일(앱)의 터미널 쪽 거울. 계약: 네트워크·외부 실행 없음, 매 렌더
# 호출되므로 극도로 저비용(grep 1회 이하), 모든 실패는 기본 출력으로 낙하.
payload=$(cat 2>/dev/null || true)
get() { printf '%s' "$payload" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
dir=$(get project_dir)
[ -n "$dir" ] || dir=$(get current_dir)
model=$(get display_name)
base="${model:-claude} · $(basename "${dir:-?}")"

flag="$dir/.oculpm/index/dispatch/current.json"
if [ -n "$dir" ] && [ -f "$flag" ]; then
  fjson=$(cat "$flag" 2>/dev/null || true)
  fts=$(printf '%s' "$fjson" | sed -n 's/.*"ts"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  ttl=$(printf '%s' "$fjson" | sed -n 's/.*"ttl"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  [ -n "$ttl" ] || ttl=86400
  now=$(date +%s 2>/dev/null || echo 0)
  # ttl 지난 플래그는 낡은 것 — 배지 없이 기본 상태줄. (plan 배지 24h,
  # 완료 재확인이 불가능한 회고 배지는 짧게 — 쓰기 측이 ttl 로 지정.)
  if [ -n "$fts" ] && [ $((now - fts)) -lt "$ttl" ]; then
    title=$(printf '%s' "$fjson" | sed -n 's/.*"title"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    plan_rel=$(printf '%s' "$fjson" | sed -n 's/.*"plan_rel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    item_id=$(printf '%s' "$fjson" | sed -n 's/.*"item_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    show=1
    # plan 항목이면 아직 미완 글리프인지 재확인 — 완료된 항목을 계속 띄우지 않는다.
    if [ -n "$plan_rel" ] && [ -n "$item_id" ]; then
      # id 는 고정 문자열(-F)로 — regex 메타문자가 든 수작성 id 에서 조용히
      # 죽지 않게. 글리프는 그 줄만 재검사.
      grep -F "{#$item_id}" "$dir/$plan_rel" 2>/dev/null | grep -E '^[[:space:]]*- \[[ ~!]\]' >/dev/null 2>&1 || show=""
    fi
    if [ -n "$show" ] && [ -n "$title" ]; then
      # 절단은 문자 단위(perl -CS) — 바이트 절단은 한글을 중간에서 깨뜨린다.
      if command -v perl >/dev/null 2>&1; then
        short=$(printf '%s' "$title" | perl -CS -ne 'chomp; print length($_) > 28 ? substr($_, 0, 27) . "..." : $_')
      else
        short=$title
      fi
      printf '⏵ OCULPM: %s · %s\n' "$short" "${model:-claude}"
      exit 0
    fi
  fi
fi
printf '%s\n' "$base"
exit 0
