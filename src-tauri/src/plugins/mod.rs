//! 외부 아카이브 가드 — zip-slip·크기 폭탄을 막는 해제 한도.
//!
//! 4.0 에서 Claude 플러그인 번들 임포트(GitHub 에서 번들을 받아 `.claude/` 에 놓는
//! 설치기)를 걷었다. 남은 것은 `archive` 하나이고, 대화 임포트(`oculpm::import`)가
//! 쓴다 — 그 임포트가 걷히면 이 모듈도 함께 지운다.

pub mod archive;
