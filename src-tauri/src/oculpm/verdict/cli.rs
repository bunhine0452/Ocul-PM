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
//! oculpm-mcp verdict --root <dir> --conversation <id> [--ledger]
//!   exit 0   이의 없음 (기록했거나 기록할 것이 없다)
//!   exit 10  이의 — stdout 에 에이전트에게 보여줄 전문
//!   exit 11  판정 불가
//!   exit 2   사용법 오류
//! ```

use std::path::PathBuf;

use chrono::Utc;

use super::{collect, judge, Verdict};

pub fn run(args: &[String]) -> i32 {
    let mut root: Option<PathBuf> = None;
    let mut conversation: Option<String> = None;
    let mut ledger = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--conversation" => conversation = it.next().cloned(),
            "--ledger" => ledger = true,
            other => {
                eprintln!(
                    "oculpm-mcp verdict: unknown argument '{other}' \
                     (usage: verdict --root <dir> --conversation <id> [--ledger])"
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

    let now = Utc::now();
    let verdict = judge(&collect(&root, conversation.trim(), now.timestamp()));
    if ledger {
        super::ledger::append(&root, conversation.trim(), &verdict, now);
    }
    if let Verdict::Objection(o) = &verdict {
        println!("{}", o.message());
    }
    verdict.exit_code()
}
