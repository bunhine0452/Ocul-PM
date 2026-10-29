//! `ask_user` — Claude 가 묻고 사람이 앱에서 답한다 (ocul-next #ask-user).
//!
//! 질문은 `.oculpm/hooks/questions/<id>.json` 에 쓰고(이 폴더는 gitignore 관리 블록 안), 훅 인박스에
//! `OculpmQuestion` 한 줄을 남겨 앱의 워처가 오늘 화면을 다시 읽게 한다. 사람이 앱에서 답하면 앱이
//! `<id>.answer.json` 을 쓰고, 이 도구는 그 파일을 기다렸다가 답을 돌려준다. 앱 안 터미널이든 바깥
//! 터미널이든 같은 길이다 — 답이 도구의 결과로 Claude 에게 간다.
//!
//! 기다림은 길다. Claude Code 는 2분 넘게 도는 MCP 호출을 뒤로 돌리고 끝나면 알린다(공식 문서) —
//! 그사이 다른 도구 호출이 막히지 않게 바이너리가 이 호출만 따로 스레드에서 돌린다(`bin/oculpm_mcp.rs`).
//! stdio 서버는 30분 동안 아무 응답이 없으면 끊기므로 25분에서 거둔다.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// 질문 폴더 (프로젝트 루트 기준) — `.oculpm/hooks/` 는 gitignore 관리 블록 안이다.
pub const QUESTIONS_REL: &str = ".oculpm/hooks/questions";
/// 사람이 답하지 않으면 거두는 때 — stdio MCP 의 무응답 한도(30분) 안.
pub const ASK_WAIT: Duration = Duration::from_secs(25 * 60);
const POLL: Duration = Duration::from_millis(500);
const MAX_QUESTION: usize = 2000;
const MAX_OPTIONS: usize = 6;
const MAX_OPTION: usize = 120;

pub fn definition() -> Value {
    json!({
        "name": "ask_user",
        "description": "사람의 결정이 필요한데 사람이 터미널을 보고 있지 않을 수 있을 때 — ocul-pm 앱의 오늘 화면에 질문을 띄우고 답을 기다린다(최대 25분). 답이 오면 그 답을 돌려준다. 고를 수 있는 답이 있으면 options 로(최대 6개, 사람은 직접 쓸 수도 있다). 25분 안에 답이 없으면 질문을 거두고 answer: null 을 돌려준다 — 그때는 터미널에서 물어라. 사소한 확인에는 쓰지 말 것.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": { "type": "string", "description": "사람에게 묻는 한 문장 (무엇을 정해야 하는지 · 왜). 2000자 안" },
                "options": { "type": "array", "items": { "type": "string" }, "description": "선택 — 고를 수 있는 답(최대 6개, 각 120자 안)" }
            },
            "required": ["question"]
        }
    })
}

fn questions_dir(root: &Path) -> PathBuf {
    root.join(QUESTIONS_REL)
}

pub fn question_path(root: &Path, id: &str) -> PathBuf {
    questions_dir(root).join(format!("{id}.json"))
}

pub fn answer_path(root: &Path, id: &str) -> PathBuf {
    questions_dir(root).join(format!("{id}.answer.json"))
}

/// id 는 시각 + 프로세스 + 순번 — 파일 이름으로만 쓰고 사람에게 보이지 않는다.
fn new_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    format!(
        "q{}-{}-{}",
        chrono::Utc::now().format("%Y%m%d%H%M%S"),
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// 앱의 워처를 깨운다 — 훅 인박스에 한 줄 (워처가 `OculpmQuestion*` 을 보고 오늘을 다시 읽게 한다).
fn nudge_app(root: &Path, event: &str, id: &str) {
    use std::io::Write;
    let path = root.join(crate::oculpm::claude_hooks::INBOX_REL);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let line = json!({
        "hook_event_name": event,
        "session_id": "",
        "question_id": id,
        "oculpm_ts": chrono::Utc::now().to_rfc3339(),
    });
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{line}");
    }
}

fn parse_args(args: &Value) -> Result<(String, Vec<String>), String> {
    let question = args
        .get("question")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or("question 이 비었어요 — 사람에게 묻는 한 문장을 주세요")?;
    if question.chars().count() > MAX_QUESTION {
        return Err(format!("question 이 너무 길어요 ({MAX_QUESTION}자 안)"));
    }
    let options: Vec<String> = args
        .get("options")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|o| !o.is_empty())
                .map(|o| o.chars().take(MAX_OPTION).collect())
                .take(MAX_OPTIONS)
                .collect()
        })
        .unwrap_or_default();
    Ok((question.to_string(), options))
}

/// 묻고 기다린다. `wait` 는 테스트가 줄인다(바이너리는 [`ASK_WAIT`]).
pub fn ask_user(root: &Path, args: &Value, wait: Duration) -> Result<Value, String> {
    let dot = std::fs::symlink_metadata(root.join(".oculpm"));
    if !dot.map(|m| m.file_type().is_dir()).unwrap_or(false) {
        return Err(format!(
            "이 프로젝트는 ocul-pm 추적 대상이 아닙니다 — {} 에 .oculpm/ 이 없어 앱에 물을 수 없어요. 터미널에서 물어 주세요.",
            root.display()
        ));
    }
    let (question, options) = parse_args(args)?;
    let id = new_id();
    std::fs::create_dir_all(questions_dir(root)).map_err(|e| format!("질문 폴더: {e}"))?;
    let body = json!({
        "id": id,
        "question": question,
        "options": options,
        "asked_at": chrono::Utc::now().to_rfc3339(),
    });
    std::fs::write(question_path(root, &id), body.to_string())
        .map_err(|e| format!("질문 쓰기: {e}"))?;
    nudge_app(root, "OculpmQuestion", &id);

    let deadline = Instant::now() + wait;
    let answered = loop {
        if let Some(answer) = read_answer(root, &id) {
            break Some(answer);
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(POLL);
    };
    let _ = std::fs::remove_file(question_path(root, &id));
    let _ = std::fs::remove_file(answer_path(root, &id));
    nudge_app(root, "OculpmQuestionDone", &id);
    Ok(match answered {
        Some(answer) => json!({ "answer": answer }),
        None => json!({
            "answer": Value::Null,
            "note": "사람이 25분 안에 앱에서 답하지 않아 질문을 거뒀어요. 터미널에서 다시 물어 주세요.",
        }),
    })
}

fn read_answer(root: &Path, id: &str) -> Option<String> {
    let raw = std::fs::read(answer_path(root, id)).ok()?;
    let v: Value = serde_json::from_slice(&raw).ok()?;
    v.get("answer").and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_written_by_the_app_comes_back_and_the_files_are_cleaned_up() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        std::fs::create_dir_all(root.join(".oculpm")).unwrap();
        let r = root.clone();
        let asker = std::thread::spawn(move || {
            ask_user(
                &r,
                &json!({ "question": "배포할까요?", "options": ["예", "아니오", " "] }),
                Duration::from_secs(10),
            )
        });
        // 앱 쪽 — 질문 파일이 생기면 답을 쓴다.
        let id = loop {
            if let Ok(rd) = std::fs::read_dir(root.join(QUESTIONS_REL)) {
                if let Some(e) = rd.flatten().next() {
                    let name = e.file_name().to_string_lossy().to_string();
                    let q: Value =
                        serde_json::from_slice(&std::fs::read(e.path()).unwrap()).unwrap();
                    assert_eq!(q["question"], "배포할까요?");
                    assert_eq!(q["options"], json!(["예", "아니오"]), "빈 선택지는 버린다");
                    break name.trim_end_matches(".json").to_string();
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        std::fs::write(
            answer_path(&root, &id),
            json!({ "answer": "예" }).to_string(),
        )
        .unwrap();
        let out = asker.join().unwrap().unwrap();
        assert_eq!(out["answer"], "예");
        assert!(!question_path(&root, &id).exists() && !answer_path(&root, &id).exists());
        let inbox =
            std::fs::read_to_string(root.join(crate::oculpm::claude_hooks::INBOX_REL)).unwrap();
        assert!(inbox.contains("\"OculpmQuestion\"") && inbox.contains("\"OculpmQuestionDone\""));
    }

    #[test]
    fn no_answer_in_time_withdraws_the_question() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join(".oculpm")).unwrap();
        let out = ask_user(
            tmp.path(),
            &json!({ "question": "어느 쪽?" }),
            Duration::from_millis(50),
        )
        .unwrap();
        assert!(out["answer"].is_null());
        assert_eq!(
            std::fs::read_dir(tmp.path().join(QUESTIONS_REL))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn untracked_projects_and_empty_questions_are_refused() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ask_user(tmp.path(), &json!({ "question": "?" }), Duration::ZERO).is_err());
        std::fs::create_dir_all(tmp.path().join(".oculpm")).unwrap();
        assert!(ask_user(tmp.path(), &json!({ "question": "  " }), Duration::ZERO).is_err());
    }
}
