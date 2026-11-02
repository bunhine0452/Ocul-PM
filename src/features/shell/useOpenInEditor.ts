/**
 * 「VS Code 에서 열기」 — 설정 「파일 열기」 의 편집기로 프로젝트 안 파일(또는 폴더)을 연다 (2026-11-03).
 * 프로젝트 ▾ 메뉴 · 작업 일지의 변경 파일이 같이 쓴다. 이름은 「자동」 이 찾은 편집기(VS Code · Cursor)
 * 를 따르고, 모르면(기본 앱 · 직접 입력) `null` — 부르는 쪽이 「편집기에서 열기」 로 적는다.
 */
import { useCallback, useEffect, useState } from "react";

import { fileOpenApi } from "@/api/fileOpen";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { choiceOf } from "@/features/settings/EditorRow";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";

const EDITOR_NAMES: Record<string, string> = { vscode: "VS Code", cursor: "Cursor" };

export function useOpenInEditor(root: string | null, enabled = true) {
  const { t } = useT();
  const editorCmd = useOptionalSettings()?.settings.externalEditorCommand ?? "auto";
  const [detected, setDetected] = useState<string | null>(null);
  const auto = choiceOf(editorCmd) === "auto";

  useEffect(() => {
    if (!enabled || !auto) return;
    let alive = true;
    void fileOpenApi
      .detectEditor()
      .then((d) => alive && setDetected(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, auto]);

  const name = EDITOR_NAMES[auto ? (detected ?? "") : choiceOf(editorCmd)] ?? null;

  /** 프로젝트 상대 경로(빈 값 = 프로젝트 폴더)를 연다. `line` 은 1부터. */
  const open = useCallback(
    (rel: string, line: number | null = null) => {
      if (!root) return;
      fileOpenApi
        .inExternalEditor(root, rel, editorCmd, line)
        .catch((e) => toast.destructive(t("sidebar.openInEditorFailed", { error: String(e?.message ?? e) })));
    },
    [root, editorCmd, t],
  );

  /** 단추 글 — 「VS Code 에서 열기」 · 「편집기에서 열기」. */
  const label = name ? t("sidebar.openInEditor", { name }) : t("sidebar.openInEditorGeneric");
  return { open, name, label };
}
