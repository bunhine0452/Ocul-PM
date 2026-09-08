//! 앱 ↔ PTY 호스트 wire 프로토콜 (#pty-host).
//!
//! 전송은 [`crate::framing`](Content-Length) + JSON 본문. LSP/DAP 와 같은
//! 프레이밍을 쓰는 이유는 하나 — 이미 검증된 파서가 크레이트에 있다.
//!
//! **버전 규율**: 업데이트 직후에는 *구버전* 호스트가 살아서 세션을 쥐고 있고,
//! *신버전* 앱이 거기 붙는다. 이 파일을 고칠 때는 필드 추가(구버전이 무시)만
//! 하고, 의미가 바뀌면 [`PROTO_VERSION`] 을 올려라 — 소켓 이름이
//! [`PROTO_VERSION`] 을 담으므로([`crate::ptyhost::client::socket_name`]) 올리는
//! 순간 자리가 갈린다. 신버전 앱은 자기 자리에 새 호스트를 띄우고, 구버전
//! 호스트는 새 소켓이 생긴 것을 보고 스스로 내려간다 (그 세션은 이어받지
//! 못한다 — `host::superseded_by_a_newer_socket`).

use serde::{Deserialize, Serialize};

/// - `1` — 최초.
/// - `2` — `Foreground` 의 뜻이 바뀌었다: 놀고 있는 셸은 `None` (2026-09-02).
///   호스트는 앱 업데이트를 **넘어 살아남으므로**, 올리지 않으면 구버전 호스트가
///   계속 `-zsh` 를 돌려줘 새 앱에서도 고친 것이 안 고쳐진 것처럼 보인다.
pub const PROTO_VERSION: u32 = 2;

/// 이 실행파일의 판(`CARGO_PKG_VERSION`).
///
/// 호스트는 [`Request::Hello`] 로 이것을 말하고, 앱은 자기 것과 견준다. 호스트는
/// **앱 업데이트를 넘어 살아남으므로**, 다른 값이 돌아왔다는 것은 지금 돌고 있는
/// 호스트가 *예전 실행파일* 이라는 뜻이다 — 업데이트가 번들을 옮긴 뒤라 그
/// 실행파일은 디스크에 없을 수도 있고, 그러면 macOS 가 그 프로세스를 설치된
/// 앱으로 알아보지 못해 화면 기록 같은 권한이 영영 안 붙는다 (2026-09-08).
pub const APP_BUILD: &str = env!("CARGO_PKG_VERSION");

/// 클라이언트 → 호스트. `id` 로 응답을 짝짓는다.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientFrame {
    pub id: u64,
    pub req: Request,
}

/// 호스트 → 클라이언트. 요청 응답이거나(Reply) 자발 이벤트다(Event).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostFrame {
    Reply { id: u64, resp: Response },
    Event { ev: Event },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    /// 프로토콜 확인 — 접속 직후 1회.
    Hello,
    /// 세션 시작. 셸·환경·nonce 는 **앱이 계산**해 넘긴다 — 호스트는 tauri
    /// 핸들이 없어 앱 데이터 경로(통합 스크립트)를 스스로 알 수 없다.
    /// 같은 sid 가 이미 살아 있으면 그 세션의 정보를 돌려준다 (멱등).
    Start {
        sid: String,
        cwd: String,
        rows: u16,
        cols: u16,
        shell: String,
        env: Vec<(String, String)>,
        nonce: String,
        shell_integration: bool,
    },
    /// 살아있는 세션의 스크롤백 스냅샷 (없으면 None) — 재접속의 관문.
    Attach {
        sid: String,
    },
    Write {
        sid: String,
        data: String,
    },
    Resize {
        sid: String,
        rows: u16,
        cols: u16,
    },
    Kill {
        sid: String,
    },
    /// 접두사로 골라 죽인다 (창/탭 닫힘 정리 — window.rs 계약 그대로).
    KillPrefix {
        prefix: String,
    },
    /// 지정 접두사만 남기고 전량 종료 (마지막 앱 창 닫힘).
    KillExcept {
        keep: Vec<String>,
    },
    /// tty 포그라운드 프로세스 그룹의 명령줄 (디스패치 프리필).
    Foreground {
        sid: String,
    },
    /// 세션 전량 종료 후 호스트 자신도 내린다 (프로토콜 불일치 복구).
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Response {
    Ok,
    Proto {
        proto: u32,
        /// 이 호스트를 띄운 앱의 판 ([`APP_BUILD`]).
        ///
        /// **구버전 호스트는 말하지 않는다** — `None` 은 "판이 없다" 가 아니라
        /// "모른다" 다. 이 자리를 아무 기본값으로 접으면 앱은 옛 호스트를 전부
        /// 같은 판으로 착각한다.
        #[serde(default)]
        build: Option<String>,
        /// Hello 시점에 쥐고 있는 세션 수.
        ///
        /// 여기서도 `None` = 모른다. **0 으로 접지 마라** — 말하지 않는 옛
        /// 호스트를 빈 것으로 읽는 순간, 앱이 사용자의 셸을 쥔 호스트를
        /// "비었으니 교체" 로 내린다.
        #[serde(default)]
        sessions: Option<u32>,
    },
    /// Start 의 결과 — 프런트 OSC 검증에 필요한 것들.
    Session {
        nonce: String,
        shell_integration: bool,
    },
    Attach {
        attach: Option<AttachPayload>,
    },
    Foreground {
        command: Option<String>,
    },
    Count {
        n: u32,
    },
    Error {
        message: String,
    },
}

/// [`Request::Attach`] 응답 본문 — 기존 `PtyAttach` 와 같은 모양.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachPayload {
    pub text: String,
    pub seq: u32,
    pub nonce: String,
    pub shell_integration: bool,
    /// 세션이 **지금 쓰고 있는** 열 수. 붙는 화면이 이 폭을 그대로 이어받아
    /// 도크↔터미널 화면을 오갈 때 폭이 흔들리지 않게 한다 (근거는 프런트
    /// `ptyResize.ts` 의 `adoptedCols`). 구버전 호스트는 이 필드를 모르므로
    /// `default`(0) 로 받고, 0 은 "모른다" 로 읽는다.
    #[serde(default)]
    pub cols: u16,
}

/// 호스트가 밀어주는 세션 이벤트. 클라이언트(앱)가 tauri 이벤트
/// (`pty-data-{sid}` / `pty-exit-{sid}`)로 그대로 재방출한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Event {
    Data { sid: String, seq: u32, text: String },
    Exit { sid: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 봉투가 왕복한다 — 필드 추가가 아닌 형태 변경은 여기서 걸린다.
    #[test]
    fn frames_round_trip_through_json() {
        let req = ClientFrame {
            id: 7,
            req: Request::Start {
                sid: "p1-abc".into(),
                cwd: "/tmp".into(),
                rows: 24,
                cols: 80,
                shell: "/bin/zsh".into(),
                env: vec![("TERM".into(), "xterm-256color".into())],
                nonce: "n".into(),
                shell_integration: true,
            },
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: ClientFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, 7);
        assert!(matches!(back.req, Request::Start { .. }));

        let ev = HostFrame::Event {
            ev: Event::Data {
                sid: "p1-abc".into(),
                seq: 3,
                text: "hi".into(),
            },
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(matches!(
            serde_json::from_str::<HostFrame>(&json).unwrap(),
            HostFrame::Event {
                ev: Event::Data { seq: 3, .. }
            }
        ));
    }

    /// 구버전 호스트의 Hello 응답에는 새 필드가 **없다** — 그때 둘 다 `None`
    /// 으로 읽혀야 한다. 여기서 `sessions` 가 `0` 으로 접히면, 앱은 사용자의
    /// 셸을 쥔 옛 호스트를 빈 것으로 보고 통째로 내린다.
    #[test]
    fn an_old_hello_reply_admits_it_does_not_know() {
        let json = r#"{"kind":"reply","id":1,"resp":{"kind":"proto","proto":2}}"#;
        let HostFrame::Reply { resp, .. } = serde_json::from_str::<HostFrame>(json).unwrap() else {
            panic!("Reply 가 아니다");
        };
        let Response::Proto {
            proto,
            build,
            sessions,
        } = resp
        else {
            panic!("Proto 가 아니다");
        };
        assert_eq!(proto, 2);
        assert_eq!(build, None, "옛 호스트는 판을 말하지 않는다");
        assert_eq!(sessions, None, "모르는 것은 0 이 아니다");
    }

    /// 알 수 없는 **추가 필드**는 무시된다 — 구버전 호스트가 신버전 앱의
    /// 요청을 읽을 수 있어야 한다는 버전 규율의 최소 보장.
    #[test]
    fn unknown_extra_fields_are_tolerated() {
        let json = r#"{"id":1,"req":{"op":"attach","sid":"x","future_field":true}}"#;
        let back: ClientFrame = serde_json::from_str(json).unwrap();
        assert!(matches!(back.req, Request::Attach { .. }));
    }
}
