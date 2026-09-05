#!/bin/sh
# ocul-pm — Stop: 배달 게이트 (ponytail delivery-gate + ECC chief-of-staff 이식).
# "이 대화에 코드 변경이 있는데 이 대화의 일지가 없다"를 감지하면 **대화당
# 1회** 턴 종료를 차단(exit 2)하고 무엇을 기록할지 지시한다. 근거는 에이전틱
# A/B 벤치 실측(benchmarks/agentic, 2026-07-31): 규칙 주입만으로는 헤드리스
# 단발 세션의 기록 준수가 0/12 — 프롬프트 의존은 안티패턴, 기계 게이트가
# 필요하다.
#
# **판정은 여기 없다.** 셸이 하던 판정(프로젝트 전역 일지 mtime)은 2026-09-05
# 에 저장소에 한 글자도 쓰지 않은 읽기 전용 세션을 붙잡았다 — 같은 워킹트리의
# 다른 에이전트 편집이 그 세션의 마커보다 새로웠다는 것이 유일한 근거였다.
# 판정은 `oculpm-mcp verdict` (src-tauri/src/oculpm/verdict/) 한 자리로 옮겼고
# 세 표면(이 파일·session-end.sh·앱의 Today 카드)이 같은 함수를 부른다.
#
# 계약: stdin 즉시 소비 · 네트워크 없음 · 모든 실패는 무해(exit 0) ·
# stop_hook_active 가드(공식 무한 차단 방지) · 대화당 1회 플래그.
payload=$(cat 2>/dev/null || true)
# 프로젝트 루트: CLAUDE_PROJECT_DIR → payload 의 cwd → 현재 디렉터리.
# payload 폴백이 필요한 이유는 실측이다 (2026-09-03): **Codex 0.153 이 이 훅들을
# 그대로 실행한다.** 플러그인 루트의 hooks/hooks.json 을 관례로 찾아 읽고
# CLAUDE_PLUGIN_ROOT 도 실어 주지만, CLAUDE_PROJECT_DIR 은 주지 않는다 — 그
# 자리를 payload 의 cwd 가 대신한다. 없으면 예전처럼 현재 디렉터리.
ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] || ROOT=$(printf '%s' "$payload" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$ROOT" ] || ROOT="."
[ -d "$ROOT/.oculpm" ] || exit 0
# 이 게이트의 차단으로 이어진 턴이면 절대 재차단하지 않는다.
# (JSON 콜론 뒤 공백 유무 양쪽을 허용 — 직렬화 구현에 의존하지 않는다.)
case "$payload" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0

# 생존 흔적 — **매 턴** 다시 찍는다. 옆 대화가 "지금 살아 있다"를 판정하는
# 유일한 근거다 (마커는 크래시 뒤 7일을 버텨서 생사를 말하지 못한다).
# 판정보다 **먼저** 찍어야 동시에 도는 옆 대화가 우리를 볼 수 있다.
: > "$ROOT/.oculpm/hooks/.session-live-$sid" 2>/dev/null || true

# 대화당 1회 — 이미 발화했으면 이 대화에서는 다시 차단하지 않는다.
fired="$ROOT/.oculpm/hooks/.delivery-gate-$sid"
[ -f "$fired" ] && exit 0

# 판정 진입점. 셔틀(bin/oculpm-mcp)이 설치 위치를 탐색해 실바이너리를 exec 한다.
plugin_root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd)}
bin="$plugin_root/bin/oculpm-mcp"
# **바이너리를 못 찾으면 침묵한다** (옛 셸 판정으로 폴백하지 않는다). 두 가지
# 이유다: (1) 폴백은 방금 걷어낸 그 오탐을 그대로 되살린다. (2) 바이너리가
# 없으면 MCP 서버도 없어 게이트가 지시하는 journal_write 자체가 존재하지
# 않는다 — 실행할 수 없는 지시로 턴을 막는 것은 도구가 아니라 방해다.
# 그런 프로젝트에서 기록을 담보하는 것은 AGENTS.md 규칙(프롬프트)뿐이다.
[ -x "$bin" ] || exit 0
msg=$("$bin" verdict --root "$ROOT" --conversation "$sid" 2>/dev/null)
rc=$?
# 10 = 이의. 0(이의 없음) · 11(판정 불가) · 그 밖(오류)은 전부 침묵.
[ "$rc" -eq 10 ] || exit 0
[ -n "$msg" ] || exit 0

: > "$fired" 2>/dev/null || exit 0
# 잔여 플래그 청소 — 마커 청소와 같은 원칙 (판정 뒤, 오래된 것만).
find "$ROOT/.oculpm/hooks" -name '.delivery-gate-*' -mtime +7 -delete 2>/dev/null || true
printf '%s\n' "$msg" >&2
exit 2
