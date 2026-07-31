/**
 * StartScreen — 프로젝트 미선택 상태의 진입 화면.
 *
 * 이 화면은 앱을 열면 처음 보는 얼굴이자 프로젝트 선택기다. 답해야 할 질문은
 * 하나다: **"어디서 이어서 일하지?"**
 *
 * 구성 (2026-07-31 벤토 콕핏 재구성):
 *   밴드 0  상단 레일 — 워드마크 · 데이트라인 · 설정 · 추가 (macOS 드래그 영역)
 *   밴드 1  검색 전용 밴드 (자동 포커스)
 *   밴드 2  벤토 — 사령탑(이어서 일하기) · 오늘의 흐름 · 판 2개
 *   밴드 3  레일 — 모든 프로젝트 / 색인(조용한 곳) / 초안 / 명령
 *   밴드 4  액션 바 — 커서 항목의 단축키 지도
 *
 * 검색어가 있으면 벤토가 빠지고 레일이 점수순 단일 목록이 된다.
 *
 * 데이터는 `home_brief` 1콜이 전부다 (프로젝트 수와 무관하게 SQL 6문).
 * 백엔드가 실패해도 `projects` prop 만으로 화면 전체가 선다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands, type Project, type ProjectBlueprint } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";

import "./home.css";
import { buildHome, type CommandSpec, type HomeRow } from "./home/homeModel";
import { useHomeBrief } from "./home/useHomeBrief";
import { useHomeCursor } from "./home/useHomeCursor";
import { HomeActionBar, HomeSearchBand, HomeTopRail } from "./home/chrome";
import { CommandRow, DraftRow, HomeSection, IndexRow, ProjectRow, type RowWiring } from "./home/rows";
import { AddTile, FlowTile, OnboardingTile, ProjectPanel, ResumeTile } from "./home/tiles";

/**
 * [중요] 이 타입을 export 해야 테스트가 직접 참조할 수 있다. JSX 스프레드는
 * 초과 프로퍼티를 검사하지 않으므로, 테스트 헬퍼가 `Partial<StartScreenProps>`
 * 로 타이핑되지 않으면 없어진 prop(`stats` 등)이 조용히 통과한다.
 */
export interface StartScreenProps {
  projects: Project[];
  indexingId: number | null;
  error: string | null;
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onOpenSettings: () => void;
  onStartGreenfield: () => void;
  /** 임시 저장 초안을 저장 단계부터 이어서 연다. */
  onResumeBlueprint: (bp: ProjectBlueprint) => void;
}

export function StartScreen(props: StartScreenProps) {
  const {
    projects,
    indexingId,
    error,
    onSelectProject,
    onAddProject,
    onRenameProject,
    onDeleteProject,
    onOpenSettings,
    onStartGreenfield,
    onResumeBlueprint,
  } = props;

  const { brief, loading, failed, reload } = useHomeBrief(projects);
  const [blueprints, setBlueprints] = useState<ProjectBlueprint[]>([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // 분 단위 상대시각("3시간 전")이 세션 내내 얼어붙지 않도록 1분마다 갱신.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  useEffect(() => {
    void loadBlueprints();
  }, []);

  async function loadBlueprints() {
    const res = await Promise.resolve()
      .then(() => commands.listBlueprints())
      .catch(() => null);
    if (res && res.status === "ok") setBlueprints(res.data);
  }

  const discardBlueprint = useCallback(async (id: number) => {
    const res = await Promise.resolve()
      .then(() => commands.deleteBlueprint(id))
      .catch(() => null);
    if (res && res.status === "ok") setBlueprints((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // 목록이 절대 비지 않게 하는 장치 — 프로젝트 0개거나 검색 결과 0건이어도
  // 이 행들이 남아 ⏎ 가 항상 무언가를 한다.
  const commandSpecs: CommandSpec[] = useMemo(
    () => [
      { id: "cmd:add", label: "기존 폴더 불러오기", hint: "⌘O", run: onAddProject },
      { id: "cmd:new", label: "새 프로젝트 시작하기", hint: "⌘N", run: onStartGreenfield },
      { id: "cmd:settings", label: "설정 열기", hint: "⌘,", run: onOpenSettings },
    ],
    [onAddProject, onStartGreenfield, onOpenSettings],
  );

  const model = useMemo(
    () => buildHome({ projects, brief, blueprints, query, now, commands: commandSpecs }),
    [projects, brief, blueprints, query, now, commandSpecs],
  );

  const searching = query.trim().length > 0;
  const cursor = useHomeCursor({ flat: model.flat, searchRef });

  const openRow = useCallback(
    (row: HomeRow) => {
      if (row.kind === "project") onSelectProject(row.project);
      else if (row.kind === "draft") onResumeBlueprint(row.bp);
      else row.run();
    },
    [onSelectProject, onResumeBlueprint],
  );

  // ── 전역 키 ──────────────────────────────────────────────────────────
  // useGlobalShortcuts 는 수식키 없는 키를 즉시 반환하므로 충돌이 없다.
  useEffect(() => {
    function isTyping(el: EventTarget | null): boolean {
      const n = el as HTMLElement | null;
      if (!n) return false;
      const tag = n.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || n.isContentEditable;
    }

    function focusSearch(seed?: string) {
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      if (seed !== undefined) setQuery((q) => q + seed);
      else el.select();
    }

    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(e.target);

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === "o") {
          e.preventDefault();
          onAddProject();
          return;
        }
        if (k === "n") {
          e.preventDefault();
          onStartGreenfield();
          return;
        }
        if (k === "e" && cursor.row?.kind === "project") {
          e.preventDefault();
          onRenameProject(cursor.row.project);
          return;
        }
        if (e.key === "Backspace") {
          // macOS 에서 ⌘⌫ 는 "커서 앞 전부 삭제"다. 검색 입력에 값이 있는
          // 동안은 그 관례를 뺏지 않는다 — 글자를 지우려던 손이 프로젝트
          // 제거 다이얼로그를 띄우면 최악이다.
          if (typing && (e.target as HTMLInputElement).value) return;
          if (cursor.row?.kind === "project") {
            e.preventDefault();
            onDeleteProject(cursor.row.project);
          }
          return;
        }
        if (k === "f") {
          e.preventDefault();
          focusSearch();
        }
        return;
      }

      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
        return;
      }
      // 타입어헤드 — 아무 데서나 글자를 치면 검색으로 흘러든다.
      if (e.key.length === 1 && !e.altKey) {
        e.preventDefault();
        focusSearch(e.key);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor.row, onAddProject, onStartGreenfield, onRenameProject, onDeleteProject]);

  // ⌘P — useGlobalShortcuts 가 이미 이 이벤트를 쏘고 있는데 대시보드에는
  // 수신자가 없어 무반응이었다. 여기서 받아 검색으로 연결한다.
  useEffect(() => {
    const onSwitch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener(NAV_BUS.openProjectSwitcher, onSwitch);
    return () => window.removeEventListener(NAV_BUS.openProjectSwitcher, onSwitch);
  }, []);

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cursor.focusFirst();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // 포커스를 옮기지 않고 1위를 연다 — "타이핑 → ⏎" 고속 경로.
        const first = model.flat[0];
        if (first) openRow(first);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // 2단: 질의가 있으면 지우고, 이미 비었으면 포커스를 놓는다.
        if (query) setQuery("");
        else {
          cursor.reset();
          searchRef.current?.blur();
        }
      }
    },
    [cursor, model.flat, openRow, query],
  );

  const wiringFor = useCallback(
    (row: HomeRow): RowWiring => ({
      isCursor: cursor.id === row.id,
      register: cursor.register,
      onRowKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          // 스페이스도 활성화로 — 버튼 기본 동작이지만 preventDefault 로
          // 스크롤이 튀는 걸 막는다.
          if (e.key === " ") e.preventDefault();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cursor.reset();
          searchRef.current?.focus();
          return;
        }
        cursor.onRowKeyDown(e);
      },
      onRowFocus: cursor.onRowFocus,
      onRowPointerMove: cursor.onRowPointerMove,
    }),
    [cursor],
  );

  const hasProjects = projects.length > 0;
  const showBento = !searching;
  const matchCount = searching ? model.rows.length : projects.length;

  return (
    <main className="home scrollbar-thin">
      <div className="home-wrap">
        <HomeTopRail
          isMac={isMac}
          dateline={model.dateline}
          failed={failed}
          onRetry={reload}
          onOpenSettings={onOpenSettings}
          onAdd={onAddProject}
        />

        <HomeSearchBand
          value={query}
          onChange={setQuery}
          inputRef={searchRef}
          matchCount={matchCount}
          total={projects.length}
          onKeyDown={onSearchKeyDown}
        />

        {/* 검색 결과 건수만 알린다 — 커서 이동은 실제 포커스가 옮겨가므로
            스크린리더가 알아서 읽는다. */}
        <p className="sr-only" role="status" aria-live="polite">
          {model.liveMessage}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 px-4 py-3 rounded-[var(--radius-m)] text-[12px] font-semibold"
            style={{
              background: "var(--t-error-soft)",
              color: "var(--t-error)",
              border: "1px solid var(--t-error)",
            }}
          >
            {error}
          </div>
        )}

        {/* ── 밴드 2 — 벤토 ──────────────────────────────────────── */}
        {showBento && (
          <div className="home-bento">
            {!hasProjects ? (
              <OnboardingTile onStart={onAddProject} />
            ) : (
              <>
                {model.hero && (
                  <ResumeTile
                    row={model.hero}
                    now={now}
                    loading={loading}
                    indexing={indexingId === model.hero.project.id}
                    onOpen={onSelectProject}
                    onRename={onRenameProject}
                    onDelete={onDeleteProject}
                  />
                )}
                <FlowTile
                  brief={brief}
                  projects={projects}
                  loading={loading}
                  onOpenProject={onSelectProject}
                />
                {model.panels.map((row) => (
                  <ProjectPanel
                    key={row.id}
                    row={row}
                    now={now}
                    indexing={indexingId === row.project.id}
                    onOpen={onSelectProject}
                    onRename={onRenameProject}
                    onDelete={onDeleteProject}
                  />
                ))}
                {/* 판이 2개가 안 되면 격자에 구멍이 남는다 — 추가 슬롯이 메운다. */}
                {model.panels.length < 2 && (
                  <AddTile
                    variant="panel"
                    onAddExisting={onAddProject}
                    onStartNew={onStartGreenfield}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ── 밴드 3 — 레일 ──────────────────────────────────────── */}
        {(model.rows.length > 0 ||
          model.quiet.length > 0 ||
          model.drafts.length > 0 ||
          model.commands.length > 0) && (
          <div className="home-list">
            {model.rows.length > 0 && (
              <>
                <HomeSection
                  title={searching ? "검색 결과" : "모든 프로젝트"}
                  count={model.rows.length}
                />
                <ul>
                  {model.rows.map((row, i) => (
                    <ProjectRow
                      key={row.id}
                      row={row}
                      query={query}
                      now={now}
                      loading={loading}
                      indexing={indexingId === row.project.id}
                      wiring={wiringFor(row)}
                      onOpen={onSelectProject}
                      onRename={onRenameProject}
                      onDelete={onDeleteProject}
                      index={i}
                    />
                  ))}
                </ul>
              </>
            )}

            {searching && model.rows.length === 0 && (
              <div className="px-4 py-6 space-y-1">
                <p className="text-[13px] text-[var(--text-2)]">
                  ‘{query}’ 와 일치하는 프로젝트가 없어요
                </p>
                <p className="text-[11px] text-[var(--text-3)]">
                  경로와 초성으로도 찾을 수 있어요
                </p>
              </div>
            )}

            {model.quiet.length > 0 && (
              <>
                <HomeSection title="색인 · 2주 이상 조용한 곳" count={model.quiet.length} />
                <div className="home-quiet">
                  {model.quiet.map((row) => (
                    <IndexRow
                      key={row.id}
                      row={row}
                      query={query}
                      wiring={wiringFor(row)}
                      onOpen={onSelectProject}
                    />
                  ))}
                </div>
              </>
            )}

            {model.drafts.length > 0 && (
              <>
                <HomeSection title="초안" count={model.drafts.length} />
                <ul>
                  {model.drafts.map((row) => (
                    <DraftRow
                      key={row.id}
                      row={row}
                      wiring={wiringFor(row)}
                      onResume={onResumeBlueprint}
                      onDiscard={discardBlueprint}
                    />
                  ))}
                </ul>
              </>
            )}

            {model.commands.length > 0 && (
              <>
                <HomeSection title="명령" count={model.commands.length} />
                <ul>
                  {model.commands.map((row, i) => (
                    <CommandRow key={row.id} row={row} wiring={wiringFor(row)} index={i} />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* ── 밴드 4 — 액션 바 ───────────────────────────────────── */}
        {hasProjects && <HomeActionBar row={cursor.row} />}
      </div>
    </main>
  );
}
