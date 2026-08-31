//! 자동화 토대 (Osaurus 벤치마크 라운드 Phase 0).
//!
//! 설계 SSOT: `docs/20260831_osaurus-bench/01-automation.md`.
//!
//! # 무엇이 여기 있는가
//!
//! | 조각 | 하는 일 |
//! |---|---|
//! | [`store`] | `.oculpm/automation/{schedules,watchers}/<id>.md` 정의의 파서·writer (Decision 1 — 온디스크가 SSOT) |
//! | [`core_model`] | 배경 작업 전용 모델 슬롯 해석 + failover 체인 + 1회 시드 (Decision 2) |
//! | [`runner`] | 모든 자동화를 집행하는 잡 러너 — 동시 1건·취소·redact·강등하되 소실 없음 |
//! | [`frequency`] | 8빈도 → "다음 실행 시각" 순수 계산 (월말·윤년·DST 정의) |
//! | [`scheduler`] | 상주 집행 루프 — `next_run_at` 이 지나면 러너에 잡을 넣는다 |
//! | [`seeds`] | 씨앗 스케줄 3종 (비활성 예시 — 빈 화면 대신) |
//!
//! # 왜 토대를 먼저 놓는가
//!
//! 이 저장소에는 배경 작업이 이미 둘 있었다 — `reconcile`(워처가 새 일지를 보면
//! 플랜 화해)과 `journal_draft`(훅이 세션 종료를 보면 일지 초안). 둘은 각자
//! 트리거·락·모델 선택·귀속 규약을 따로 들고 있었고, 그래서 "자동 일지" 가
//! 락 공유 미설계를 이유로 오래 보류돼 있었다. Phase 0 은 그 셋(모델 선택·락·
//! 원장)을 하나로 모으고, Phase 1(Schedules)·Phase 2(Watchers)가 그 위에 새
//! 발동원을 얹는다.
//!
//! # 아직 연결되지 않은 것
//!
//! 잡을 큐에 넣는 쪽은 지금 [`scheduler`](시계) 하나뿐이다. 현실에 반응하는
//! 축 — 정착 타이머와 워처 자동화 — 은 Phase 2(`#settle-timer`·
//! `#watcher-automation`)의 자리이고, 플랜 산출물도 그때 러너에 붙는다
//! (`#reconcile-absorb`). 그 전까지 워처 정의는 저장·편집만 되고 발동하지 않는다.

pub mod core_model;
pub mod frequency;
pub mod runner;
pub mod scheduler;
pub mod seeds;
pub mod store;
