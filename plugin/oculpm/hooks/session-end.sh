#!/bin/sh
# ocul-pm — SessionEnd: 이벤트 인박스 append + "일지 미작성 세션" 판정.
#
# 근거는 에이전틱 A/B 벤치 실측(benchmarks/agentic, 2026-07-31): 규칙·도구가
# 주입돼도 헤드리스 단발 세션의 기록 준수가 0/12 — 규칙만으로 기록이 담보되지
# 않는 세션이 실재한다. 그런 세션을 (a) 사용자에게 조건부 stderr 로 알리고
# (b) `.oculpm/hooks/journal-missing.jsonl` 신호로 남겨 앱이 초안 제안 등
# 후속을 할 수 있게 한다. 계약: 네트워크·외부 실행 없음, 실패는 전부 무해,
# `.oculpm` 없으면 침묵 (stdin 은 항상 소비).
#
# 알려진 한계: 판정은 프로젝트 전역 mtime 이라, 동시 세션이 일지를 쓰면 이
# 세션의 미작성이 가려진다(미탐 방향 — 소음보다 보수적). 세션 귀속 판정은
# 일지 frontmatter 의 session_id 상관관계가 필요해 후속(H3b)으로 미룬다.
ROOT="${CLAUDE_PROJECT_DIR:-.}"
payload=$(cat 2>/dev/null || true)
[ -d "$ROOT/.oculpm" ] || exit 0
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
# 빈 payload 는 append 하지 않는다 (구 인라인 cat>> 과 바이트 동등).
[ -n "$payload" ] && printf '%s\n' "$payload" >> "$ROOT/.oculpm/hooks/claude-events.jsonl" 2>/dev/null || true

sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
marker="$ROOT/.oculpm/hooks/.session-start-$sid"
missing=""
if [ -n "$sid" ] && [ -f "$marker" ]; then
  if [ -z "$(find "$ROOT/.oculpm/journal" -type f -name '*.md' -newer "$marker" 2>/dev/null | head -1)" ]; then
    missing=1
  fi
  rm -f "$marker" 2>/dev/null || true
fi
# 크래시 잔여 마커 청소 — SessionStart 가 아니라 여기(판정 뒤)서 돌려, 살아있는
# 장기 세션의 마커를 다른 세션의 시작이 쓸어가는 경합을 줄인다 (리뷰 LOW —
# 7일+ 열린 세션과의 잔여 경합은 미탐 방향이라 수용).
find "$ROOT/.oculpm/hooks" -name '.session-start-*' -mtime +7 -delete 2>/dev/null || true

if [ -n "$missing" ]; then
  signal="$ROOT/.oculpm/hooks/journal-missing.jsonl"
  # 무한 성장 방지 — 앱 소비자(후속 H3b)가 붙기 전까지의 상한. 200줄 초과 시
  # 최근 100줄만 보존 (신호는 최근성이 전부다).
  if [ -f "$signal" ] && [ "$(wc -l < "$signal" 2>/dev/null || echo 0)" -gt 200 ]; then
    tail -n 100 "$signal" > "$signal.tmp" 2>/dev/null && mv "$signal.tmp" "$signal" 2>/dev/null || true
  fi
  printf '{"ts":"%s","session_id":"%s","kind":"journal_missing"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sid" \
    >> "$signal" 2>/dev/null || true
  echo "oculpm: 이 세션은 일지 없이 끝났습니다 — 다음 세션에서 journal_write 로 남기거나, ocul-pm 앱의 일지 초안 기능을 켜 두세요" >&2
else
  echo "oculpm: 세션 기록됨 — /oculpm:standup 으로 오늘 요약, 회고·diff 대조는 ocul-pm 앱 (oculpm.com)" >&2
fi
exit 0
