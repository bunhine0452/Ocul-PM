#!/bin/sh
# ocul-pm — SessionEnd: 이벤트 인박스 append + "일지 미작성 대화" 판정.
#
# 근거는 에이전틱 A/B 벤치 실측(benchmarks/agentic, 2026-07-31): 규칙·도구가
# 주입돼도 헤드리스 단발 세션의 기록 준수가 0/12 — 규칙만으로 기록이 담보되지
# 않는 세션이 실재한다. 그런 대화를 (a) 사용자에게 조건부 stderr 로 알리고
# (b) `.oculpm/hooks/journal-missing.jsonl` 신호로 남겨 앱이 초안 제안 등
# 후속을 할 수 있게 한다. 계약: 네트워크 없음, 실패는 전부 무해,
# `.oculpm` 없으면 침묵 (stdin 은 항상 소비).
#
# **판정은 여기 없다** — `oculpm-mcp verdict` 한 자리다 (delivery-gate.sh 와
# 같은 함수). 종전의 프로젝트 전역 mtime 판정은 동시 대화가 일지를 쓰면 이
# 대화의 미작성을 가렸고(미탐), 반대로 옆 대화의 편집을 이 대화의 것으로
# 읽었다(오탐). 원장 줄에는 이제 `verdict` 가 실려 **미기록과 판정 불가가
# 구별**된다 — 옛 원장 164행 중 55%가 사후 재판정 불가였던 이유가 그 구별의
# 부재였다.
#
# ── 1.5초 (2026-11-12, Windows) ──────────────────────────────────────────
# Claude Code 는 SessionEnd 훅 전체에 **1.5초**만 준다 (종료 · /clear · /resume 전환).
# 플러그인 훅의 `timeout` 은 그 예산을 늘리지 못한다(공식 hooks 문서 SessionEnd 절).
# Windows 의 Git Bash 에서는 프로세스 하나가 0.2초 남짓이라(설치본 실측: `sh -c 'exit 0'`
# 230ms · `git --version` 247ms · 이 저장소에서 `verdict` 838ms) 이 스크립트가 통째로
# 1.3~2.5초 걸렸고, 사용자는 「SessionEnd hook … failed: Hook cancelled」 를 봤다 —
# 판정도 인박스 append 도 마커 청소도 잘린 채로.
# 그래서 Git Bash 에서는 stdin 을 내장으로 읽고 루트만 확인한 뒤 **나머지를 떼어 낸
# 뒤쪽 작업으로 넘기고 곧장 끝난다**. 그 작업의 출력은 버린다 — 종료 코드 0 의 stderr 는
# 어차피 사용자에게 보이지 않는다(같은 문서: 「exit 2 일 때만 stderr 를 보여 준다」).
# 테스트처럼 끝난 직후의 결과를 봐야 하는 쪽은 OCULPM_HOOK_SYNC=1 로 예전처럼 기다린다.
# 값: /clear 직후엔 새 대화의 생존 흔적이 판정보다 먼저 찍힐 수 있어, 미기록이 「판정 불가
# (live_peers)」 로 적히는 일이 생긴다 — 잘려서 아무것도 안 남던 것보다는 낫다.
background=
case "${OSTYPE:-}" in
  msys* | cygwin*)
    # 내장 read — `$(cat)` 한 번이 프로세스 하나다. 끝의 개행은 `$(…)` 처럼 뗀다.
    IFS= read -r -d '' payload 2>/dev/null || true
    nl='
'
    payload=${payload%"${payload##*[!$nl]}"}
    [ -n "${OCULPM_HOOK_SYNC:-}" ] || background=1
    ;;
  *) payload=$(cat 2>/dev/null || true) ;;
esac
# payload 의 문자열 값 하나를 `_v` 에 — 프로세스를 띄우지 않는다 (delivery-gate.sh 와 같은 함수).
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
[ -d "$ROOT/.oculpm/hooks" ] || mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
json_str session_id
sid=$_v
case $sid in *[!A-Za-z0-9._-]*) sid= ;; esac

finish() {
  rc=""
  if [ -n "$sid" ]; then
    plugin_root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd)}
    bin="$plugin_root/bin/oculpm-mcp"
    # 바이너리가 없으면 판정도 신호도 없다 (delivery-gate.sh 와 같은 결정 —
    # 걷어낸 근사로 폴백하면 오탐이 그대로 되살아난다).
    if [ -x "$bin" ]; then
      # --transcript 는 이 대화 자신의 편집 기록이다 — 옆 대화가 살아 있어도
      # 우리 몫만 골라 판정한다 ({#gate-positive-attribution}).
      # --ledger 가 신호 원장 append 를 **바이너리 안에서** 한다: 회전(읽고-
      # 자르고-바꾸기)은 append 와 달리 원자적이지 않아 공용 파일 문지기가
      # 필요하고, 셸의 `>>` 는 개행 누락으로 깨진 줄을 남긴 전례가 있다.
      json_str transcript_path
      # JSON 의 `\\` 를 `\` 로 — 옛 `sed 's/\\\\/\\/g'` 와 같은 값, 프로세스 없이.
      tp= _r=$_v
      while :; do
        case $_r in
          *'\\'*) tp=$tp${_r%%'\\'*}'\'; _r=${_r#*'\\'} ;;
          *) break ;;
        esac
      done
      tp=$tp$_r
      "$bin" verdict --root "$ROOT" --conversation "$sid" --transcript "$tp" --ledger >/dev/null 2>&1
      rc=$?
    fi
    rm -f "$ROOT/.oculpm/hooks/.session-start-$sid" "$ROOT/.oculpm/hooks/.session-live-$sid" 2>/dev/null || true
  fi
  # 크래시 잔여 청소 — SessionStart 가 아니라 여기(판정 뒤)서 돌려, 살아있는
  # 장기 세션의 마커를 다른 세션의 시작이 쓸어가는 경합을 줄인다 (리뷰 LOW —
  # 7일+ 열린 세션과의 잔여 경합은 미탐 방향이라 수용).
  find "$ROOT/.oculpm/hooks" \( -name '.session-start-*' -o -name '.session-live-*' \) -mtime +7 -delete 2>/dev/null || true

  case "$rc" in
    10)
      echo "oculpm: 이 대화는 일지 없이 끝났습니다 — 다음 세션에서 journal_write 로 남기거나, ocul-pm 앱의 일지 초안 기능을 켜 두세요" >&2
      ;;
    0)
      echo "oculpm: 세션 기록됨 — 다음 항목은 /oculpm:next, 오늘 요약·diff 대조는 ocul-pm 앱 (oculpm.com)" >&2
      ;;
    *)
      # 11(판정 불가) · 미실행. 모름을 위반으로도 무결로도 말하지 않는다 —
      # 원장에는 남았으니 회고가 세면 된다.
      ;;
  esac

  # 이벤트 인박스 append 는 신호 append **뒤에** — 워처의 인박스 소비가 낸
  # oculpmSessionEnded 로 프론트가 재조회할 때 신호가 이미 디스크에 있도록
  # (순서 경합 리뷰 지적). 빈 payload 는 append 하지 않는다.
  [ -n "$payload" ] && printf '%s\n' "$payload" >> "$ROOT/.oculpm/hooks/claude-events.jsonl" 2>/dev/null || true

  # B1 — statusline 1회성 넛지 (ponytail 패턴: 반복하면 잔소리가 된다).
  # 디스패치를 써 본 프로젝트(current.json 존재)에서, statusLine 미설정이고,
  # 아직 넛지한 적 없을 때 단 한 번.
  nudged="$ROOT/.oculpm/hooks/.statusline-nudged"
  if [ -f "$ROOT/.oculpm/index/dispatch/current.json" ] && [ ! -f "$nudged" ]; then
    if ! grep -q '"statusLine"' "$HOME/.claude/settings.json" "$ROOT/.claude/settings.json" "$ROOT/.claude/settings.local.json" 2>/dev/null; then
      echo "oculpm: 팁 — 상태줄에 현재 디스패치 항목을 띄울 수 있어요: /statusline 에서 플러그인의 hooks/oculpm-statusline.sh 지정 (자세히: oculpm.com/plugin)" >&2
      : > "$nudged" 2>/dev/null || true
    fi
  fi
}

if [ -n "$background" ]; then
  # 표준 입출력을 끊어야 Claude Code 가 이 작업을 기다리지 않는다 — 파이프를 쥐고
  # 있으면 훅이 끝난 것으로 보지 않는다.
  finish </dev/null >/dev/null 2>&1 &
else
  finish
fi
exit 0
