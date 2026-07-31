#!/bin/sh
# ocul-pm — SessionStart: 세션 시작 마커 파일을 남긴다. SessionEnd 의
# "이 세션에서 일지가 하나라도 났는가" 판정(mtime -newer)의 기준점이다.
# 세션별 마커(session_id 접미)라 동시 세션에도 안전하다 (크래시 잔여 청소는
# session-end.sh 가 판정 뒤에 수행 — 살아있는 세션과의 경합 최소화).
# 계약: stdin 즉시 소비·네트워크 없음·모든 실패는 무해.
ROOT="${CLAUDE_PROJECT_DIR:-.}"
payload=$(cat 2>/dev/null || true)
[ -d "$ROOT/.oculpm" ] || exit 0
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
[ -n "$sid" ] || exit 0
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
marker="$ROOT/.oculpm/hooks/.session-start-$sid"
# create-only — SessionStart 는 auto-compact/resume 에도 같은 session_id 로
# 재발화한다. 재터치하면 세션 초반에 쓴 일지가 "마커보다 오래됨"이 되어
# 기록한 세션에 미작성 경고가 나는 오탐(리뷰 HIGH)이 생긴다.
if [ ! -f "$marker" ]; then
  : > "$marker" 2>/dev/null || exit 0
  # 같은 초에 작성된 일지가 -newer(엄격 초과)에서 밀리지 않게 1초 과거로.
  # (HFS+ 등 초 단위 mtime 파일시스템 대비 — 실패해도 무해.)
  touch -t "$(date -v-2S +%Y%m%d%H%M.%S 2>/dev/null)" "$marker" 2>/dev/null || true
fi
exit 0
