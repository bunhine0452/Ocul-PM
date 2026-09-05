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
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)

rc=""
if [ -n "$sid" ]; then
  plugin_root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd)}
  bin="$plugin_root/bin/oculpm-mcp"
  # 바이너리가 없으면 판정도 신호도 없다 (delivery-gate.sh 와 같은 결정 —
  # 걷어낸 근사로 폴백하면 오탐이 그대로 되살아난다).
  if [ -x "$bin" ]; then
    # --ledger 가 신호 원장 append 를 **바이너리 안에서** 한다: 회전(읽고-
    # 자르고-바꾸기)은 append 와 달리 원자적이지 않아 공용 파일 문지기가
    # 필요하고, 셸의 `>>` 는 개행 누락으로 깨진 줄을 남긴 전례가 있다.
    "$bin" verdict --root "$ROOT" --conversation "$sid" --ledger >/dev/null 2>&1
    rc=$?
  fi
  rm -f "$ROOT/.oculpm/hooks/.session-start-$sid" 2>/dev/null || true
  rm -f "$ROOT/.oculpm/hooks/.session-live-$sid" 2>/dev/null || true
fi
# 크래시 잔여 청소 — SessionStart 가 아니라 여기(판정 뒤)서 돌려, 살아있는
# 장기 세션의 마커를 다른 세션의 시작이 쓸어가는 경합을 줄인다 (리뷰 LOW —
# 7일+ 열린 세션과의 잔여 경합은 미탐 방향이라 수용).
find "$ROOT/.oculpm/hooks" -name '.session-start-*' -mtime +7 -delete 2>/dev/null || true
find "$ROOT/.oculpm/hooks" -name '.session-live-*' -mtime +7 -delete 2>/dev/null || true

case "$rc" in
  10)
    echo "oculpm: 이 대화는 일지 없이 끝났습니다 — 다음 세션에서 journal_write 로 남기거나, ocul-pm 앱의 일지 초안 기능을 켜 두세요" >&2
    ;;
  0)
    echo "oculpm: 세션 기록됨 — /oculpm:standup 으로 오늘 요약, 회고·diff 대조는 ocul-pm 앱 (oculpm.com)" >&2
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
exit 0
