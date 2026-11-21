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
# **확인 게이트 (2026-11-22, 플랜 agent-era-20261122)** 가 같은 훅에 얹혀 있다: 이 대화가
# 계획의 항목을 닫았는데(plan_update done) 그 계획의 확인 명령을 돌린 기록(`판정 ✓|✗ …`)이
# 없으면 대화당 1회 짚는다. 판정은 같은 바이너리의 `gate` 가 배달 판정과 함께 낸다 — 앱은
# 확인 명령을 돌리지도 결과를 읽지도 않고, 「돌리고 끝 줄을 남겨라」 고 말할 뿐이다.
#
# 계약: stdin 즉시 소비 · 네트워크 없음 · 모든 실패는 무해(exit 0) ·
# stop_hook_active 가드(공식 무한 차단 방지) · 게이트마다 대화당 1회 플래그.
payload=$(cat 2>/dev/null || true)
# payload 의 문자열 값 하나를 `_v` 에 — 프로세스를 띄우지 않는다 (plan-context.sh 와 같은 함수).
# Windows 의 Git Bash 는 `sed | head` 파이프라인 하나에 프로세스 셋, 하나에 수십 ms 다 (11-11).
# 옛 `sed -n 's/.*"<키>"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1` 과 같은 값 —
# 키의 마지막 등장, 값에 `"` 가 없을 때만.
json_str() {
  _v=
  case $payload in *"\"$1\""*) ;; *) return 0 ;; esac
  _r=${payload##*"\"$1\""}
  _r=${_r#"${_r%%[![:space:]]*}"}
  case $_r in :*) ;; *) return 0 ;; esac
  _r=${_r#:}
  _r=${_r#"${_r%%[![:space:]]*}"}
  case $_r in \"*) ;; *) return 0 ;; esac
  _r=${_r#\"}
  case $_r in *\"*) _v=${_r%%\"*} ;; esac
}
# 프로젝트 루트: CLAUDE_PROJECT_DIR → payload 의 cwd → 현재 디렉터리.
# payload 폴백이 필요한 이유는 실측이다 (2026-09-03): **Codex 0.153 이 이 훅들을
# 그대로 실행한다.** 플러그인 루트의 hooks/hooks.json 을 관례로 찾아 읽고
# CLAUDE_PLUGIN_ROOT 도 실어 주지만, CLAUDE_PROJECT_DIR 은 주지 않는다 — 그
# 자리를 payload 의 cwd 가 대신한다. 없으면 예전처럼 현재 디렉터리.
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
# 이 게이트의 차단으로 이어진 턴이면 절대 재차단하지 않는다.
# (JSON 콜론 뒤 공백 유무 양쪽을 허용 — 직렬화 구현에 의존하지 않는다.)
case "$payload" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
json_str session_id
sid=$_v
case $sid in *[!A-Za-z0-9._-]*) sid= ;; esac
[ -n "$sid" ] || exit 0
[ -d "$ROOT/.oculpm/hooks" ] || mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0

# 생존 흔적 — **매 턴** 다시 찍는다. 옆 대화가 "지금 살아 있다"를 판정하는
# 유일한 근거다 (마커는 크래시 뒤 7일을 버텨서 생사를 말하지 못한다).
# 판정보다 **먼저** 찍어야 동시에 도는 옆 대화가 우리를 볼 수 있다.
: > "$ROOT/.oculpm/hooks/.session-live-$sid" 2>/dev/null || true

# 대화당 1회 — 게이트마다 따로 센다. 이미 뜬 게이트는 이 대화에서 다시 막지 않는다.
#   배달 게이트: 바꾼 파일이 있는데 이 대화의 일지가 없다.
#   확인 게이트(11-22): 계획의 항목을 닫았는데 그 계획의 확인 명령을 돌린 기록(판정)이 없다.
# 둘 다 이미 떴으면 바이너리를 띄우지도 않는다.
fired="$ROOT/.oculpm/hooks/.delivery-gate-$sid"
checked="$ROOT/.oculpm/hooks/.check-gate-$sid"
skip_journal=
skip_check=
[ -f "$fired" ] && skip_journal=--skip-journal
[ -f "$checked" ] && skip_check=--skip-check
if [ -n "$skip_journal" ] && [ -n "$skip_check" ]; then exit 0; fi

# 판정 진입점. 셔틀(bin/oculpm-mcp)이 설치 위치를 탐색해 실바이너리를 exec 한다.
plugin_root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd)}
bin="$plugin_root/bin/oculpm-mcp"
# **바이너리를 못 찾으면 침묵한다** (옛 셸 판정으로 폴백하지 않는다). 두 가지
# 이유다: (1) 폴백은 방금 걷어낸 그 오탐을 그대로 되살린다. (2) 바이너리가
# 없으면 MCP 서버도 없어 게이트가 지시하는 journal_write 자체가 존재하지
# 않는다 — 실행할 수 없는 지시로 턴을 막는 것은 도구가 아니라 방해다.
# 그런 프로젝트에서 기록을 담보하는 것은 AGENTS.md 규칙(프롬프트)뿐이다.
[ -x "$bin" ] || exit 0
# 이 대화 자신의 트랜스크립트 — 판정이 **양성 귀속**에 쓴다
# ({#gate-positive-attribution}). 여기에 이 대화가 부른 Edit/Write 가 들어 있어,
# 옆 대화가 살아 있어도 우리 몫만 골라 붙잡을 수 있다. 못 뽑아도 무해하다
# (예전처럼 옆 대화가 있으면 판정 불가).
# Windows 경로는 JSON 안에서 `\\` 로 온다 — 한 번 푼다 (옛 `sed 's/\\\\/\\/g'` 와 같다, 프로세스 없이).
json_str transcript_path
_r=$_v
tp=
while :; do
  case $_r in
    *'\\'*) tp=$tp${_r%%'\\'*}'\'; _r=${_r#*'\\'} ;;
    *) break ;;
  esac
done
tp=$tp$_r
# 두 판정을 **한 번에** 받는다 (`oculpm-mcp gate` — 한 프로세스, 트랜스크립트 한 번 읽기).
#   10 = 배달 이의 · 12 = 확인 이의 · 13 = 둘 다. 0 · 11(판정 불가) · 그 밖은 침묵.
# $skip_… 는 비었거나 인자 하나다 — 일부러 따옴표 없이 편다.
msg=$("$bin" gate --root "$ROOT" --conversation "$sid" --transcript "$tp" $skip_journal $skip_check 2>/dev/null)
rc=$?
# 2 = 사용법 오류 — 앱이 아직 옛 판이라 `gate` 를 모른다 (플러그인만 먼저 올라간 사용자).
# 배달 게이트는 예전 진입점으로 그대로 지킨다. 확인 게이트는 앱이 올라간 뒤부터다.
if [ "$rc" -eq 2 ] && [ -z "$skip_journal" ]; then
  msg=$("$bin" verdict --root "$ROOT" --conversation "$sid" --transcript "$tp" 2>/dev/null)
  rc=$?
fi
# 1 = 셔틀이 바이너리를 못 찾았다 — 앱이 없는 곳이다. 로컬에서는 예전처럼 침묵한다
# (MCP 도구가 없어 journal_write 를 시킬 수 없다). **클라우드 세션**(CLAUDE_CODE_REMOTE=true —
# Claude Code 가 일회용 기기에 넣는 표식)에서만 셸이 대신 묻는다: 그 기기에는 대화가 하나뿐이라
# 2026-09-05 의 오탐(같은 워킹트리의 옆 대화)이 생길 자리가 없고, 거기서 한 일은 git 으로만
# 돌아오므로 일지 없이 끝나면 아무도 모른다. 근거는 둘 다 1차 출처다 — 이 대화의
# 트랜스크립트에 `.oculpm/` 밖을 고친 편집 도구 호출이 있고, 세션 마커보다 새 일지가 없다.
# 지시는 도구 없이도 할 수 있는 것(규격서를 읽고 파일로)만 한다.
if [ "$rc" -eq 1 ] && [ -z "$skip_journal" ] && [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  marker="$ROOT/.oculpm/hooks/.session-start-$sid"
  if [ -f "$marker" ] && [ -f "$tp" ] && [ ! -L "$ROOT/.oculpm/journal" ] \
    && grep -E '"name"[[:space:]]*:[[:space:]]*"(Edit|Write|MultiEdit|NotebookEdit)"' "$tp" 2>/dev/null | grep -q -v '\.oculpm/' \
    && [ -z "$(find "$ROOT/.oculpm/journal" -name '*.md' -newer "$marker" 2>/dev/null | head -1)" ]; then
    msg='oculpm 배달 게이트: 이 대화에서 파일을 고쳤는데 이 세션의 일지가 없습니다.
- 논리 단위(버그 수정/기능/리팩토링/에러 해결)가 끝났으면 `.oculpm/agents/journal-spec.md` 를 읽고 그 규격대로 `.oculpm/journal/<YYYYMMDD>/<TypeFolder>/` 에 일지 한 편을 쓰고, 대응 플래너 항목의 글리프와 plan-log 를 갱신하세요 (이 환경에는 oculpm MCP 도구가 없어 파일로 씁니다).
- 아직 작업이 진행 중이면 이 안내를 무시하고 계속하세요 (이 게이트는 대화당 한 번만 뜹니다).'
    rc=10
  fi
fi
journal_hit=
check_hit=
[ "$rc" -eq 10 ] && journal_hit=1
[ "$rc" -eq 12 ] && check_hit=1
[ "$rc" -eq 13 ] && journal_hit=1 && check_hit=1
[ -n "$journal_hit$check_hit" ] || exit 0
[ -n "$msg" ] || exit 0

if [ -n "$journal_hit" ]; then : > "$fired" 2>/dev/null || exit 0; fi
if [ -n "$check_hit" ]; then : > "$checked" 2>/dev/null || exit 0; fi
# 잔여 플래그 청소 — 마커 청소와 같은 원칙 (판정 뒤, 오래된 것만).
find "$ROOT/.oculpm/hooks" \( -name '.delivery-gate-*' -o -name '.check-gate-*' \) -mtime +7 -delete 2>/dev/null || true
printf '%s\n' "$msg" >&2
exit 2
