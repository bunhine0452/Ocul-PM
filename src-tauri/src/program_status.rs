//! 프로그램 상태 신호 (OSC 7501, Program Status Protocol) — 터미널에서 도는 프로그램이 자기
//! 상태(idle · working · done · blocked · error)를 출력 흐름에 실어 보낸다. Claude Code 는
//! 2.1.295 부터 터미널이 탐침(`ESC ] 7501 ; ? ST`)에 답하면 보낸다. 규격:
//! <https://www.superlogical.com/rex/docs/build/program-status>
//!
//! 해석기와 탐침 응답은 Orca 의 `src/shared/program-status/{protocol,osc-scanner}.ts` 를 Rust 로
//! 옮겼다 — Orca (stablyai/orca), MIT License, Copyright (c) 2026 Lovecast Inc.
//! 허락문 전문은 저장소 루트 `THIRD_PARTY_NOTICES.md`.
//!
//! 옮기며 바꾼 것:
//! - PTY 에서 읽은 **바이트** 위에서 훑는다(UTF-8 조립 전). 본문은 규격상 ASCII 다.
//! - OSC 133(프롬프트 시작) · RIS(전체 리셋)는 보지 않는다 — 이 앱의 셸에는 셸 통합이 없다.
//!   기록은 프로그램이 `state=clear` 를 보내거나 세션이 끝날 때까지 산다.
//! - 탐침에는 **화면으로 넘기기 전에** 답한다(`terminal.rs` 읽기 루프). Claude 는 탐침 뒤에
//!   장치 속성 질의(DA1)를 붙여 보내고, 그 응답보다 우리 답이 먼저 와야 지원으로 본다 — 웹뷰의
//!   xterm 이 DA1 에 답하기 전에 여기서 쓴다.

use base64::Engine;

/// `ESC ] 7501 ;`
pub const PREFIX: &[u8] = b"\x1b]7501;";

/// 탐침에 돌려주는 유일한 바이트 — 받아들이는 상태와 종류를 다 적는다.
pub const QUERY_REPLY: &[u8] =
    b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\";

/// OSC 부터 ST 까지 한 줄의 상한.
const MAX_SEQUENCE_BYTES: usize = 4096;
const MAX_BODY: usize = MAX_SEQUENCE_BYTES - PREFIX.len() - 1;
const MAX_KEY_BYTES: usize = 16;
const MAX_MSG_ENCODED: usize = 2732;
const MAX_MSG_DECODED: usize = 2048;
const MAX_TITLE_ENCODED: usize = 256;
const MAX_TITLE_DECODED: usize = 192;
const MAX_ID_LENGTH: usize = 128;
const MAX_ID_DEPTH: usize = 8;
const MAX_APP_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Working,
    Done,
    Blocked,
    Error,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Idle => "idle",
            State::Working => "working",
            State::Done => "done",
            State::Blocked => "blocked",
            State::Error => "error",
        }
    }

    fn parse(s: &str) -> Option<State> {
        Some(match s {
            "idle" => State::Idle,
            "working" => State::Working,
            "done" => State::Done,
            "blocked" => State::Blocked,
            "error" => State::Error,
            _ => return None,
        })
    }
}

/// 막힌 까닭 — 권한 · 질문 · 로그인.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Permission,
    Question,
    Auth,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Permission => "permission",
            Kind::Question => "question",
            Kind::Auth => "auth",
        }
    }

    fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "permission" => Kind::Permission,
            "question" => Kind::Question,
            "auth" => Kind::Auth,
            _ => return None,
        })
    }
}

/// 보고 하나. `state == None` 은 `clear`(기록을 지운다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// `None` 은 루트(프로그램 자신), 아니면 그 아래 기록(하위 에이전트 등).
    pub id: Option<String>,
    pub state: Option<State>,
    pub kind: Option<Kind>,
    pub progress: Option<u8>,
    pub app: Option<String>,
    pub title: Option<String>,
    pub msg: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Query,
    Report(Report),
}

fn is_key(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase())
}

fn is_value(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"_.,+/=-".contains(&b))
}

fn is_segment(s: &str) -> bool {
    (1..=32).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))
}

fn is_valid_id(id: &str) -> bool {
    if id.len() > MAX_ID_LENGTH {
        return false;
    }
    let segments: Vec<&str> = id.split('/').collect();
    segments.len() <= MAX_ID_DEPTH && segments.iter().all(|s| is_segment(s))
}

fn is_app(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))
}

/// base64 로 실린 한 줄 글. 상한을 넘거나 제어 문자가 있으면 보고 전체를 버린다(`None`).
fn decode_text(encoded: &str, max_encoded: usize, max_decoded: usize) -> Option<String> {
    // 상한을 디코딩 **전에** — 적대적인 프로그램이 시킬 수 있는 일을 묶는다.
    if encoded.len() > max_encoded {
        return None;
    }
    let unpadded = encoded.trim_end_matches('=');
    if encoded.len() - unpadded.len() > 2
        || !unpadded
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
        || unpadded.len() % 4 == 1
    {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(unpadded)
        .ok()?;
    if bytes.len() > max_decoded {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    let control = text
        .chars()
        .any(|c| (c as u32) < 0x20 || (0x7f..=0x9f).contains(&(c as u32)));
    (!control).then_some(text)
}

/// `OSC 7501;` 와 ST 사이의 본문. `None` 은 무시(상태 없음 · 잘못된 id · 상한 초과).
pub fn parse_body(body: &[u8]) -> Option<Message> {
    if body.len() > MAX_SEQUENCE_BYTES {
        return None;
    }
    let body = std::str::from_utf8(body).ok()?;
    if body.trim() == "?" {
        return Some(Message::Query);
    }
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    let mut msg = None;
    let mut title = None;
    for pair in body.split(':') {
        let Some(eq) = pair.find('=') else { continue };
        let key = pair[..eq].trim();
        let value = pair[eq + 1..].trim();
        // 어느 한 번이라도 상한을 넘으면 보고 전체를 버린다 — 뒤에 같은 키가 와도.
        if key.len() > MAX_KEY_BYTES
            || (key == "app" && value.len() > MAX_APP_BYTES)
            || (key == "id" && !is_valid_id(value))
        {
            return None;
        }
        // 모양이 틀린 쌍만 건너뛰고 나머지 보고는 쓴다.
        if !is_key(key) || !is_value(value) {
            continue;
        }
        match key {
            "msg" => msg = Some(decode_text(value, MAX_MSG_ENCODED, MAX_MSG_DECODED)?),
            "title" => title = Some(decode_text(value, MAX_TITLE_ENCODED, MAX_TITLE_DECODED)?),
            _ => {
                pairs.retain(|(k, _)| *k != key);
                pairs.push((key, value));
            }
        }
    }
    let get = |k: &str| pairs.iter().find(|(key, _)| *key == k).map(|(_, v)| *v);
    let state = match get("state")? {
        "clear" => None,
        s => Some(State::parse(s)?),
    };
    let kind = if state == Some(State::Blocked) {
        get("kind").and_then(Kind::parse)
    } else {
        None
    };
    let progress = if matches!(state, Some(State::Working | State::Blocked)) {
        get("progress")
            .filter(|p| (1..=3).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|p| p.parse::<u8>().ok())
            .filter(|p| *p <= 100)
    } else {
        None
    };
    Some(Message::Report(Report {
        id: get("id").map(str::to_string),
        state,
        kind,
        progress,
        app: get("app").filter(|a| is_app(a)).map(str::to_string),
        title: title.filter(|t: &String| !t.is_empty()),
        msg: msg.filter(|m: &String| !m.is_empty()),
    }))
}

/// BEL · ST, 또는 (xterm 처럼) ST 가 아닌 ESC — 그 ESC 는 먹지 않는다. CAN · SUB 는 중단.
struct Terminator {
    index: usize,
    len: usize,
    aborted: bool,
}

fn find_terminator(data: &[u8], from: usize, limit: usize) -> Option<Terminator> {
    let end = limit.min(data.len());
    for i in from..end {
        match data[i] {
            0x07 => {
                return Some(Terminator {
                    index: i,
                    len: 1,
                    aborted: false,
                });
            }
            0x18 | 0x1a => {
                return Some(Terminator {
                    index: i,
                    len: 1,
                    aborted: true,
                });
            }
            0x1b if i + 1 < data.len() => {
                let len = if data[i + 1] == b'\\' { 2 } else { 0 };
                return Some(Terminator {
                    index: i,
                    len,
                    aborted: false,
                });
            }
            _ => {}
        }
    }
    None
}

/// PTY 출력 흐름 하나의 상태 있는 훑개 — 읽기 사이에 걸친 조각은 다음 읽기까지 남긴다.
/// 흐름에서 아무것도 지우지 않는다(화면에는 그대로 간다 — xterm 은 모르는 OSC 를 그리지 않는다).
#[derive(Default)]
pub struct Scanner {
    pending: Vec<u8>,
}

impl Scanner {
    pub fn feed(&mut self, data: &[u8]) -> Vec<Message> {
        if self.pending.is_empty() && !data.contains(&0x1b) {
            return Vec::new();
        }
        let mut combined = std::mem::take(&mut self.pending);
        combined.extend_from_slice(data);
        let mut out = Vec::new();
        let mut cursor = 0;
        while let Some(rel) = combined[cursor..].iter().position(|&b| b == 0x1b) {
            let esc = cursor + rel;
            let rest = &combined[esc..];
            if !rest.starts_with(PREFIX) {
                // 머리말이 읽기 경계에서 잘렸으면 남긴다.
                if rest.len() < PREFIX.len() && PREFIX.starts_with(rest) {
                    self.pending = rest.to_vec();
                    break;
                }
                cursor = esc + 1;
                continue;
            }
            let body_start = esc + PREFIX.len();
            match find_terminator(&combined, body_start, body_start + MAX_BODY + 1) {
                None if combined.len() - body_start <= MAX_BODY => {
                    self.pending = combined[esc..].to_vec();
                    break;
                }
                // 상한을 넘은 줄은 통째로 버리고 머리말 뒤에서 다시 찾는다.
                None => cursor = body_start,
                Some(t) => {
                    cursor = t.index + t.len;
                    if !t.aborted {
                        if let Some(m) = parse_body(&combined[body_start..t.index]) {
                            out.push(m);
                        }
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s)
    }

    fn report(body: &str) -> Report {
        match parse_body(body.as_bytes()) {
            Some(Message::Report(r)) => r,
            other => panic!("보고가 아니다: {other:?}"),
        }
    }

    #[test]
    fn the_query_is_a_question_mark() {
        assert_eq!(parse_body(b"?"), Some(Message::Query));
        assert_eq!(parse_body(b" ? "), Some(Message::Query));
    }

    #[test]
    fn a_blocked_question_carries_its_kind_and_message() {
        let r = report(&format!(
            "state=blocked:kind=question:msg={}",
            b64("답: 비울까요? (예 · 아니오)")
        ));
        assert_eq!(r.id, None);
        assert_eq!(r.state, Some(State::Blocked));
        assert_eq!(r.kind, Some(Kind::Question));
        assert_eq!(r.msg.as_deref(), Some("답: 비울까요? (예 · 아니오)"));
    }

    #[test]
    fn kind_only_counts_when_blocked_and_progress_only_when_live() {
        let r = report("state=working:kind=permission:progress=40");
        assert_eq!(r.kind, None);
        assert_eq!(r.progress, Some(40));
        let r = report("state=done:progress=40");
        assert_eq!(r.progress, None);
        assert_eq!(report("state=working:progress=101").progress, None);
    }

    #[test]
    fn clear_wipes_and_a_missing_or_unknown_state_is_ignored() {
        assert_eq!(report("state=clear").state, None);
        assert_eq!(parse_body(b"kind=question"), None);
        assert_eq!(parse_body(b"state=sleeping"), None);
    }

    #[test]
    fn child_records_keep_their_id_and_a_bad_id_voids_the_report() {
        assert_eq!(
            report("id=sub/a1:state=working").id.as_deref(),
            Some("sub/a1")
        );
        assert_eq!(parse_body(b"id=bad id:state=working"), None);
        let deep = (0..9)
            .map(|i| format!("s{i}"))
            .collect::<Vec<_>>()
            .join("/");
        assert_eq!(
            parse_body(format!("id={deep}:state=working").as_bytes()),
            None
        );
    }

    #[test]
    fn a_message_with_control_characters_or_over_the_cap_voids_the_report() {
        assert_eq!(
            parse_body(format!("state=working:msg={}", b64("a\nb")).as_bytes()),
            None
        );
        let long = "가".repeat(700); // 2100 바이트 > 2048
        assert_eq!(
            parse_body(format!("state=working:msg={}", b64(&long)).as_bytes()),
            None
        );
        // base64 글자가 아니면 그 쌍만 건너뛰고, 길이가 맞지 않는 base64 는 보고 전체를 버린다.
        assert_eq!(report("state=working:msg=***").msg, None);
        assert_eq!(parse_body(b"state=working:msg=abcde"), None);
    }

    #[test]
    fn malformed_pairs_are_skipped_but_the_rest_applies() {
        let r = report("state=working:Bad=1:app=claude:x");
        assert_eq!(r.state, Some(State::Working));
        assert_eq!(r.app.as_deref(), Some("claude"));
    }

    #[test]
    fn the_scanner_finds_reports_ended_by_st_or_bel_and_leaves_other_escapes_alone() {
        let mut s = Scanner::default();
        let mut data = b"hello \x1b[32mgreen\x1b[0m ".to_vec();
        data.extend_from_slice(b"\x1b]7501;state=working\x1b\\");
        data.extend_from_slice(b"\x1b]0;title\x07");
        data.extend_from_slice(b"\x1b]7501;?\x07");
        let out = s.feed(&data);
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], Message::Report(r) if r.state == Some(State::Working)));
        assert_eq!(out[1], Message::Query);
    }

    #[test]
    fn a_sequence_split_across_reads_is_put_together() {
        let mut s = Scanner::default();
        let whole = b"x\x1b]7501;state=blocked:kind=permission\x1b\\y";
        for cut in 1..whole.len() {
            let mut s2 = Scanner::default();
            let mut got = s2.feed(&whole[..cut]);
            got.extend(s2.feed(&whole[cut..]));
            assert_eq!(got.len(), 1, "자른 자리 {cut}");
        }
        assert!(s.feed(b"plain text").is_empty());
    }

    #[test]
    fn an_aborted_or_oversized_sequence_is_dropped() {
        let mut s = Scanner::default();
        assert!(s.feed(b"\x1b]7501;state=working\x18").is_empty());
        let mut big = b"\x1b]7501;state=working:app=".to_vec();
        big.extend(std::iter::repeat_n(b'a', 5000));
        big.extend_from_slice(b"\x07\x1b]7501;state=done\x07");
        let out = s.feed(&big);
        assert_eq!(out.len(), 1);
        assert!(matches!(&out[0], Message::Report(r) if r.state == Some(State::Done)));
    }

    #[test]
    fn the_reply_lists_every_state_and_kind() {
        let reply = std::str::from_utf8(QUERY_REPLY).unwrap();
        for s in [
            "idle",
            "working",
            "done",
            "blocked",
            "error",
            "permission",
            "question",
            "auth",
        ] {
            assert!(reply.contains(s), "{s}");
        }
        assert!(reply.starts_with("\x1b]7501;?:") && reply.ends_with("\x1b\\"));
    }
}
