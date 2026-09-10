//! 세션 스크롤백 링버퍼 (#pty-host).
//!
//! 재접속의 관문인 `Attach` 가 돌려주는 스냅샷의 원본이다. 호스트가 앱보다 오래
//! 사는 이유가 이것이기도 하다 — 앱이 업데이트로 재시작해도 여기 담긴 출력이
//! 그대로 남아 있어, 다시 붙은 화면이 화면을 복원할 수 있다.
//!
//! `host.rs` 에서 떼어 낸 이유는 순수 자료구조라서다: PTY·소켓·락 없이 그대로
//! 테스트되고, 호스트 본체는 이미 한 파일이 감당할 만큼 크다 (#pty-write-lock
//! 라운드에서 파일 크기 래칫이 그 사실을 말해 줬다).
//!
//! ── 크기 마커 (2026-09-11) ────────────────────────────────────────────────
//!
//! 스냅샷은 바이트의 나열이 아니라 **어떤 폭에서 찍힌 바이트의 나열**이다.
//! claude code 같은 TUI 는 자기 화면을 다시 그릴 때 "커서를 N 줄 올려 지우고
//! 다시 쓴다" 를 반복하는데, 그 N 은 그때의 열 수로 계산된 값이다. 같은 바이트를
//! 다른 폭의 xterm 에 그대로 흘리면 지운다고 믿은 줄이 안 지워지고 접힌 줄이
//! 겹쳐서, 도크(좁음)↔터미널 화면(넓음)을 오갈 때마다 옛 대화가 찌부러졌다.
//!
//! 그래서 `Resize` 가 지나간 자리마다 마커를 끼워 두고, 스냅샷은 "이 오프셋부터는
//! rows×cols 였다" 를 함께 돌려준다. 붙는 화면은 구간마다 xterm 을 그 크기로
//! 맞춘 뒤 쓴다 — 셸이 실제로 본 그대로 재생하는 것이라, 폭이 바뀐 구간도
//! xterm 의 리플로(soft wrap)가 다루는 평범한 줄바꿈으로 남는다.

use std::collections::VecDeque;

use super::protocol::{AttachPayload, SizeMark};

/// 재접속 리플레이용 스크롤백 상한 (bytes, 청크 단위로 앞에서 버림).
const SCROLLBACK_CAP_BYTES: usize = 200_000;

enum Chunk {
    Text(String),
    /// 이 자리부터의 PTY 크기. 바이트를 차지하지 않는다.
    Size {
        rows: u16,
        cols: u16,
    },
}

/// `snapshot` 의 결과 — 텍스트와, 텍스트 안에서 크기가 바뀐 자리들.
pub struct Snapshot {
    pub text: String,
    pub seq: u32,
    /// 오름차순. `at` 은 **UTF-16 단위** 오프셋이다 — 받는 쪽이 JS 문자열이라
    /// 바이트 오프셋은 쓸 수 없고, `chars()` 인덱스도 서로게이트 쌍에서 어긋난다.
    /// 첫 원소는 (알 수 있으면) 항상 `at == 0` 으로, 스냅샷 첫 바이트의 크기다.
    pub sizes: Vec<SizeMark>,
}

#[derive(Default)]
pub struct SessionBuf {
    chunks: VecDeque<Chunk>,
    bytes: usize,
    seq: u32,
    /// 링에서 밀려난 구간의 **마지막** 크기 — 즉 지금 남아 있는 첫 청크가 찍힐
    /// 때의 크기. 세션을 띄운 크기로 시작한다. `None` 은 "모른다"(구버전 경로).
    front_size: Option<(u16, u16)>,
    /// 가장 최근에 알려진 크기 — 같은 값의 `Resize` 를 마커로 남기지 않기 위해.
    current: Option<(u16, u16)>,
}

impl SessionBuf {
    /// 세션을 띄운 크기로 시작한다 — 첫 바이트부터 어떤 폭이었는지 안다.
    pub fn with_size(rows: u16, cols: u16) -> Self {
        let size = (rows > 0 && cols > 0).then_some((rows, cols));
        Self {
            front_size: size,
            current: size,
            ..Self::default()
        }
    }

    pub fn push(&mut self, text: &str) -> u32 {
        self.seq += 1;
        self.bytes += text.len();
        self.chunks.push_back(Chunk::Text(text.to_string()));
        self.trim();
        self.seq
    }

    /// PTY 크기가 바뀌었다. 같은 크기면 아무것도 남기지 않고, 텍스트 없이
    /// 연달아 바뀌면 마지막 것만 남긴다 (분할 막대를 끄는 동안의 중간 크기는
    /// 어떤 바이트도 찍지 않았으니 재생에 필요 없다).
    pub fn resized(&mut self, rows: u16, cols: u16) {
        if rows == 0 || cols == 0 {
            return;
        }
        if self.current == Some((rows, cols)) {
            return;
        }
        self.current = Some((rows, cols));
        if let Some(Chunk::Size { rows: r, cols: c }) = self.chunks.back_mut() {
            *r = rows;
            *c = cols;
            return;
        }
        self.chunks.push_back(Chunk::Size { rows, cols });
    }

    fn trim(&mut self) {
        while self.bytes > SCROLLBACK_CAP_BYTES {
            match self.chunks.pop_front() {
                Some(Chunk::Text(front)) => self.bytes -= front.len(),
                Some(Chunk::Size { rows, cols }) => self.front_size = Some((rows, cols)),
                None => break,
            }
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut text = String::with_capacity(self.bytes);
        let mut sizes: Vec<SizeMark> = Vec::new();
        let mut at: u32 = 0;
        let mark = |sizes: &mut Vec<SizeMark>, at: u32, rows: u16, cols: u16| {
            // 같은 자리의 마커는 마지막 것이 이긴다 — 바이트가 하나도 안 찍힌
            // 크기는 재생에 아무 뜻이 없다.
            if let Some(last) = sizes.last_mut() {
                if last.at == at {
                    last.rows = rows;
                    last.cols = cols;
                    return;
                }
            }
            sizes.push(SizeMark { at, rows, cols });
        };
        if let Some((rows, cols)) = self.front_size {
            mark(&mut sizes, 0, rows, cols);
        }
        for chunk in &self.chunks {
            match chunk {
                Chunk::Text(s) => {
                    text.push_str(s);
                    at += s.encode_utf16().count() as u32;
                }
                Chunk::Size { rows, cols } => mark(&mut sizes, at, *rows, *cols),
            }
        }
        Snapshot {
            text,
            seq: self.seq,
            sizes,
        }
    }

    /// 지금 PTY 가 쓰는 열 수 — 마커를 모르는 옛 필드(`cols`)를 채우는 데 쓴다.
    /// 링버퍼가 기억하는 값이라 커널에 다시 묻지 않는다 (`get_size` 는 ioctl 이다).
    pub fn current_cols(&self) -> u16 {
        self.current.map_or(0, |(_, c)| c)
    }

    /// `Attach` 응답 본문 — 스냅샷 + 세션 정보를 한 번에.
    pub fn attach_payload(&self, nonce: String, shell_integration: bool) -> AttachPayload {
        let snap = self.snapshot();
        AttachPayload {
            text: snap.text,
            seq: snap.seq,
            nonce,
            shell_integration,
            cols: self.current_cols(),
            sizes: snap.sizes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marks(buf: &SessionBuf) -> Vec<(u32, u16, u16)> {
        buf.snapshot()
            .sizes
            .iter()
            .map(|m| (m.at, m.rows, m.cols))
            .collect()
    }

    /// 링버퍼 — 상한 초과 시 앞 청크부터 버리고 seq 는 단조 증가.
    #[test]
    fn session_buf_caps_and_sequences() {
        let mut buf = SessionBuf::default();
        let big = "x".repeat(SCROLLBACK_CAP_BYTES / 2 + 1);
        assert_eq!(buf.push(&big), 1);
        assert_eq!(buf.push(&big), 2);
        assert_eq!(buf.push("tail"), 3); // 첫 big 이 밀려난다
        let snap = buf.snapshot();
        assert_eq!(snap.seq, 3);
        assert!(snap.text.ends_with("tail"));
        assert!(snap.text.len() <= SCROLLBACK_CAP_BYTES + 4);
        assert_eq!(snap.text.matches('x').count(), big.len());
        // 크기를 모르는 버퍼는 마커도 없다 — 없는 것을 지어내지 않는다.
        assert!(snap.sizes.is_empty());
    }

    /// 시작 크기는 오프셋 0 의 마커로, 이후 Resize 는 그 시점의 오프셋으로.
    #[test]
    fn size_marks_follow_the_bytes() {
        let mut buf = SessionBuf::with_size(24, 80);
        buf.push("abc");
        buf.resized(40, 200);
        buf.push("defg");
        buf.resized(40, 60);
        buf.push("h");
        assert_eq!(marks(&buf), vec![(0, 24, 80), (3, 40, 200), (7, 40, 60)]);
        assert_eq!(buf.snapshot().text, "abcdefgh");
        assert_eq!(buf.current_cols(), 60);
    }

    /// 오프셋은 UTF-16 단위다 — 한글은 1, 이모지(서로게이트 쌍)는 2.
    #[test]
    fn offsets_count_utf16_units_not_bytes() {
        let mut buf = SessionBuf::with_size(24, 80);
        buf.push("한글😀");
        buf.resized(24, 100);
        buf.push("x");
        assert_eq!(marks(&buf), vec![(0, 24, 80), (4, 24, 100)]);
    }

    /// 바이트 없이 연달아 바뀐 크기는 마지막 하나로 접히고, 같은 크기는 마커를
    /// 남기지 않는다.
    #[test]
    fn redundant_resizes_collapse() {
        let mut buf = SessionBuf::with_size(24, 80);
        buf.resized(24, 80); // 같은 크기 — 무시
        buf.push("a");
        buf.resized(24, 90);
        buf.resized(24, 95);
        buf.resized(30, 100); // 셋이 하나로
        buf.push("b");
        buf.resized(30, 100); // 같은 크기 — 무시
        assert_eq!(marks(&buf), vec![(0, 24, 80), (1, 30, 100)]);
    }

    /// 크기가 시작 크기로 되돌아온 경우에도 마커는 남는다 — "지금 크기" 와
    /// "그 사이에 찍힌 바이트의 크기" 는 다른 사실이다.
    #[test]
    fn returning_to_the_start_size_is_still_a_mark() {
        let mut buf = SessionBuf::with_size(24, 80);
        buf.push("a");
        buf.resized(24, 40);
        buf.push("b");
        buf.resized(24, 80);
        buf.push("c");
        assert_eq!(marks(&buf), vec![(0, 24, 80), (1, 24, 40), (2, 24, 80)]);
    }

    /// 앞이 잘려 나가면 잘린 구간의 마지막 크기가 새 첫 마커가 된다.
    #[test]
    fn trimming_carries_the_size_of_the_surviving_front() {
        let mut buf = SessionBuf::with_size(24, 80);
        let big = "x".repeat(SCROLLBACK_CAP_BYTES / 2 + 1);
        buf.push(&big);
        buf.resized(24, 120);
        buf.push(&big); // 여기서 첫 big 과 마커가 함께 밀려난다
        buf.resized(24, 60);
        buf.push("tail");
        let m = marks(&buf);
        assert_eq!(m[0], (0, 24, 120));
        assert_eq!(m[1], (big.encode_utf16().count() as u32, 24, 60));
        assert_eq!(m.len(), 2);
    }

    /// 0 크기는 PTY 에게 뜻이 없다 — 마커로도 남기지 않는다.
    #[test]
    fn zero_sizes_are_ignored() {
        let mut buf = SessionBuf::with_size(0, 0);
        buf.push("a");
        buf.resized(0, 80);
        buf.resized(24, 0);
        assert!(marks(&buf).is_empty());
        assert_eq!(buf.current_cols(), 0);
    }
}
