//! 앱 안 터미널이 웹뷰와 주고받는 모양 — 세션 사건 · 프로그램 상태 · 목록 한 줄 · 업데이트 뒤 잇기 · 도는
//! 세션 수. `terminal.rs` 가 800줄에 닿지 않게 떼어 냈다(2026-11-15). 이름은 `crate::terminal::*` 그대로다.

use serde::{Deserialize, Serialize};

/// 웹뷰로 가는 세션 사건 — 출력 조각 · 끝 · 프로그램 상태(OSC 7501) · 제목(OSC 0 · 2) · 종 · 알림(OSC 9 · 777).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TermEvent {
    /// `n` 은 이 조각의 바이트 수 — 웹뷰가 그린 뒤 `term_ack` 로 돌려준다(출력 흐름 제어).
    Output {
        data: String,
        n: u32,
    },
    Exit {
        code: Option<u32>,
    },
    Status {
        status: Option<TermStatus>,
    },
    /// 세션 이름이 될 제목이 바뀌었다(`TermInfo.title`) — 같은 세션은 1초에 한 번까지.
    Title {
        title: Option<String>,
    },
    /// 무언가 도는 세션이 BEL 을 울렸다(셸만 도는 칸의 종은 오지 않는다).
    Bell,
    /// 안의 프로그램이 띄워 달라는 알림(OSC 9 · 777).
    Notice {
        title: Option<String>,
        body: String,
    },
}

/// 세션 안 프로그램(주로 claude)이 스스로 알린 상태 — `program_status` 의 루트 기록.
/// `None` 은 모름(신호를 안 보내는 프로그램 · 셸만 도는 중 · `state=clear`).
#[derive(Debug, Clone, Serialize, specta::Type, PartialEq, Eq)]
pub struct TermStatus {
    /// `idle` · `working` · `done` · `blocked` · `error`
    pub state: String,
    /// blocked 일 때만 — `permission` · `question` · `auth`
    pub kind: Option<String>,
    /// 프로그램이 붙인 한 줄 (「approve Write: …」 · 「answer: Q? (A · B)」).
    pub msg: Option<String>,
    /// 이 상태로 바뀐 시각 (RFC 3339) — 같은 상태가 이어지면 그대로다.
    pub since: String,
    /// 상태를 보낸 프로그램(`claude` · `codex` …, 소문자) — 한 번 알리면 지울 때까지 남는다. 업데이트 뒤
    /// 잇기는 이 이름이 claude 일 때만(`Row::runs_claude`). TS 는 선택 속성 — 이 필드를 모르던 시험 · 다른
    /// 화면의 값 모양을 깨지 않는다(serde 속성으로 하면 specta 가 타입을 보내기 · 받기 둘로 쪼갠다).
    #[specta(optional)]
    pub app: Option<String>,
}

/// 업데이트 재시작을 건너 이을 claude 세션 하나 — 그 창의 프로젝트와, 레인이면 그 경로.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct TermResume {
    pub project_id: u32,
    /// 「여럿에서」 레인의 폴더(`term_open` 의 `cwd` 그대로). 프로젝트 루트면 `None`.
    #[serde(default)]
    pub lane: Option<String>,
}

/// 계획의 확인 명령을 돌릴 세션 (11-15 사용자 결정 「누를 때만 돌리기」) — 사람이 확인 창에서 전문을 보고 누른
/// 한 줄과 탭 이름. 셸은 줄을 명령 인자로 받는다(`terminal_env.rs` 의 `Launch::Check`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
pub struct TermCheck {
    /// 웹뷰가 거른 한 줄 — 확인 창에 보인 그대로다. 한 줄이 아니면 열지 않는다(`terminal_env::is_one_line`).
    pub line: String,
    /// 탭 이름(「확인 명령」) — 웹뷰가 제 언어로 정한다. `claude` 가 아니라 업데이트 뒤 잇기 대상이 아니다.
    pub label: String,
}

/// 앱 전체에서 도는 세션 수 — 업데이트가 재시작 전에 묻는다.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct TermBusy {
    /// 셸 위에서 무언가 도는 세션.
    pub busy: u32,
    /// 그 가운데 claude 가 도는 세션 — 다시 뜨면 이어서 연다.
    pub claude: u32,
}

/// 목록 한 줄.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TermInfo {
    pub id: u32,
    pub project_id: u32,
    /// 셸 이름 또는 `claude` (「다음」 실행), 확인 명령이면 그 탭 이름(`TermCheck.label`).
    pub label: String,
    /// 시작 시각 (RFC 3339).
    pub started_at: String,
    /// 끝났으면 종료 코드 (모르면 `None`, 아직 돌면 `alive`).
    pub alive: bool,
    pub exit_code: Option<u32>,
    /// 세션 안 프로그램의 상태 — 끝난 뒤에도 마지막 값(done · error)이 남는다.
    pub status: Option<TermStatus>,
    /// 셸 위에서 무언가가 돈다 — 닫기 · 끄기 전에 묻고 프로젝트 목록이 센다. 빈 셸은 `false`.
    /// 표에 적어 두지 않고 목록을 줄 때마다 잰다(`Session::snapshot`).
    pub busy: bool,
    /// 그 창이 뒤에 있는 동안 안의 프로그램이 기다림 · 끝냄 · 오류로 바뀌었고 아직 그 창을 안 봤다
    /// (Orca 의 알림 규칙 — 읽지 않음은 프로젝트(= 창)마다). 창이 앞에 오면 지운다.
    pub unseen: bool,
    /// 안의 프로그램이 붙인 제목(OSC 7501 의 `title=`, 없으면 OSC 0 · 2) — 정화해 60자. 탭의 이름이 된다
    /// (claude 셋이 모두 「claude」 이던 것을 대화 주제로). TS 는 선택 속성(`TermStatus.app` 과 같은 까닭).
    #[specta(optional)]
    pub title: Option<String>,
}
