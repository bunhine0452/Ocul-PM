//! `Content-Length` 프레이밍 — 헤더 + `\r\n\r\n` + 본문.
//!
//! **LSP 와 DAP 가 함께 쓴다.** 둘은 봉투(JSON-RPC 2.0 vs `seq`/`request_seq`)가
//! 다르지만 바깥 프레이밍은 같다 — DAP 가 LSP 의 base protocol 을 그대로 가져다
//! 썼기 때문이다. 그래서 이 조각만 크레이트 루트로 올려 둔다: `dap` 이 `lsp` 를
//! 임포트하게 두면 있지도 않은 계층 관계를 암시한다.
//!
//! **MCP 의 프레이밍과는 다르다.** `oculpm/mcp/protocol.rs` 는 개행 구분 JSON 이라
//! 한 줄 = 한 메시지지만, 여기는 HTTP 스타일 헤더로 길이를 먼저 알린다:
//!
//! ```text
//! Content-Length: 123\r\n
//! Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n   (선택)
//! \r\n
//! {"jsonrpc":"2.0", ...}
//! ```
//!
//! 스트림에서 오므로 한 번의 read 가 메시지 경계와 맞지 않는다 — 헤더 중간에서
//! 끊기기도 하고, 한 번에 여러 메시지가 오기도 한다. 그래서 파서는 **버퍼를
//! 소유하지 않고** "지금까지 모인 바이트에서 완성된 메시지 하나를 떼어낼 수
//! 있나" 만 답하는 순수 함수로 둔다 (테스트 가치가 가장 높은 조각).

/// 한 메시지의 헤더 상한. 정상 헤더는 100바이트 남짓이라 이걸 넘으면 상대가
/// LSP 를 말하고 있지 않다는 뜻 — 무한정 버퍼링하다 메모리를 먹는 대신 끊는다.
const MAX_HEADER_BYTES: usize = 8 * 1024;

/// 본문 상한. rust-analyzer 의 대형 완성 응답도 수 MB 를 넘지 않는다.
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    /// 완성된 메시지 하나와, 버퍼에서 소비한 바이트 수.
    Message { body: Vec<u8>, consumed: usize },
    /// 아직 메시지 하나가 다 안 왔다 — 더 읽어야 한다.
    Incomplete,
    /// 프로토콜 위반. 호출자는 연결을 끊는다 (복구 지점이 없다 — 어디서부터
    /// 다시 맞춰야 할지 알 수 없으므로 재동기화를 시도하지 않는다).
    Invalid(&'static str),
}

/// 버퍼 앞에서 완성된 메시지 하나를 떼어낸다.
pub fn parse_frame(buf: &[u8]) -> Frame {
    let Some(header_end) = find_header_end(buf) else {
        return if buf.len() > MAX_HEADER_BYTES {
            Frame::Invalid("header exceeds limit without terminator")
        } else {
            Frame::Incomplete
        };
    };

    let header_bytes = &buf[..header_end];
    // 헤더는 ASCII 다. 아니면 LSP 가 아니다.
    let Ok(header) = std::str::from_utf8(header_bytes) else {
        return Frame::Invalid("header is not valid utf-8");
    };

    let mut content_length: Option<usize> = None;
    for line in header.split("\r\n") {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Frame::Invalid("header line without ':'");
        };
        // 헤더 이름은 대소문자를 가리지 않는다 (HTTP 관습).
        if name.trim().eq_ignore_ascii_case("content-length") {
            match value.trim().parse::<usize>() {
                Ok(n) if n <= MAX_BODY_BYTES => content_length = Some(n),
                Ok(_) => return Frame::Invalid("content-length exceeds limit"),
                Err(_) => return Frame::Invalid("content-length is not a number"),
            }
        }
        // 그 밖의 헤더(Content-Type 등)는 읽고 버린다.
    }

    let Some(len) = content_length else {
        return Frame::Invalid("missing content-length header");
    };

    let body_start = header_end + 4; // "\r\n\r\n"
    let body_end = body_start + len;
    if buf.len() < body_end {
        return Frame::Incomplete;
    }
    Frame::Message {
        body: buf[body_start..body_end].to_vec(),
        consumed: body_end,
    }
}

/// `\r\n\r\n` 의 시작 위치 (= 헤더 영역의 끝).
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// 메시지 하나를 전송 형태로 감싼다.
pub fn encode_frame(body: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(body: &str) -> Vec<u8> {
        encode_frame(body)
    }

    #[test]
    fn round_trips_a_single_message() {
        let buf = msg(r#"{"jsonrpc":"2.0"}"#);
        match parse_frame(&buf) {
            Frame::Message { body, consumed } => {
                assert_eq!(String::from_utf8(body).unwrap(), r#"{"jsonrpc":"2.0"}"#);
                assert_eq!(consumed, buf.len());
            }
            other => panic!("expected a message, got {other:?}"),
        }
    }

    /// 한 번의 read 가 메시지 경계와 맞지 않는 것이 정상이다 — 헤더 중간,
    /// 헤더 직후, 본문 중간 어디서 끊겨도 Incomplete 여야 한다.
    #[test]
    fn partial_reads_are_incomplete_at_every_boundary() {
        let buf = msg(r#"{"a":1}"#);
        for cut in 0..buf.len() {
            assert_eq!(
                parse_frame(&buf[..cut]),
                Frame::Incomplete,
                "{cut} 바이트에서 잘렸을 때 Incomplete 가 아니다"
            );
        }
        assert!(matches!(parse_frame(&buf), Frame::Message { .. }));
    }

    /// 한 번에 여러 메시지가 오면 앞에서부터 하나씩 떼어낸다.
    #[test]
    fn consumes_one_message_at_a_time_from_a_batch() {
        let mut buf = msg(r#"{"n":1}"#);
        buf.extend_from_slice(&msg(r#"{"n":2}"#));

        let Frame::Message { body, consumed } = parse_frame(&buf) else {
            panic!("첫 메시지를 못 뗐다")
        };
        assert_eq!(String::from_utf8(body).unwrap(), r#"{"n":1}"#);

        let Frame::Message { body, .. } = parse_frame(&buf[consumed..]) else {
            panic!("둘째 메시지를 못 뗐다")
        };
        assert_eq!(String::from_utf8(body).unwrap(), r#"{"n":2}"#);
    }

    /// 본문은 UTF-8 이고 한글은 1자 3바이트다 — 길이를 문자 수로 세면 여기서 깨진다.
    #[test]
    fn content_length_counts_bytes_not_characters() {
        let body = r#"{"msg":"한글 주석"}"#;
        let buf = msg(body);
        let header = String::from_utf8(buf[..20].to_vec()).unwrap();
        assert!(header.starts_with(&format!("Content-Length: {}", body.len())), "{header}");
        let Frame::Message { body: got, .. } = parse_frame(&buf) else {
            panic!("한글 본문을 못 읽었다")
        };
        assert_eq!(String::from_utf8(got).unwrap(), body);
    }

    #[test]
    fn accepts_extra_headers_and_any_case() {
        let body = r#"{"ok":true}"#;
        let raw = format!(
            "content-length: {}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{body}",
            body.len()
        );
        let Frame::Message { body: got, .. } = parse_frame(raw.as_bytes()) else {
            panic!("추가 헤더/소문자 이름을 거부했다")
        };
        assert_eq!(String::from_utf8(got).unwrap(), body);
    }

    #[test]
    fn rejects_malformed_headers() {
        let cases: [(&[u8], &str); 3] = [
            (b"Content-Length: abc\r\n\r\n{}", "숫자가 아닌 길이"),
            (b"Content-Type: x\r\n\r\n{}", "length 헤더 없음"),
            (b"garbage\r\n\r\n{}", "':' 없는 헤더 줄"),
        ];
        for (raw, why) in cases {
            assert!(matches!(parse_frame(raw), Frame::Invalid(_)), "{why} 를 통과시켰다");
        }
    }

    /// 종결자 없이 무한정 밀어 넣는 상대에게 메모리를 내주지 않는다.
    #[test]
    fn oversized_header_without_terminator_is_invalid_not_incomplete() {
        let flood = vec![b'x'; MAX_HEADER_BYTES + 1];
        assert!(matches!(parse_frame(&flood), Frame::Invalid(_)));
        // 상한 이하에서는 여전히 "더 기다린다".
        let small = vec![b'x'; 16];
        assert_eq!(parse_frame(&small), Frame::Incomplete);
    }

    #[test]
    fn rejects_absurd_content_length_before_allocating() {
        let raw = b"Content-Length: 99999999999\r\n\r\n";
        assert!(matches!(parse_frame(raw), Frame::Invalid(_)));
    }
}
