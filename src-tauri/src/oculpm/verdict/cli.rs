//! 셸 훅이 부르는 진입점 — `oculpm-mcp verdict …`.
//!
//! 새 바이너리를 만들지 않은 이유: 플러그인은 이미 `plugin/oculpm/bin/oculpm-mcp`
//! 셔틀로 설치 위치가 유동적인 실바이너리를 찾아 exec 한다. 판정을 그 셔틀의
//! 서브커맨드로 얹으면 탐색·설치 경로가 **한 벌**로 남는다.
//!
//! 계약은 훅의 것을 그대로 잇는다: 네트워크 없음 · 표준입력을 기다리지 않음 ·
//! 실패는 무해. 사람이 읽을 메시지는 stdout 으로, 판정은 종료 코드로 나간다
//! (셸에서 JSON 을 파싱하지 않아도 되게 — `sh` 의 JSON 파싱은 그 자체가 결함
//! 원천이다).
//!
//! ```text
//! oculpm-mcp verdict --root <dir> --conversation <id> [--transcript <path>] [--ledger]
//!   exit 0   이의 없음 (기록했거나 기록할 것이 없다)
//!   exit 10  이의 — stdout 에 에이전트에게 보여줄 전문
//!   exit 11  판정 불가
//!   exit 2   사용법 오류
//! ```
//!
//! `--transcript` 는 훅 payload 의 `transcript_path` 다. 그 파일에 **그 대화
//! 자신의 편집 도구 호출**이 들어 있어, 옆 대화가 살아 있을 때도 우리 몫만
//! 골라 붙잡을 수 있다 ({#gate-positive-attribution}). 없으면 예전과 같이
//! 옆 대화가 있는 순간 판정 불가다 — 그러니 **선택**이고, 못 읽어도 무해하다.

use std::path::PathBuf;

use super::{collect_with_transcript, judge, Verdict};

pub fn run(args: &[String]) -> i32 {
    let mut root: Option<PathBuf> = None;
    let mut conversation: Option<String> = None;
    let mut transcript: Option<PathBuf> = None;
    let mut ledger = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--conversation" => conversation = it.next().cloned(),
            "--transcript" => transcript = it.next().filter(|p| !p.is_empty()).map(PathBuf::from),
            "--ledger" => ledger = true,
            other => {
                eprintln!(
                    "oculpm-mcp verdict: unknown argument '{other}' \
                     (usage: verdict --root <dir> --conversation <id> \
                     [--transcript <path>] [--ledger])"
                );
                return 2;
            }
        }
    }
    let (Some(root), Some(conversation)) = (root, conversation) else {
        eprintln!("oculpm-mcp verdict: --root 와 --conversation 이 모두 필요합니다");
        return 2;
    };
    if conversation.trim().is_empty() || !root.join(".oculpm").is_dir() {
        // 추적되지 않는 프로젝트·빈 대화 id 는 판정 대상이 아니다.
        return 0;
    }

    let now = crate::clock::now();
    let verdict = judge(&collect_with_transcript(
        &root,
        conversation.trim(),
        now.as_second(),
        transcript.as_deref(),
    ));
    if ledger {
        super::ledger::append(&root, conversation.trim(), &verdict, now);
    }
    if let Verdict::Objection(o) = &verdict {
        println!("{}", o.message());
    }
    verdict.exit_code()
}

/// 확인 이의만 있다 (`gate`).
pub const EXIT_CHECK_OBJECTION: i32 = 12;
/// 배달 이의와 확인 이의가 함께 있다 (`gate`).
pub const EXIT_BOTH_OBJECTIONS: i32 = 13;

/// `oculpm-mcp gate …` — Stop 훅(`delivery-gate.sh`)이 **한 번** 불러 두 판정을 함께 받는다
/// (플랜 `agent-era-20261122` {#check-gate}).
///
/// 배달 판정(`verdict`)과 확인 판정([`super::check`])을 한 프로세스에서, 트랜스크립트를 한 번만
/// 읽어 낸다 — 게이트는 매 턴 도는 자리이고 Windows 의 Git Bash 는 프로세스 하나에 수십 ms 다.
/// `verdict` 를 넓히지 않고 서브커맨드를 따로 둔 까닭: 플러그인만 먼저 올라간 사용자의 옛
/// 바이너리는 모르는 인자에 exit 2 를 내는데, 그때 훅이 예전 `verdict` 로 물러나 배달 게이트를
/// 그대로 지킬 수 있어야 한다.
///
/// ```text
/// oculpm-mcp gate --root <dir> --conversation <id> [--transcript <path>]
///                 [--skip-journal] [--skip-check]
///   exit 0   이의 없음
///   exit 10  배달 이의 (일지가 없다)            — stdout 에 전문
///   exit 12  확인 이의 (판정이 없다)            — stdout 에 전문
///   exit 13  둘 다                              — stdout 에 두 전문 (빈 줄로 가른다)
///   exit 11  배달 판정 불가 · 확인 이의 없음
///   exit 2   사용법 오류
/// ```
///
/// `--skip-…` 은 이 대화에서 이미 한 번 뜬 게이트다 — 훅이 플래그 파일로 안다. 배달 판정을
/// 건너뛰면 워킹트리(`git status`)도 읽지 않는다.
pub fn run_gate(args: &[String]) -> i32 {
    let mut root: Option<PathBuf> = None;
    let mut conversation: Option<String> = None;
    let mut transcript: Option<PathBuf> = None;
    let (mut skip_journal, mut skip_check) = (false, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--conversation" => conversation = it.next().cloned(),
            "--transcript" => transcript = it.next().filter(|p| !p.is_empty()).map(PathBuf::from),
            "--skip-journal" => skip_journal = true,
            "--skip-check" => skip_check = true,
            other => {
                eprintln!(
                    "oculpm-mcp gate: unknown argument '{other}' \
                     (usage: gate --root <dir> --conversation <id> \
                     [--transcript <path>] [--skip-journal] [--skip-check])"
                );
                return 2;
            }
        }
    }
    let (Some(root), Some(conversation)) = (root, conversation) else {
        eprintln!("oculpm-mcp gate: --root 와 --conversation 이 모두 필요합니다");
        return 2;
    };
    let conversation = conversation.trim();
    if conversation.is_empty() || !root.join(".oculpm").is_dir() {
        return 0;
    }

    let now = crate::clock::now();
    let read = transcript.as_deref().map(super::Transcript::read);
    let journal = (!skip_journal).then(|| {
        judge(&super::collect_with(
            &root,
            conversation,
            now.as_second(),
            read.as_ref(),
        ))
    });
    let check = match (&read, skip_check) {
        (Some(read), false) => super::check::objection(
            &root,
            &read.plan_updates,
            super::segment_started_at(&root, conversation),
        ),
        _ => None,
    };

    let mut said = false;
    if let Some(Verdict::Objection(o)) = &journal {
        println!("{}", o.message());
        said = true;
    }
    if let Some(c) = &check {
        if said {
            println!();
        }
        println!("{}", c.message());
    }
    match (&journal, &check) {
        (Some(Verdict::Objection(_)), Some(_)) => EXIT_BOTH_OBJECTIONS,
        (_, Some(_)) => EXIT_CHECK_OBJECTION,
        (Some(verdict), None) => verdict.exit_code(),
        (None, None) => 0,
    }
}
