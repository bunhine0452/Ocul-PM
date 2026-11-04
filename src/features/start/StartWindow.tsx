/**
 * 시작 창 — 프로젝트가 없는 창 (창 하나 = 프로젝트 하나, 4.0).
 *
 * 한 장이다 — **최근 프로젝트**(최근 활동 순, 줄마다 오늘 기록 수와 확인할 것). 「열기」를
 * 누르면 **이 창이** 그 프로젝트가 된다(이미 다른 창에 열려 있으면 그 창이 앞으로 온다).
 * 폴더를 새로 고르면 곧바로 그 프로젝트가 되고, 기록 파일은 프로젝트 창이 열리며 만든다.
 * 「처음 쓰는 방법」 세 단계 칸은 첫 실행 안내(`features/tour`)가 대신한다(ocul-next #tour-retire).
 *
 * 3.x 의 시작 탭·첫 실행 마법사·프로젝트 관리 시트·새 프로젝트 마법사를 이 한 장이
 * 대신한다. 서버도 계정도 없다 — 기록은 전부 프로젝트 폴더의 마크다운이다.
 *
 * 11-04 다시 그림(「촌스럽고 구려」): 베이지 캔버스 위 흰 카드 한 장 · 줄마다 다른 자리에 선 딱지 · 줄마다 반복된
 * 긴 mono 경로가 웹 페이지처럼 보였다. 이제 창 전체가 한 면이고, 목록은 영수증처럼 칸이 맞는 표다 — 이름 · 어디 ·
 * 예외 · 날짜가 줄마다 같은 세로선에 선다(subgrid). 「열림」 딱지 대신 **열린 창**과 **최근** 두 묶음으로 나누고,
 * 경로는 이름과 폴더 이름이 같으면 그 위 폴더만 쓴다(`whereOf`). 채운 단추는 「폴더 열기」 하나(영수증 규칙 3).
 */
import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { projectsApi } from "@/api/projects";
import { windowApi } from "@/api/window";
import { X } from "@/components/Icons";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, type Lang } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { Project } from "@/lib/bindings";
import { kbd, readChord } from "@/lib/kbd";
import { tildePath } from "@/lib/osPath";
import { projectColorOf } from "@/features/shell/projectColor";
import { dragRegion, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { TermsChip } from "@/features/terminal/TermsChip";
import { useTermOverview } from "@/features/terminal/status";
import { addProjectFromFolder } from "./addFolder";
import { useRecentProjects, type RecentProject } from "./useRecentProjects";
import "./start.css";

/** 「어디」 칸 — 폴더 이름이 프로젝트 이름과 같으면 되풀이하지 않고 그 위 폴더만(`~/Desktop/git`). */
export function whereOf(name: string, root: string): string {
  const path = tildePath(root).replace(/[\\/]+$/, "");
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut <= 0 || path.slice(cut + 1) !== name) return path;
  return path.slice(0, cut);
}

function dayLabel(row: RecentProject, lang: Lang, t: ReturnType<typeof useT>["t"]): string {
  const today = localWorkdayKey();
  const { lastWorkday, dayCount } = row;
  if (!lastWorkday) return t("start.noRecords");
  if (lastWorkday === today) return t("start.today", { n: dayCount ?? 0 });
  if (lastWorkday === shiftWorkday(today, -1)) return t("start.yesterday", { n: dayCount ?? 0 });
  const y = Number(lastWorkday.slice(0, 4));
  const m = Number(lastWorkday.slice(4, 6));
  const d = Number(lastWorkday.slice(6, 8));
  return new Date(y, m - 1, d).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", {
    month: "long",
    day: "numeric",
  });
}

export function StartWindow() {
  const { t, lang } = useT();
  const { rows, loaded, reload } = useRecentProjects();
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [openElsewhere, setOpenElsewhere] = useState<number[]>([]);
  const terms = useTermOverview();

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

  // ⌘O — 폴더 열기 (Windows·Linux 는 Ctrl+O).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = readChord(e);
      if (!c.mod || c.shift || c.alt || c.key.toLowerCase() !== "o") return;
      e.preventDefault();
      void pickFolder();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickFolder]);

  const forget = async (project: Project) => {
    // 「기록 폴더도 휴지통으로」 — 확인 대화상자 안의 체크 칸. 기본은 꺼짐(목록에서만 뺀다).
    const wipe = { current: false };
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
      reload();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };

  const drag = dragRegion();
  const opened = rows.filter((r) => openElsewhere.includes(r.project.id));
  const rest = rows.filter((r) => !openElsewhere.includes(r.project.id));

  // ↑↓ 로 줄을 옮긴다 — 줄은 단추라 Enter 는 그대로 「열기」다.
  const onListKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".start-row-open")];
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = at < 0 ? 0 : Math.min(all.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    all[next].focus();
  };

  const renderRow = (row: RecentProject) => {
    const p = row.project;
    return (
      <li key={p.id} className="start-row">
        {/* 줄 전체가 「열기」 — 따로 선 단추가 줄마다 가운데를 비우고 줄을 두 겹으로 키웠다(10-30). */}
        <button
          type="button"
          className="start-row-open"
          onClick={() => adopt(p)}
          aria-label={t("start.openAria", { name: p.name })}
          title={p.root_path}
        >
          {/* 프로젝트 색 — 프로젝트 창 윗줄 · ⌘O 목록과 같은 점. 색이 없으면 빈 고리. */}
          <span className="start-row-dot" data-pc={projectColorOf(p.color)} aria-hidden="true" />
          <span className="start-row-name">{p.name}</span>
          <span className="start-row-path mono">{whereOf(p.name, p.root_path)}</span>
        </button>
        <span className="start-row-flags">
          <TermsChip terms={terms.get(p.id)} />
          {/* 일지 없는 파일은 있을 때만 — 줄마다 「0」 이 서 있으면 예외가 묻힌다. */}
          {row.toCheck != null && row.toCheck > 0 ? (
            <span className="chip sm warn" title={t("start.toCheckTitle")}>
              {t("start.toCheck", { n: row.toCheck })}
            </span>
          ) : null}
        </span>
        <span className="start-row-day">{dayLabel(row, lang, t)}</span>
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

  return (
    <div className={"start" + (isMac() ? " is-mac" : "")}>
      <header className="start-bar" {...drag}>
        <span className="start-bar-title" {...drag}>
          Ocul
        </span>
      </header>

      <div className="start-body">
        <section className="start-col" aria-labelledby="start-recent-title">
          <div className="start-head">
            <h2 id="start-recent-title">{t("start.recent")}</h2>
            {rows.length > 0 ? <span className="start-count">{rows.length}</span> : null}
            <span className="start-spacer" />
            <button type="button" className="btn sm primary" onClick={() => void pickFolder()} aria-busy={busy}>
              {t("start.openFolder")}
              <kbd className="kbd">{kbd("⌘O")}</kbd>
            </button>
          </div>
          {loaded && rows.length === 0 ? (
            <p className="start-empty">{t("start.empty")}</p>
          ) : (
            <div className="start-groups" onKeyDown={onListKey}>
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
          )}
          <p className="start-foot">{t("start.footRecent")}</p>
        </section>
      </div>
      {confirmDialog}
    </div>
  );
}
