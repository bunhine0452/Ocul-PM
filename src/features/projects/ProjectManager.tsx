/**
 * 프로젝트 관리 — 워크스페이스에 등록된 **모든** 프로젝트를 한 화면에서
 * 추가 · 이름 변경 · 제거한다.
 *
 * 왜 메인 화면과 따로 있나:
 *   메인 화면(home)은 "어디서 이어서 일하지?" 에 답하느라 위계를 만든다 —
 *   최근 것은 크게, 조용한 것은 접어서. 그건 **일하러 올 때** 옳지만,
 *   정리하러 올 때는 정확히 반대가 필요하다. 접힌 것도 보이고, 같은 눈높이로
 *   나열되고, 여러 개를 한 번에 고를 수 있어야 한다.
 *
 * 규약 4가지:
 *  1. **단건 이름 변경/제거는 재구현하지 않는다.** App 이 이미 갖고 있는
 *     다이얼로그(`onRenameProject`/`onDeleteProject`)를 그대로 부른다 — 제거
 *     옵션(.oculpm / AGENTS.md)이 두 벌로 갈라지면 한쪽만 고쳐지는 날이 온다.
 *  2. **일괄 제거만 여기서 처리한다.** 여러 프로젝트가 대상이라 단건 다이얼로그로
 *     표현할 수 없는, 이 화면에만 있는 능력이다.
 *  3. **파괴적 작업은 항상 2단.** 선택 → 확인(대상 이름 명시 + 디스크 옵션) → 실행.
 *  4. **`role="dialog"`** 를 달아 메인 화면의 전역 키(타입어헤드·⌘E·⌘⌫)가
 *     내려앉게 한다 (StartScreen 의 오버레이 가드가 이 선택자를 본다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FolderOpen, Pencil, Search, Sparkles, Trash2, X } from "@/components/Icons";
import { commands, type HomeBrief, type Project } from "@/lib/bindings";
import { initials, relativeTime, tildePath } from "@/features/onboarding/home/homeModel";

import "./projects.css";
import {
  buildManagerRows,
  firstDir,
  type ManagerSortKey,
  type SortDir,
} from "./managerModel";

/** 확인 문구에 이름을 그대로 적는 최대 개수. 넘으면 "외 N곳" 으로 접는다. */
const NAMES_IN_CONFIRM = 3;

export interface ProjectManagerProps {
  projects: Project[];
  /** 메인 화면이 이미 받아 둔 집계. `null` 이면 시각·건수 칸만 비고 목록은 선다. */
  brief: HomeBrief | null;
  indexingId: number | null;
  onClose: () => void;
  onOpenProject: (p: Project) => void;
  /** App 의 이름 변경 다이얼로그 (이 화면 위에 뜬다). */
  onRenameProject: (p: Project) => void;
  /** App 의 단건 제거 다이얼로그. */
  onDeleteProject: (p: Project) => void;
  onAddProject: () => void;
  onStartGreenfield: () => void;
  /** 일괄 제거 후 App 의 프로젝트 목록을 다시 읽게 한다. */
  onProjectsChanged: () => void;
}

export function ProjectManager(props: ProjectManagerProps) {
  const {
    projects,
    brief,
    indexingId,
    onClose,
    onOpenProject,
    onRenameProject,
    onDeleteProject,
    onAddProject,
    onStartGreenfield,
    onProjectsChanged,
  } = props;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ManagerSortKey>("recent");
  const [dir, setDir] = useState<SortDir>(firstDir("recent"));
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [wipeOculpm, setWipeOculpm] = useState(false);
  const [wipeAgentsMd, setWipeAgentsMd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // 분 단위 상대시각이 얼어붙지 않도록 1분마다 갱신 (메인 화면과 같은 규약).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const rows = useMemo(
    () => buildManagerRows({ projects, brief, query, sort, dir }),
    [projects, brief, query, sort, dir],
  );

  /**
   * 선택은 **살아 있는 프로젝트만** 센다. 단건 제거 다이얼로그로 지운 항목의
   * id 가 `selectedIds` 에 남아 있으면 "2곳 선택됨" 이라고 해 놓고 실제로는
   * 1곳만 지우는 거짓 카운트가 된다.
   */
  const selected = useMemo(
    () => projects.filter((p) => selectedIds.has(p.id)),
    [projects, selectedIds],
  );

  const visibleIds = useMemo(() => rows.map((r) => r.project.id), [rows]);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;

  // indeterminate 는 속성이 아니라 프로퍼티라 JSX 로 못 준다.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
    }
  }, [visibleSelectedCount, allVisibleSelected]);

  const toggleOne = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everyOn = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      for (const id of visibleIds) {
        if (everyOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setConfirming(false);
  }, []);

  const sortBy = useCallback(
    (key: ManagerSortKey) => {
      if (key === sort) {
        setDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSort(key);
        setDir(firstDir(key));
      }
    },
    [sort],
  );

  const startConfirm = useCallback(() => {
    setWipeOculpm(false);
    setWipeAgentsMd(false);
    setError(null);
    setConfirming(true);
  }, []);

  /**
   * 일괄 제거. **직렬**로 돈다 — 프로젝트마다 SQLite 쓰기 + (옵션에 따라) 디스크
   * 삭제가 일어나므로 병렬로 던져 봐야 락 경합만 늘고, 실패한 항목을 사용자에게
   * 이름으로 되돌려주기도 어려워진다.
   */
  const runBulkDelete = useCallback(async () => {
    const targets = selected;
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);

    const failed: string[] = [];
    for (const p of targets) {
      const res = await Promise.resolve()
        .then(() => commands.deleteProject(p.id, wipeOculpm, wipeAgentsMd))
        .catch(() => null);
      if (!res || res.status === "error") failed.push(p.name);
    }

    setBusy(false);
    setConfirming(false);
    setSelectedIds(new Set());
    onProjectsChanged();

    // 부분 실패를 침묵시키지 않는다 — 목록에서 사라지지 않은 이유를 알려준다.
    if (failed.length > 0) {
      setError(`제거하지 못한 프로젝트 ${failed.length}곳: ${failed.join(", ")}`);
    }
  }, [selected, wipeOculpm, wipeAgentsMd, onProjectsChanged]);

  // Esc — 확인 단계면 확인만 취소하고, 아니면 화면을 닫는다.
  // App 의 이름 변경/제거 다이얼로그가 이 위에 떠 있으면 그쪽이 Esc 의 주인이다.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.querySelector("[data-app-dialog]")) return;
      e.preventDefault();
      if (confirming) setConfirming(false);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onClose]);

  const searching = query.trim().length > 0;

  const confirmNames =
    selected.length <= NAMES_IN_CONFIRM
      ? selected.map((p) => p.name).join(", ")
      : `${selected
          .slice(0, NAMES_IN_CONFIRM)
          .map((p) => p.name)
          .join(", ")} 외 ${selected.length - NAMES_IN_CONFIRM}곳`;

  return (
    <div
      className="pm-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pm-title"
      onClick={(e) => {
        // 선택·확인이 걸려 있으면 바깥 클릭으로 닫지 않는다 — 고른 걸 날린다.
        if (e.target !== e.currentTarget) return;
        if (confirming || selected.length > 0) return;
        onClose();
      }}
    >
      <div className="pm-sheet">
        <header className="pm-head">
          <div className="min-w-0">
            <h2 id="pm-title" className="pm-title">
              프로젝트 관리
            </h2>
            <p className="pm-sub">
              등록된 {projects.length}곳. 이름 변경과 제거는 Ocul-PM 워크스페이스에만 적용되고,
              실제 프로젝트 폴더는 그대로 남습니다.
            </p>
          </div>
          <button type="button" className="pm-close" onClick={onClose} aria-label="닫기 (Esc)">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="pm-tools">
          <span className="pm-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="이름 · 경로로 거르기"
              aria-label="관리할 프로젝트 검색"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
          <button type="button" className="pm-btn" onClick={onAddProject}>
            <FolderOpen className="w-3.5 h-3.5" />
            폴더 불러오기
          </button>
          <button
            type="button"
            className="pm-btn pm-btn--accent"
            onClick={() => {
              // 마법사는 이 시트와 같은 z 대역이라 겹친다 — 먼저 비켜 준다.
              onClose();
              onStartGreenfield();
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            새 프로젝트
          </button>
        </div>

        <div className="pm-tablewrap scrollbar-thin">
          <table className="pm-table">
            <thead>
              <tr>
                <th scope="col" className="pm-c-check">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="pm-check"
                    aria-label="보이는 프로젝트 전체 선택"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={rows.length === 0}
                  />
                </th>
                <th scope="col" aria-sort={ariaSort(sort === "name", dir)}>
                  <SortButton
                    label="프로젝트"
                    active={sort === "name"}
                    dir={dir}
                    onClick={() => sortBy("name")}
                  />
                </th>
                <th scope="col" className="pm-c-when" aria-sort={ariaSort(sort === "recent", dir)}>
                  <SortButton
                    label="마지막 활동"
                    active={sort === "recent"}
                    dir={dir}
                    onClick={() => sortBy("recent")}
                  />
                </th>
                <th scope="col" className="pm-c-num" aria-sort={ariaSort(sort === "entries", dir)}>
                  <SortButton
                    label="기록"
                    active={sort === "entries"}
                    dir={dir}
                    onClick={() => sortBy("entries")}
                  />
                </th>
                <th scope="col" className="pm-c-act">
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project: p, lastAt, totalEntries }) => (
                <tr key={p.id} className={selectedIds.has(p.id) ? "is-selected" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      className="pm-check"
                      aria-label={`${p.name} 선택`}
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td>
                    <span className="pm-idcell">
                      <span className="pm-mark" aria-hidden="true">
                        {initials(p.name)}
                      </span>
                      <span className="pm-idtext">
                        <button
                          type="button"
                          className="pm-name"
                          onClick={() => onOpenProject(p)}
                          aria-label={`${p.name} 열기`}
                        >
                          {p.name}
                        </button>
                        <span className="pm-path" title={p.root_path}>
                          {tildePath(p.root_path)}
                        </span>
                      </span>
                      {indexingId === p.id && (
                        <span className="pm-badge" role="status">
                          인덱싱
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="pm-when">{relativeTime(lastAt, now)}</td>
                  <td className="pm-num">{totalEntries}건</td>
                  <td>
                    <span className="pm-act">
                      <button
                        type="button"
                        className="pm-iconbtn"
                        aria-label={`${p.name} 이름 변경`}
                        onClick={() => onRenameProject(p)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="pm-iconbtn pm-iconbtn--danger"
                        aria-label={`${p.name} 제거`}
                        onClick={() => onDeleteProject(p)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="pm-empty">
              <p className="pm-empty-title">
                {searching
                  ? `‘${query}’ 와 일치하는 프로젝트가 없어요`
                  : "아직 등록된 프로젝트가 없어요"}
              </p>
              <p className="pm-empty-sub">
                {searching
                  ? "경로와 초성으로도 찾을 수 있어요"
                  : "‘폴더 불러오기’ 로 기존 프로젝트를 추가하세요"}
              </p>
            </div>
          )}
        </div>

        <div className="pm-foot">
          {confirming ? (
            <div className="pm-confirm">
              <p className="pm-confirm-q">
                <span className="pm-confirm-names">{confirmNames}</span> — 총 {selected.length}곳을
                워크스페이스에서 제거할까요? 앱의 인덱스와 캐시만 지워지고, 프로젝트 폴더 자체는
                삭제되지 않습니다.
              </p>
              <div className="pm-confirm-opts">
                <label className="pm-opt">
                  <input
                    type="checkbox"
                    checked={wipeOculpm}
                    onChange={(e) => setWipeOculpm(e.target.checked)}
                  />
                  각 폴더의 <code>.oculpm</code> 폴더도 삭제
                </label>
                <label className="pm-opt">
                  <input
                    type="checkbox"
                    checked={wipeAgentsMd}
                    onChange={(e) => setWipeAgentsMd(e.target.checked)}
                  />
                  각 폴더의 <code>AGENTS.md</code> 파일도 삭제
                </label>
              </div>
              {(wipeOculpm || wipeAgentsMd) && (
                <p className="pm-warn">
                  선택한 파일은 {selected.length}곳 전부에서 영구 삭제되며 되돌릴 수 없습니다.
                </p>
              )}
              <div className="pm-confirm-actions">
                <button
                  type="button"
                  className="pm-btn"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="pm-btn pm-btn--danger"
                  onClick={() => void runBulkDelete()}
                  disabled={busy}
                >
                  {busy ? "제거 중…" : `${selected.length}곳 제거`}
                </button>
              </div>
            </div>
          ) : selected.length > 0 ? (
            <div className="pm-bulk">
              <span>
                <span className="pm-bulk-count">{selected.length}곳</span> 선택됨
              </span>
              <span className="pm-bulk-spacer" />
              <button type="button" className="pm-btn" onClick={clearSelection}>
                선택 해제
              </button>
              <button type="button" className="pm-btn pm-btn--danger" onClick={startConfirm}>
                선택 제거
              </button>
            </div>
          ) : (
            <p className="pm-hint">
              <span>{searching ? `${rows.length}곳 일치` : `${rows.length}곳`}</span>
              <span aria-hidden="true">·</span>
              <span>여러 곳을 한 번에 지우려면 왼쪽 체크박스로 고르세요</span>
              <span className="pm-bulk-spacer" />
              <span>
                <kbd>Esc</kbd> 닫기
              </span>
            </p>
          )}

          {error && (
            <p className="pm-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 정렬 열 버튼. 방향은 캐럿과 `aria-sort`(th) 두 경로로 알린다. */
function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pm-sortbtn" onClick={onClick}>
      {label}
      {active && (
        <span className="pm-sortcaret" aria-hidden="true">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

function ariaSort(active: boolean, dir: SortDir): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}
