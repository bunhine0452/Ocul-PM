# shell_version: 2
# ocul-pm 셸 통합 (zsh) — 명령 경계·종료코드·작업 디렉터리를 앱에 알린다.
#
# 이 파일은 ocul-pm 이 생성·관리한다. 직접 고치면 다음 업그레이드에서 덮인다.
#
# 설계 메모:
#  - ZDOTDIR 우회(VS Code 방식)를 쓰지 않는다. 사용자의 .zshrc 를 우리가 대신
#    source 하는 구조는 실패 시 "통합이 안 됨"이 아니라 "터미널을 못 씀" 등급의
#    사고가 된다(.zshenv → .zprofile → .zshrc → .zlogin 순서 재현, HISTFILE
#    분기, ${ZDOTDIR:-$HOME} 를 읽는 프레임워크 오작동).
#  - 대신 사용자 rc 에 심는 것은 **비활성 한 줄**이다. OCULPM_SHELL_INTEGRATION
#    은 ocul-pm 의 PTY 만 설정하므로, 다른 터미널에서 그 줄은 아무 일도 하지
#    않는다.
#  - PS1 을 건드리지 않는다. precmd/preexec 훅만 쓰므로 oh-my-zsh·powerlevel10k·
#    starship 처럼 매 프롬프트마다 PS1 을 재구성하는 프레임워크와 부딪히지
#    않는다 (PS1 에 마커를 심는 iTerm2 방식이 p10k 와 충돌하는 지점).
#  - OSC 7 대신 cwd 를 우리 A 페이로드에 실어 보낸다. OSC 7 은 percent-encoding
#    이 필요하고(한글 경로에서 zsh 순수 확장으로는 비싸다) file://<host> 의
#    호스트 해석이 원격에서 모호하다. 상호운용을 위해 OSC 7 도 함께 쏘고,
#    수신 쪽은 남이 쏘는 OSC 7 도 받아준다.

# 대화형 셸에서만. 그리고 ocul-pm 의 PTY 안에서만.
[[ -o interactive ]] || return 0
[[ -n "$OCULPM_TERM" ]] || return 0
# 중복 소싱 방지 (사용자 rc 가 두 번 source 하거나 exec zsh 하는 경우).
[[ -n "$OCULPM_SI_LOADED" ]] && return 0
typeset -g OCULPM_SI_LOADED=1

# tmux/screen 은 OSC 133 을 자기가 소비하고 바깥으로 전달하지 않는다(tmux 3.4+).
# 신호가 앱에 도달하지 못하므로 조용히 비활성화한다 — 반쯤 동작해서 명령 경계가
# 어긋나는 것보다 아예 끄는 편이 낫다 (iTerm2 스크립트도 같은 이유로 그렇게 한다).
case "$TERM" in
  screen*|tmux*|dumb|linux) return 0 ;;
esac
[[ -n "$TMUX" ]] && return 0

# 페이로드 이스케이프 — 세미콜론(구분자)·역슬래시·제어문자만 막는다.
# 순수 파라미터 확장이라 서브프로세스를 띄우지 않는다 (명령마다 도는 코드다).
__oculpm_esc() {
  local s=${1//\\/\\\\}
  s=${s//;/\\x3b}
  s=${s//$'\n'/\\x0a}
  s=${s//$'\r'/\\x0d}
  s=${s//$'\e'/\\x1b}
  s=${s//$'\a'/\\x07}
  print -rn -- "$s"
}

# 위조 방지 nonce. PTY 를 띄울 때 앱이 심고, 앱은 이 값이 맞는 신호만 믿는다.
# 터미널로 흘러드는 임의 바이트(예: `cat evil.txt`)가 가짜 명령 경계나 가짜
# cwd 를 주입하는 것을 막는다 — VS Code 가 OSC 633;E 에 nonce 를 넣는 이유와 같다.
typeset -g # 세션 심 (플랜 `session-shim-cli`) — 우리가 만든 PATH 를 강요하지 않고, **사용자
# rc 가 끝난 뒤** 심 디렉터리만 앞에 붙인다. 앱 프로세스의 빈약한 PATH 를
# 통째로 물려주면 brew·nvm 이 사라진다.
if [ -n "$OCULPM_SHIM_DIR" ] && [ -d "$OCULPM_SHIM_DIR" ]; then
  case ":$PATH:" in
    *":$OCULPM_SHIM_DIR:"*) ;;
    *) PATH="$OCULPM_SHIM_DIR:$PATH"; export PATH ;;
  esac
fi

__oculpm_nonce="${OCULPM_NONCE:-}"

# 프롬프트 직전: 직전 명령의 종료코드를 보고하고 새 프롬프트를 연다.
__oculpm_precmd() {
  local exit_status=$?
  if [[ -n "$__oculpm_ran" ]]; then
    printf '\e]133;D;%s;nonce=%s\a' "$exit_status" "$__oculpm_nonce"
    unset __oculpm_ran
  fi
  printf '\e]133;A;nonce=%s;cwd=%s\a' "$__oculpm_nonce" "$(__oculpm_esc "$PWD")"
  printf '\e]7;file://%s%s\a' "${HOST:-localhost}" "$PWD"
  # B 에도 nonce 를 싣는다 — 수신 쪽 규칙을 "nonce 가 맞지 않으면 전부 불신"
  # 하나로 유지하기 위해서다(예외를 두면 그 예외가 공격면이 된다).
  printf '\e]133;B;nonce=%s\a' "$__oculpm_nonce"
}

# 명령 실행 직전: 실행될 명령줄을 함께 실어 보낸다. 앱이 이걸로 코딩
# 에이전트(claude/cursor/gemini …) 실행을 식별한다.
__oculpm_preexec() {
  typeset -g __oculpm_ran=1
  printf '\e]133;C;nonce=%s;cmd=%s\a' "$__oculpm_nonce" "$(__oculpm_esc "${1}")"
}

autoload -Uz add-zsh-hook 2>/dev/null
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd __oculpm_precmd
  add-zsh-hook preexec __oculpm_preexec
else
  typeset -ga precmd_functions preexec_functions
  precmd_functions+=(__oculpm_precmd)
  preexec_functions+=(__oculpm_preexec)
fi
