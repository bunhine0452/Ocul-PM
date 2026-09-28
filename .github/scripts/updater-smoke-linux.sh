#!/usr/bin/env bash
# 업데이터 스모크 — Linux AppImage N→N+1 · deb 안내 (크로스플랫폼 L-UPD #w3-updater-smoke).
#
# 사용자는 Linux 를 직접 테스트할 수 없다 — 첫 공개 판의 업데이터가 깨져 있으면 사용자는 그
# 판에 갇힌다. 그래서 앱 안 업데이터의 한 바퀴를 이 러너에서 실제로 돌린다:
#
#   N   = 스모크 판. portability.yml bundle 잡이 `--config` 로 업데이터 엔드포인트를
#         http://127.0.0.1:<port>/latest.json, 공개 키를 그 잡의 일회용 키로 돌려 굽고
#         (판은 N+1 보다 낮게), 프런트는 VITE_OCULPM_UPDATER_SMOKE=1 — 새 판을 찾으면 배너의
#         「지금 업데이트」 와 같은 install() 을 스스로 부른다(components/UpdateBanner.tsx).
#   N+1 = 릴리스와 같은 설정으로 구운 AppImage(같은 일회용 키로 서명한 .sig). 로컬 서버
#         (updater-smoke-http.mjs)가 latest.json(키 linux-x86_64-appimage — 릴리스와 같다)과
#         함께 내준다.
#
# 순서가 뜻을 갖는다 — 거절부터:
#   1. 서명이 다른 파일의 것(키는 맞고 내용이 다름) → 받은 뒤 검증에서 거절, AppImage 불변
#   2. 서명이 다른 키의 것(일회용 키 둘째)          → 거절, AppImage 불변
#   3. 맞는 서명 → AppImage 가 N+1 로 바뀌고(sha256) 앱이 스스로 다시 떠 기동 줄이 새 판을 말한다
#   4. deb(스모크 판) → 업데이터에 묻지 않고 패키지 관리자 안내, 접근 로그 0줄
#
# 판정 두 종류(install-smoke-linux.sh 와 같다): gate 는 실패하면 잡이 붉고, observe 는 기록만.
# 증거: 앱 로그(단계마다 logs-<단계>/ 로 떼어 둔다) · 접근 로그 · 스크린샷 · summary.md.
#
# 경로의 근거: 앱 로그 = ~/.local/share/<identifier>/logs/oculpm.log.YYYY-MM-DD (install-smoke 와
# 같다). 기동 줄 `[FLOW] install kind — version X` 는 src-tauri/src/commands/install_kind.rs,
# 업데이터 줄 `check -> …` · `install -> …` 는 src/lib/updater.ts 가 남긴다.
#
# 세션 D-Bus 는 바깥(워크플로)의 `dbus-run-session --` 이 스크립트 전체에 하나 준다 — 앱이
# 스스로 다시 뜰 때 옛 프로세스와 함께 버스가 사라지지 않게.
#
# 사용법: updater-smoke-linux.sh <번들 폴더(N+1 .AppImage)> <업데이터 재료 폴더> <결과 폴더>
#
# shellcheck disable=SC2012,SC2015,SC2024
# (ls 로 보는 폴더는 우리가 만든 이름뿐 · `A && echo || B` 의 echo 는 실패하지 않는다 ·
#  sudo 명령의 출력은 일부러 사용자 소유 로그 파일로 받는다)
set -uo pipefail

BUNDLE_DIR=$(realpath "$1")
UPD_DIR=$(realpath "$2")
OUT_DIR=$3
mkdir -p "$OUT_DIR"
OUT_DIR=$(realpath "$OUT_DIR")
HTTP=$(dirname "$(realpath "$0")")/updater-smoke-http.mjs

info() { grep -m1 "^$1=" "$UPD_DIR/updater-info.txt" 2>/dev/null | cut -d= -f2- | tr -d '\r'; }
BASE=$(info base_version)
NEW=$(info payload_version)
PORT=$(info port)

IDENTIFIER=com.kimhyunbin.ocul-pm
DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
LOG_DIR=$DATA_HOME/$IDENTIFIER/logs
KEY=linux-x86_64-appimage
DISPLAY_NUM=:98
WORK=$(mktemp -d)
SERVE=$WORK/serve
ACCESS=$OUT_DIR/access.log

BASE_APPIMAGE=$UPD_DIR/base/Ocul-PM_${BASE}_amd64.AppImage
BASE_SIG=$BASE_APPIMAGE.sig
BASE_DEB=$UPD_DIR/base/Ocul-PM_${BASE}_amd64.deb
PAYLOAD=$BUNDLE_DIR/Ocul-PM_${NEW}_amd64.AppImage
PAYLOAD_SIG=$UPD_DIR/payload.sig
FOREIGN_SIG=$UPD_DIR/foreign.sig
# 사용자가 받아 둔 자리처럼 — 쓰기 가능한 폴더, 이름은 받은 그대로.
APP_FILE=$WORK/apps/Ocul-PM_${BASE}_amd64.AppImage
URL=http://127.0.0.1:$PORT/Ocul-PM_${NEW}_amd64.AppImage

# ── 판정 기록 (install-smoke-linux.sh 와 같은 모양) ─────────────────────────
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

gate() { # name fn...
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

sha() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }

# ── 앱 로그 · 접근 로그 ────────────────────────────────────────────────────
# 단계마다 로그 폴더를 비우고(앞 단계 것은 결과 폴더로 옮긴다) 시작한다 — 판정이 앞 단계의
# 줄을 줍지 않게. 앱 데이터는 두어 실제 사용자처럼 이어 간다.
log_text() { cat "$LOG_DIR"/oculpm.log* 2>/dev/null; }
log_has() { log_text | grep -qF -- "$1"; }
log_last() { log_text | grep -F -- "$1" | tail -1 | sed 's/^ *//'; }
log_count() { log_text | grep -cF -- "$1" || true; }
archive_logs() { # label
  mkdir -p "$OUT_DIR/logs-$1"
  if [ -d "$LOG_DIR" ]; then mv "$LOG_DIR"/* "$OUT_DIR/logs-$1/" 2>/dev/null; fi
  return 0
}
access_hits() { # path → 200 줄 수
  grep -F "\"path\":\"$1\"" "$ACCESS" 2>/dev/null | grep -cF '"status":200' || true
}
access_bytes() { # path → 마지막 200 응답의 바이트
  grep -F "\"path\":\"$1\"" "$ACCESS" 2>/dev/null | grep -F '"status":200' | tail -1 | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p'
}

# ── 앱 실행 ────────────────────────────────────────────────────────────────
APP_PID=""
APP_LABEL=""
APPIMAGE_ENV=()

launch() { # label cmd...
  APP_LABEL=$1
  shift
  rm -f "$OUT_DIR/$APP_LABEL.exit"
  (
    "$@" >"$OUT_DIR/$APP_LABEL.stdout.log" 2>&1
    echo $? >"$OUT_DIR/$APP_LABEL.exit"
  ) &
  APP_PID=$!
}
launched_exited() { [ -f "$OUT_DIR/$APP_LABEL.exit" ]; }
app_pids() { pgrep -x ocul-pm | tr '\n' ' '; }
any_app() { [ -n "$(app_pids)" ]; }
stop_app() {
  pkill -TERM -x ocul-pm 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! any_app; then break; fi
    sleep 1
  done
  pkill -KILL -x ocul-pm 2>/dev/null
  pkill -KILL -f 'Ocul-PM_.*\.AppImage' 2>/dev/null
  if [ -n "$APP_PID" ]; then wait "$APP_PID" 2>/dev/null; fi
  APP_PID=""
  sleep 1
}
screenshot() { import -window root "$OUT_DIR/$1.png" && echo "$OUT_DIR/$1.png"; }

write_latest() { # sig notes
  node "$HTTP" latest --out "$SERVE/latest.json" --version "$NEW" --url "$URL" --sig "$1" --keys "$KEY" --notes "$2"
}

# ── 0. 준비 ────────────────────────────────────────────────────────────────
check_inputs() {
  local missing=() f
  [ -n "$BASE" ] && [ -n "$NEW" ] && [ -n "$PORT" ] || { echo "updater-info.txt 가 모자라다: $(tr '\n' ' ' <"$UPD_DIR/updater-info.txt" 2>/dev/null)"; return 1; }
  for f in "$BASE_APPIMAGE" "$BASE_SIG" "$BASE_DEB" "$PAYLOAD" "$PAYLOAD_SIG" "$FOREIGN_SIG" "$HTTP"; do
    [ -s "$f" ] || missing+=("$f")
  done
  [ ${#missing[@]} -eq 0 ] || { echo "없다: ${missing[*]} · 번들: $(ls "$BUNDLE_DIR" | tr '\n' ' ') · 재료: $(find "$UPD_DIR" -type f -printf '%P ' 2>/dev/null)"; return 1; }
  [ "$(printf '%s\n%s\n' "$BASE" "$NEW" | sort -V | tail -1)" = "$NEW" ] && [ "$BASE" != "$NEW" ] || { echo "스모크 판 $BASE 가 새 판 $NEW 보다 낮지 않다"; return 1; }
  # 새 판의 .sig 는 재료와 같은 run 의 번들에 대한 것이다 — 다른 run 의 번들이 섞이면 설치
  # 시험이 「서명 불일치」 로 거짓 실패한다. 받은 번들이 그 파일인지 먼저 본다.
  [ "$(sha "$PAYLOAD")" = "$(info payload_sha256)" ] || { echo "받은 새 판이 재료의 것이 아니다: $(sha "$PAYLOAD") ≠ $(info payload_sha256)"; return 1; }
  echo "N=$BASE → N+1=$NEW · 포트 $PORT · 키 $KEY · $(tr '\n' ' ' <"$UPD_DIR/updater-info.txt")"
}
gate "입력 — 스모크 판(N) · 새 판(N+1) · 서명 셋 · updater-info.txt" check_inputs

# install-smoke-linux.sh 와 같은 꾸러미: 헤드리스 러너에 없는 데스크톱 기본 라이브러리(그래픽
# 드라이버에 딸린 것 — AppImage 가 호스트에서 찾는다). WebKitGTK 는 깔지 않는다(AppImage 가 싣는다).
prepare() {
  sudo apt-get update -qq >/dev/null &&
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      xvfb x11-utils imagemagick \
      libegl1 libgles2 libgl1 libgbm1 libdrm2 libx11-xcb1 libfribidi0 libharfbuzz0b libfontconfig1 libfreetype6 >/dev/null &&
    echo "xvfb $(dpkg-query -W -f='${Version}' xvfb) · 세션 버스 ${DBUS_SESSION_BUS_ADDRESS:-없음}"
}
gate "준비 — Xvfb · ImageMagick · 데스크톱 기본 라이브러리 · 세션 D-Bus" prepare

Xvfb "$DISPLAY_NUM" -screen 0 1280x800x24 -nolisten tcp >"$OUT_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
export DISPLAY=$DISPLAY_NUM
sleep 2

place_app() {
  mkdir -p "$WORK/apps" "$SERVE" &&
    cp "$BASE_APPIMAGE" "$APP_FILE" && chmod +x "$APP_FILE" &&
    cp "$PAYLOAD" "$SERVE/" &&
    echo "N $APP_FILE sha256=$(sha "$APP_FILE") · N+1 $(basename "$PAYLOAD") sha256=$(sha "$PAYLOAD") ($(wc -c <"$PAYLOAD") B)"
}
gate "배치 — 스모크 판 AppImage 를 쓰기 가능한 폴더에 · 새 판을 서버 루트에" place_app
BASE_HASH=$(sha "$APP_FILE")
NEW_HASH=$(sha "$PAYLOAD")

# FUSE 로 직접 마운트해 도는지(사용자의 보통 경로) — 안 되면 풀어서 돈다(install-smoke 와 같다).
appimage_mode() {
  local first
  first=$(timeout 8 "$APP_FILE" --appimage-mount 2>&1 | head -1)
  if [[ "$first" == /tmp/.mount_* ]]; then echo "direct (FUSE 마운트 $first)"; return 0; fi
  echo "extract-and-run (FUSE 마운트 실패: $first)"
  return 1
}
if out=$(appimage_mode); then APPIMAGE_ENV=(); else APPIMAGE_ENV=(env APPIMAGE_EXTRACT_AND_RUN=1); fi
row observe 1 "AppImage — 실행 방식" "$out"

# 서버는 gate 밖에서 띄운다 — gate 는 본문을 $(…) 서브셸에서 돌려 PID 를 잃는다.
node "$HTTP" serve --root "$SERVE" --port "$PORT" --log "$ACCESS" >"$OUT_DIR/http.out" 2>&1 &
HTTP_PID=$!
server_up() {
  wait_until 20 curl -fsS -o /dev/null "http://127.0.0.1:$PORT/$(basename "$PAYLOAD")" || { echo "서버가 안 뜬다: $(cat "$OUT_DIR/http.out")"; return 1; }
  head -1 "$OUT_DIR/http.out"
}
gate "로컬 업데이트 서버 — 127.0.0.1:$PORT" server_up

# ── 1·2. 거절 — 서명이 틀린 latest.json ───────────────────────────────────
# 앱이 latest.json 을 묻고 → 새 판을 끝까지 받고 → 검증에서 거절해야 한다. 받기 전에 끝나면
# (주소·서버 문제) 서명을 본 것이 아니므로 「받았다」 도 gate 다. 단계 이름(PHASE)은 파일
# 이름에도 쓰므로 ASCII 로.
PHASE=""
EXPECT=""

boot_is_base() {
  wait_until 90 log_has "install kind — version $BASE" || { echo "90초 안에 기동 줄(판 $BASE)이 없다 · 앱 출력 끝: $(tail -5 "$OUT_DIR/$PHASE.stdout.log" 2>/dev/null)"; return 1; }
  local line
  line=$(log_last "install kind — version")
  [[ "$line" == *"bundle=appimage"* ]] || { echo "설치 형식이 appimage 가 아니다: $line"; return 1; }
  echo "$line"
}

rejected() {
  wait_until 180 log_has 'install -> error' || { echo "180초 안에 install -> error 가 없다 · updater 줄: $(log_text | grep -F 'updater' | tail -5 | tr '\n' '|') · 접근: $(tr '\n' ' ' <"$ACCESS")"; return 1; }
  local line
  line=$(log_last 'install -> error')
  [[ "$line" == *"$EXPECT"* ]] || { echo "거절 문장이 기대('$EXPECT')와 다르다: $line"; return 1; }
  if log_has 'install -> installed'; then echo "거절됐다면서 installed 줄이 있다: $(log_last 'install -> installed')"; return 1; fi
  echo "$line"
}

downloaded() {
  local q p b want
  q=$(access_hits /latest.json)
  p=$(access_hits "/$(basename "$PAYLOAD")")
  b=$(access_bytes "/$(basename "$PAYLOAD")")
  want=$(wc -c <"$PAYLOAD")
  echo "latest.json 200×$q · 새 판 200×$p (${b:-0}/$want B)"
  [ "$q" -ge 1 ] && [ "$p" -ge 1 ] && [ "${b:-0}" = "$want" ]
}

unchanged() {
  local h
  h=$(sha "$APP_FILE")
  [ "$h" = "$BASE_HASH" ] && echo "sha256 그대로 $h" || { echo "AppImage 가 바뀌었다: $h (원래 $BASE_HASH)"; return 1; }
}

still_alive() {
  sleep 3
  if launched_exited; then echo "앱이 끝났다 (종료 코드 $(cat "$OUT_DIR/$PHASE.exit"))"; return 1; fi
  echo "살아 있음 (ocul-pm pid $(app_pids))"
}

negative_phase() { # phase sig 기대-문장 설명
  PHASE=$1
  EXPECT=$3
  : >"$ACCESS"
  gate "$PHASE — latest.json ($4)" write_latest "$2" "$PHASE"
  launch "$PHASE" "${APPIMAGE_ENV[@]}" "$APP_FILE"
  gate "$PHASE — 스모크 판이 떴다 (기동 줄 판 $BASE · bundle=appimage)" boot_is_base
  gate "$PHASE — 서명 검증이 거절했다 ('$EXPECT')" rejected
  gate "$PHASE — 새 판을 끝까지 받은 뒤 거절했다 (접근 로그)" downloaded
  gate "$PHASE — AppImage 불변" unchanged
  gate "$PHASE — 앱은 N 그대로 살아 있다" still_alive
  observe "$PHASE — 스크린샷 (배너: 업데이트 실패)" screenshot "$PHASE"
  stop_app
  archive_logs "$PHASE"
}

negative_phase reject-content "$BASE_SIG" "The signature verification failed" "서명은 같은 키지만 스모크 판 파일의 것"
negative_phase reject-key "$FOREIGN_SIG" "different key than the one provided" "새 판을 다른 일회용 키로 서명한 것"

# ── 3. 설치 — 맞는 서명 ────────────────────────────────────────────────────
PHASE=install
: >"$ACCESS"
gate "$PHASE — latest.json (새 판의 .sig)" write_latest "$PAYLOAD_SIG" "$PHASE"
launch "$PHASE" "${APPIMAGE_ENV[@]}" "$APP_FILE"

is_new_file() { [ "$(sha "$APP_FILE")" = "$NEW_HASH" ]; }
replaced() {
  wait_until 240 is_new_file || {
    echo "240초 안에 AppImage 가 새 판으로 안 바뀌었다 ($(sha "$APP_FILE")) · updater 줄: $(log_text | grep -F 'updater' | tail -6 | tr '\n' '|') · 접근: $(tr '\n' ' ' <"$ACCESS")"
    return 1
  }
  [ -x "$APP_FILE" ] || { echo "실행 권한이 없다: $(stat -c '%A' "$APP_FILE")"; return 1; }
  echo "sha256 $NEW_HASH == 새 판 · 권한 $(stat -c '%A' "$APP_FILE")"
}
gate "$PHASE — 서명 검증 통과 → AppImage 가 새 판으로 바뀌었다 (sha256)" replaced

# 서명 검증 통과의 증거는 위의 교체 자체다(플러그인은 검증한 바이트만 쓴다). 여기서는 앱이
# 그 길로 갔다는 것만 — install -> start 는 받기 전에 남아 늘 파일에 닿는다. install ->
# installed 는 재시작 직전에 남아 비차단 로그 작성기가 못 쓰고 끝날 수 있어 기록만 한다.
verified() {
  log_has 'install -> start' || { echo "install -> start 줄이 없다 · updater 줄: $(log_text | grep -F 'updater' | tail -5 | tr '\n' '|')"; return 1; }
  if log_has 'install -> error'; then echo "오류 줄이 있다: $(log_last 'install -> error')"; return 1; fi
  log_last 'install -> start'
}
gate "$PHASE — 앱 로그 install -> start · 오류 줄 없음" verified
installed_line() { wait_until 10 log_has 'install -> installed' && log_last 'install -> installed' || { echo "없음 (재시작 직전 줄이라 비차단 작성기가 못 썼을 수 있다)"; return 1; }; }
observe "$PHASE — 앱 로그 install -> installed" installed_line

relaunched() {
  wait_until 120 log_has "install kind — version $NEW" || { echo "120초 안에 새 판($NEW) 기동 줄이 없다 · 기동 줄: $(log_text | grep -F 'install kind' | tr '\n' '|') · 앱 출력 끝: $(tail -5 "$OUT_DIR/$PHASE.stdout.log" 2>/dev/null)"; return 1; }
  wait_until 30 any_app || { echo "기동 줄은 있는데 ocul-pm 프로세스가 없다"; return 1; }
  echo "기동 줄의 판: $(log_text | grep -F 'install kind — version' | sed 's/.*install kind — version \([^ ]*\).*/\1/' | tr '\n' ' ')· 지금 pid $(app_pids)"
}
gate "$PHASE — 앱이 스스로 다시 떴고 기동 줄이 새 판 $NEW 을 말한다" relaunched

old_gone() {
  wait_until 30 launched_exited || { echo "처음 띄운 프로세스가 30초 뒤에도 안 끝났다"; return 1; }
  echo "처음 띄운 프로세스 종료 코드 $(cat "$OUT_DIR/$PHASE.exit") · 새 프로세스 pid $(app_pids)"
}
gate "$PHASE — 옛 프로세스는 끝났다 (재시작이지 두 벌이 아니다)" old_gone

# 새 판은 릴리스 설정(엔드포인트 GitHub · 진짜 공개 키)이다 — 떠서 한 번 묻는다. 결과는
# 그날의 GitHub latest.json 에 달렸으므로 기록만(이 OS 가 아직 없으면 noBuild).
two_checks() { [ "$(log_count 'check -> ')" -ge 2 ]; }
new_check() {
  wait_until 60 two_checks || true
  log_text | grep -F 'check -> ' | tail -1 | sed 's/^ *//'
}
observe "$PHASE — 새 판의 첫 확인 (진짜 GitHub latest.json 에 대해)" new_check
observe "$PHASE — 스크린샷 (새 판)" screenshot "$PHASE"
stop_app
archive_logs "$PHASE"

# ── 4. deb — 패키지 관리자 안내, 묻지 않는다 ──────────────────────────────
deb_install() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$BASE_DEB" >"$OUT_DIR/apt-deb.log" 2>&1 || { tail -20 "$OUT_DIR/apt-deb.log"; return 1; }
  dpkg-query -W -f='${Status} ${Version}' ocul-pm | grep -q "install ok installed $BASE" || { dpkg-query -W -f='${Status} ${Version}' ocul-pm; return 1; }
  echo "install ok installed $BASE"
}
gate "deb — 스모크 판 설치 (apt-get install ./deb)" deb_install

: >"$ACCESS"
launch deb /usr/bin/ocul-pm

deb_boot() {
  wait_until 90 log_has 'App window mounted' || { echo "90초 안에 프런트가 안 떴다 · 앱 출력 끝: $(tail -5 "$OUT_DIR/deb.stdout.log" 2>/dev/null)"; return 1; }
  local line
  line=$(log_last 'install kind — version')
  [[ "$line" == *"bundle=deb"* ]] || { echo "설치 형식이 deb 가 아니다: $line"; return 1; }
  echo "$line"
}
gate "deb — 프런트가 떴다 · 기동 줄 bundle=deb" deb_boot

deb_route() {
  wait_until 60 log_has 'check -> packageManaged' || { echo "60초 안에 check -> packageManaged 가 없다 · updater 줄: $(log_text | grep -F 'updater' | tail -5 | tr '\n' '|')"; return 1; }
  local line
  line=$(log_last 'check -> packageManaged')
  [[ "$line" == *'"format":"deb"'* ]] || { echo "형식이 deb 가 아니다: $line"; return 1; }
  echo "$line"
}
gate "deb — 업데이터가 패키지 관리자 안내로 (check -> packageManaged · deb)" deb_route

deb_silent() {
  sleep 20
  local n
  n=$(grep -c . "$ACCESS" 2>/dev/null || true)
  [ "${n:-0}" -eq 0 ] && echo "접근 로그 0줄 (마운트 뒤 20초 더 봄)" || { echo "deb 앱이 서버에 물었다: $(tr '\n' ' ' <"$ACCESS")"; return 1; }
}
gate "deb — latest.json 을 묻지 않았다 (접근 로그 0줄)" deb_silent
observe "deb — 스크린샷" screenshot deb
stop_app
archive_logs deb
observe "deb — 제거" bash -c 'sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq ocul-pm >/dev/null 2>&1 && echo 제거됨'

if [ -n "$HTTP_PID" ]; then kill "$HTTP_PID" 2>/dev/null; fi
kill "$XVFB_PID" 2>/dev/null

# ── 요약 ───────────────────────────────────────────────────────────────────
{
  echo "## 업데이터 스모크 — linux (Ocul-PM $BASE → $NEW)"
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
  echo "::error::업데이터 스모크(linux) gate 실패 ${FAILED}건: ${FAILED_NAMES[*]}"
  exit 1
fi
echo "업데이터 스모크(linux) 통과 — gate ${GATES}건"
