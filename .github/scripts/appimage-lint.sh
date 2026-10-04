#!/usr/bin/env bash
# AppImage 내용 린트 — 우리 스모크가 못 보는 두 실행 경로를 이미지 안에서 정적으로 본다.
#
#   1. 마운트 지점에서만 해석되는 심링크. 빌드 러너에서는 절대경로 심링크가 아직 남아 있는
#      AppDir 를 가리켜 멀쩡해 보이지만, 사용자 PC 의 /tmp/.mount_* 안에서는 끊긴다.
#      v3.6.0 의 .DirIcon 이 그랬다 → AppImage 카탈로그의 appdir-lint 가
#      "FATAL: .DirIcon is missing" 으로 거절(appimage.github.io#9061, tauri-apps/tauri#15110).
#   2. 소유자만 읽거나 실행할 수 있는 항목. 스모크는 같은 사용자로 띄워서 못 잡는다. root 가
#      마운트하고 다른 사용자가 띄우면(firejail --appimage) 안 뜬다. v3.6.0 의 AppRun.wrapped
#      0770 (tauri-apps/tauri#16155 — seed-appimage-apprun.sh 가 막는다).
#
# 쓰기: appimage-lint.sh <파일.AppImage | 풀어 둔 AppDir>
#   release.yml · portability.yml 번들 잡의 산출물 단계. 하나라도 걸리면 exit 1.
set -euo pipefail

src="$1"
if [ -d "$src" ]; then
  root="$(cd "$src" && pwd -P)"
else
  x="$(mktemp -d)"
  trap 'rm -rf "$x"' EXIT
  # 런타임은 이미지의 모드로 풀되 umask 가 깎는다 — 022 로 고정해야 "o 비트 없음" 이
  # 러너 설정이 아니라 이미지의 사실이 된다.
  umask 022
  (cd "$x" && "$(cd "$(dirname "$src")" && pwd -P)/$(basename "$src")" --appimage-extract >/dev/null)
  root="$x/squashfs-root"
fi

fail=0
err() { echo "::error::AppImage 린트 — $*"; fail=1; }

[ -e "$root/.DirIcon" ] || [ -L "$root/.DirIcon" ] || err ".DirIcon 이 없다"

# 모든 심링크: 상대경로이고, 이미지 안에서 해석되고, 이미지 밖으로 나가지 않는다.
while IFS= read -r -d '' l; do
  rel="${l#"$root"/}"
  t="$(readlink "$l")"
  case "$t" in
    /*) err "$rel → $t (절대경로 — 마운트 지점에서 끊긴다)"; continue ;;
  esac
  if [ ! -e "$l" ]; then err "$rel → $t (끊김)"; continue; fi
  case "$(realpath "$l")" in
    "$root"/*) ;;
    *) err "$rel → $t (이미지 밖을 가리킨다)" ;;
  esac
done < <(find "$root" -type l -print0)

# 권한: 모두가 읽을 수 있고, 소유자가 실행할 수 있으면 모두가 실행할 수 있다(디렉터리 포함).
bad="$(find "$root" -mindepth 1 ! -type l \( ! -perm -004 -o \( -perm -100 ! -perm -001 \) \) -print)"
if [ -n "$bad" ]; then
  while IFS= read -r f; do
    err "$(ls -ld "$f" | awk '{print $1}') ${f#"$root"/} (소유자 전용 — 다른 사용자로 띄우면 안 뜬다)"
  done <<<"$bad"
fi

[ "$fail" -eq 0 ] || exit 1
echo "AppImage 린트 통과 — 심링크 $(find "$root" -type l | wc -l | tr -d ' ')개 모두 상대·내부, 소유자 전용 항목 없음"
