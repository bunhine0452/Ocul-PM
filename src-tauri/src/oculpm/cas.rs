//! 확인-후-쓰기(CAS)의 공용 재료 — **내용 해시**와 **문서별 문지기**.
//!
//! `.oculpm/` 의 문서(플랜·논의·일지)는 전부 같은 모양으로 고쳐진다: 파일을
//! 읽고, 일부를 바꾸고, 통째로 다시 쓴다. 그 read-modify-write 사이에 남이
//! 쓰면 앞의 변경이 **조용히** 사라진다 — 오류도 흔적도 없이.
//!
//! 플래너는 그 사고를 이미 겪고 두 장치를 세웠다({#cas-required} ·
//! {#cas-toctou}). 그런데 그 둘은 `mcp/tools/plan_ops.rs` 안에 살았고, 같은
//! 모양인 논의·일지 쓰기는 아무 보호 없이 남아 있었다 (2026-09-08 감사).
//! 이 모듈은 그 두 장치를 **한 자리로 끌어올려** 세 문서가 같은 구현을 쓰게
//! 한다.
//!
//! ## 왜 한 구현이어야 하는가
//!
//! 해시는 **발급하는 자리와 대조하는 자리가 같은 함수**를 써야 한다. 한쪽이
//! 원본 바이트를, 다른 쪽이 정규화된 문자열을 해싱하면 아무도 CAS 를 통과하지
//! 못한다. 문지기는 **잡는 자리가 같아야** 문지기다 — 두 진입자가 서로 다른
//! 락 파일을 잡으면 둘 다 "보호받는다" 고 믿으면서 나란히 쓴다.
//!
//! ## 두 장치는 역할이 다르다
//!
//! - [`acquire_doc_guard`] 는 **읽기부터 쓰기까지를 한 임계구간으로** 만든다.
//!   대조에 쓴 그 바이트가 쓰기 순간까지 유효하게 하는 것이 몫이라, 락은 반드시
//!   **읽기 앞**에 선다. 프로세스 경계를 넘으므로(원자적 파일 생성) 앱·MCP
//!   서버·CLI 어댑터가 같은 문을 지난다.
//! - [`content_hash`] 는 **호출자가 본 것과 디스크가 지금 가진 것이 같은가**를
//!   묻는다. 문지기가 못 막는 것 — 편집기를 열어 둔 몇 분 사이에 에이전트가
//!   고친 경우 — 은 이쪽만 잡는다.

use std::path::Path;

use chrono::Utc;

use super::file_guard::{FileGuard, GuardError, GuardPolicy};

/// 문서 하나를 쓰는 임계구간의 대기 상한.
///
/// 임계구간이 밀리초인데 부딪혔다는 이유만으로 충돌을 돌려주면, 정상 동시성이
/// CAS 충돌로 둔갑해 호출자가 "그냥 다시 부르면 된다" 를 배운다. 그 학습이
/// CAS 를 무력화한다.
const DOC_GUARD_WAIT_MS: u64 = 2_000;

/// 내용의 blake3 hex — `base_hash` 가 가리키는 바로 그 값.
pub fn content_hash(text: &str) -> String {
    blake3::hash(text.as_bytes()).to_hex().to_string()
}

/// 문서 하나를 지키는 크로스프로세스 문지기.
///
/// **자리**: 지키는 파일 옆(`.<파일명>.lock`). `.oculpm/index/**` 는 앱이
/// 관리하는 파생물이라 피했고, `.oculpm/` 바로 아래에 새 폴더를 파면 워처의
/// 라우팅표(`data_area_for_path`)에 없는 경로라 코드 변경 ndjson 파이프라인까지
/// 흘러 들어가 락 파일 생성·삭제가 변경 원장을 오염시킨다.
///
/// 점으로 시작하는 이름이라 문서 스캔에도 걸리지 않는다 — 플랜·논의 스캔은
/// `*.md` 만 읽고, 일지의 `is_journal_entry_path` 는 점으로 시작하는 세그먼트를
/// 명시적으로 거부한다. 남는 것은 "다시 읽어라" 신호 한 쌍뿐인데, 어차피 같은
/// 호출이 진짜 쓰기로 그 신호를 한 번 더 내므로 같은 디바운스 창 안이다.
pub fn acquire_doc_guard(path: &Path) -> Result<FileGuard, GuardError> {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("doc");
    let lock = path.with_file_name(format!(".{name}.lock"));
    FileGuard::acquire(&lock, Utc::now(), GuardPolicy::waiting(DOC_GUARD_WAIT_MS))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 발급과 대조가 같은 함수를 쓰는지 — 이 성질이 깨지면 CAS 는 아무도 통과
    /// 못 하는 문이 된다.
    #[test]
    fn the_hash_is_stable_and_distinguishes_content() {
        assert_eq!(content_hash("hello"), content_hash("hello"));
        assert_ne!(content_hash("hello"), content_hash("hello "));
        assert_eq!(content_hash("").len(), 64);
    }

    /// 문지기는 지키는 파일 **옆**에 점으로 시작하는 이름으로 선다 — 문서
    /// 스캔이 `*.md` 만 읽고 점 세그먼트를 거부한다는 계약에 기댄다.
    #[test]
    fn the_lock_sits_next_to_the_file_hidden_from_document_scans() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("discussion.md");
        let guard = acquire_doc_guard(&doc).expect("첫 진입자는 잡는다");
        let lock = dir.path().join(".discussion.md.lock");
        assert!(lock.exists(), "락 파일이 문서 옆에 선다");
        drop(guard);
        assert!(!lock.exists(), "놓으면 자리를 비운다");
    }

    /// **둘째 진입자는 못 들어간다** — 이것이 read-modify-write 를 한 구간으로
    /// 만드는 전부다. 기다림은 짧게 잡아 테스트가 늘어지지 않게 한다.
    #[test]
    fn a_second_writer_waits_and_then_gives_up() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("plan.md");
        let _held = acquire_doc_guard(&doc).expect("첫 진입자는 잡는다");
        let lock = dir.path().join(".plan.md.lock");
        let second = FileGuard::acquire(&lock, Utc::now(), GuardPolicy::IMMEDIATE);
        assert!(second.is_err(), "쥐고 있는 동안 둘째는 거절된다");
    }
}
