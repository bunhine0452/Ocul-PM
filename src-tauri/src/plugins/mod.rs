//! Claude 플러그인 번들 임포트 (Osaurus 라운드 Phase 6, `05-config-plugins-import.md` §2~3).
//!
//! ocul-pm 은 **Claude Code 를 구동하는 앱**이라 번들의 아티팩트를 자기
//! 형식으로 번역할 이유가 없다 — Claude Code 가 읽는 자리에 그대로 놓는다.
//! 번역 손실이 0 이고, 앱을 지워도 그 자리에 그대로 남는다.
//!
//! 규약 넷:
//!
//! - **가드가 먼저다** — 아카이브는 외부 입력이다 ([`archive`]).
//! - **우리 것만 만진다** — 놓은 파일에 소유 마커를 남기고, 마커 없는 사용자
//!   파일은 절대 덮어쓰지 않고 conflict 로 보고한다 ([`install`]).
//! - **하나가 깨져도 전체가 멈추지 않는다** — 마지막에 건너뛴 것을 요약한다.
//! - **모르는 것을 조용히 무시하지 않는다** — 감지했지만 실행하지 않는
//!   아티팩트를 「선언됐지만 아직 이행하지 않음」으로 적는다 ([`manifest`]).

pub mod archive;
pub mod install;
pub mod manifest;
pub mod source;
pub mod store;
