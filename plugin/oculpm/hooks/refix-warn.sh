#!/bin/sh
# ocul-pm — PreToolUse(Edit·Write·MultiEdit·NotebookEdit): 재수정 경고 (11-02).
# 고치려는 파일이 최근 7일 버그 일지의 files_touched 에 있으면 그 버그와 그때의
# 확인 명령을 additionalContext 로 들려준다. **막지 않는다** (허가 결정을 내지
# 않는다 — 내면 사용자의 권한 묻기를 건너뛴다). 판단은 `oculpm-mcp refix`
# (src-tauri/src/oculpm/refix.rs) 한 자리, 이 셸은 길만 놓는다.
#
# 계약: stdin 즉시 소비 · 네트워크 없음 · 모든 실패는 무해(exit 0, 출력 없음).
payload=$(cat 2>/dev/null || true)
ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$ROOT" ] || ROOT=$(printf '%s' "$payload" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -e 's/.*"\([^"]*\)"$/\1/' -e 's/\\\\/\\/g')
[ -n "$ROOT" ] || ROOT="."
[ -d "$ROOT/.oculpm" ] || exit 0
for _link in .oculpm .oculpm/hooks .oculpm/journal; do
  if [ -L "$ROOT/$_link" ]; then exit 0; fi
done
# BSD sed(macOS)의 BRE 에는 `\|` 가 없다 — 열쇠 둘을 차례로 본다.
file=$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$file" ] || file=$(printf '%s' "$payload" | sed -n 's/.*"notebook_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
file=$(printf '%s' "$file" | sed 's/\\\\/\\/g')
[ -n "$file" ] || exit 0
sid=$(printf '%s' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9._-]*\)".*/\1/p' | head -1)
plugin_root=${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." 2>/dev/null && pwd)}
bin="$plugin_root/bin/oculpm-mcp"
[ -x "$bin" ] || exit 0
out=$("$bin" refix --root "$ROOT" --file "$file" --conversation "$sid" 2>/dev/null) || exit 0
[ -n "$out" ] && printf '%s\n' "$out"
exit 0
