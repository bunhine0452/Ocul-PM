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
//! | [`seeds`] | 씨앗 자동화 5종 (비활성 예시 — 빈 화면 대신) |
//! | [`tiers`] | 반응성 티어 6단 — 디바운스를 이름 있는 정책으로 (Phase 2) |
//! | [`settle`] | settle-then-act 타이머 + 증폭 루프 가드 (Phase 2, 순수) |
//! | [`draft_claim`] | 두 초안 경로가 나눠 갖는 중복 키 (Phase 2) |
//! | [`watchers`] | 워처 자동화 런타임 — 정착·일지 삽입 두 채널을 러너로 (Phase 2) |
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
//! # 두 축이 다 붙었다
//!
//! 잡을 넣는 쪽은 셋이다: [`scheduler`](시계) · [`watchers`] 의 정착 타이머
//! (파일이 멎었다) · [`watchers`] 의 일지 삽입 채널(새 일지가 들어왔다 →
//! 플랜 화해). 세 경로 모두 [`runner`] 한 문을 지나므로 예산·동시 1건·취소·
//! 원장 규약이 갈라지지 않는다.
//!
//! 플랜 편집 로직 자체는 `oculpm::reconcile` 이 그대로 소유한다 — 러너는
//! 집행 규약만 얹고 그 모듈을 부른다 (CAS·`plan_write_lock` 을 두 벌 들지 않게).

pub mod core_model;
pub mod draft_claim;
pub mod frequency;
pub mod runner;
pub mod scheduler;
pub mod seeds;
pub mod settle;
pub mod store;
pub mod tiers;
pub mod watchers;
