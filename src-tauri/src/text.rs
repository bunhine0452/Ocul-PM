//! 문자 경계를 지키는 문자열 다루기 — 퍼센트 디코딩과 바이트 예산 절단.
//!
//! # 왜 한 모듈인가
//!
//! 두 함수는 같은 사고에서 나왔다. `String` 을 **바이트 인덱스로 슬라이스**하면
//! 그 인덱스가 UTF-8 문자 중간일 때 패닉한다 (`&s[..n]` 은 검사하지 않는다).
//! 한국어가 기본 UI 언어인 앱에서 이건 이론이 아니다 — 3바이트 문자가 기본이라
//! 임의의 바이트 오프셋이 경계일 확률은 1/3 이다.
//!
//! 2026-09-07 감사에서 같은 결함이 **네 자리**에서 나왔고, 넷 다 각자 손으로
//! 쓴 코드였다:
//!
//! * `deeplink.rs` · `notion.rs` · `lsp/registry.rs` — 퍼센트 디코더 3벌이
//!   글자까지 같았고, 셋 다 `&s[i + 1..i + 3]` 으로 패닉했다.
//! * `commands/overview.rs` — 매니페스트를 24KB 예산으로 자르며 경계를 안 봤다.
//!
//! 반대로 `llm/mod.rs` · `commands/oculpm.rs` · `acp/session.rs` 는 **맞게**
//! 짜여 있었다. 즉 이 저장소는 이 함정을 이미 알고 있었는데, 아는 것이 코드
//! 한 자리에 모여 있지 않아서 다음 사람이 또 틀렸다. 그래서 모은다 — 여기를
//! 거치지 않고 `&s[..n]` 을 쓰는 새 자리가 생기면 그게 다음 결함이다.

/// 퍼센트 인코딩(`%XX`)을 푼다. `+` 는 공백으로 보지 않는다 — 경로에 `+` 가
/// 들어가면 그대로 `+` 여야 한다 (딥링크·LSP URI 둘 다 그 규약이다).
///
/// `%` 뒤 두 바이트가 hex 가 아니거나 문자열이 거기서 끝나면 `%` 를 **글자
/// 그대로** 남긴다 — 관대한 디코더다. 입력이 어디서 오든(브라우저·루프백
/// 소켓·언어 서버) 패닉하지 않는 것이 이 함수의 유일한 강한 약속이다.
///
/// 디코딩 결과가 올바른 UTF-8 이 아니면 `from_utf8_lossy` 가 대체 문자로
/// 바꾼다. 퍼센트 디코딩은 임의 바이트를 만들 수 있으므로 이 폴백이 필요하다.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // `&s[i + 1..i + 3]` 으로 자르지 않는다 — 그 두 바이트가 멀티바이트
        // 문자의 일부면 슬라이스 자체가 패닉한다 (`%한` 이 정확히 그렇다).
        // 바이트를 직접 읽으면 경계라는 개념이 아예 등장하지 않는다.
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// hex 한 자리 → 값. 대소문자 모두 받는다.
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// `max` **바이트를 넘지 않는** 가장 큰 문자 경계. `&s[..floor_char_boundary(s, n)]`
/// 은 절대 패닉하지 않는다.
///
/// `str::floor_char_boundary` 가 안정화되면 그것으로 갈아탄다 (동작 동일).
pub fn floor_char_boundary(s: &str, max: usize) -> usize {
    if max >= s.len() {
        return s.len();
    }
    let mut cut = max;
    // UTF-8 문자는 최대 4바이트라 최대 3번 물러난다. `cut > 0` 은 방어이고,
    // 0 은 언제나 경계이므로 루프는 반드시 끝난다.
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

/// `max` 바이트까지 자르고, 잘랐을 때만 `suffix` 를 붙인다. 경계는 언제나
/// 지킨다. 반환값의 길이는 `max + suffix.len()` 을 넘을 수 있다 — 예산은
/// **본문**에 대한 것이지 표시 문자열 전체가 아니다.
pub fn truncate_with(s: &str, max: usize, suffix: &str) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let cut = floor_char_boundary(s, max);
    format!("{}{}", &s[..cut], suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ascii_escapes() {
        assert_eq!(percent_decode("a%2Bb"), "a+b");
        assert_eq!(percent_decode("%2f%2F"), "//");
        assert_eq!(percent_decode("plain"), "plain");
    }

    #[test]
    fn decodes_utf8_sequences() {
        // "한" = ED 95 9C
        assert_eq!(percent_decode("%ED%95%9C"), "한");
    }

    /// 회귀 — 2026-09-07 감사에서 실증한 패닉. `%` 바로 뒤에 멀티바이트 문자가
    /// 오면 옛 구현은 `end byte index 3 is not a char boundary` 로 죽었다.
    /// 딥링크(`oculpm://open?project=%한`)로 웹페이지가 유발할 수 있었다.
    #[test]
    fn multibyte_after_percent_does_not_panic() {
        assert_eq!(percent_decode("%한"), "%한");
        assert_eq!(percent_decode("%한x"), "%한x");
        assert_eq!(percent_decode("a%한%41"), "a%한A");
        // 이모지(4바이트)도 같다.
        assert_eq!(percent_decode("%🙂"), "%🙂");
    }

    #[test]
    fn keeps_incomplete_escapes_literal() {
        assert_eq!(percent_decode("%"), "%");
        assert_eq!(percent_decode("%4"), "%4");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("100%"), "100%");
        // 끝에 딱 맞는 `%XX` 는 풀린다 (경계 조건).
        assert_eq!(percent_decode("x%41"), "xA");
    }

    #[test]
    fn plus_is_not_a_space() {
        assert_eq!(percent_decode("a+b"), "a+b");
    }

    #[test]
    fn floor_boundary_never_splits_a_char() {
        let s = "가나다"; // 3바이트 × 3
        assert_eq!(floor_char_boundary(s, 9), 9);
        assert_eq!(floor_char_boundary(s, 100), 9);
        // 4·5 는 '나' 안쪽 → 3 으로 물러난다.
        assert_eq!(floor_char_boundary(s, 4), 3);
        assert_eq!(floor_char_boundary(s, 5), 3);
        assert_eq!(floor_char_boundary(s, 3), 3);
        assert_eq!(floor_char_boundary(s, 1), 0);
        assert_eq!(floor_char_boundary(s, 0), 0);
        // 슬라이스가 실제로 패닉하지 않는다.
        for n in 0..=s.len() + 2 {
            let _ = &s[..floor_char_boundary(s, n)];
        }
    }

    #[test]
    fn truncate_adds_suffix_only_when_cut() {
        assert_eq!(truncate_with("abc", 10, "…"), "abc");
        assert_eq!(truncate_with("가나다", 4, "…"), "가…");
        // 상한과 길이가 같으면 자르지 않는다.
        assert_eq!(truncate_with("가", 3, "…"), "가");
    }
}
