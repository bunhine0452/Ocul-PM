/**
 * 시작 창 — 프로젝트가 없는 창 (창 하나 = 프로젝트 하나, 4.0).
 *
 * 한 장이다 — **최근 프로젝트**(최근 활동 순, 줄마다 예외 하나와 날짜). 「열기」를
 * 누르면 **이 창이** 그 프로젝트가 된다(이미 다른 창에 열려 있으면 그 창이 앞으로 온다).
 * 폴더를 새로 고르면 곧바로 그 프로젝트가 되고, 기록 파일은 프로젝트 창이 열리며 만든다.
 * 「처음 쓰는 방법」 세 단계 칸은 첫 실행 안내(`features/tour`)가 대신한다(ocul-next #tour-retire).
 *
 * 3.x 의 시작 탭·첫 실행 마법사·프로젝트 관리 시트·새 프로젝트 마법사를 이 한 장이
 * 대신한다. 서버도 계정도 없다 — 기록은 전부 프로젝트 폴더의 마크다운이다.
 *
 * 11-04 다시 그림(「촌스럽고 구려」): 창 전체가 한 면이고, 목록은 영수증처럼 칸이 맞는 표다 — 점 · 이름 · 어디 ·
 * 예외 · 날짜가 줄마다 같은 세로선에 선다(subgrid). 묶음은 **열린 창**과 **다른 프로젝트** 둘. 채운 단추는
 * 「폴더 열기」 하나(영수증 규칙 3).
 *
 * 11-15 막다른 길 없애기: 프로젝트를 들이기 전에도 ⌘K 팔레트 · ⌘, 설정(머리줄 톱니) · ⌘/ 단축키가 선다 —
 * Windows · Linux 는 팔레트가 「처음 쓰는 법」 의 유일한 길인데 그것도 없었다. 첫 줄에 포커스가 있어 ↑↓ · j/k 가
 * 바로 먹고, 치면 이름 · 경로로 거른다. 줄은 ⌘O · ⌥Tab · ⌘K 와 한 벌(`ProjectRow`)이고, 날짜 칸은 브리프가
 * 오기 전 「—」, 못 읽으면 「모름」 이다(「기록 없음」 으로 섰다가 재정렬되던 것).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { CommandPalette } from "@/components/CommandPalette";
import { ErrorCard } from "@/components/ErrorCard";
import { ArrowLeft, SearchIcon, SettingsIcon, X } from "@/components/Icons";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, type Lang } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Project, ProjectAttention } from "@/lib/bindings";
import { matchScore } from "@/lib/choseong";
import { isImeComposing } from "@/lib/ime";
import { isModalOpen, kbd, readChord } from "@/lib/kbd";
import { tildePath } from "@/lib/osPath";
import { requestCheatsheet } from "@/lib/projectActions";
import { dragRegion, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { workdayDate } from "@/lib/workdayLabel";
import { ProjectRow, describedBy, distinctWhere } from "@/features/shell/ProjectRow";
import { useTermOverview } from "@/features/terminal/status";
import { addProjectFromFolder } from "./addFolder";
import { useRecentProjects, type BriefState, type RecentProject } from "./useRecentProjects";
import "./start.css";

// 「어디」 칸의 규칙은 프로젝트 줄 한 벌이 갖는다 — 예전 이름으로도 부른다.
export { whereOf } from "@/features/shell/ProjectRow";

const StartSettings = lazy(() => import("./StartSettings"));

/** 칸에 바로 넣는 글자 — 공백을 뺀 라틴 · 숫자 · 기호 한 자(공백은 줄 단추의 「열기」 다). */
const ASCII_CHAR = /^[\x21-\x7e]$/;
/** 라틴 밖의 글자 한 자 — 두벌식이 줄(단추) 위에서 보내는 낱자(ㅇ) 따위. */
const NON_ASCII_CHAR = /^\P{ASCII}$/u;

/** 줄의 「열기」 단추들 — 화면 순서대로. */
function openButtons(list: HTMLElement | null): HTMLButtonElement[] {
  return [...(list?.querySelectorAll<HTMLButtonElement>(".start-row-open") ?? [])];
}

function dayLabel(row: RecentProject, brief: BriefState, lang: Lang, t: ReturnType<typeof useT>["t"]): string {
  // 브리프가 오기 전엔 모른다 — 「기록 없음」 이 먼저 섰다가 바뀌면 둘 다 거짓말이 된다.
  if (brief === "pending") return "—";
  if (brief === "failed") return t("start.unknown");
  const today = localWorkdayKey();
  const { lastWorkday, dayCount } = row;
  if (!lastWorkday) return t("start.noRecords");
  if (lastWorkday === today) return t("start.today", { n: dayCount ?? 0 });
  if (lastWorkday === shiftWorkday(today, -1)) return t("start.yesterday", { n: dayCount ?? 0 });
  return workdayDate(lastWorkday, lang);
}

export function StartWindow() {
  const { t, lang } = useT();
  const { rows, loaded, error, brief, reload } = useRecentProjects();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [openElsewhere, setOpenElsewhere] = useState<number[]>([]);
  const [attention, setAttention] = useState<Map<number, ProjectAttention>>(new Map());
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "settings">("list");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const terms = useTermOverview();
  const listRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLButtonElement>(null);
  const focusedOnce = useRef(false);
  /** 설정 쪽을 열었다 — 목록으로 돌아오면 첫 줄에 포커스를 다시 둔다. */
  const fromSettings = useRef(false);
  /** 목록에서 뺀 줄의 자리 — 목록이 다시 오면 그 자리(= 다음 줄)에 포커스를 둔다. */
  const refocusAt = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const off = windowApi.onOpenProjectsChanged((open) => {
      if (alive) setOpenElsewhere(open);
    });
    void windowApi
      .openProjectIds()
      .then((open) => {
        if (alive) setOpenElsewhere(open);
      })
      .catch(() => {});
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, []);

  // 기다림 · 실패 — ⌘O 목록과 같은 칩(`ProjectRow`). 프로젝트 id 가 바뀔 때만 다시 묻는다.
  const idsKey = rows.map((r) => r.project.id).join(",");
  useEffect(() => {
    if (!idsKey) return;
    let alive = true;
    const ids = idsKey.split(",").map(Number);
    const read = () =>
      void Promise.resolve()
        .then(() => windowApi.attention(ids))
        .then((a) => alive && setAttention(a))
        .catch(() => {});
    read();
    const off = Promise.resolve()
      .then(() => windowApi.onAttentionChanged(read))
      .catch(() => null);
    return () => {
      alive = false;
      void off.then((unlisten) => unlisten?.());
    };
  }, [idsKey]);

  /** 이 창이 그 프로젝트가 된다 — 다른 창에 열려 있으면 그 창이 앞으로 온다(I1). */
  const adopt = useCallback(
    (project: Project) => {
      windowApi
        .adoptProject(project.id)
        .catch((e: unknown) => toast.destructive(t("project.openWindowFailed", { error: tError(toAppError(e)) })));
    },
    [t],
  );

  const pickFolder = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const result = await addProjectFromFolder();
    setBusy(false);
    if (result.kind === "cancelled") return;
    if (result.kind === "error") {
      toast.destructive(result.message);
      return;
    }
    reload();
    // 새로 들인 폴더든 이미 있던 폴더든 이 창이 곧 그 프로젝트다 — 기록 파일(AGENTS.md ·
    // .oculpm/)은 프로젝트 창이 열리며 만들고, 오늘의 첫 활성화 카드가 무엇을 만들었는지 보여 준다.
    adopt(result.project);
  }, [adopt, busy, reload]);

  // ⌘O 폴더 열기 · ⌘K 팔레트 · ⌘, 설정 · ⌘/ 단축키 (Windows·Linux 는 Ctrl). 모달이 떠 있으면 ⌘K(팔레트 닫기)만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = readChord(e);
      if (!c.mod || c.alt) return;
      const key = c.key.toLowerCase();
      if (key === "k" && !c.shift) {
        e.preventDefault();
        setPaletteOpen(!isModalOpen());
        return;
      }
      if (isModalOpen() || c.shift) return;
      if (key === "o") {
        e.preventDefault();
        void pickFolder();
      } else if (c.key === ",") {
        e.preventDefault();
        setView("settings");
      } else if (c.key === "/") {
        e.preventDefault();
        requestCheatsheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickFolder]);

  // 첫 포커스 — 첫 줄(없으면 「폴더 열기」). 열자마자 ↓ · ↩ 가 먹는다. 이미 다른 곳에 포커스가 있으면 그대로 둔다.
  // 링은 띄우지 않는다(focusVisible: false) — 창을 열 때마다 첫 줄에 민트 테가 서면 시끄럽다. 줄의 면이 고른 줄을
  // 말하고, ↓ 를 누르면 그때부터 링이 선다(키보드로 옮긴 포커스).
  // 설정에서 돌아올 때도 목록으로 — 누른 「← 최근 프로젝트」 가 사라져 포커스가 body 로 떨어지거나(톱니로 닫으면
  // 머리줄에 남아) ↑↓ · j/k · 치면 거르기가 다시 먹지 않았다.
  useEffect(() => {
    if (view === "settings") {
      fromSettings.current = true;
      return;
    }
    if (!loaded) return;
    const back = fromSettings.current;
    fromSettings.current = false;
    if (focusedOnce.current && !back) return;
    focusedOnce.current = true;
    const active = document.activeElement;
    if (!back && active && active !== document.body) return;
    const quiet: FocusOptions & { focusVisible?: boolean } = { focusVisible: false };
    (openButtons(listRef.current)[0] ?? folderRef.current)?.focus(quiet);
  }, [loaded, view]);

  // 목록에서 뺀 뒤 — 목록이 다시 오면 그 자리의 줄(= 다음 줄), 끝이었으면 앞 줄에 포커스.
  useEffect(() => {
    const at = refocusAt.current;
    if (at == null) return;
    refocusAt.current = null;
    const all = openButtons(listRef.current);
    (all[Math.min(at, all.length - 1)] ?? folderRef.current)?.focus();
  }, [idsKey]);

  const forget = async (project: Project) => {
    // 「기록 폴더도 휴지통으로」 — 확인 대화상자 안의 체크 칸. 기본은 꺼짐(목록에서만 뺀다).
    const wipe = { current: false };
    const at = openButtons(listRef.current).findIndex((b) => b.dataset.projectId === String(project.id));
    const ok = await confirm({
      title: t("start.forgetTitle", { name: project.name }),
      message: (
        <>
          <p className="start-forget-body">{t("start.forgetBody")}</p>
          <label className="start-forget-wipe">
            <input type="checkbox" onChange={(e) => (wipe.current = e.target.checked)} />
            <span>
              <b>{t("start.forgetWipe")}</b>
              <span className="start-forget-sub">{t("start.forgetWipeSub")}</span>
            </span>
          </label>
        </>
      ),
      confirmLabel: t("start.forget"),
    });
    if (!ok) return;
    try {
      await projectsApi.forget(project.id, wipe.current);
      if (wipe.current) toast.info(t("start.forgetWiped", { name: project.name }));
      refocusAt.current = Math.max(0, at);
      reload();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };

  const drag = dragRegion();
  const q = query.trim();
  const visible = q
    ? rows.filter((r) => matchScore(q, [r.project.name, r.project.root_path, tildePath(r.project.root_path)]) > 0)
    : rows;
  const opened = visible.filter((r) => openElsewhere.includes(r.project.id));
  const rest = visible.filter((r) => !openElsewhere.includes(r.project.id));
  const where = distinctWhere(rows.map((r) => r.project));

  const moveFocus = (delta: number) => {
    const all = openButtons(listRef.current);
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[at < 0 ? 0 : Math.min(all.length - 1, Math.max(0, at + delta))].focus();
  };

  // ↑↓ · j/k 로 줄을 옮긴다 — 줄은 단추라 Enter 는 그대로 「열기」다. 다른 글자를 치면 거르기 칸으로 옮겨 거른다
  // (거르는 중이면 j · k 도 글자다).
  const onListKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    const key = readChord(e.nativeEvent).key;
    if (e.key === "ArrowDown" || (key === "j" && !query)) {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp" || (key === "k" && !query)) {
      e.preventDefault();
      moveFocus(-1);
    } else if (ASCII_CHAR.test(e.key)) {
      // 라틴 글자는 칸에 바로 넣는다 — 입력기가 끼지 않는 글자라 갈라질 일이 없다.
      e.preventDefault();
      setQuery((v) => v + e.key);
      findRef.current?.focus();
    } else if (e.key === "Process" || e.nativeEvent.keyCode === 229 || NON_ASCII_CHAR.test(e.key)) {
      // 한글(두벌식) · 입력기 키는 글자를 넣지 않고 칸으로 포커스만 옮긴다 — 막지 않으면 이 키의 입력과 조합이 새
      // 칸에서 시작된다. 낱자를 직접 넣으면 입력기 밖에 박혀 「오큘」 이 「ㅇㅗ큘」 로 갈라졌다.
      findRef.current?.focus();
    }
  };

  const onFindKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openButtons(listRef.current)[0]?.focus();
    } else if (e.key === "Enter") {
      // 화면의 맨 윗줄 — 「열린 창」 묶음이 먼저 선다. 최근 순 첫 줄을 열면 ↓ 가 가는 줄과 ↩ 가 여는 줄이 달랐다.
      const first = opened[0] ?? rest[0];
      if (!first) return;
      e.preventDefault();
      adopt(first.project);
    }
  };

  const renderRow = (row: RecentProject) => {
    const p = row.project;
    const idPrefix = `start-${p.id}`;
    return (
      <li key={p.id} className="start-row">
        {/* 줄 전체가 「열기」 — 따로 선 단추가 줄마다 가운데를 비우고 줄을 두 겹으로 키웠다(10-30). 경로 · 칩 ·
            날짜는 설명(aria-describedby)으로 읽힌다 — 경로는 이름이 겹칠 때만 줄에 선다. */}
        <button
          type="button"
          className="start-row-open"
          data-project-id={p.id}
          onClick={() => adopt(p)}
          aria-label={t("start.openAria", { name: p.name })}
          aria-describedby={describedBy(idPrefix)}
          title={p.root_path}
        >
          <ProjectRow
            project={p}
            where={where.get(p.id)}
            signals={{ attention: attention.get(p.id), terms: terms.get(p.id), toCheck: row.toCheck }}
            meta={dayLabel(row, brief, lang, t)}
            idPrefix={idPrefix}
          />
        </button>
        <button
          type="button"
          className="iconbtn sm start-row-forget"
          onClick={() => void forget(p)}
          aria-label={t("start.forgetAria", { name: p.name })}
          title={t("start.forget")}
        >
          <X size={13} />
        </button>
      </li>
    );
  };

  const list = () => {
    if (!loaded) {
      if (error) return <ErrorCard title={t("start.listFailed")} error={error} onRetry={reload} className="start-error" />;
      // 첫 조회 전 — 줄 모양만 잡아 둔다. 움직이지 않는다(영수증 규칙 6).
      return (
        <ul className="start-list start-skel" aria-busy="true" aria-label={t("common.loading")}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="start-row">
              <span className="start-skel-bar" />
            </li>
          ))}
        </ul>
      );
    }
    if (rows.length === 0) return <p className="start-empty">{t("start.empty")}</p>;
    return (
      <div className="start-groups" onKeyDown={onListKey} ref={listRef}>
        {visible.length === 0 ? <p className="start-group start-none">{t("sidebar.findProjectNone")}</p> : null}
        {opened.length > 0 ? (
          <>
            <p className="start-group" id="start-group-open">
              {t("start.groupOpen")}
            </p>
            <ul className="start-list" aria-labelledby="start-group-open">
              {opened.map(renderRow)}
            </ul>
            {rest.length > 0 ? (
              <p className="start-group" id="start-group-rest">
                {t("start.groupRest")}
              </p>
            ) : null}
          </>
        ) : null}
        {rest.length > 0 ? (
          <ul className="start-list" aria-labelledby={opened.length > 0 ? "start-group-rest" : undefined}>
            {rest.map(renderRow)}
          </ul>
        ) : null}
      </div>
    );
  };

  return (
    <div className={"start" + (isMac() ? " is-mac" : "")}>
      <header className="start-bar" {...drag}>
        <span className="start-bar-title" {...drag}>
          Ocul
        </span>
        {/* 설정 — 조용한 톱니. 프로젝트를 들이기 전에도 언어 · 밝기를 바꾼다. */}
        <button
          type="button"
          className={"iconbtn start-bar-gear" + (view === "settings" ? " active" : "")}
          aria-label={t("sidebar.settings")}
          aria-pressed={view === "settings"}
          title={`${t("sidebar.settings")} (${kbd("⌘,")})`}
          onClick={() => setView((v) => (v === "settings" ? "list" : "settings"))}
        >
          <SettingsIcon size={15} />
        </button>
      </header>

      {view === "settings" ? (
        <div className="start-body is-settings">
          <div className="start-col">
            <button type="button" className="btn ghost sm start-back" onClick={() => setView("list")}>
              <ArrowLeft size={15} aria-hidden="true" />
              {t("start.recent")}
            </button>
            <Suspense fallback={null}>
              <StartSettings />
            </Suspense>
          </div>
        </div>
      ) : (
        <div className="start-body">
          <section className="start-col" aria-labelledby="start-recent-title">
            <div className="start-head">
              <h2 id="start-recent-title">{t("start.recent")}</h2>
              {rows.length > 0 ? <span className="start-count">{rows.length}</span> : null}
              <span className="start-spacer" />
              {rows.length > 0 ? (
                <label className="search-box sm start-find">
                  <SearchIcon size={13} aria-hidden="true" />
                  <input
                    ref={findRef}
                    type="text"
                    value={query}
                    placeholder={t("sidebar.findProject")}
                    aria-label={t("sidebar.findProject")}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onFindKey}
                  />
                </label>
              ) : null}
              <button
                ref={folderRef}
                type="button"
                className="btn sm primary"
                onClick={() => void pickFolder()}
                aria-busy={busy}
              >
                {t("start.openFolder")}
                <kbd className="kbd">{kbd("⌘O")}</kbd>
              </button>
            </div>
            {list()}
            <p className="start-foot">{t("start.footRecent")}</p>
          </section>
        </div>
      )}
      {confirmDialog}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onOpenSettings={() => setView("settings")}
        projects={rows.map((r) => r.project)}
        onSelectProject={adopt}
        onOpenFolder={() => void pickFolder()}
      />
    </div>
  );
}
