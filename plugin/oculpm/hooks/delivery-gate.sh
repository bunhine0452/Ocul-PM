#!/bin/sh
# ocul-pm — Stop: 배달 게이트 (ponytail delivery-gate + ECC chief-of-staff 이식).
# "이 세션에서 코드 변경이 있는데 이 세션의 일지가 없다"를 감지하면 **세션당
# 1회** 턴 종료를 차단(exit 2)하고 에이전트에게 일지 작성을 지시한다. 근거는
# 에이전틱 A/B 벤치 실측(benchmarks/agentic, 2026-07-31): 규칙 주입만으로는
# 헤드리스 단발 세션의 기록 준수가 0/12 — 프롬프트 의존은 안티패턴, 기계
# 게이트가 필요하다.
# 계약: stdin 즉시 소비 · 네트워크 없음 · 모든 실패는 무해(exit 0) ·
# stop_hook_active 가드(공식 무한 차단 방지) · 세션당 1회 플래그 ·
# 코드 변경 판정은 **세션 귀속**(마커보다 새로운 파일만 — 세션 시작 전부터
# 있던 워킹트리 WIP 는 이 세션의 변경이 아니다).
ROOT="${CLAUDE_PROJECT_DIR:-.}"
payload=$(cat 2>/dev/null || true)
[ -d "$ROOT/.oculpm" ] || exit 0
# 이 게이트의 차단으로 이어진 턴이면 절대 재차단하지 않는다.
# (JSON 콜론 뒤 공백 유무 양쪽을 허용 — 직렬화 구현에 의존하지 않는다.)
case "$payload" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
# 세션 마커(session-marker.sh)가 판정 기준점 — 없으면 판정 불가, 침묵.
marker="$ROOT/.oculpm/hooks/.session-start-$sid"
[ -f "$marker" ] || exit 0
# 세션당 1회 — 이미 발화했으면 이 세션에서는 다시 차단하지 않는다.
fired="$ROOT/.oculpm/hooks/.delivery-gate-$sid"
[ -f "$fired" ] && exit 0
# 이 세션에서 이미 일지를 썼으면 통과.
[ -n "$(find "$ROOT/.oculpm/journal" -type f -name '*.md' -newer "$marker" 2>/dev/null | head -1)" ] && exit 0
# 코드 변경 판정 — 조건 전부를 만족하는 파일이 하나라도 있을 때만 발화:
#  · git 이 더티로 보고 (pathspec `-- .` 로 이 프로젝트 하위만 — 모노레포 이웃 제외)
#  · .oculpm 밖 (일지·훅 파일만의 변경은 코드 변경이 아니다)
#  · 마커보다 mtime 이 새로움 (세션 귀속 — 기존 WIP·병렬 세션 잔여 제외)
# porcelain 경로는 git 루트 기준이라 toplevel/show-prefix 로 보정한다.
# core.quotepath=off 로 비ASCII 경로의 8진 이스케이프를 끈다 (한글 슬러그).
top=$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)
[ -n "$top" ] || exit 0
prefix=$(git -C "$ROOT" rev-parse --show-prefix 2>/dev/null)
changed=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  p=${line#???}
  # rename "old -> new" 은 새 경로로 판정 (.oculpm 밖으로 나간 이동도 실질 변경).
  case "$p" in *" -> "*) p=${p##* -> } ;; esac
  # 공백 등으로 C-quote 된 경로는 겉따옴표만 벗긴다 (이스케이프 잔존 시 -e 가
  # 실패해 그 파일만 건너뜀 — 미탐 방향이라 무해).
  case "$p" in \"*\") p=${p%\"}; p=${p#\"} ;; esac
  case "$p" in "$prefix".oculpm | "$prefix".oculpm/*) continue ;; esac
  if [ -e "$top/$p" ] && [ "$top/$p" -nt "$marker" ]; then
    changed=1
    break
  fi
done <<PORCELAIN
$(git -C "$ROOT" -c core.quotepath=off status --porcelain -- . 2>/dev/null)
PORCELAIN
[ -n "$changed" ] || exit 0
: > "$fired" 2>/dev/null || exit 0
# 잔여 플래그 청소 — 마커 청소와 같은 원칙 (판정 뒤, 오래된 것만).
find "$ROOT/.oculpm/hooks" -name '.delivery-gate-*' -mtime +7 -delete 2>/dev/null || true
cat >&2 <<'MSG'
oculpm 배달 게이트: 이 세션에 코드 변경이 있는데 작업 일지가 없습니다.
- 논리 단위(버그 수정/기능/리팩토링/에러 해결)가 끝난 상태라면: journal_write(MCP) 또는 AGENTS.md §2 규격으로 일지를 쓰고, plan_update 로 플래너 항목을 갱신한 뒤 마치세요.
- 아직 작업이 진행 중이면: 이 안내는 무시하고 하던 작업을 계속하세요 (이 게이트는 세션당 한 번만 뜹니다).
MSG
exit 2
