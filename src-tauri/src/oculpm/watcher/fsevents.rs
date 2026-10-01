//! macOS FSEvents 의 **끈적한 깃발**을 디바운서 앞에서 걷는다 (#fs-mac-rename-old-name).
//!
//! FSEvents(`kFSEventStreamCreateFlagFileEvents`)의 깃발은 경로에 **누적**된다.
//! 최근에 만든 파일이면 그 뒤의 어떤 기록에도 `ItemCreated` 가 다시 붙는다 — 이름을
//! 바꿔도, 지워도. notify 는 기록 하나를 `Create` → `Remove` → `Modify(Name)` →
//! `Modify(Metadata)` → `Modify(Data)` 순서의 원시 이벤트로 풀어 디바운서에 넣고,
//! 디바운서는 그 `Create` 를 "이 창에서 막 만들어짐" 으로 믿는다 (프로브 2026-10-01):
//!
//! - **이름 바꾸기** `a → b` — 옛 이름의 파일 id 가 캐시에 있으면 디바운서가 둘을
//!   짝짓고, 원천 큐 맨 앞이 `Create` 라 "새 이름에 생성" 한 판으로 접는다. 옛 이름의
//!   삭제가 **통째로 사라진다** — ndjson·일지 캐시에 옛 이름 행이 남았다.
//! - **지우기** — `Create` 뒤의 `Remove` 를 "만들었다 지운 것" 으로 접어 없애고, 뒤따른
//!   속성·내용 깃발만 남긴다. 없는 파일의 **수정**으로 기록됐다.
//!
//! 판정은 하나다: 원시 이벤트를 받는 순간 경로가 디스크에 없는데 그 이벤트가 `Create`
//! 거나 내용·속성 변경이면 버린다. 그 경로가 사라진 사실은 같은 기록의 `Remove` /
//! `Modify(Name)` 이 말하고, 그것들은 그대로 넘긴다. 사라진 경로의 "만들어짐·수정됨"
//! 은 더할 정보가 없다.
//!
//! 대가: 아주 짧게 살다 간 파일(만들고 곧바로 지움)은 예전엔 디바운서가 "없던 일" 로
//! 접었고(그래도 뒤따른 깃발이 수정 행을 남겼다) 이제는 삭제 행 하나를 남긴다.
//!
//! 리눅스(inotify)·윈도우(ReadDirectoryChangesW)는 깃발이 누적되지 않아 걸지 않는다.

use std::path::Path;

use notify::event::ModifyKind;
use notify::{Event, EventHandler, EventKind};

/// 경로가 사라졌을 때 믿을 수 없는(= 버릴) 종류인가.
///
/// `Remove` 와 `Modify(Name)` 은 사라짐 자체를 말하므로 남긴다. 경로가 없는 재스캔
/// (`Other`) 도 남긴다.
pub(super) fn is_stale_when_missing(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) => true,
        EventKind::Modify(ModifyKind::Name(_)) => false,
        EventKind::Modify(_) => true,
        _ => false,
    }
}

/// 디바운서가 notify 백엔드에 넘기는 처리기를 감싼다.
pub(super) struct StaleFlagFilter<H> {
    inner: H,
}

impl<H> StaleFlagFilter<H> {
    pub(super) fn new(inner: H) -> Self {
        Self { inner }
    }
}

impl<H: EventHandler> EventHandler for StaleFlagFilter<H> {
    fn handle_event(&mut self, event: notify::Result<Event>) {
        if let Ok(ev) = &event {
            // FSEvents 의 기록은 경로가 하나다. 여럿이면 판정하지 않고 넘긴다.
            if let [path] = ev.paths.as_slice() {
                if is_stale_when_missing(&ev.kind) && !exists(path) {
                    return;
                }
            }
        }
        self.inner.handle_event(event);
    }
}

/// 깨진 심링크도 "있다" — 링크 자체가 바뀐 것이다.
fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

/// macOS 의 OS 워처 — `FsEventWatcher` 그대로에 처리기만 [`StaleFlagFilter`] 로 감싼다.
/// `new_debouncer_opt` 가 이 타입의 `new` 에 자기 처리기를 넘긴다.
#[cfg(target_os = "macos")]
pub(super) struct StaleFlagWatcher(notify::FsEventWatcher);

#[cfg(target_os = "macos")]
impl notify::Watcher for StaleFlagWatcher {
    fn new<F: EventHandler>(event_handler: F, config: notify::Config) -> notify::Result<Self> {
        notify::FsEventWatcher::new(StaleFlagFilter::new(event_handler), config).map(Self)
    }

    fn watch(&mut self, path: &Path, recursive_mode: notify::RecursiveMode) -> notify::Result<()> {
        self.0.watch(path, recursive_mode)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }

    fn configure(&mut self, option: notify::Config) -> notify::Result<bool> {
        self.0.configure(option)
    }

    fn kind() -> notify::WatcherKind {
        notify::WatcherKind::Fsevent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode};
    use std::sync::{Arc, Mutex};

    type Seen = Arc<Mutex<Vec<EventKind>>>;

    fn filter() -> (StaleFlagFilter<impl EventHandler>, Seen) {
        let seen: Seen = Arc::default();
        let sink = seen.clone();
        let handler = move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                sink.lock().unwrap().push(ev.kind);
            }
        };
        (StaleFlagFilter::new(handler), seen)
    }

    /// 프로브가 본 "이름을 바꾼 옛 이름" 기록 그대로 (2026-10-01, macOS 27).
    fn rename_source_record() -> Vec<EventKind> {
        vec![
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            EventKind::Modify(ModifyKind::Metadata(MetadataKind::Extended)),
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
        ]
    }

    #[test]
    fn a_vanished_path_keeps_only_the_events_that_say_it_vanished() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("old_name.rs");
        let (mut f, seen) = filter();
        for kind in rename_source_record() {
            f.handle_event(Ok(Event::new(kind).add_path(gone.clone())));
        }
        f.handle_event(Ok(
            Event::new(EventKind::Remove(RemoveKind::File)).add_path(gone.clone())
        ));
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
                EventKind::Remove(RemoveKind::File),
            ]
        );
    }

    #[test]
    fn a_present_path_passes_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let here = dir.path().join("new_name.rs");
        std::fs::write(&here, "x").unwrap();
        let (mut f, seen) = filter();
        for kind in rename_source_record() {
            f.handle_event(Ok(Event::new(kind).add_path(here.clone())));
        }
        assert_eq!(*seen.lock().unwrap(), rename_source_record());
    }

    #[test]
    fn rescans_and_errors_pass_through() {
        let (mut f, seen) = filter();
        f.handle_event(Ok(Event::new(EventKind::Other)));
        f.handle_event(Err(notify::Error::generic("boom")));
        assert_eq!(*seen.lock().unwrap(), vec![EventKind::Other]);
    }

    #[test]
    fn a_dangling_symlink_counts_as_present() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.path().join("nowhere"), &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(dir.path().join("nowhere"), &link).is_err() {
            return; // 개발자 모드가 아니면 심링크를 못 만든다 — 판정할 것이 없다.
        }
        let (mut f, seen) = filter();
        f.handle_event(Ok(
            Event::new(EventKind::Create(CreateKind::Other)).add_path(link)
        ));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }
}
