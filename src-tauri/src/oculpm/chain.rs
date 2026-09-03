//! 덧붙이기만 하는 원장의 해시 체인 (플랜 `ledger-and-liveness-honesty`).
//!
//! `append_ndjson` 은 O_APPEND + 한 번의 `write(2)` 라 동시 생산자에게도 **줄이
//! 유실되지 않는다.** 그런데 그것뿐이다 — 누가 중간 줄을 지우거나 내용을 고쳐도
//! 남는 흔적이 없다. `.oculpm/` 은 사람이 열어 고칠 수 있어야 한다는 것이 이
//! 제품의 약속이므로 **막을 수는 없다.** 대신 **검출**은 할 수 있다.
//!
//! block/buzz 의 `crates/buzz-audit` 규율을 가져왔다:
//!
//! - 줄마다 자기 digest(`hash`)와 앞 줄의 digest(`prev`)를 싣는다.
//! - digest 는 **키를 정렬한** canonical JSON 위에서 계산한다. 필드 순서에
//!   의존하면 구조체를 리팩터하는 순간 과거 원장이 전부 깨진다.
//! - 직렬화 실패는 빈 값으로 대체하지 않고 에러로 올린다 — 해시가 실제 payload
//!   대신 조용히 빈 값을 세면 체인 자체가 거짓말이 된다.
//! - **묶는 값**(binding)을 해시 선두에 넣는다. 우리는 원장 파일의 이름(task
//!   id — 타임스탬프 + UUIDv4)을 쓴다. 다른 원장에서 줄을 복사해 넣으면 재계산이
//!   달라져 검증이 깨진다. 절대경로를 쓰지 않는 이유는 프로젝트 폴더를 옮기는
//!   순간 멀쩡한 원장이 통째로 붉어지기 때문이다.
//!
//! ## 이 체인이 하지 못하는 것
//!
//! **감사이지 서명이 아니다.** 키가 없으므로 원장 전체를 다시 계산해 갈아끼우는
//! 것은 막지 못한다. 잡는 것은 손으로 한 줄 고치기·지우기 같은 **변조**이지
//! 작정한 **위조**가 아니다. 화면도 그렇게 말해야 한다.
//!
//! ## 갈래(fork)를 변조라고 부르지 않는다
//!
//! 두 프로세스가 같은 순간에 덧붙이면 둘 다 같은 `prev` 를 보고 쓴다. 줄은
//! 유실되지 않지만 사슬은 갈라진다. 이때 뒤 줄의 `prev` 는 **앞선 어느 줄의
//! digest 와는 일치한다** — 그 사실로 갈래와 삭제를 가른다. 동시 쓰기의 흔적을
//! "누가 원장을 고쳤다"고 말하는 것은 거짓 고발이다.

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 줄이 자기 digest 를 싣는 필드.
pub const HASH_FIELD: &str = "hash";
/// 줄이 앞 줄의 digest 를 싣는 필드.
pub const PREV_FIELD: &str = "prev";

/// 원장 한 파일의 검증 결과.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChainStatus {
    /// 줄 `lines` 개가 이어져 있다.
    Intact { lines: u32 },
    /// 해시가 없는 줄이 있다 — 이 기능 이전에 쓰인 원장이다. **판정하지 않는다.**
    ///
    /// 없는 것을 깨진 것으로 부르지 않는다. 모르는 것은 모른다고 한다.
    Unverifiable { line: u32 },
    /// 사슬이 끊겼다.
    Broken(ChainBreak),
}

/// 끊긴 지점. `bool` 이 아니라 이것을 돌려주는 이유는 **어디서** 끊겼는지가
/// 사람이 판단할 유일한 재료이기 때문이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ChainBreak {
    /// 1부터 세는 줄 번호 (편집기가 보여주는 번호와 같게).
    pub line: u32,
    pub reason: BreakReason,
    /// [`BreakReason::Forked`] 일 때 갈라져 나온 줄 번호.
    ///
    /// 사유 안에 담지 않고 밖으로 낸 이유는 JSON 이 평평해야 하기 때문이다 —
    /// `ChainStatus` 가 이미 `kind` 로 태그를 쓰고 있어서, 사유가 또 태그된
    /// 객체이면 한 오브젝트에 같은 키가 두 번 나거나 한 겹 더 중첩된다.
    ///
    /// `skip_serializing_if` 를 **일부러 안 붙인다.** 붙이면 직렬화와
    /// 역직렬화의 모양이 갈려 specta 가 타입을 둘로 쪼개고, 프런트가 받는
    /// 타입이 외부 태그 형태로 바뀐다. 없을 땐 `null` 을 그대로 낸다.
    pub forked_from_line: Option<u32>,
    /// 우리가 계산한 값.
    pub expected: String,
    /// 파일에 적혀 있던 값.
    pub found: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum BreakReason {
    /// 줄 내용이 자기 digest 와 안 맞는다 — 내용이 고쳐졌다.
    ContentChanged,
    /// 앞 줄과의 연결이 끊겼다 — 사이의 줄이 지워졌거나 순서가 바뀌었다.
    LinkBroken,
    /// 앞선 줄에서 갈라졌다 — 동시 쓰기의 흔적이지 변조가 아니다.
    Forked,
}

/// 키를 정렬한 JSON 직렬화. 기계·러스트 버전이 달라도 같은 문자열이 나온다.
///
/// 스칼라 직렬화 실패를 자리표시자로 바꾸지 않고 그대로 올린다.
pub fn canonical_json(value: &Value) -> Result<String, serde_json::Error> {
    use std::collections::BTreeMap;
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<&str, &Value> = map.iter().map(|(k, v)| (k.as_str(), v)).collect();
            let mut out = String::from("{");
            for (i, (k, v)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k)?);
                out.push(':');
                out.push_str(&canonical_json(v)?);
            }
            out.push('}');
            Ok(out)
        }
        Value::Array(items) => {
            let mut out = String::from("[");
            for (i, v) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_json(v)?);
            }
            out.push(']');
            Ok(out)
        }
        other => serde_json::to_string(other),
    }
}

/// 줄 하나의 digest.
///
/// `line` 은 **`hash` 필드를 뺀** 줄이어야 한다 (`prev` 는 포함 — 그것이 사슬을
/// 잇는 고리다). `seq` 를 넣는 이유는 줄을 지우거나 자리를 바꾸는 것을 잡기
/// 위해서다. `binding` 은 이 원장을 다른 원장과 구별하는 값이다.
///
/// 시각은 **디스크에 적힌 문자열 그대로** 해시된다 — `DateTime` 을 다시
/// 직렬화하지 않는다. 재직렬화가 끼면 소수 자릿수가 값에 따라 달라져(chrono 는
/// 0·3·6·9 자리를 낸다) 쓸 때와 읽을 때의 프리이미지가 갈린다.
pub fn line_digest(binding: &str, seq: u32, line: &Value) -> Result<String, serde_json::Error> {
    let mut hasher = Hasher::new();
    hasher.update(binding.as_bytes());
    hasher.update(&[0u8]); // binding 과 뒤 바이트가 섞이지 않게
    hasher.update(&seq.to_be_bytes());
    hasher.update(canonical_json(line)?.as_bytes());
    Ok(hasher.finalize().to_hex().to_string())
}

/// 원장 줄들을 검증한다. 빈 줄은 세지 않고 건너뛴다.
///
/// 첫 번째 문제에서 멈춘다 — `seq` 가 digest 에 들어가므로 한 줄이 사라지면 그
/// 뒤가 전부 어긋난다. 스무 줄을 붉게 칠하는 것보다 **어디서 시작됐는지** 한
/// 자리를 가리키는 것이 사람에게 쓸모 있다.
pub fn verify_lines(binding: &str, raw: &str) -> ChainStatus {
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut hashes: Vec<String> = Vec::with_capacity(lines.len());

    for (index, text) in lines.iter().enumerate() {
        let number = index as u32 + 1;
        let Ok(mut value) = serde_json::from_str::<Value>(text) else {
            // 파싱조차 안 되는 줄은 이 체인이 판정할 대상이 아니다 —
            // `read` 도 그런 줄은 건너뛴다.
            return ChainStatus::Unverifiable { line: number };
        };
        let Some(stored) = value
            .as_object_mut()
            .and_then(|o| o.remove(HASH_FIELD))
            .and_then(|h| h.as_str().map(str::to_string))
        else {
            return ChainStatus::Unverifiable { line: number };
        };

        let prev = value
            .get(PREV_FIELD)
            .and_then(Value::as_str)
            .map(str::to_string);

        // ① 이 줄이 자기 자신과 맞는가.
        let Ok(computed) = line_digest(binding, index as u32, &value) else {
            return ChainStatus::Unverifiable { line: number };
        };
        if computed != stored {
            return ChainStatus::Broken(ChainBreak {
                line: number,
                reason: BreakReason::ContentChanged,
                forked_from_line: None,
                expected: computed,
                found: stored,
            });
        }

        // ② 앞 줄과 이어져 있는가.
        let want = hashes.last().cloned();
        if prev != want {
            let found = prev.clone().unwrap_or_default();
            // 갈래인가 — 이 `prev` 가 **앞선 어느 줄**의 digest 와 맞는다면
            // 동시 쓰기의 흔적이지 누가 지운 것이 아니다.
            let forked = prev
                .as_ref()
                .and_then(|p| hashes.iter().position(|h| h == p));
            return ChainStatus::Broken(ChainBreak {
                line: number,
                reason: match forked {
                    Some(_) => BreakReason::Forked,
                    None => BreakReason::LinkBroken,
                },
                forked_from_line: forked.map(|at| at as u32 + 1),
                expected: want.unwrap_or_default(),
                found,
            });
        }

        hashes.push(stored);
    }

    ChainStatus::Intact {
        lines: hashes.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 줄 세 개짜리 정상 원장을 만든다.
    fn ledger(binding: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut prev: Option<String> = None;
        for (i, state) in ["submitted", "working", "completed"].iter().enumerate() {
            let mut line = json!({ "at": "2026-09-03T17:00:00.123456789+09:00", "state": state });
            if let Some(p) = &prev {
                line[PREV_FIELD] = json!(p);
            }
            let hash = line_digest(binding, i as u32, &line).unwrap();
            line[HASH_FIELD] = json!(hash);
            prev = Some(hash);
            out.push(serde_json::to_string(&line).unwrap());
        }
        out
    }

    #[test]
    fn an_untouched_ledger_verifies() {
        let raw = ledger("t1").join("\n");
        assert_eq!(verify_lines("t1", &raw), ChainStatus::Intact { lines: 3 });
    }

    /// 나노초를 단 시각이 재검증된다 — 디스크의 문자열을 그대로 해시하기
    /// 때문이다. 이 테스트가 없으면 buzz 가 밟은 함정을 다시 밟는다.
    #[test]
    fn a_nanosecond_timestamp_still_verifies() {
        let raw = ledger("t1").join("\n");
        assert!(raw.contains("123456789"));
        assert!(matches!(
            verify_lines("t1", &raw),
            ChainStatus::Intact { .. }
        ));
    }

    #[test]
    fn a_deleted_middle_line_breaks_the_link() {
        let lines = ledger("t1");
        let raw = format!("{}\n{}", lines[0], lines[2]);
        match verify_lines("t1", &raw) {
            // 지워진 줄 다음 줄이 자리(seq)를 물려받아 자기 digest 부터 어긋난다.
            ChainStatus::Broken(b) => {
                assert_eq!(b.line, 2);
                assert_eq!(b.reason, BreakReason::ContentChanged);
            }
            other => panic!("삭제를 못 잡았다: {other:?}"),
        }
    }

    #[test]
    fn an_edited_line_is_caught_where_it_was_edited() {
        let mut lines = ledger("t1");
        lines[1] = lines[1].replace("working", "canceled");
        match verify_lines("t1", &lines.join("\n")) {
            ChainStatus::Broken(b) => {
                assert_eq!(b.line, 2);
                assert_eq!(b.reason, BreakReason::ContentChanged);
            }
            other => panic!("수정을 못 잡았다: {other:?}"),
        }
    }

    /// 다른 원장에서 통째로 베껴 온 줄은 binding 때문에 재계산이 달라진다.
    #[test]
    fn a_line_copied_from_another_ledger_does_not_verify() {
        let raw = ledger("t1").join("\n");
        match verify_lines("t2", &raw) {
            ChainStatus::Broken(b) => {
                assert_eq!(b.line, 1);
                assert_eq!(b.reason, BreakReason::ContentChanged);
            }
            other => panic!("남의 원장 줄이 통과했다: {other:?}"),
        }
    }

    /// 동시 쓰기는 **변조가 아니다** — 갈래로 부른다.
    #[test]
    fn a_concurrent_append_is_reported_as_a_fork_not_tampering() {
        let lines = ledger("t1");
        // 둘째 줄을 쓴 두 프로세스: 뒤엣것도 첫 줄을 prev 로 보고 썼다.
        let mut rival = json!({
            "at": "2026-09-03T17:00:01+09:00",
            "state": "failed",
            PREV_FIELD: serde_json::from_str::<Value>(&lines[1]).unwrap()[PREV_FIELD].clone(),
        });
        let hash = line_digest("t1", 2, &rival).unwrap();
        rival[HASH_FIELD] = json!(hash);

        let raw = format!(
            "{}\n{}\n{}",
            lines[0],
            lines[1],
            serde_json::to_string(&rival).unwrap()
        );
        match verify_lines("t1", &raw) {
            ChainStatus::Broken(b) => {
                assert_eq!(b.line, 3);
                assert_eq!(b.reason, BreakReason::Forked);
                assert_eq!(b.forked_from_line, Some(1));
            }
            other => panic!("갈래를 변조로 부르면 안 된다: {other:?}"),
        }
    }

    /// 해시가 없는 옛 원장을 "깨졌다"고 부르지 않는다.
    #[test]
    fn a_legacy_ledger_is_unverifiable_not_broken() {
        let raw = r#"{"at":"2026-09-01T10:00:00+09:00","state":"submitted"}"#;
        assert_eq!(
            verify_lines("t1", raw),
            ChainStatus::Unverifiable { line: 1 }
        );
    }

    #[test]
    fn canonical_json_sorts_keys_and_survives_nesting() {
        let v = json!({ "b": 1, "a": { "d": [1, 2], "c": "x" } });
        assert_eq!(
            canonical_json(&v).unwrap(),
            r#"{"a":{"c":"x","d":[1,2]},"b":1}"#
        );
    }
}
