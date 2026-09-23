#!/bin/sh
# ocul-pm — 이벤트 싱크의 **파일 판** (Codex · Windows 전용).
#
# hooks.json 의 SessionStart·Stop 첫 훅은 한 줄짜리 인라인 sh 다. Codex 는
# Windows 에서 훅을 `cmd.exe /C` 로 돌려 그 한 줄을 읽지 못한다 — 그래서 Codex 판
# hooks.json 만 `commandWindows` 로 run-sh.cmd → Git Bash → 이 파일을 부른다.
# 하는 일은 인라인과 같다 (tests/plugin_xplat.rs 가 두 판을 같은 payload 로 돌려
# 같은 줄이 쌓이는지 잰다):
#   ① 추적 프로젝트일 때만 쓴다 ② payload 가 `}` 로 끝나면 `oculpm_ts`(UTC) 를
#   끼운다 ③ `printf '%s\n'` 으로 개행을 붙여 append ④ stdin 은 늘 소비, 실패는 무해.
# 인라인과 다른 점은 루트 폴백 하나 — CLAUDE_PROJECT_DIR → payload 의 cwd → 현재
# 디렉터리. Codex 는 CLAUDE_PROJECT_DIR 을 주지 않는다 (형제 훅과 같은 3단).
payload=$(cat 2>/dev/null || true)
# Windows 에서 온 payload 가 CRLF 로 끝나면 `$(…)` 가 LF 만 떼고 CR 이 남는다.
cr=$(printf '\r')
payload=${payload%"$cr"}
ROOT="${CLAUDE_PROJECT_DIR:-}"
# Windows 경로는 JSON 안에서 `\\` 로 온다 — 한 번 푼다.
[ -n "$ROOT" ] || ROOT=$(printf '%s' "$payload" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -e 's/.*"\([^"]*\)"$/\1/' -e 's/\\\\/\\/g')
[ -n "$ROOT" ] || ROOT="."
[ -d "$ROOT/.oculpm" ] || exit 0
[ -n "$payload" ] || exit 0
case "$payload" in
  *\}) payload="${payload%\}},\"oculpm_ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" ;;
esac
mkdir -p "$ROOT/.oculpm/hooks" 2>/dev/null || exit 0
printf '%s\n' "$payload" >> "$ROOT/.oculpm/hooks/claude-events.jsonl" 2>/dev/null || true
exit 0
