#!/usr/bin/env bash
# AppImage 런처(AppRun)를 Tauri 번들러 캐시에 0755 로 미리 놓는다 — `pnpm tauri build` 앞.
#
# 번들러(tauri-bundler 2.9.x `write_and_make_executable`)는 캐시에 AppRun 이 없을 때만 받아
# **0770** 으로 쓰고, 그것을 AppDir 로 복사(fs::copy — 모드 보존)한다. linuxdeploy 가 그것을
# AppRun.wrapped 로 옮겨 AppImage 안에 `-rwxrwx---` 로 실린다. 같은 사용자가 띄우면 멀쩡하지만
# root 가 마운트하고 다른 사용자가 띄우는 경로(firejail --appimage — AppImage 카탈로그
# appimage.github.io 의 실행 테스트가 정확히 이것)에서는 `Permission denied` 로 아예 안 뜬다.
# 캐시에 있으면 받지 않으므로 우리 파일의 모드가 그대로 실린다.
#
# 업스트림 tauri-apps/tauri#16155 — CLI 2.12 에서 고쳐졌다. 2.12 로 올리면 이 스크립트와 두
# 워크플로의 호출을 지운다(appimage-lint.sh 가 그 뒤에도 모드를 지킨다).
#
# URL 은 번들러가 받는 것과 같다. 해시는 v3.6.0 AppImage 안의 AppRun.wrapped 와 같다 —
# 다르면 업스트림 파일이 바뀐 것이니 확인한 뒤 갱신한다.
set -euo pipefail

url=https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64
sha=f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f
# dirs::cache_dir() 의 Linux 값 + "tauri" (tauri-bundler linuxdeploy.rs tools_path).
dir="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp" "$url"
if ! echo "$sha  $tmp" | sha256sum -c --quiet -; then
  echo "::error::AppRun-x86_64 의 SHA-256 이 고정값과 다르다 — 업스트림 파일을 확인하고 sha 를 갱신할 것"
  exit 1
fi
mkdir -p "$dir"
install -m 0755 "$tmp" "$dir/AppRun-x86_64"
echo "AppRun-x86_64 → $dir (0755, sha256 $sha)"
