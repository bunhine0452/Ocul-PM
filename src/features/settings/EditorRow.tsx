/**
 * 설정 · 앱 · 「파일 열기」 — 변경 · 터미널 ⌘클릭 · 작업 일지가 파일을 여는 편집기 (2026-11-02).
 *
 * 예전엔 셸 명령 `code "%path"` 가 고정 기본값이었고 바꿀 칸이 없었다. macOS 에서 VS Code 를
 * 깔아도 `code` 셸 명령은 따로 설치해야 해서, 편집기로 열기가 오류 토스트만 띄웠다. 이제 값은
 * `auto`(깔린 것을 찾는다) · `vscode` · `cursor` · `system` · 셸 명령 템플릿 — 읽는 쪽은
 * `src-tauri/src/commands/editor_choice.rs`.
 *
 * 11-15 (#settings-status): 「자동」 은 찾은 이름을 괄호에 넣지 않는다 — 다섯 칸 세그먼트가 좁은 창(480 × 125%)에서
 * 넘쳤다. 찾은 이름은 그 칸의 툴팁 · 접근명으로만 둔다(11-15 검수): 회색으로 덧붙이던 때는 「자동 VS Code | VS Code」
 * 가 같은 선택지 둘처럼 읽혔다. 제품 이름은 기계 글씨가 아니라 본문 서체다(영수증 규칙 2). 화면이 420px 아래면
 * 세그먼트 대신 고르기 칸(select)이 서고, 거기는 「자동 (VS Code)」 로 이름까지 적는다(한 줄씩 서는 목록이라 겹쳐 읽히지 않는다).
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

  const foundName = found ? NAMES[found] : undefined;
  const options: Array<{ id: Choice; label: string }> = [
    { id: "auto", label: t("prefs.display.editorAuto") },
    { id: "vscode", label: "VS Code" },
    { id: "cursor", label: "Cursor" },
    { id: "system", label: t("prefs.display.editorSystem") },
    { id: "custom", label: t("prefs.display.editorCustom") },
  ];

  return (
    <PrefsRow label={t("prefs.display.editor")} meta={t("prefs.display.editorMeta")}>
      <div className="prefs-editor-seg">
        <PrefsSeg<Choice>
          label={t("prefs.display.editor")}
          value={choice}
          options={options.map((o) => {
            if (o.id !== "auto" || !foundName) return o;
            const found = t("prefs.display.editorAutoFound", { name: foundName });
            return { id: o.id, aria: found, label: <span title={found}>{o.label}</span> };
          })}
          onChange={pick}
        />
      </div>
      {/* 좁은 화면(≤420px)의 같은 고르기 — 둘 중 하나만 보인다(prefs.css 의 컨테이너 쿼리). */}
      <select
        className="prefs-editor-select"
        aria-label={t("prefs.display.editor")}
        value={choice}
        onChange={(e) => pick(e.target.value as Choice)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id === "auto" && foundName ? t("prefs.display.editorAutoFound", { name: foundName }) : o.label}
          </option>
        ))}
      </select>
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
