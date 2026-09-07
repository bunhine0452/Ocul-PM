#!/bin/sh
# ocul-pm — SessionStart: 세션 시작 마커 파일을 남긴다. SessionEnd 의
# "이 세션에서 일지가 하나라도 났는가" 판정(mtime -newer)의 기준점이다.
# 세션별 마커(session_id 접미)라 동시 세션에도 안전하다 (크래시 잔여 청소는
# session-end.sh 가 판정 뒤에 수행 — 살아있는 세션과의 경합 최소화).
# 여기서 말하는 세션은 **대화**(conversation)다 — resume 마다 새로 열리는
# 세그먼트가 아니라 `CLAUDE_CODE_SESSION_ID` 하나. 마커는 세그먼트의 수명을,
# 생존 파일은 대화의 최근 활동을 나타낸다 (용어: oculpm/verdict/mod.rs).
# 계약: stdin 즉시 소비·네트워크 없음·모든 실패는 무해.
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
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
# 생존 흔적 — 이 대화가 **지금** 살아 있다. 마커와 달리 매번 다시 찍는다
# (Stop 훅도 매 턴 찍는다). 첫 턴이 끝나기 전에도 옆 대화가 우리를 용의자로
# 볼 수 있어야, 그쪽이 우리 편집을 자기 것으로 오인하지 않는다.
: > "$ROOT/.oculpm/hooks/.session-live-$sid" 2>/dev/null || true
marker="$ROOT/.oculpm/hooks/.session-start-$sid"
# create-only — SessionStart 는 auto-compact/resume 에도 같은 session_id 로
# 재발화한다. 재터치하면 세션 초반에 쓴 일지가 "마커보다 오래됨"이 되어
# 기록한 세션에 미작성 경고가 나는 오탐(리뷰 HIGH)이 생긴다.
if [ ! -f "$marker" ]; then
  : > "$marker" 2>/dev/null || exit 0
  # 같은 초에 작성된 일지가 -newer(엄격 초과)에서 밀리지 않게 2초 과거로.
  # (HFS+ 등 초 단위 mtime 파일시스템 대비 — 실패해도 무해.)
  # date -v 는 BSD(macOS), -d 는 GNU(Linux) — 양쪽 폴백. 둘 다 실패하면
  # 백데이팅만 생략 (같은 초 경계의 드문 오탐을 감수, 마커 자체는 유효).
  past=$(date -v-2S +%Y%m%d%H%M.%S 2>/dev/null || date -d '-2 seconds' +%Y%m%d%H%M.%S 2>/dev/null)
  [ -n "$past" ] && touch -t "$past" "$marker" 2>/dev/null || true
fi
exit 0
