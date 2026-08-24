//! Tailscale 인터페이스 3조건 탐지 (#mb0-ts-bind / #security-layers ①).
//!
//! 대역만 보면 안 된다 — 100.64.0.0/10 은 ISP CGNAT 도 쓴다. 세 조건을 겹친다:
//! (a) 100.64.0.0/10 소속, (b) 점대점 터널 형태(/32 + broadcast 없음),
//! (c) tailscale CLI 교차검증(있을 때만 — 불일치면 미기동).

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::process::Command;

/// 탐지된 Tailscale 바인드 주소.
///
/// private 필드 + 유일 생성자 [`TailscaleBindAddr::detect`] — `serve()` 가 이 타입만
/// 받으면 0.0.0.0/127.0.0.1 폴백이 컴파일 에러가 된다 (#mb0-bind-newtype).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TailscaleBindAddr(Ipv4Addr);

impl TailscaleBindAddr {
    /// 시스템 인터페이스를 열거해 3조건을 통과한 주소를 고른다. 실패 = 서버 미기동.
    pub fn detect() -> Result<Self, BindDetectError> {
        let candidates = enumerate_candidates();
        let cli_ips = query_tailscale_cli();
        select_candidate(&candidates, cli_ips.as_deref()).map(Self)
    }

    pub fn socket_addr(&self, port: u16) -> SocketAddr {
        SocketAddr::V4(SocketAddrV4::new(self.0, port))
    }
}

/// 탐지 실패 사유 — 설정 화면에 그대로 노출된다 (사용자 노출 에러는 영어).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BindDetectError {
    #[error("no Tailscale interface found — is Tailscale installed and connected?")]
    NoCandidate,
    #[error("interface/CLI mismatch: tailscale CLI reports [{cli}] but no matching interface passed the checks")]
    CliMismatch { cli: String },
}

/// 인터페이스 후보 — 순수 판정을 위해 열거 결과에서 분리한 최소 표현.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub ip: Ipv4Addr,
    pub prefix_len: u8,
    pub has_broadcast: bool,
}

/// (a) 100.64.0.0/10 — Tailscale 이 할당하는 CGNAT 대역.
pub(crate) fn in_cgnat_range(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..=127).contains(&o[1])
}

/// (b) 점대점 터널 형태 — /32 이고 broadcast 없음.
/// ISP CGNAT 는 일반 서브넷(/24 등 + broadcast)이라 여기서 걸러진다.
pub(crate) fn is_point_to_point(c: &Candidate) -> bool {
    c.prefix_len == 32 && !c.has_broadcast
}

/// 3조건 선택 — 순수 함수 (테스트 표면).
///
/// * 후보 0개 → `NoCandidate`.
/// * 후보 여럿 → 결정적 선택(주소 오름차순 첫 번째).
/// * CLI 부재(`None`) → (a)+(b) 통과만으로 채택.
/// * CLI 존재 → 교집합만 채택, 교집합 없으면 `CliMismatch`(미기동).
pub(crate) fn select_candidate(
    candidates: &[Candidate],
    cli_ips: Option<&[Ipv4Addr]>,
) -> Result<Ipv4Addr, BindDetectError> {
    let mut passed: Vec<Ipv4Addr> = candidates
        .iter()
        .filter(|c| in_cgnat_range(c.ip) && is_point_to_point(c))
        .map(|c| c.ip)
        .collect();
    passed.sort_unstable();

    match cli_ips {
        None => passed.first().copied().ok_or(BindDetectError::NoCandidate),
        Some(cli) => {
            if passed.is_empty() {
                return Err(BindDetectError::NoCandidate);
            }
            passed
                .iter()
                .copied()
                .find(|ip| cli.contains(ip))
                .ok_or_else(|| BindDetectError::CliMismatch {
                    cli: cli
                        .iter()
                        .map(|ip| ip.to_string())
                        .collect::<Vec<_>>()
                        .join(", "),
                })
        }
    }
}

pub(crate) fn prefix_len_from_netmask(mask: Ipv4Addr) -> u8 {
    u32::from(mask).count_ones() as u8
}

/// 시스템 인터페이스 → 후보 목록. 실패는 빈 목록(= 이후 NoCandidate)으로 수렴.
fn enumerate_candidates() -> Vec<Candidate> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    ifaces
        .into_iter()
        .filter_map(|iface| match iface.addr {
            if_addrs::IfAddr::V4(v4) => Some(Candidate {
                ip: v4.ip,
                prefix_len: prefix_len_from_netmask(v4.netmask),
                has_broadcast: v4.broadcast.is_some(),
            }),
            _ => None,
        })
        .collect()
}

/// tailscale CLI 위치 후보 — App Store 판은 PATH 에 없어 앱 번들 경로가 먼저.
const TAILSCALE_CLI_CANDIDATES: &[&str] = &[
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "tailscale",
];

/// `tailscale ip -4` 교차검증. `Some` 은 "CLI 가 성공했고 IPv4 를 ≥1개 보고"일 때만 —
/// CLI 부재·실패·빈 출력은 전부 `None`(= 교차검증 불가, (a)+(b)만으로 판정).
fn query_tailscale_cli() -> Option<Vec<Ipv4Addr>> {
    for cli in TAILSCALE_CLI_CANDIDATES {
        let Ok(out) = Command::new(cli).args(["ip", "-4"]).output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let ips: Vec<Ipv4Addr> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect();
        if !ips.is_empty() {
            return Some(ips);
        }
        return None;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }

    fn cand(addr: &str, prefix_len: u8, has_broadcast: bool) -> Candidate {
        Candidate { ip: ip(addr), prefix_len, has_broadcast }
    }

    // ── (a) 대역 경계 (#mb0-bind-tests) ──────────────────────────────

    #[test]
    fn cgnat_range_boundaries() {
        assert!(in_cgnat_range(ip("100.64.0.0")));
        assert!(in_cgnat_range(ip("100.127.255.255")));
        assert!(!in_cgnat_range(ip("100.63.255.255")));
        assert!(!in_cgnat_range(ip("100.128.0.0")));
        assert!(!in_cgnat_range(ip("10.1.2.3")));
        assert!(!in_cgnat_range(ip("192.168.1.1")));
        assert!(!in_cgnat_range(ip("172.16.0.1")));
    }

    // ── (b) ISP CGNAT 회귀 — 같은 IP 라도 형태로 갈린다 ─────────────

    #[test]
    fn accepts_point_to_point_tunnel() {
        let r = select_candidate(&[cand("100.90.1.2", 32, false)], None);
        assert_eq!(r, Ok(ip("100.90.1.2")));
    }

    #[test]
    fn rejects_isp_cgnat_shaped_subnet() {
        // 같은 100.90.1.2 이지만 /24 + broadcast — ISP CGNAT 형태는 거부.
        let r = select_candidate(&[cand("100.90.1.2", 24, true)], None);
        assert_eq!(r, Err(BindDetectError::NoCandidate));
    }

    #[test]
    fn rejects_private_range_even_if_point_to_point() {
        let r = select_candidate(&[cand("192.168.1.10", 32, false)], None);
        assert_eq!(r, Err(BindDetectError::NoCandidate));
    }

    // ── 후보 0개 / 여럿 ──────────────────────────────────────────────

    #[test]
    fn empty_candidates_is_no_candidate() {
        assert_eq!(select_candidate(&[], None), Err(BindDetectError::NoCandidate));
    }

    #[test]
    fn multiple_candidates_pick_deterministically() {
        let cands = [cand("100.100.0.2", 32, false), cand("100.64.5.5", 32, false)];
        assert_eq!(select_candidate(&cands, None), Ok(ip("100.64.5.5")));
        // 순서를 바꿔도 같은 결과 — 결정적.
        let swapped = [cand("100.64.5.5", 32, false), cand("100.100.0.2", 32, false)];
        assert_eq!(select_candidate(&swapped, None), Ok(ip("100.64.5.5")));
    }

    // ── (c) CLI 교차검증 ─────────────────────────────────────────────

    #[test]
    fn cli_absent_passes_on_a_and_b_only() {
        let r = select_candidate(&[cand("100.90.1.2", 32, false)], None);
        assert_eq!(r, Ok(ip("100.90.1.2")));
    }

    #[test]
    fn cli_match_picks_the_cli_address_over_sort_order() {
        let cands = [cand("100.64.1.1", 32, false), cand("100.90.1.2", 32, false)];
        let cli = [ip("100.90.1.2")];
        assert_eq!(select_candidate(&cands, Some(&cli)), Ok(ip("100.90.1.2")));
    }

    #[test]
    fn cli_mismatch_refuses_to_bind() {
        let cands = [cand("100.90.1.2", 32, false)];
        let cli = [ip("100.70.0.1")];
        assert_eq!(
            select_candidate(&cands, Some(&cli)),
            Err(BindDetectError::CliMismatch { cli: "100.70.0.1".into() })
        );
    }

    #[test]
    fn cli_present_but_no_passed_candidates_is_no_candidate() {
        let cands = [cand("100.90.1.2", 24, true)]; // (b) 탈락
        let cli = [ip("100.90.1.2")];
        assert_eq!(select_candidate(&cands, Some(&cli)), Err(BindDetectError::NoCandidate));
    }

    // ── netmask → prefix ─────────────────────────────────────────────

    #[test]
    fn netmask_to_prefix_len() {
        assert_eq!(prefix_len_from_netmask(ip("255.255.255.255")), 32);
        assert_eq!(prefix_len_from_netmask(ip("255.255.255.0")), 24);
        assert_eq!(prefix_len_from_netmask(ip("255.192.0.0")), 10);
        assert_eq!(prefix_len_from_netmask(ip("0.0.0.0")), 0);
    }
}
