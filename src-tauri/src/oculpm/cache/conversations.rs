//! 대화(agent.session) 귀속 조회 — `first_record` 원장의 재료.
//!
//! 037 이 캐시에 `agent_session` 칸을 만든 뒤에도 그 칸을 **읽는** 쿼리는
//! `get_entry` 하나뿐이었다(단건 하이드레이션). "이 대화가 일지를 남겼는가"를
//! 화면이 물으려면 창 안의 일지를 대화별로 접어야 하는데, 그 자리가 없어서
//! 프론트가 엔트리를 N번 걷어야 했다. 여기서는 **한 쿼리**로 창 안 일지의
//! (경로·제목·시각·에이전트·대화 id) 를 돌려주고, 접는 일은
//! `oculpm::first_record` 가 순수 함수로 한다.

use super::*;

/// 창 안 일지 한 건 — 귀속에 필요한 것만.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationJournalRow {
    pub relative_path: String,
    pub workday: String,
    pub title: String,
    pub created_at: String,
    pub agent_id: String,
    /// 프론트매터 `agent.session` — 없으면 **귀속 불명**이지 누구의 것도 아닌
    /// 게 아니다 (플러그인 없이 쓴 에이전트, 037 이전 일지).
    pub agent_session: Option<String>,
}

impl<'a> JournalCache<'a> {
    /// `since_workday`(포함) 이후의 일지 전부 — 최신순.
    ///
    /// 워크데이 칸으로 자르는 이유는 `idx_oculpm_journal_workday` 를 그대로
    /// 타고, 시각 문자열 비교(오프셋 섞임)를 피하기 위해서다. 상한을 두는 이유는
    /// 이 조회가 Today 마운트마다 도는 자리이기 때문이다 — 700건 저장소에서
    /// 7일 창은 수십 건이고, 그 이상은 화면이 어차피 못 보여 준다.
    pub async fn entries_since_workday(
        &self,
        project_id: u32,
        since_workday: &str,
        limit: u32,
    ) -> Result<Vec<ConversationJournalRow>, OculpmError> {
        let pid = project_id as i64;
        let since = since_workday.to_string();
        let limit = i64::from(limit.clamp(1, 2000));
        let rows = self
            .db
            .conn()
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT relative_path, workday, title, created_at, agent_id, agent_session
                     FROM oculpm_journal
                     WHERE project_id = ?1 AND workday >= ?2
                     ORDER BY workday DESC, created_at DESC
                     LIMIT ?3",
                )?;
                let collected: rusqlite::Result<Vec<ConversationJournalRow>> = stmt
                    .query_map(params![pid, &since, limit], |r| {
                        Ok(ConversationJournalRow {
                            relative_path: r.get(0)?,
                            workday: r.get(1)?,
                            title: r.get(2)?,
                            created_at: r.get(3)?,
                            agent_id: r.get(4)?,
                            agent_session: r
                                .get::<_, Option<String>>(5)?
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty()),
                        })
                    })?
                    .collect();
                collected
            })
            .await
            .map_err(map_sqlite_err)?;
        Ok(rows)
    }
}
