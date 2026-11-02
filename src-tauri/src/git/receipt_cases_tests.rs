//! 영수증 재료 사례표 (`receipt_cases.json`) — VS Code 확장(`extension/src/model/shared.spec.ts`)이
//! 같은 표를 읽는다. 앱과 확장이 같은 일지에서 다른 숫자를 말하지 않게 하는 계약이다.

use crate::oculpm::{evidence, markdown, planner};

fn cases() -> serde_json::Value {
    serde_json::from_str(include_str!("receipt_cases.json")).expect("receipt_cases.json")
}

#[test]
fn evidence_and_proof() {
    for c in cases()["evidence"].as_array().unwrap() {
        let body = c["body"].as_str().unwrap();
        assert_eq!(
            evidence::evidence_level(body) as u64,
            c["level"].as_u64().unwrap(),
            "level: {body:?}"
        );
        let proof = evidence::verification_section(body).and_then(super::race::proof_line);
        assert_eq!(proof.as_deref(), c["proof"].as_str(), "proof: {body:?}");
    }
}

#[test]
fn journal_title() {
    for c in cases()["title"].as_array().unwrap() {
        let body = c["body"].as_str().unwrap();
        assert_eq!(
            markdown::parse_body(body).title,
            c["title"].as_str().unwrap(),
            "{body:?}"
        );
    }
}

#[test]
fn verdict_note() {
    for c in cases()["verdict"].as_array().unwrap() {
        let note = c["note"].as_str().unwrap();
        let want = c["passed"]
            .as_bool()
            .map(|p| (p, c["summary"].as_str().unwrap().to_string()));
        assert_eq!(planner::judge::parse_note(note), want, "{note:?}");
    }
}

#[test]
fn check_command() {
    for c in cases()["check"].as_array().unwrap() {
        let md = c["md"].as_str().unwrap();
        assert_eq!(
            planner::done_when::check_command(md).as_deref(),
            c["check"].as_str(),
            "{md:?}"
        );
    }
}
