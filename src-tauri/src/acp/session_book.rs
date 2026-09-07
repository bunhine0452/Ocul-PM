//! 한 어댑터 안의 **대화별 장부** — `process.rs` 에서 갈라 나왔다.
//!
//! 가른 이유는 크기다. `process.rs` 는 어댑터 수명·이벤트 라우팅·상태 레지스트리
//! 를 한꺼번에 지고 크기 래칫 상한에 붙어 있어서, 세그먼트 청소 같은 새 배관을
//! 그 파일 안에서는 더 놓을 수가 없었다. 이 장부는 자기 테스트까지 딸린 완결된
//! 단위라 가장 깨끗한 절단면이다 — 어댑터 프로세스에 대해 아무 것도 모르고,
//! `SessionId` 하나로만 말한다.

use std::collections::HashMap;

use agent_client_protocol::schema::v1::SessionId;

use super::session::AcpConfigOption;

/// 한 어댑터 안의 **대화별 장부**.
///
/// 갈라 둔 이유는 이 세 칸이 한 몸이기 때문이다: "보고 있는 대화"가 바뀌면
/// 설정도 제목도 그 대화의 것이 되어야 한다. 프로젝트에 한 칸씩만 두었을 때
/// 두 가지가 동시에 틀렸다.
///
///  1. **탭 전환** — `acp_select_session` 은 어댑터에 아무 것도 묻지 않는다
///     (그게 요점이다: 물으면 그 대화에 흐르던 스트림의 자리를 빼앗는다).
///     그래서 옮겨 간 대화의 셀렉터가 **방금 떠나온 대화의 모델·권한 모드**를
///     그대로 가리켰다.
///  2. **알림** — 뒤에서 도는 대화가 모델을 바꾸거나 제목을 받으면, 그 값이
///     보고 있는 대화의 칸을 덮었다.
///
/// 둘 다 "Auto 라 적혀 있는데 실은 Manual" 부류의 거짓말이다. 사용자가 자동
/// 승인될 거라 믿는 순간이라 안전 문제이기도 하다.
#[derive(Default)]
pub(super) struct SessionBook {
    /// **화면이 지금 보고 있는** 대화.
    ///
    /// "활성 세션"이 아니다. 프롬프트·취소는 대화 id 를 인자로 받으므로 여러
    /// 대화가 동시에 돌 수 있고, 이 칸은 그중 어느 것을 화면이 띄우고 있는지의
    /// 장부일 뿐이다.
    pub(super) current: Option<SessionId>,
    /// 대화별 설정 항목 (모델·Effort·모드 …).
    pub(super) options: HashMap<String, Vec<AcpConfigOption>>,
    /// 대화별 제목 (에이전트가 나중에 붙인다).
    pub(super) titles: HashMap<String, String>,
}

impl SessionBook {
    pub(super) fn current_id(&self) -> Option<String> {
        self.current.as_ref().map(|s| s.0.to_string())
    }

    /// 대화를 새로 열었거나 다시 읽었다 — 설정을 갈아 끼우고 이름은 비운다
    /// (에이전트가 새로 붙여 준다. 남겨 두면 옛 제목이 되살아난다).
    pub(super) fn open(&mut self, session: SessionId, options: Vec<AcpConfigOption>) {
        let id = session.0.to_string();
        self.current = Some(session);
        self.options.insert(id.clone(), options);
        self.titles.remove(&id);
    }

    /// 보고 있는 대화만 바꾼다. `title` 의 `None` 은 "모른다"이지 "지워라"가
    /// 아니다 — 갈무리해 둔 제목을 덮지 않는다.
    pub(super) fn select(&mut self, session: SessionId, title: Option<String>) {
        let id = session.0.to_string();
        self.current = Some(session);
        if let Some(title) = title {
            self.titles.insert(id, title);
        }
    }

    /// 보고 있는 대화를 놓는다 (새 대화를 여는 길). 대화들의 설정·제목은
    /// 그대로 둔다 — 하던 대화는 탭에 남아 계속 돌고, 돌아가면 제 값이어야 한다.
    pub(super) fn deselect(&mut self) {
        self.current = None;
    }

    pub(super) fn set_options(&mut self, session_id: &str, options: Vec<AcpConfigOption>) {
        if options.is_empty() {
            return;
        }
        self.options.insert(session_id.to_string(), options);
    }

    pub(super) fn options_of(&self, session_id: &str) -> Vec<AcpConfigOption> {
        self.options.get(session_id).cloned().unwrap_or_default()
    }

    pub(super) fn patch_option(&mut self, session_id: &str, config_id: &str, value: &str) {
        let Some(options) = self.options.get_mut(session_id) else {
            return;
        };
        for option in options.iter_mut().filter(|o| o.id == config_id) {
            option.current = Some(value.to_string());
        }
    }

    pub(super) fn set_title(&mut self, session_id: &str, title: Option<String>) {
        match title {
            Some(title) => self.titles.insert(session_id.to_string(), title),
            None => self.titles.remove(session_id),
        };
    }

    pub(super) fn title_of(&self, session_id: &str) -> Option<String> {
        self.titles.get(session_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(id: &str, current: &str) -> AcpConfigOption {
        AcpConfigOption {
            id: id.to_string(),
            name: id.to_string(),
            category: None,
            current: Some(current.to_string()),
            choices: Vec::new(),
            is_boolean: false,
        }
    }

    fn current_option(book: &SessionBook, id: &str) -> Option<String> {
        let session = book.current_id()?;
        book.options_of(&session)
            .into_iter()
            .find(|o| o.id == id)?
            .current
    }

    /// 탭을 옮겼다 돌아오면 **그 대화의** 모델·권한 모드가 보여야 한다.
    ///
    /// 프로젝트에 설정 한 칸만 두었을 때는 전환이 값을 안 바꿔서, 옮겨 간
    /// 대화의 셀렉터가 방금 떠나온 대화의 값을 가리켰다. 어댑터에 다시 묻지
    /// 않는 것이 이 전환의 요점이므로, 우리가 대화별로 들고 있어야 한다.
    #[test]
    fn switching_conversations_restores_that_conversations_settings() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), vec![option("model", "opus")]);
        book.open(SessionId::new("b"), vec![option("model", "haiku")]);

        book.select(SessionId::new("a"), None);
        assert_eq!(current_option(&book, "model").as_deref(), Some("opus"));

        book.select(SessionId::new("b"), None);
        assert_eq!(current_option(&book, "model").as_deref(), Some("haiku"));
    }

    /// 뒤에서 도는 대화가 모드를 내려도 **보고 있는 대화의 셀렉터는 그대로다.**
    ///
    /// 한 칸이었을 때는 옆 대화의 값이 화면을 덮었다 — "Auto 라 적혀 있는데
    /// 실은 Manual" 은 사용자가 자동 승인될 거라 믿는 순간이라 안전 문제다.
    #[test]
    fn a_background_conversation_does_not_repaint_the_visible_selectors() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), vec![option("mode", "auto")]);
        book.open(SessionId::new("b"), vec![option("mode", "auto")]);
        book.select(SessionId::new("a"), None);

        // 옆 대화(b)가 기본 모드로 내려앉았다.
        book.patch_option("b", "mode", "default");
        assert_eq!(current_option(&book, "mode").as_deref(), Some("auto"));

        book.select(SessionId::new("b"), None);
        assert_eq!(current_option(&book, "mode").as_deref(), Some("default"));
    }

    /// 제목도 같다 — 옆 대화가 이름을 받았다고 보고 있는 탭이 개명되면 안 된다.
    #[test]
    fn a_background_title_does_not_rename_the_visible_tab() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), Vec::new());
        book.select(SessionId::new("a"), None);
        book.set_title("a", Some("내 대화".to_string()));

        book.set_title("b", Some("남의 대화".to_string()));

        let visible = book.current_id().unwrap();
        assert_eq!(book.title_of(&visible).as_deref(), Some("내 대화"));
        assert_eq!(book.title_of("b").as_deref(), Some("남의 대화"));
    }

    /// 새 대화를 여는 것은 하던 대화를 **버리는 것이 아니다** — 탭에 그대로
    /// 남아 계속 돌고, 돌아가면 그 설정이 있어야 한다.
    #[test]
    fn opening_a_blank_slate_keeps_the_other_conversations_settings() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), vec![option("model", "opus")]);

        book.deselect();
        assert!(book.current_id().is_none());

        book.select(SessionId::new("a"), None);
        assert_eq!(current_option(&book, "model").as_deref(), Some("opus"));
    }

    /// 전환이 넘기는 `None` 은 "이름을 모른다"이지 "지워라"가 아니다.
    #[test]
    fn selecting_without_a_title_keeps_the_stored_one() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), Vec::new());
        book.set_title("a", Some("에이전트가 붙인 이름".to_string()));

        book.select(SessionId::new("a"), None);
        assert_eq!(book.title_of("a").as_deref(), Some("에이전트가 붙인 이름"));
    }

    /// 다시 읽은 대화의 제목은 비운다 — 안 그러면 옛 이름이 되살아난다.
    #[test]
    fn reopening_a_conversation_drops_its_stale_title() {
        let mut book = SessionBook::default();
        book.open(SessionId::new("a"), Vec::new());
        book.set_title("a", Some("옛 이름".to_string()));

        book.open(SessionId::new("a"), Vec::new());
        assert_eq!(book.title_of("a"), None);
    }
}
