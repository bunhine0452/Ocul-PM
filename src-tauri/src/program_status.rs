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
//!
//! 같은 훑개가 다른 신호도 읽는다(2026-11-15) — 상태를 OSC 7501 로 보내는 프로그램은 아직 적고,
//! 나머지는 오래된 관례로 말한다: OSC 0 · 2 창 제목(Claude Code 는 대화 주제를 싣는다), OSC 9 ·
//! 777 데스크톱 알림(Codex · Gemini CLI · 긴 스크립트), 그리고 OSC 밖의 BEL. 버리던 것들이다.

use base64::Engine;

/// 탐침에 돌려주는 유일한 바이트 — 받아들이는 상태와 종류를 다 적는다.
pub const QUERY_REPLY: &[u8] =
    b"\x1b]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth\x1b\\";

/// OSC 부터 ST 까지 한 줄의 상한.
const MAX_SEQUENCE_BYTES: usize = 4096;
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
    /// OSC 0 · 2 — 창 제목(정화한 것, [`clean_text`]). `None` 은 지움(빈 제목).
    Title(Option<String>),
    /// OSC 9 · OSC 777 notify — 프로그램이 띄워 달라는 알림 한 줄.
    Notice {
        title: Option<String>,
        body: String,
    },
    /// OSC 밖의 BEL — 울릴지는 세션이 무언가 돌고 있는지를 보고 받는 쪽이 정한다.
    Bell,
}

/// 창 제목의 상한(글자) — 탭 한 칸 · 알림 제목에 들어갈 만큼.
pub const TITLE_CHARS: usize = 60;
/// 알림 글의 상한(글자).
pub const NOTICE_CHARS: usize = 200;

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

/// `app=` 의 이름 — 소문자로 맞추고, `[a-z0-9._-]` 밖의 글자가 있으면 모름(`None`). 업데이트 뒤 잇기가
/// 이 이름으로 claude 와 Codex 를 가르므로(`terminal.rs` 의 `runs_claude`) 모양을 하나로 둔다. 길이 상한
/// (`MAX_APP_BYTES`)을 넘으면 보고 전체를 버리는 것은 규격 그대로 `parse_body` 가 한다.
fn normalize_app(s: &str) -> Option<String> {
    let lower = s.to_ascii_lowercase();
    let ok = !lower.is_empty()
        && lower
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b));
    ok.then_some(lower)
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
        app: get("app").and_then(normalize_app),
        title: title.filter(|t: &String| !t.is_empty()),
        msg: msg.filter(|m: &String| !m.is_empty()),
    }))
}

/// 제목 · 알림 글을 화면에 실을 수 있게 다듬는다 — 제어 글자, 양방향 덮어쓰기(U+202A–202E · U+2066–2069 ·
/// LRM · RLM · ALM), 폭 0 글자(U+200B–200D · U+2060 · U+FEFF · 무른 줄표)를 지우고, 앞머리의 스피너
/// (점자 U+2800–28FF, `·✢✳✶✻✽`)와 공백을 뗀 뒤 `max` 글자로 자른다(넘치면 끝 글자가 `…`). 비면 `None`.
///
/// 프로그램이 보낸 글이 탭 · 알림 제목에 그대로 선다 — 오른쪽에서 왼쪽으로 뒤집는 글자로 다른 글을 흉내
/// 내거나 보이지 않는 글자로 같은 이름을 둘로 만드는 길을 막는다. Claude Code 는 제목 앞에 도는 스피너를
/// 붙여 프레임마다 다시 보낸다 — 떼어야 같은 제목이 같은 제목이다.
pub fn clean_text(raw: &[u8], max: usize) -> Option<String> {
    let text = String::from_utf8_lossy(raw);
    let kept: String = text
        .chars()
        .map(|c| {
            if matches!(c, '\t' | '\n' | '\r') {
                ' '
            } else {
                c
            }
        })
        .filter(|&c| !is_hidden(c))
        .collect();
    let trimmed = kept
        .trim_start_matches(|c: char| is_spinner(c) || c.is_whitespace())
        .trim_end();
    if trimmed.is_empty() {
        return None;
    }
    let mut chars = trimmed.chars();
    let mut out: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        out.pop();
        out.push('…');
    }
    Some(out)
}

fn is_hidden(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{00AD}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

/// Claude Code 가 제목 앞에 붙이는 스피너 프레임(`·✢✳✶✻✽`)과 점자 스피너(npm · cargo 류).
fn is_spinner(c: char) -> bool {
    matches!(
        c,
        '\u{2800}'..='\u{28FF}' | '·' | '✢' | '✳' | '✶' | '✻' | '✽'
    )
}

/// `ESC ]` 와 끝 사이 본문 하나 — 앞 번호로 가른다. 모르는 번호는 버린다(화면에는 그대로 간다).
fn dispatch(body: &[u8]) -> Option<Message> {
    let (num, rest) = match body.iter().position(|&b| b == b';') {
        Some(i) => (&body[..i], &body[i + 1..]),
        None => (body, &body[body.len()..]),
    };
    match num {
        b"7501" => parse_body(rest),
        b"0" | b"2" => Some(Message::Title(clean_text(rest, TITLE_CHARS))),
        b"9" => notice_9(rest),
        b"777" => notice_777(rest),
        _ => None,
    }
}

/// OSC 9 — iTerm2 의 알림 한 줄. 첫 인자가 숫자면 다른 뜻(ConEmu 의 진행 표시 `9;4;1;50` 등)이라 버린다.
fn notice_9(rest: &[u8]) -> Option<Message> {
    let first = rest.split(|&b| b == b';').next().unwrap_or_default();
    if !first.is_empty() && first.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let body = clean_text(rest, NOTICE_CHARS)?;
    Some(Message::Notice { title: None, body })
}

/// OSC 777 — rxvt 의 `notify;제목;본문`. 다른 하위 명령은 버린다. 본문이 비면 제목을 본문으로.
fn notice_777(rest: &[u8]) -> Option<Message> {
    let mut parts = rest.splitn(3, |&b| b == b';');
    if parts.next() != Some(&b"notify"[..]) {
        return None;
    }
    let title = parts.next().and_then(|t| clean_text(t, TITLE_CHARS));
    let body = parts.next().and_then(|b| clean_text(b, NOTICE_CHARS));
    match (title, body) {
        (title, Some(body)) => Some(Message::Notice { title, body }),
        (Some(title), None) => Some(Message::Notice {
            title: None,
            body: title,
        }),
        (None, None) => None,
    }
}

/// 훑개가 서 있는 자리 — 읽기 사이에 걸친 시퀀스는 이 자리에서 다음 읽기를 잇는다.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Mode {
    #[default]
    Ground,
    /// ESC 하나를 봤다.
    Esc,
    /// `ESC ]` 뒤 — 본문을 모은다.
    Osc,
    /// OSC 안의 ESC — `\` 면 ST. 아니면 (xterm 처럼) 끝으로 보고, 그 ESC 로 새 시퀀스를 연다.
    OscEsc,
    /// DCS · SOS · PM · APC — ST 까지 건너뛴다(안의 BEL 은 종이 아니다).
    Str,
    StrEsc,
}

/// PTY 출력 흐름 하나의 상태 있는 훑개. 흐름에서 아무것도 지우지 않는다(화면에는 그대로 간다 — xterm 은
/// 모르는 OSC 를 그리지 않는다). OSC 하나는 `MAX_SEQUENCE_BYTES` 까지 — 넘으면 끝까지 넘기고 버린다.
#[derive(Default)]
pub struct Scanner {
    mode: Mode,
    body: Vec<u8>,
    overflow: bool,
}

impl Scanner {
    pub fn feed(&mut self, data: &[u8]) -> Vec<Message> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < data.len() {
            if self.mode == Mode::Ground {
                // 보통의 출력에는 ESC 도 BEL 도 없다 — 둘 중 하나까지 건너뛴다.
                match data[i..].iter().position(|&b| b == 0x1b || b == 0x07) {
                    Some(skip) => i += skip,
                    None => break,
                }
            }
            self.step(data[i], &mut out);
            i += 1;
        }
        out
    }

    fn step(&mut self, b: u8, out: &mut Vec<Message>) {
        match self.mode {
            Mode::Ground => match b {
                0x1b => self.mode = Mode::Esc,
                0x07 => out.push(Message::Bell),
                _ => {}
            },
            Mode::Esc => {
                self.mode = match b {
                    b']' => {
                        self.body.clear();
                        self.overflow = false;
                        Mode::Osc
                    }
                    b'P' | b'X' | b'^' | b'_' => Mode::Str,
                    0x1b => Mode::Esc,
                    _ => Mode::Ground,
                };
            }
            Mode::Osc => match b {
                0x07 => self.finish(out),
                0x1b => self.mode = Mode::OscEsc,
                // CAN · SUB — 중단. 본문은 버린다.
                0x18 | 0x1a => self.mode = Mode::Ground,
                _ if self.body.len() < MAX_SEQUENCE_BYTES => self.body.push(b),
                _ => self.overflow = true,
            },
            Mode::OscEsc => {
                self.finish(out);
                if b != b'\\' {
                    self.mode = Mode::Esc;
                    self.step(b, out);
                }
            }
            Mode::Str => match b {
                0x1b => self.mode = Mode::StrEsc,
                0x18 | 0x1a => self.mode = Mode::Ground,
                _ => {}
            },
            Mode::StrEsc => {
                self.mode = Mode::Ground;
                if b != b'\\' {
                    self.mode = Mode::Esc;
                    self.step(b, out);
                }
            }
        }
    }

    /// OSC 하나가 끝났다 — 상한을 넘지 않았으면 번호대로 읽는다.
    fn finish(&mut self, out: &mut Vec<Message>) {
        self.mode = Mode::Ground;
        if !self.overflow {
            out.extend(dispatch(&self.body));
        }
        self.body.clear();
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
        assert_eq!(out.len(), 3, "{out:?}");
        assert!(matches!(&out[0], Message::Report(r) if r.state == Some(State::Working)));
        assert_eq!(out[1], Message::Title(Some("title".into())));
        assert_eq!(out[2], Message::Query);
    }

    /// 앱 이름은 소문자 한 모양으로 — 업데이트 뒤 잇기가 이 이름으로 claude 와 Codex 를 가른다.
    #[test]
    fn the_app_name_is_lowercased_and_odd_names_are_unknown() {
        assert_eq!(
            report("state=working:app=Codex").app.as_deref(),
            Some("codex")
        );
        assert_eq!(
            report("state=working:app=CLAUDE-Code").app.as_deref(),
            Some("claude-code")
        );
        assert_eq!(report("state=working:app=co+dex").app, None);
        // 제어 글자가 든 쌍은 건너뛰고 상태는 쓴다.
        let r = report("state=working:app=co\x01dex");
        assert_eq!((r.state, r.app), (Some(State::Working), None));
        // 32바이트를 넘으면 규격대로 보고 전체를 버린다.
        let long = format!("state=working:app={}", "c".repeat(33));
        assert_eq!(parse_body(long.as_bytes()), None);
        assert_eq!(
            report(&format!("state=working:app={}", "c".repeat(32)))
                .app
                .map(|a| a.len()),
            Some(32)
        );
    }

    #[test]
    fn titles_drop_the_spinner_bidi_and_invisible_characters() {
        let mut s = Scanner::default();
        let title = |s: &mut Scanner, raw: &str| match s.feed(raw.as_bytes()).as_slice() {
            [Message::Title(t)] => t.clone(),
            other => panic!("제목 하나가 아니다: {other:?}"),
        };
        assert_eq!(
            title(&mut s, "\x1b]0;⠋ 로그인 고치기\x07").as_deref(),
            Some("로그인 고치기")
        );
        assert_eq!(
            title(&mut s, "\x1b]2;✳ 로그인 고치기\x1b\\").as_deref(),
            Some("로그인 고치기")
        );
        assert_eq!(
            title(&mut s, "\x1b]0;\u{202E}abc\u{2066}d\u{200B}ef\u{2069}\x07").as_deref(),
            Some("abcdef")
        );
        assert_eq!(title(&mut s, "\x1b]0;\x07"), None, "빈 제목은 지움");
        let long = title(&mut s, &format!("\x1b]0;{}\x07", "가".repeat(80))).unwrap();
        assert_eq!(long.chars().count(), TITLE_CHARS);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn notices_come_from_osc_9_and_777_but_not_from_progress() {
        let mut s = Scanner::default();
        assert_eq!(
            s.feed("\x1b]9;빌드 끝\x07".as_bytes()),
            vec![Message::Notice {
                title: None,
                body: "빌드 끝".into()
            }]
        );
        assert!(
            s.feed(b"\x1b]9;4;1;50\x07").is_empty(),
            "진행 표시는 알림이 아니다"
        );
        assert_eq!(
            s.feed("\x1b]777;notify;Codex;답을 기다려요\x1b\\".as_bytes()),
            vec![Message::Notice {
                title: Some("Codex".into()),
                body: "답을 기다려요".into()
            }]
        );
        assert!(s.feed(b"\x1b]777;preexec;x\x07").is_empty());
    }

    /// OSC 밖의 BEL 만 종이다 — OSC 를 끝내는 BEL, DCS 안의 BEL 은 아니다.
    #[test]
    fn only_a_bel_outside_of_sequences_is_a_bell() {
        let mut s = Scanner::default();
        assert_eq!(s.feed(b"done\x07"), vec![Message::Bell]);
        assert!(matches!(
            s.feed(b"\x1b]0;t\x07").as_slice(),
            [Message::Title(_)]
        ));
        assert!(s.feed(b"\x1bPq\x07#1\x1b\\").is_empty());
        // 읽기 경계에 걸친 OSC 의 끝 BEL 도 종이 아니다.
        assert!(s.feed(b"\x1b]0;ab").is_empty());
        assert!(matches!(
            s.feed(b"c\x07\x07").as_slice(),
            [Message::Title(_), Message::Bell]
        ));
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
