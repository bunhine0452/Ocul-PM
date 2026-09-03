# shell_version: 2
# ocul-pm 셸 통합 (bash) — zsh 판(oculpm.zsh)의 bash 대응.
#
# bash 에는 preexec 훅이 없어 `trap ... DEBUG` 로 대신한다. 기존 DEBUG trap 이나
# PROMPT_COMMAND 를 반드시 보존한다 — 덮어쓰면 사용자 환경이 조용히 망가진다.
# bash-preexec 가 이미 로드돼 있으면 그쪽 배열에 얹어 이중 실행을 피한다.

case "$-" in *i*) ;; *) return 0 ;; esac
[ -n "$OCULPM_TERM" ] || return 0
[ -n "$OCULPM_SI_LOADED" ] && return 0
OCULPM_SI_LOADED=1

case "$TERM" in
  screen*|tmux*|dumb|linux) return 0 ;;
esac
[ -n "$TMUX" ] && return 0

# 세션 심 (플랜 `session-shim-cli`) — 우리가 만든 PATH 를 강요하지 않고, **사용자
# rc 가 끝난 뒤** 심 디렉터리만 앞에 붙인다. 앱 프로세스의 빈약한 PATH 를
# 통째로 물려주면 brew·nvm 이 사라진다.
if [ -n "$OCULPM_SHIM_DIR" ] && [ -d "$OCULPM_SHIM_DIR" ]; then
  case ":$PATH:" in
    *":$OCULPM_SHIM_DIR:"*) ;;
    *) PATH="$OCULPM_SHIM_DIR:$PATH"; export PATH ;;
  esac
fi

__oculpm_nonce="${OCULPM_NONCE:-}"

# zsh 판과 동일한 이스케이프. bash 3.2(macOS 기본)에도 있는 확장만 쓴다.
__oculpm_esc() {
  local s=${1//\\/\\\\}
  s=${s//;/\\x3b}
  s=${s//$'\n'/\\x0a}
  s=${s//$'\r'/\\x0d}
  s=${s//$'\e'/\\x1b}
  s=${s//$'\a'/\\x07}
  printf '%s' "$s"
}

__oculpm_precmd() {
  local exit_status=$?
  if [ -n "$__oculpm_ran" ]; then
    printf '\e]133;D;%s;nonce=%s\a' "$exit_status" "$__oculpm_nonce"
    unset __oculpm_ran
  fi
  printf '\e]133;A;nonce=%s;cwd=%s\a' "$__oculpm_nonce" "$(__oculpm_esc "$PWD")"
  printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$PWD"
  # zsh 판과 동일 — B 에도 nonce (수신 규칙을 하나로 유지).
  printf '\e]133;B;nonce=%s\a' "$__oculpm_nonce"
  return $exit_status
}

__oculpm_preexec() {
  # 자동완성 중이거나 PROMPT_COMMAND 자체가 도는 발화는 사용자 명령이 아니다.
  [ -n "$COMP_LINE" ] && return
  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
  __oculpm_ran=1
  printf '\e]133;C;nonce=%s;cmd=%s\a' "$__oculpm_nonce" "$(__oculpm_esc "$BASH_COMMAND")"
}

if [ -n "$bash_preexec_imported" ] || [ -n "$__bp_imported" ]; then
  # bash-preexec 가 이미 있으면 그 배열에 얹는다 (DEBUG trap 을 두 번 걸지 않는다).
  precmd_functions+=(__oculpm_precmd)
  preexec_functions+=(__oculpm_preexec)
else
  # 기존 DEBUG trap 보존 — 우리 것을 먼저 돌리고 원본을 이어 부른다.
  __oculpm_prev_debug=$(trap -p DEBUG | sed -E "s/^trap -- '(.*)' DEBUG\$/\\1/")
  if [ -n "$__oculpm_prev_debug" ]; then
    trap '__oculpm_preexec; eval "$__oculpm_prev_debug"' DEBUG
  else
    trap '__oculpm_preexec' DEBUG
  fi
  # 기존 PROMPT_COMMAND 보존 — 원본을 먼저 돌리고 종료코드를 복원한 뒤 우리 것.
  if [ -n "$PROMPT_COMMAND" ]; then
    __oculpm_prev_prompt="$PROMPT_COMMAND"
    PROMPT_COMMAND='__oculpm_status=$?; eval "$__oculpm_prev_prompt"; (exit $__oculpm_status); __oculpm_precmd'
  else
    PROMPT_COMMAND='__oculpm_precmd'
  fi
fi
