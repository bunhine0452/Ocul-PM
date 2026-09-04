//! 세션 스크롤백 링버퍼 (#pty-host).
//!
//! 재접속의 관문인 `Attach` 가 돌려주는 스냅샷의 원본이다. 호스트가 앱보다 오래
//! 사는 이유가 이것이기도 하다 — 앱이 업데이트로 재시작해도 여기 담긴 출력이
//! 그대로 남아 있어, 다시 붙은 화면이 화면을 복원할 수 있다.
//!
//! `host.rs` 에서 떼어 낸 이유는 순수 자료구조라서다: PTY·소켓·락 없이 그대로
//! 테스트되고, 호스트 본체는 이미 한 파일이 감당할 만큼 크다 (#pty-write-lock
//! 라운드에서 파일 크기 래칫이 그 사실을 말해 줬다).

use std::collections::VecDeque;

/// 재접속 리플레이용 스크롤백 상한 (bytes, 청크 단위로 앞에서 버림).
const SCROLLBACK_CAP_BYTES: usize = 200_000;

#[derive(Default)]
pub struct SessionBuf {
    chunks: VecDeque<String>,
    bytes: usize,
    seq: u32,
}

impl SessionBuf {
    pub fn push(&mut self, text: &str) -> u32 {
        self.seq += 1;
        self.bytes += text.len();
        self.chunks.push_back(text.to_string());
        while self.bytes > SCROLLBACK_CAP_BYTES {
            match self.chunks.pop_front() {
                Some(front) => self.bytes -= front.len(),
                None => break,
            }
        }
        self.seq
    }

    pub fn snapshot(&self) -> (String, u32) {
        (self.chunks.iter().map(String::as_str).collect(), self.seq)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 링버퍼 — 상한 초과 시 앞 청크부터 버리고 seq 는 단조 증가.
    #[test]
    fn session_buf_caps_and_sequences() {
        let mut buf = SessionBuf::default();
        let big = "x".repeat(SCROLLBACK_CAP_BYTES / 2 + 1);
        assert_eq!(buf.push(&big), 1);
        assert_eq!(buf.push(&big), 2);
        assert_eq!(buf.push("tail"), 3); // 첫 big 이 밀려난다
        let (text, seq) = buf.snapshot();
        assert_eq!(seq, 3);
        assert!(text.ends_with("tail"));
        assert!(text.len() <= SCROLLBACK_CAP_BYTES + 4);
        assert_eq!(text.matches('x').count(), big.len());
    }
}
