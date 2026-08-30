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
import { useMinuteTick } from "@/hooks/useSecondTick";

import { commands, type Project, type ProjectBlueprint } from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";

import "./home.css";
import { buildHome, type CommandSpec, type HomeRow } from "./home/homeModel";
import { useHomeBrief } from "./home/useHomeBrief";
import { useHomeCursor } from "./home/useHomeCursor";
import { HomeActionBar, HomeSearchBand, HomeTopRail } from "./home/chrome";
import { CommandRow, DraftRow, type RowWiring } from "./home/rows";
import { AddCard, FlowTile, OnboardingTile } from "./home/tiles";
import { ProjectCard } from "./home/ProjectCard";
import { ProjectManager } from "@/features/projects/ProjectManager";
import { useT } from "@/i18n";

/**
 * [중요] 이 타입을 export 해야 테스트가 직접 참조할 수 있다. JSX 스프레드는
 * 초과 프로퍼티를 검사하지 않으므로, 테스트 헬퍼가 `Partial<StartScreenProps>`
 * 로 타이핑되지 않으면 없어진 prop(`stats` 등)이 조용히 통과한다.
 */
export interface StartScreenProps {
  projects: Project[];
  indexingId: number | null;
  /** 이미 창이 떠 있는 프로젝트 id — 카드에 "열림" 배지 (멀티 창 §5.3). */
  openWindows: number[];
  error: string | null;
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onOpenSettings: () => void;
  onStartGreenfield: () => void;
  /** 임시 저장 초안을 저장 단계부터 이어서 연다. */
  onResumeBlueprint: (bp: ProjectBlueprint) => void;
  /**
   * 관리 화면의 일괄 제거처럼 **이 화면 안에서** 프로젝트 목록을 바꾼 뒤,
   * 소유자(App)가 목록을 다시 읽게 한다. 단건 이름 변경/제거는 App 의
   * 다이얼로그가 스스로 갱신하므로 여기로 오지 않는다.
   */
  onProjectsChanged: () => void;
}

export function StartScreen(props: StartScreenProps) {
  const { t } = useT();
  const {
    projects,
    indexingId,
    openWindows,
    error,
    onSelectProject,
    onAddProject,
    onRenameProject,
    onDeleteProject,
    onOpenSettings,
    onStartGreenfield,
    onResumeBlueprint,
    onProjectsChanged,
  } = props;

  const { brief, loading, failed, reload } = useHomeBrief(projects);
  const [blueprints, setBlueprints] = useState<ProjectBlueprint[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // 분 단위 상대시각("3시간 전")이 세션 내내 얼어붙지 않도록 — 공유 1분 시계.
  const now = useMinuteTick(true);

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
  const openManage = useCallback(() => setManageOpen(true), []);

  const commandSpecs: CommandSpec[] = useMemo(
    () => [
      { id: "cmd:add", label: t("home.cmdAdd"), hint: "⌘O", run: onAddProject },
      { id: "cmd:new", label: t("home.cmdNew"), hint: "⌘N", run: onStartGreenfield },
      // 관리할 게 없으면 관리 명령도 없다 — 0개일 때 이 행은 막다른 길이다.
      ...(projects.length > 0
        ? [{ id: "cmd:manage", label: t("home.manageProjects"), hint: "⌘⇧M", run: openManage }]
        : []),
      { id: "cmd:settings", label: t("home.openSettings"), hint: "⌘,", run: onOpenSettings },
    ],
    [t, projects.length, onAddProject, onStartGreenfield, openManage, onOpenSettings],
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
      // 오버레이(설정·그린필드 마법사·이름변경/제거 다이얼로그·커맨드 팔레트)가
      // 떠 있는 동안에는 이 화면의 전역 키를 전부 내려놓는다. 안 그러면 열린
      // 다이얼로그의 버튼에 포커스가 있을 때 글자를 치면 타입어헤드가 뒤에 있는
      // 검색창으로 포커스를 끌어내 모달 밖으로 탈출한다.
      if (document.querySelector('[role="dialog"], [data-home-overlay]')) return;

      // IME 조합 중에는 키를 가로채지 않는다 — 조합 중 키다운은 확정 신호다.
      if (e.isComposing || e.keyCode === 229) return;

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
        // ⌘⇧M — 프로젝트 관리. ⌘M 은 macOS 의 창 최소화라 건드리지 않는다.
        if (k === "m" && e.shiftKey) {
          e.preventDefault();
          openManage();
          return;
        }
        // ⌘E / ⌘⌫ 는 **키보드로 포커스한 행**에만 적용한다. 커서는 마우스가
        // 스쳐 지나가도 옮겨가므로(onMouseMove), 포커스 확인 없이 발동하면
        // 포인터가 우연히 얹힌 프로젝트의 제거 확인창이 뜬다.
        if (k === "e") {
          if (typing) return;
          if (cursor.row?.kind === "project" && cursor.isFocusedRow()) {
            e.preventDefault();
            onRenameProject(cursor.row.project);
          }
          return;
        }
        if (e.key === "Backspace") {
          // macOS 에서 ⌘⌫ 는 "커서 앞 전부 삭제"다. 검색 입력에 값이 있는
          // 동안은 그 관례를 뺏지 않는다 — 글자를 지우려던 손이 프로젝트
          // 제거 다이얼로그를 띄우면 최악이다.
          if (typing && (e.target as HTMLInputElement).value) return;
          if (cursor.row?.kind === "project" && cursor.isFocusedRow()) {
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
      // 스페이스는 제외한다: 행 버튼에 포커스가 있을 때 스페이스는 그 행을
      // 여는 표준 동작이고, 질의 선두 공백은 어차피 trim 되어 의미도 없다.
      if (e.key.length === 1 && e.key !== " " && !e.altKey) {
        e.preventDefault();
        focusSearch(e.key);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, onAddProject, onStartGreenfield, onRenameProject, onDeleteProject, openManage]);

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
      // 한글 IME 조합 중의 Enter 는 "후보 확정"이지 "실행"이 아니다. 가드가
      // 없으면 "회고"를 치다가 조합을 확정하는 순간 프로젝트가 열려 버린다.
      // (`keyCode === 229` 는 조합 중 키다운의 전통적 신호 — Safari 포함
      //  일부 엔진이 isComposing 을 늦게 세팅해 둘 다 본다.)
      const composing =
        e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229;
      if (composing) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        cursor.focusFirst();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // 포커스를 옮기지 않고 1위를 연다 — "타이핑 → ⏎" 고속 경로.
        // primary 는 검색 중이면 1위 결과, 아니면 사령탑이다 (flat[0] 아님).
        if (model.primary) openRow(model.primary);
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
    [cursor, model.primary, openRow, query],
  );

  // 로빙 tabindex 의 탭 스톱. 커서가 아직 없으면(초기 상태) 첫 행이 맡는다 —
  // 안 그러면 목록 전체가 tabIndex=-1 이라 Tab 으로 들어갈 방법이 없다.
  const firstRowId = model.flat[0]?.id ?? null;

  const wiringFor = useCallback(
    (row: HomeRow): RowWiring => ({
      isCursor: cursor.id === row.id,
      tabbable: cursor.id === null ? row.id === firstRowId : cursor.id === row.id,
      register: cursor.register,
      onRowKeyDown: (e) => {
        // Enter/Space 는 <button> 이 알아서 활성화한다 — 가로채지 않는다.
        if (e.key === "Enter" || e.key === " ") return;
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
    [cursor, firstRowId],
  );

  const hasProjects = projects.length > 0;
  const matchCount = model.ranked.length;
  const quietIds = useMemo(() => new Set(model.quiet.map((r) => r.id)), [model.quiet]);
  const openSet = useMemo(() => new Set(openWindows), [openWindows]);

  return (
    <main className="home">
      <div className="home-wrap">
        <HomeTopRail
          isMac={isMac}
          dateline={model.dateline}
          failed={failed}
          onRetry={reload}
          onManage={openManage}
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
          <div role="alert" className="home-alert">
            {error}
          </div>
        )}

        {!hasProjects ? (
          <OnboardingTile onStart={onAddProject} />
        ) : (
          // 두 칸 판 — 왼쪽은 프로젝트 **전부**, 오른쪽은 오늘의 흐름.
          // 스크롤은 각 칸이 소유한다 (페이지 자체는 스크롤하지 않는다):
          // 창을 열었을 때 보이는 것이 곧 전부여야 한다.
          <div className="home-board">
            <section className="home-pane" aria-labelledby="home-projects-head">
              <header className="home-panehead">
                <h2 id="home-projects-head" className="home-eyebrow">
                  {searching ? t("home.sectionSearch") : t("home.allProjects")}
                </h2>
                <span className="home-panecount">{matchCount}</span>
                {!searching && model.quiet.length > 0 && (
                  <span className="home-panehint">
                    {t("home.quietTail", { n: model.quiet.length })}
                  </span>
                )}
              </header>

              {matchCount === 0 ? (
                <div className="home-empty">
                  <p>{t("home.noMatch", { query })}</p>
                  <p className="hg-dim">{t("home.noMatchTip")}</p>
                </div>
              ) : (
                <ul className="hg-grid scrollbar-thin">
                  {model.ranked.map((row, i) => (
                    <ProjectCard
                      key={row.id}
                      row={row}
                      query={query}
                      now={now}
                      loading={loading}
                      lead={!searching && i === 0}
                      quiet={quietIds.has(row.id)}
                      indexing={indexingId === row.project.id}
                      opened={openSet.has(row.project.id)}
                      wiring={wiringFor(row)}
                      onOpen={onSelectProject}
                      onRename={onRenameProject}
                      onDelete={onDeleteProject}
                    />
                  ))}
                  {!searching && (
                    <AddCard onAddExisting={onAddProject} onStartNew={onStartGreenfield} />
                  )}
                </ul>
              )}
            </section>

            <aside className="home-pane home-side" aria-label={t("home.todayFlow")}>
              <FlowTile
                brief={brief}
                projects={projects}
                loading={loading}
                failed={failed}
                onOpenProject={onSelectProject}
              />
            </aside>
          </div>
        )}

        {/* 바닥 띠 — 초안과 명령을 한 줄로 압축한다. 예전에는 각각 섹션이라
            세로를 먹었고, 정작 프로젝트가 화면 밖으로 밀렸다. */}
        <footer className="home-foot">
          {model.drafts.length > 0 && (
            <ul className="home-foot-list">
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
          )}
          {model.commands.length > 0 && (
            <ul className="home-foot-list">
              {model.commands.map((row, i) => (
                <CommandRow key={row.id} row={row} wiring={wiringFor(row)} index={i} />
              ))}
            </ul>
          )}
          <HomeActionBar row={cursor.row} />
        </footer>
      </div>

      {manageOpen && (
        <ProjectManager
          projects={projects}
          brief={brief}
          indexingId={indexingId}
          onClose={() => setManageOpen(false)}
          onOpenProject={onSelectProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
          onAddProject={onAddProject}
          onStartGreenfield={onStartGreenfield}
          onProjectsChanged={onProjectsChanged}
        />
      )}
    </main>
  );
}
