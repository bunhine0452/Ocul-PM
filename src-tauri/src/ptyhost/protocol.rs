//! 앱 ↔ PTY 호스트 wire 프로토콜 (#pty-host).
//!
//! 전송은 [`crate::framing`](Content-Length) + JSON 본문. LSP/DAP 와 같은
//! 프레이밍을 쓰는 이유는 하나 — 이미 검증된 파서가 크레이트에 있다.
//!
//! **버전 규율**: 업데이트 직후에는 *구버전* 호스트가 살아서 세션을 쥐고 있고,
//! *신버전* 앱이 거기 붙는다. 이 파일을 고칠 때는 필드 추가(구버전이 무시)만
//! 하고, 의미가 바뀌면 [`PROTO_VERSION`] 을 올려라 — 클라이언트가 불일치를
//! 보면 호스트를 내리고 새로 띄운다 (세션은 잃지만 무언의 오동작보다 낫다).

use serde::{Deserialize, Serialize};

/// - `1` — 최초.
/// - `2` — `Foreground` 의 뜻이 바뀌었다: 놀고 있는 셸은 `None` (2026-09-02).
///   호스트는 앱 업데이트를 **넘어 살아남으므로**, 올리지 않으면 구버전 호스트가
///   계속 `-zsh` 를 돌려줘 새 앱에서도 고친 것이 안 고쳐진 것처럼 보인다.
pub const PROTO_VERSION: u32 = 2;

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

    /// 알 수 없는 **추가 필드**는 무시된다 — 구버전 호스트가 신버전 앱의
    /// 요청을 읽을 수 있어야 한다는 버전 규율의 최소 보장.
    #[test]
    fn unknown_extra_fields_are_tolerated() {
        let json = r#"{"id":1,"req":{"op":"attach","sid":"x","future_field":true}}"#;
        let back: ClientFrame = serde_json::from_str(json).unwrap();
        assert!(matches!(back.req, Request::Attach { .. }));
    }
}
