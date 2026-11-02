/**
 * 설정 · 표시 · 「파일 열기」 — 변경 · 터미널 ⌘클릭 · 작업 일지가 파일을 여는 편집기 (2026-11-02).
 *
 * 예전엔 셸 명령 `code "%path"` 가 고정 기본값이었고 바꿀 칸이 없었다. macOS 에서 VS Code 를
 * 깔아도 `code` 셸 명령은 따로 설치해야 해서, 편집기로 열기가 오류 토스트만 띄웠다. 이제 값은
 * `auto`(깔린 것을 찾는다) · `vscode` · `cursor` · `system` · 셸 명령 템플릿 — 읽는 쪽은
 * `src-tauri/src/commands/editor_choice.rs`.
 */
import { useEffect, useState } from "react";

import { fileOpenApi } from "@/api/fileOpen";
import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { useSaveSetting } from "./saveSetting";
import { PrefsRow, PrefsSeg } from "./prefsUi";

type Choice = "auto" | "vscode" | "cursor" | "system" | "custom";

/** 옛 기본값 — 이 글자가 저장돼 있으면 고른 것이 아니라 기본값이 남은 것이다(백엔드와 같은 규칙). */
const LEGACY_DEFAULT = 'code "%path"';
const CUSTOM_PLACEHOLDER = 'code -g "%path:%line"';

export function choiceOf(raw: string): Choice {
  const v = raw.trim();
  if (v === "" || v === "auto" || v === LEGACY_DEFAULT) return "auto";
  if (v === "vscode" || v === "cursor" || v === "system") return v;
  return "custom";
}

const NAMES: Record<string, string> = { vscode: "VS Code", cursor: "Cursor" };

export function EditorRow() {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  const saved = settings.externalEditorCommand;
  const [choice, setChoice] = useState<Choice>(() => choiceOf(saved));
  const [draft, setDraft] = useState(() => (choiceOf(saved) === "custom" ? saved : ""));
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fileOpenApi
      .detectEditor()
      .then((d) => alive && setFound(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pick = (next: Choice) => {
    setChoice(next);
    if (next === "custom") {
      if (draft.trim()) save("externalEditorCommand", draft.trim());
      return;
    }
    save("externalEditorCommand", next);
  };
  const commitDraft = () => {
    const v = draft.trim();
    if (v && v !== saved) save("externalEditorCommand", v);
  };

  const autoLabel =
    found && NAMES[found]
      ? t("prefs.display.editorAutoFound", { name: NAMES[found] })
      : t("prefs.display.editorAuto");

  return (
    <PrefsRow label={t("prefs.display.editor")} meta={t("prefs.display.editorMeta")}>
      <PrefsSeg<Choice>
        label={t("prefs.display.editor")}
        value={choice}
        options={[
          { id: "auto", label: autoLabel },
          { id: "vscode", label: "VS Code" },
          { id: "cursor", label: "Cursor" },
          { id: "system", label: t("prefs.display.editorSystem") },
          { id: "custom", label: t("prefs.display.editorCustom") },
        ]}
        onChange={pick}
      />
      {choice === "custom" ? (
        <input
          className="prefs-input mono"
          value={draft}
          placeholder={CUSTOM_PLACEHOLDER}
          aria-label={t("prefs.display.editorCustom")}
          title={t("prefs.display.editorCustomHint")}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
          }}
        />
      ) : null}
    </PrefsRow>
  );
}
