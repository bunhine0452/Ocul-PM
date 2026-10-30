/**
 * 터미널 경로의 「이 파일로 할 일」 (10-31, 3.x 의 것을 4.x 에 다시) — Finder 에서 보기 · 빠른 미리보기
 * (macOS) · 외부 편집기. 셋 다 백엔드가 프로젝트 루트 안쪽인지 다시 보고, 거절 사유를 삼키지 않고 띄운다.
 * 앱 안 편집기 항목은 4.0 에서 편집기와 함께 걷혀 없다.
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

const MENU_W = 236;

const REVEAL: Record<ReturnType<typeof getPlatform>, I18nKey> = {
  mac: "terminal.fileMenu.reveal",
  windows: "terminal.fileMenu.revealWin",
  linux: "terminal.fileMenu.revealLinux",
};

export function TermFileMenuHost({ projectRoot }: { projectRoot: string | null }) {
  const at = useFileMenu();
  if (!at || !projectRoot) return null;
  return <TermFileMenu key={`${at.path}:${at.x}:${at.y}`} at={at} root={projectRoot} />;
}

function TermFileMenu({ at, root }: { at: FileMenuAt; root: string }) {
  const { t } = useT();
  const editor = useOptionalSettings()?.settings.externalEditorCommand.trim() ?? "";
  const rel = relativeToRoot(at.path, root);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 루트 밖 경로(다른 폴더 · 레인 · /tmp)는 백엔드가 거절한다 — 메뉴를 띄우지 않고 이유만.
  useEffect(() => {
    if (rel !== null) return;
    toast.warning(t("terminal.fileMenu.outside"));
    closeFileMenu();
  }, [rel, t]);

  // 바깥 클릭 · Esc 로 닫는다 — 캡처 단계에서(터미널 캔버스가 먼저 삼키지 않게). 열면 첫 항목에 포커스.
  useEffect(() => {
    if (rel === null) return;
    boxRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) closeFileMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeFileMenu();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [rel]);

  if (rel === null) return null;

  const run = (job: Promise<unknown>) => {
    void job.catch((e: unknown) => toast.destructive(t("terminal.fileMenu.failed", { error: tError(toAppError(e)) })));
    closeFileMenu();
  };
  const left = Math.max(8, Math.min(at.x + 6, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(at.y + 6, window.innerHeight - 160));
  const label = at.line === null ? rel : `${rel}:${at.line}`;

  return (
    <div
      ref={boxRef}
      className="tm-file-menu"
      style={{ left, top, width: MENU_W }}
      role="menu"
      aria-label={t("terminal.fileMenu.title")}
    >
      <div className="tm-file-menu-head" title={label}>
        {label}
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
      {editor ? (
        <button
          type="button"
          role="menuitem"
          className="tm-file-menu-item"
          onClick={() => run(fileOpenApi.inExternalEditor(root, rel, editor, at.line))}
        >
          <ExternalLink size={13} aria-hidden="true" />
          {t("terminal.fileMenu.external")}
        </button>
      ) : null}
    </div>
  );
}
