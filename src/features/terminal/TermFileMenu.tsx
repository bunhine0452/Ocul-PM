/**
 * 터미널 경로의 「이 파일로 할 일」 (10-31, 3.x 의 것을 4.x 에 다시) — Finder 에서 보기 · 빠른 미리보기
 * (macOS) · 외부 편집기. 셋 다 백엔드가 루트 안쪽인지 다시 보고, 거절 사유를 삼키지 않고 띄운다.
 * 앱 안 편집기 항목은 4.0 에서 편집기와 함께 걷혀 없다.
 *
 * 루트는 고른 칸의 것이다 — 레인(나란히 돌린 시도) 세션이면 그 worktree. 예전엔 늘 프로젝트 루트를 받아,
 * 레인 Claude 가 찍은 `src/foo.ts:12` 를 ⌘클릭하면 원래 체크아웃의 같은 이름 파일이 아무 표시 없이 열렸다.
 * 백엔드 명령은 받은 루트에 `secure_join` 만 하니 레인 경로를 넘기면 그 안에서 열린다.
 *
 * 머리는 파일 이름:줄을 자르지 않고 먼저, 폴더는 뒤에 앞쪽부터 접는다(영수증 — 폴더가 먼저 줄어든다).
 * 열 때 포커스가 있던 곳(대개 터미널)을 기억해 Esc · 실행 뒤 돌려준다.
 */
import { useEffect, useRef } from "react";

import { fileOpenApi } from "@/api/fileOpen";
import { toAppError } from "@/api/invoke";
import { ExternalLink, Eye, FolderOpen } from "@/components/Icons";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { getPlatform } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { closeFileMenu, relativeToRoot, useFileMenu, type FileMenuAt } from "./fileRefs";
import { useMenuKeys } from "./menuKeys";

/** 자리 계산에 쓰는 폭의 상한 — 실제 폭은 CSS 가 236~360px 로 쥔다. */
const MENU_MAX_W = 360;

const REVEAL: Record<ReturnType<typeof getPlatform>, I18nKey> = {
  mac: "terminal.fileMenu.reveal",
  windows: "terminal.fileMenu.revealWin",
  linux: "terminal.fileMenu.revealLinux",
};

export function TermFileMenuHost({ projectRoot, lane = null }: { projectRoot: string | null; lane?: number | null }) {
  const at = useFileMenu();
  if (!at || !projectRoot) return null;
  return <TermFileMenu key={`${at.path}:${at.x}:${at.y}`} at={at} root={projectRoot} lane={lane} />;
}

function TermFileMenu({ at, root, lane }: { at: FileMenuAt; root: string; lane: number | null }) {
  const { t } = useT();
  // 빈 값도 `auto` 다 — 백엔드가 깔린 편집기를 찾는다(`editor_choice.rs`). 항목은 늘 선다.
  const editor = useOptionalSettings()?.settings.externalEditorCommand.trim() ?? "auto";
  const rel = relativeToRoot(at.path, root);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 열 때 포커스가 있던 곳 — 링크를 누른 터미널의 입력. 닫으면 돌려준다.
  const before = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const restore = () => before.current?.focus?.();

  // 루트 밖 경로(다른 폴더 · /tmp)는 백엔드가 거절한다 — 메뉴를 띄우지 않고 이유만.
  useEffect(() => {
    if (rel !== null) return;
    toast.warning(t("terminal.fileMenu.outside"));
    closeFileMenu();
  }, [rel, t]);

  // ↑↓ · Home · End · Esc · Tab · 바깥 클릭 — 숨은 세션 목록 · 「새 세션 ▾」 과 같은 키(`menuKeys`).
  useMenuKeys(rel !== null, boxRef, (refocus) => {
    closeFileMenu();
    if (refocus) restore();
  });

  if (rel === null) return null;

  const run = (job: Promise<unknown>) => {
    void job.catch((e: unknown) => toast.destructive(t("terminal.fileMenu.failed", { error: tError(toAppError(e)) })));
    closeFileMenu();
    restore();
  };
  const left = Math.max(8, Math.min(at.x + 6, window.innerWidth - MENU_MAX_W - 8));
  const top = Math.max(8, Math.min(at.y + 6, window.innerHeight - 160));
  const cut = rel.lastIndexOf("/");
  const file = rel.slice(cut + 1) + (at.line === null ? "" : `:${at.line}`);
  const dir = cut < 0 ? "" : rel.slice(0, cut);
  const full = at.line === null ? rel : `${rel}:${at.line}`;

  return (
    <div ref={boxRef} className="tm-file-menu" style={{ left, top }} role="menu" aria-label={t("terminal.fileMenu.title")}>
      <div className="tm-file-menu-head" title={full}>
        {lane != null ? <span className="tm-file-menu-lane">{t("race.lane", { n: lane })} · </span> : null}
        <span className="tm-file-menu-name">{file}</span>
        {dir ? (
          <span className="tm-file-menu-dir" dir="rtl">
            <bdi>{dir}</bdi>
          </span>
        ) : null}
      </div>
      <button type="button" role="menuitem" className="tm-file-menu-item" onClick={() => run(fileOpenApi.reveal(root, rel))}>
        <FolderOpen size={13} aria-hidden="true" />
        {t(REVEAL[getPlatform()])}
      </button>
      {getPlatform() === "mac" ? (
        <button
          type="button"
          role="menuitem"
          className="tm-file-menu-item"
          onClick={() => run(fileOpenApi.quickLook(root, rel))}
        >
          <Eye size={13} aria-hidden="true" />
          {t("terminal.fileMenu.quickLook")}
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="tm-file-menu-item"
        onClick={() => run(fileOpenApi.inExternalEditor(root, rel, editor, at.line))}
      >
        <ExternalLink size={13} aria-hidden="true" />
        {t("terminal.fileMenu.external")}
      </button>
    </div>
  );
}
