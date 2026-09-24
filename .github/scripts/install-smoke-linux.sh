#!/usr/bin/env bash
# 설치 스모크 — Linux AppImage · deb (크로스플랫폼 W3 · L-PKG #w3-install-smoke · D10 · D11).
#
# 사용자는 Linux 를 직접 테스트할 수 없다 — 이 러너가 사용자 PC 다. 릴리스와 같은 설정
# (tauri.conf.json + tauri.linux.conf.json)으로 ubuntu-22.04 에서 만든 번들을 실제로
# 설치·실행·제거한다. 판정은 두 종류:
#   gate    — 실패하면 잡이 붉어진다.
#   observe — 기록만 한다(사실 확인 — 결론은 보고서가 낸다).
#
# 순서가 뜻을 갖는다: AppImage 를 **먼저** 돌린다. 이 러너에는 WebKitGTK 4.1 이 없으므로
# (빌드 잡과 다른 깨끗한 러너) AppImage 가 자기 안의 라이브러리만으로 뜨는지가 드러난다.
# deb 는 그 뒤 dpkg -i → apt-get -f install 로 Depends 를 실제로 끌어온다. Depends 가
# 모자란지는 러너 이미지(이미 깔린 게 많다)가 아니라 **깨끗한 컨테이너**
# (ubuntu:22.04 · debian:12 · ubuntu:24.04)에서 ldd 로 본다.
#
# 경로의 근거:
#   앱 로그  — src-tauri/src/lib.rs setup_logging:
#              ProjectDirs::from("com","kimhyunbin","ocul-pm").data_dir()/logs
#              = ~/.local/share/ocul-pm/logs/oculpm.log.YYYY-MM-DD, 기동 줄 `tracing initialised`
#   앱 데이터 — Tauri app_data_dir() = ~/.local/share/<identifier>, DB ocul-pm.db
#   AppImage 사이드카 안정 사본 — oculpm/paths/tool_config.rs stable_sidecar_dir()
#              = ~/.local/share/ocul-pm/bin/oculpm-mcp (lib.rs 기동 로그 "AppImage 사이드카 안정 사본 확인")
#
# 사용법: install-smoke-linux.sh <번들 폴더(.AppImage·.deb)> <기대 버전> <결과 폴더>
#
# shellcheck disable=SC2012,SC2015,SC2024
# (ls 로 보는 폴더는 우리가 만든 이름뿐 · `A && echo || B` 의 echo 는 실패하지 않는다 ·
#  sudo 명령의 출력은 일부러 사용자 소유 로그 파일로 받는다)
set -uo pipefail

BUNDLE_DIR=$(realpath "$1")
VERSION=$2
OUT_DIR=$3
mkdir -p "$OUT_DIR"
OUT_DIR=$(realpath "$OUT_DIR")

IDENTIFIER=com.kimhyunbin.ocul-pm
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
LOG_DIR=$DATA_HOME/ocul-pm/logs
APP_DATA=$DATA_HOME/$IDENTIFIER
DB=$APP_DATA/ocul-pm.db
STABLE_MCP=$DATA_HOME/ocul-pm/bin/oculpm-mcp
DISPLAY_NUM=:99
WORK=$(mktemp -d)

shopt -s nullglob
appimages=("$BUNDLE_DIR"/*.AppImage)
debs=("$BUNDLE_DIR"/*.deb)
APPIMAGE_FILE=${appimages[0]:-}
DEB_FILE=${debs[0]:-}

# ── 판정 기록 ──────────────────────────────────────────────────────────────
ROWS=()
GATES=0
FAILED=0
FAILED_NAMES=()

row() { # kind ok name detail
  local kind=$1 ok=$2 name=$3 detail=$4 mark
  detail=${detail//$'\n'/ ; }
  if [ "$kind" = observe ]; then mark="OBS "; elif [ "$ok" = 1 ]; then mark=PASS; else mark=FAIL; fi
  echo "[$mark] $name :: $detail"
  ROWS+=("$kind"$'\t'"$ok"$'\t'"$name"$'\t'"$detail")
  if [ "$kind" = gate ]; then
    GATES=$((GATES + 1))
    if [ "$ok" != 1 ]; then
      FAILED=$((FAILED + 1))
      FAILED_NAMES+=("$name")
    fi
  fi
}

# 함수 본문은 stdout 에 상세를 쓰고, 종료 코드로 성패를 말한다.
gate() { # name fn
  local name=$1 out
  shift
  if out=$("$@" 2>&1); then row gate 1 "$name" "$out"; else row gate 0 "$name" "$out"; fi
}
observe() {
  local name=$1 out
  shift
  if out=$("$@" 2>&1); then row observe 1 "$name" "$out"; else row observe 0 "$name" "관찰 실패: $out"; fi
}

wait_until() { # timeout_sec cmd...
  local timeout=$1 i
  shift
  for ((i = 0; i < timeout; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  "$@" >/dev/null 2>&1
}

# ── 공용 검사 ──────────────────────────────────────────────────────────────
# ELF 가 요구하는 가장 높은 GLIBC 심볼 판 (D11 — 하한 2.35 = ubuntu 22.04).
max_glibc() {
  objdump -T "$1" 2>/dev/null | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -1
}

check_glibc_floor() { # 설명 ELF...
  local label=$1 f max worst=0 report=()
  shift
  for f in "$@"; do
    [ -f "$f" ] || { echo "없다: $f"; return 1; }
    max=$(max_glibc "$f")
    report+=("$(basename "$f")=GLIBC_${max:-없음}")
    if [ -n "$max" ] && [ "$(printf '%s\n2.35\n' "$max" | sort -V | tail -1)" != "2.35" ]; then worst=1; fi
    if objdump -T "$f" 2>/dev/null | grep -q 'UND.*__isoc23_'; then
      report+=("$(basename "$f") 가 __isoc23_* 를 밖에서 찾는다(glibc_compat 미링크)")
      worst=1
    fi
  done
  echo "$label: ${report[*]}"
  return $worst
}

# ── 0. 준비 ────────────────────────────────────────────────────────────────
# gio(libglib2.0-bin)·xdg-mime(xdg-utils)·update-desktop-database(desktop-file-utils)는
# 데스크톱이면 있는 것 — 딥링크 처리기 등록과 `gio open` 검사에 쓴다. desktop-file-utils 는
# deb 설치 **전에** 있어야 dpkg 트리거가 mimeinfo.cache 를 고친다.
prepare() {
  sudo apt-get update -qq >/dev/null &&
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      xvfb x11-utils imagemagick binutils libglib2.0-bin xdg-utils desktop-file-utils >/dev/null &&
    echo "xvfb $(dpkg-query -W -f='${Version}' xvfb) · webkit2gtk-4.1 설치 여부: $(dpkg-query -W -f='${Status}' libwebkit2gtk-4.1-0 2>/dev/null || echo '없음')"
}
gate "준비 — Xvfb · x11-utils · ImageMagick · gio · xdg-utils (WebKitGTK 는 설치하지 않는다)" prepare

check_inputs() {
  [ -n "$APPIMAGE_FILE" ] || { echo ".AppImage 가 없다: $(ls "$BUNDLE_DIR")"; return 1; }
  [ -n "$DEB_FILE" ] || { echo ".deb 가 없다: $(ls "$BUNDLE_DIR")"; return 1; }
  ls -la "$BUNDLE_DIR" | tail -n +2
}
gate "번들 — .AppImage · .deb 가 있다" check_inputs

Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp >"$OUT_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
export DISPLAY=$DISPLAY_NUM
sleep 2

# ── 1. 정적 검사 — D11 glibc 하한 · deb 메타데이터 ─────────────────────────
extract_deb() { dpkg-deb -x "$DEB_FILE" "$WORK/deb-root" && find "$WORK/deb-root" -type f | sed "s|$WORK/deb-root||" | sort; }
gate "deb 내용물" extract_deb

extract_appimage() {
  (cd "$WORK" && "$APPIMAGE_FILE" --appimage-extract >/dev/null) &&
    echo "usr/bin: $(ls "$WORK/squashfs-root/usr/bin" | tr '\n' ' ') · usr/lib .so $(find "$WORK/squashfs-root/usr/lib" -name '*.so*' -type f | wc -l)개"
}
chmod +x "$APPIMAGE_FILE" 2>/dev/null
gate "AppImage 풀기 (--appimage-extract)" extract_appimage

gate "D11 — deb 실행 파일의 GLIBC 요구 ≤ 2.35 · __isoc23_ 미해결 없음" \
  check_glibc_floor deb "$WORK/deb-root/usr/bin/ocul-pm" "$WORK/deb-root/usr/bin/oculpm-mcp"
gate "D11 — AppImage 실행 파일의 GLIBC 요구 ≤ 2.35" \
  check_glibc_floor appimage "$WORK/squashfs-root/usr/bin/ocul-pm" "$WORK/squashfs-root/usr/bin/oculpm-mcp"

appimage_libs_glibc() {
  local f max worst="" top="0"
  while IFS= read -r f; do
    max=$(max_glibc "$f")
    [ -n "$max" ] || continue
    if [ "$(printf '%s\n%s\n' "$max" "$top" | sort -V | tail -1)" = "$max" ]; then top=$max; worst=$(basename "$f"); fi
  done < <(find "$WORK/squashfs-root/usr/lib" -name '*.so*' -type f)
  echo "AppImage 동봉 라이브러리 중 최고 GLIBC_$top ($worst)"
  [ "$(printf '%s\n2.35\n' "$top" | sort -V | tail -1)" = "2.35" ]
}
gate "D11 — AppImage 동봉 라이브러리의 GLIBC 요구 ≤ 2.35" appimage_libs_glibc

deb_control() {
  local pkg ver dep miss=()
  pkg=$(dpkg-deb -f "$DEB_FILE" Package)
  ver=$(dpkg-deb -f "$DEB_FILE" Version)
  dep=$(dpkg-deb -f "$DEB_FILE" Depends)
  echo "Package=$pkg Version=$ver Depends=$dep"
  [ "$pkg" = ocul-pm ] || { echo "Package 가 ocul-pm 이 아니다"; return 1; }
  [ "$ver" = "$VERSION" ] || { echo "Version 이 $VERSION 이 아니다"; return 1; }
  for want in libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 libssl3 libdbus-1-3; do
    grep -q "$want" <<<"$dep" || miss+=("$want")
  done
  [ ${#miss[@]} -eq 0 ] || { echo "Depends 에 없다: ${miss[*]}"; return 1; }
}
gate "deb control — Package · Version · Depends (webkit·gtk·appindicator·ssl·dbus)" deb_control

deb_desktop() {
  local f="$WORK/deb-root/usr/share/applications/Ocul-PM.desktop"
  [ -f "$f" ] || { echo "없다: $f"; return 1; }
  grep -E '^(Exec|MimeType|Icon|Categories)=' "$f" | tr '\n' ' '
  grep -q '^MimeType=.*x-scheme-handler/oculpm' "$f" || { echo "(oculpm:// 스킴 처리기 없음)"; return 1; }
  grep -q '^Exec=.* %u$' "$f" || { echo "(Exec 에 %u 가 없다 — 링크 URL 이 앱에 안 넘어간다)"; return 1; }
  grep -q '^Categories=..*' "$f" || { echo "(Categories 가 비었다 — 메뉴 분류 없음)"; return 1; }
}
gate "deb .desktop — oculpm:// 처리기 (MimeType · Exec %u) · Categories" deb_desktop

# ── 2. 깨끗한 컨테이너 — Depends 만으로 모든 공유 라이브러리가 풀리는가 ─────
container_check() { # image
  local image=$1
  docker run --rm -v "$BUNDLE_DIR:/pkg:ro" "$image" bash -c '
    set -u
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null 2>&1 || { echo "apt-get update 실패"; exit 10; }
    deb=$(ls /pkg/*.deb | head -1)
    if ! apt-get install -y -qq --no-install-recommends "$deb" >/tmp/apt.log 2>&1; then
      echo "설치 실패:"; tail -25 /tmp/apt.log; exit 11
    fi
    glibc=$(ldd --version | head -1 | grep -o "[0-9.]*$")
    miss=$(for b in /usr/bin/ocul-pm /usr/bin/oculpm-mcp; do ldd "$b" | grep "not found" | sed "s|^|$b: |"; done)
    if [ -n "$miss" ]; then echo "glibc $glibc · 못 찾은 라이브러리: $miss"; exit 12; fi
    ver=$(/usr/bin/oculpm-mcp --version 2>&1) || { echo "oculpm-mcp --version 실패: $ver"; exit 13; }
    echo "glibc $glibc · ldd 누락 0 · $ver · 설치 패키지 $(dpkg-query -W | wc -l)개"
  '
}
for image in ubuntu:22.04 debian:12 ubuntu:24.04; do
  gate "깨끗한 $image — apt-get install ./deb (Depends 만, --no-install-recommends) → ldd 누락 0 · 사이드카 실행" \
    container_check "$image"
done

# ── 3. 실행 공용 ───────────────────────────────────────────────────────────
APP_PID=""
APP_LABEL=""

# 실행마다 새 사용자처럼 — 로그와 앱 데이터를 비운다(두 번째 실행의 "DB 생성" 이
# 첫 실행이 남긴 파일로 거짓 통과하지 않게). AppImage 안정 사본 자리는 건드리지 않는다.
reset_state() { rm -rf "$LOG_DIR" "$APP_DATA"; }

# find 로 — 스크립트가 nullglob 을 켜 두어 `ls 글롭*` 은 맞는 게 없으면 현재 폴더를 나열한다.
latest_log() {
  find "$LOG_DIR" -maxdepth 1 -type f -name 'oculpm.log*' -printf '%T@ %p\n' 2>/dev/null |
    sort -rn | head -1 | cut -d' ' -f2-
}

log_has_boot() { local f; f=$(latest_log); [ -n "$f" ] && grep -q 'tracing initialised' "$f"; }

# dbus-run-session: 실제 데스크톱처럼 세션 버스를 준다 (single-instance · 알림 · keyring 이 쓴다).
# 감싼 서브셸이 앱이 끝나면 종료 코드를 파일에 적는다 — 생존 판정과 사인(死因)을 한 곳에서.
launch() { # label cmd...
  APP_LABEL=$1
  shift
  local runner=()
  if command -v dbus-run-session >/dev/null; then runner=(dbus-run-session --); fi
  rm -f "$OUT_DIR/$APP_LABEL.exit"
  (
    "${runner[@]}" "$@" >"$OUT_DIR/$APP_LABEL.stdout.log" 2>&1
    echo $? >"$OUT_DIR/$APP_LABEL.exit"
  ) &
  APP_PID=$!
}

app_alive() { [ -n "$APP_LABEL" ] && [ ! -f "$OUT_DIR/$APP_LABEL.exit" ]; }

check_boot_line() {
  if wait_until 90 log_has_boot; then latest_log; return 0; fi
  echo "90초 안에 $LOG_DIR 에 기동 줄이 없다 — 찾은 로그: $(find "$HOME" -name 'oculpm.log*' 2>/dev/null | tr '\n' ' ') · 앱 출력 끝: $(tail -5 "$OUT_DIR/$APP_LABEL.stdout.log" 2>/dev/null)"
  return 1
}

check_db() { wait_until 60 test -f "$DB" && echo "$DB" || { echo "60초 안에 $DB 가 없다"; return 1; }; }

has_window() { xwininfo -root -tree 2>/dev/null | grep -q '"Ocul-PM"'; }
check_window() {
  if wait_until 60 has_window; then xwininfo -root -tree | grep '"Ocul-PM"' | head -3 | sed 's/^ *//'; return 0; fi
  echo "60초 안에 'Ocul-PM' 창이 X 트리에 없다"
  return 1
}

check_webkit() {
  if wait_until 60 pgrep -f WebKitWebProcess; then
    echo "WebKitWebProcess $(pgrep -fc WebKitWebProcess)개"
    return 0
  fi
  echo "60초 안에 WebKitWebProcess 가 없다"
  return 1
}

# 프런트가 실제로 떴다는 증거 — src/windows/TabbedWindow.tsx 가 마운트 때
# oculpmLog.flow("App window mounted") 를 IPC 로 보내 앱 로그에 적는다.
log_has_mount() { local f; f=$(latest_log); [ -n "$f" ] && grep -q 'App window mounted' "$f"; }
check_frontend_mounted() {
  if wait_until 60 log_has_mount; then grep -m1 'App window mounted' "$(latest_log)"; return 0; fi
  echo "60초 안에 앱 로그에 App window mounted 가 없다 (웹뷰가 번들을 못 실었거나 IPC 가 안 돈다) · 앱 출력 끝: $(tail -5 "$OUT_DIR/$APP_LABEL.stdout.log" 2>/dev/null)"
  return 1
}

check_alive_20s() {
  sleep 20
  if app_alive; then echo "살아 있음 ($(pgrep -f 'usr/bin/ocul-pm' | tr '\n' ' '))"; return 0; fi
  echo "죽었다 (종료 코드 $(cat "$OUT_DIR/$APP_LABEL.exit")) · 출력 끝: $(tail -15 "$OUT_DIR/$APP_LABEL.stdout.log")"
  return 1
}

screenshot() { import -window root "$OUT_DIR/$APP_LABEL.png" && echo "$OUT_DIR/$APP_LABEL.png"; }

log_errors() {
  local f n
  f=$(latest_log)
  [ -n "$f" ] || { echo "로그 없음"; return 1; }
  cp "$f" "$OUT_DIR/$APP_LABEL.app.log"
  n=$(grep -cE '\b(ERROR|WARN)\b' "$f" || true)
  echo "ERROR/WARN ${n}줄: $(grep -E '\b(ERROR|WARN)\b' "$f" | head -8 | tr '\n' '|')"
}

# 앱 실행 파일은 어느 방식이든 경로가 `…/usr/bin/ocul-pm` 이다(deb: /usr/bin, FUSE:
# /tmp/.mount_*/usr/bin, 풀어서 실행: …/squashfs-root/usr/bin). AppImage 런타임은 파일 이름으로.
stop_app() {
  [ -n "$APP_PID" ] || return 0
  pkill -TERM -f 'usr/bin/ocul-pm' 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do app_alive || break; sleep 1; done
  pkill -KILL -f 'usr/bin/ocul-pm' 2>/dev/null
  if [ -n "$APPIMAGE_FILE" ]; then pkill -KILL -f "$(basename "$APPIMAGE_FILE")" 2>/dev/null; fi
  wait "$APP_PID" 2>/dev/null
  APP_PID=""
}

run_app_checks() { # label
  gate "$1 — 로그 기동 줄 [FLOW] tracing initialised" check_boot_line
  gate "$1 — 앱 데이터 ocul-pm.db 생성 (setup 이 DB 열기를 지났다)" check_db
  gate "$1 — 창 'Ocul-PM' (Xvfb X 트리)" check_window
  gate "$1 — WebKitGTK 웹 프로세스" check_webkit
  gate "$1 — 프런트: 웹뷰가 번들을 싣고 IPC 로 [FLOW] App window mounted 를 보냈다" check_frontend_mounted
  gate "$1 — 기동 20초 뒤에도 살아 있다" check_alive_20s
  observe "$1 — 스크린샷" screenshot
  observe "$1 — 앱 로그 ERROR/WARN" log_errors
}

# ── 4. AppImage (깨끗한 러너 — WebKitGTK 미설치) ──────────────────────────
# FUSE 로 직접 마운트해 도는지 먼저 본다(사용자의 보통 경로) — `--appimage-mount` 는
# 마운트하고 경로를 찍은 채 기다린다. 안 되면(러너에 FUSE 가 없거나 런타임이 libfuse2 를
# 찾는다) 풀어서 돈다(APPIMAGE_EXTRACT_AND_RUN). 어느 쪽이었는지는 관찰로 남긴다.
appimage_mode() {
  local first
  first=$(timeout 8 "$APPIMAGE_FILE" --appimage-mount 2>&1 | head -1)
  if [[ "$first" == /tmp/.mount_* ]]; then echo "direct (FUSE 마운트 $first)"; return 0; fi
  echo "extract-and-run (FUSE 마운트 실패: $first)"
  return 1
}
if out=$(appimage_mode); then APPIMAGE_ENV=(); else APPIMAGE_ENV=(env APPIMAGE_EXTRACT_AND_RUN=1); fi
row observe 1 "AppImage — 실행 방식" "$out"

# AppImage 는 linuxdeploy excludelist 의 라이브러리(libEGL·libGL·libgbm·libdrm·X11·fontconfig
# ·harfbuzz… — 그래픽 데스크톱이면 늘 있는 것)를 싣지 않고 호스트에서 찾는다. 헤드리스
# 러너에는 그중 일부가 없다(첫 실행: libEGL.so.1 없음 → 종료 코드 127). 무엇이 없었는지
# 기록한 뒤, 데스크톱이면 있는 꾸러미만 깔아 사용자 PC 를 흉내 낸다 — WebKitGTK 는 여전히
# 깔지 않는다(AppImage 가 자기 것을 쓰는지 보려는 것이므로).
appimage_host_libs() {
  local root="$WORK/squashfs-root" miss
  miss=$(for b in "$root/usr/bin/ocul-pm" "$root"/usr/lib/libwebkit2gtk-4.1.so.0 "$root"/usr/lib/libgstgl-1.0.so.0; do
    [ -e "$b" ] && LD_LIBRARY_PATH="$root/usr/lib" ldd "$b" 2>/dev/null | grep 'not found' | awk '{print $1}'
  done | sort -u | tr '\n' ' ')
  echo "이 러너에 없는 호스트 라이브러리: ${miss:-없음}"
}
observe "AppImage — 호스트에 기대는 라이브러리 중 러너에 없는 것 (ldd)" appimage_host_libs

desktop_baseline() {
  local left
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    libegl1 libgl1 libgbm1 libdrm2 libx11-xcb1 libfribidi0 libharfbuzz0b libfontconfig1 libfreetype6 >/dev/null ||
    return 1
  left=$(appimage_host_libs)
  echo "$left"
  [[ "$left" == *": 없음" ]]
}
gate "데스크톱 기본 라이브러리 (libegl1 · libgl1 · libgbm1 … — WebKitGTK 제외)" desktop_baseline

reset_state
launch appimage "${APPIMAGE_ENV[@]}" "$APPIMAGE_FILE"
row observe 1 "AppImage — 실행" "${APPIMAGE_ENV[*]} $APPIMAGE_FILE"
run_app_checks "AppImage"

appimage_stable_mcp() {
  local f
  f=$(latest_log)
  grep -q 'AppImage 사이드카 안정 사본 확인' "$f" 2>/dev/null || { echo "기동 로그에 안정 사본 줄이 없다: $(grep -i 'appimage' "$f" 2>/dev/null | head -3)"; return 1; }
  [ -x "$STABLE_MCP" ] || { echo "없다: $STABLE_MCP"; return 1; }
  "$STABLE_MCP" --version
}
gate "AppImage — 사이드카 안정 사본 ~/.local/share/ocul-pm/bin/oculpm-mcp --version" appimage_stable_mcp

# AppImage 는 설치 관리자가 없어 앱이 기동 때 스스로 oculpm:// 처리기를 적는다
# (lib.rs → tauri-plugin-deep-link register_all: ~/.local/share/applications/<exe>-handler.desktop,
# Exec="$APPIMAGE" %u, xdg-mime default).
appimage_scheme_handler() {
  local f="$DATA_HOME/applications/ocul-pm-handler.desktop"
  wait_until 20 test -f "$f" || { echo "없다: $f · 기동 로그: $(grep -i 'deep\|딥링크' "$(latest_log)" 2>/dev/null | head -3)"; return 1; }
  echo "$(grep -E '^(Exec|MimeType)=' "$f" | tr '\n' ' ') · xdg-mime default: $(xdg-mime query default x-scheme-handler/oculpm 2>&1)"
  grep -q '^Exec=.*%u' "$f"
}
observe "AppImage — oculpm:// 처리기 자가 등록 (Exec … %u)" appimage_scheme_handler
stop_app
# 뒤의 deb 검사가 AppImage 처리기(사용자 수준 기본값이 시스템 .desktop 을 이긴다)를 줍지 않게 걷어낸다.
rm -f "$DATA_HOME/applications/ocul-pm-handler.desktop"
sed -i '/x-scheme-handler\/oculpm/d' "$HOME/.config/mimeapps.list" "$DATA_HOME/applications/mimeapps.list" 2>/dev/null

# ── 5. deb (dpkg -i → apt-get -f install) ────────────────────────────────
deb_install() {
  local first
  first=$(sudo dpkg -i "$DEB_FILE" 2>&1) || echo "dpkg -i 가 의존성 때문에 멈춤(예상): $(grep -m3 -E 'depends on|dependency' <<<"$first" | tr '\n' ' ')"
  sudo DEBIAN_FRONTEND=noninteractive apt-get -f install -y -qq >"$OUT_DIR/apt-f-install.log" 2>&1 || { tail -20 "$OUT_DIR/apt-f-install.log"; return 1; }
  dpkg-query -W -f='${Status} ${Version}' ocul-pm | grep -q "install ok installed $VERSION" || { dpkg-query -W -f='${Status} ${Version}' ocul-pm; return 1; }
  echo "install ok installed $VERSION · 끌어온 패키지: $(grep -c '^Setting up' "$OUT_DIR/apt-f-install.log" || true)개"
}
gate "deb — sudo dpkg -i + apt-get -f install → 설치됨" deb_install

deb_files() {
  local f miss=()
  for f in /usr/bin/ocul-pm /usr/bin/oculpm-mcp /usr/share/applications/Ocul-PM.desktop; do
    [ -e "$f" ] || miss+=("$f")
  done
  [ ${#miss[@]} -eq 0 ] || { echo "없다: ${miss[*]}"; return 1; }
  echo "$(dpkg -L ocul-pm | grep -c .)개 경로 · 아이콘 $(dpkg -L ocul-pm | grep -c '/icons/')개"
}
gate "deb — 설치 위치 파일 (/usr/bin/ocul-pm · /usr/bin/oculpm-mcp · .desktop)" deb_files

deb_mcp() { local v; v=$(/usr/bin/oculpm-mcp --version 2>&1) && [ "$v" = "oculpm-mcp $VERSION" ] && echo "$v" || { echo "응답: $v"; return 1; }; }
gate "deb — 사이드카 /usr/bin/oculpm-mcp --version" deb_mcp

reset_state
launch deb /usr/bin/ocul-pm
row observe 1 "deb — 실행" "/usr/bin/ocul-pm"
run_app_checks "deb"
stop_app

# 딥링크 — 브라우저가 oculpm://… 를 열면 데스크톱이 .desktop 의 Exec 로 앱을 띄운다.
# Exec 에 %u 가 없으면 GLib(gio)는 %f 로 치고, oculpm:// 는 로컬 경로가 없어 URL 이
# 인자에서 빠진다 — 앱은 뜨지만 링크를 못 받는다. 실제로 gio open 으로 띄워 떠오른
# 프로세스의 명령줄에 URL 이 실렸는지 본다(Exec 가 맨 이름이라 argv0 는 ocul-pm).
deb_deeplink() {
  local url='oculpm://smoke/deeplink-probe' handler pid cmd
  command -v gio >/dev/null || { echo "gio 가 없다"; return 1; }
  handler=$(xdg-mime query default x-scheme-handler/oculpm 2>&1)
  reset_state
  gio open "$url" >"$OUT_DIR/deeplink-gio.log" 2>&1 &
  if ! wait_until 30 pgrep -x ocul-pm; then
    echo "처리기=$handler · 30초 안에 앱이 안 떴다: $(cat "$OUT_DIR/deeplink-gio.log")"
    return 1
  fi
  sleep 2
  pid=$(pgrep -x ocul-pm | head -1)
  cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline")
  pkill -TERM -x ocul-pm
  sleep 3
  pkill -KILL -x ocul-pm
  echo "처리기=$handler · 떠오른 명령줄: $cmd"
  [[ "$cmd" == *"$url"* ]]
}
gate "deb — gio open oculpm://… → 앱 명령줄에 URL 이 실린다 (.desktop Exec %u)" deb_deeplink

deb_remove() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq ocul-pm >"$OUT_DIR/apt-remove.log" 2>&1 || { tail -20 "$OUT_DIR/apt-remove.log"; return 1; }
  local left=() f
  for f in /usr/bin/ocul-pm /usr/bin/oculpm-mcp /usr/share/applications/Ocul-PM.desktop; do [ -e "$f" ] && left+=("$f"); done
  if dpkg-query -W -f='${Status}' ocul-pm 2>/dev/null | grep -q 'install ok installed'; then left+=("dpkg 상태: 아직 installed"); fi
  [ ${#left[@]} -eq 0 ] || { echo "남았다: ${left[*]}"; return 1; }
  echo "제거됨 · dpkg 상태: $(dpkg-query -W -f='${Status}' ocul-pm 2>/dev/null || echo '기록 없음')"
}
gate "deb — apt-get remove → 실행 파일 · .desktop 없음" deb_remove

leftovers() {
  local p
  for p in "$APP_DATA" "$DATA_HOME/ocul-pm" "$HOME/.config/$IDENTIFIER" "$HOME/.cache/$IDENTIFIER"; do
    if [ -e "$p" ]; then echo "$p=남음"; else echo "$p=없음"; fi
  done
}
observe "제거 뒤 사용자 데이터 (패키지는 홈을 건드리지 않는다)" leftovers

kill "$XVFB_PID" 2>/dev/null

# ── 요약 ───────────────────────────────────────────────────────────────────
{
  echo "## 설치 스모크 — linux (Ocul-PM $VERSION)"
  echo ""
  echo "gate ${GATES}건 중 실패 ${FAILED}건"
  echo ""
  echo "| 종류 | 결과 | 항목 | 상세 |"
  echo "|---|---|---|---|"
  for r in "${ROWS[@]}"; do
    IFS=$'\t' read -r kind ok name detail <<<"$r"
    if [ "$kind" = observe ]; then res=$([ "$ok" = 1 ] && echo 기록 || echo '관찰 실패'); elif [ "$ok" = 1 ]; then res=통과; else res='**실패**'; fi
    detail=${detail//|/\\|}
    [ ${#detail} -gt 600 ] && detail="${detail:0:600}…"
    echo "| $kind | $res | $name | $detail |"
  done
} >"$OUT_DIR/summary.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$OUT_DIR/summary.md" >>"$GITHUB_STEP_SUMMARY"; fi

if [ "$FAILED" -gt 0 ]; then
  echo "::error::설치 스모크(linux) gate 실패 ${FAILED}건: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "설치 스모크(linux) 통과 — gate ${GATES}건"
