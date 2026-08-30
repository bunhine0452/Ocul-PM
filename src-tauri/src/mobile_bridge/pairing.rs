//! 페어링 코드 → Bearer 토큰 (#mb0-pairing, 플랜 D5 ②).
//!
//! 코드는 6자리·TTL 5분·1회용, 메모리에만 산다. 성공 시 발급되는 토큰은
//! 폰에만 전달되고 서버에는 blake3 해시만 남는다 (평문 저장 금지).

use std::time::{Duration, Instant};

pub const PAIRING_TTL: Duration = Duration::from_secs(5 * 60);
/// 코드 오입력 허용 횟수 — 초과하면 세션 자체를 태운다 (무차별 대입 방지).
pub const MAX_ATTEMPTS: u8 = 5;

/// 진행 중인 페어링 세션 — 동시에 최대 1개 (MobileBridgeState 가 보관).
#[derive(Debug)]
pub struct PairingSession {
    code: String,
    expires_at: Instant,
    attempts: u8,
}

/// 코드 대조 결과. `Accepted` 일 때만 호출측이 세션을 소모(take)한다 — 1회용.
#[derive(Debug, PartialEq, Eq)]
pub enum PairAttempt {
    Accepted,
    WrongCode { remaining: u8 },
    Expired,
    Exhausted,
}

impl PairingSession {
    pub fn begin(now: Instant) -> Self {
        Self {
            code: generate_code(),
            expires_at: now + PAIRING_TTL,
            attempts: 0,
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn remaining_secs(&self, now: Instant) -> u64 {
        self.expires_at.saturating_duration_since(now).as_secs()
    }

    /// 대조 — 순수 판정 (`now` 주입으로 테스트 가능).
    pub fn check(&mut self, input: &str, now: Instant) -> PairAttempt {
        if now >= self.expires_at {
            return PairAttempt::Expired;
        }
        if self.attempts >= MAX_ATTEMPTS {
            return PairAttempt::Exhausted;
        }
        if input == self.code {
            return PairAttempt::Accepted;
        }
        self.attempts += 1;
        if self.attempts >= MAX_ATTEMPTS {
            PairAttempt::Exhausted
        } else {
            PairAttempt::WrongCode {
                remaining: MAX_ATTEMPTS - self.attempts,
            }
        }
    }
}

/// 6자리 숫자 코드. uuid v4 의 랜덤 바이트에서 파생 — 10^6 대비 2^32 의
/// 모듈로 편향은 무시 가능한 수준.
fn generate_code() -> String {
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    let n = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{n:06}")
}

/// Bearer 토큰 — uuid v4 두 개(hex 64자, ~244비트 엔트로피).
pub fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// 저장·대조는 항상 이 해시로 — 평문 토큰은 DB 에 닿지 않는다.
pub fn hash_token(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_with(code: &str, now: Instant) -> PairingSession {
        PairingSession {
            code: code.into(),
            expires_at: now + PAIRING_TTL,
            attempts: 0,
        }
    }

    #[test]
    fn code_is_six_digits() {
        for _ in 0..50 {
            let s = PairingSession::begin(Instant::now());
            assert_eq!(s.code().len(), 6);
            assert!(s.code().chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn correct_code_is_accepted() {
        let now = Instant::now();
        let mut s = session_with("123456", now);
        assert_eq!(s.check("123456", now), PairAttempt::Accepted);
    }

    #[test]
    fn expired_at_ttl_boundary() {
        let now = Instant::now();
        let mut s = session_with("123456", now);
        // TTL 경계 — expires_at 정각은 이미 만료다.
        assert_eq!(s.check("123456", now + PAIRING_TTL), PairAttempt::Expired);
    }

    #[test]
    fn wrong_code_counts_down_then_exhausts() {
        let now = Instant::now();
        let mut s = session_with("123456", now);
        for i in 1..MAX_ATTEMPTS {
            assert_eq!(
                s.check("000000", now),
                PairAttempt::WrongCode {
                    remaining: MAX_ATTEMPTS - i
                }
            );
        }
        // 5번째 오입력 — 소진.
        assert_eq!(s.check("000000", now), PairAttempt::Exhausted);
        // 소진 후에는 맞는 코드도 거부.
        assert_eq!(s.check("123456", now), PairAttempt::Exhausted);
    }

    #[test]
    fn token_is_64_hex_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn hash_is_stable_and_distinct() {
        assert_eq!(hash_token("abc"), hash_token("abc"));
        assert_ne!(hash_token("abc"), hash_token("abd"));
        assert_eq!(hash_token("abc").len(), 64);
    }
}
