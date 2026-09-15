// 언어 서버 쓰기 동작의 다이얼로그 둘 — 이름 바꾸기(F2) 입력과 코드 액션(⌘.) 목록.
// 상태는 `useLspActions` 가 들고, 여기는 그리기만 한다. `CodePane.tsx` 에서 그대로 들어냈다.
import type React from "react";

import type { LspCodeAction } from "@/lib/bindings";
import { t } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { AppDialog } from "@/components/ui/AppDialog";
import { Star } from "@/components/Icons";

interface RenameDialogProps {
  renameAt: { line: number; character: number } | null;
  setRenameAt: React.Dispatch<React.SetStateAction<{ line: number; character: number } | null>>;
  renameName: string;
  setRenameName: React.Dispatch<React.SetStateAction<string>>;
  renaming: boolean;
  submitRename: () => void;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
}

export function RenameDialog({
  renameAt,
  setRenameAt,
  renameName,
  setRenameName,
  renaming,
  submitRename,
  renameInputRef,
}: RenameDialogProps) {
  return (
    <AppDialog
      open={renameAt != null}
      onClose={() => setRenameAt(null)}
      label={t("code.lsp.renameTitle")}
      width={420}
      initialFocusRef={renameInputRef}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitRename();
        }}
        style={{ padding: "18px 20px 16px" }}
      >
        <label
          htmlFor="code-rename-input"
          style={{ display: "block", fontSize: "var(--fs-4)", fontWeight: "var(--fw-strong)", marginBottom: 8 }}
        >
          {t("code.lsp.renameTitle")}
        </label>
        <input
          id="code-rename-input"
          ref={renameInputRef}
          className="input"
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          disabled={renaming}
          spellCheck={false}
          autoComplete="off"
          style={{ width: "100%", fontFamily: "var(--mono)" }}
        />
        <p style={{ margin: "10px 0 0", fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("code.lsp.renameHint")}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn sm" onClick={() => setRenameAt(null)} disabled={renaming}>{t("common.cancel")}</button>
          <button type="submit" className="btn sm primary" {...blocked(renameName.trim() ? null : t("code.lsp.blockedNoName"))} disabled={renaming}>
            {renaming ? t("code.lsp.renaming") : t("code.lsp.renameApply")}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}

interface CodeActionsDialogProps {
  actions: LspCodeAction[] | null;
  setActions: React.Dispatch<React.SetStateAction<LspCodeAction[] | null>>;
  actionsBusy: boolean;
  runCodeAction: (index: number) => void;
}

export function CodeActionsDialog({ actions, setActions, actionsBusy, runCodeAction }: CodeActionsDialogProps) {
  return (
    <AppDialog
      open={actions != null && actions.length > 0}
      onClose={() => setActions(null)}
      label={t("code.lsp.actionsTitle")}
      width={460}
    >
      <div style={{ padding: "16px 20px 18px" }}>
        <h2 style={{ margin: "0 0 12px", fontSize: "var(--fs-5)", fontWeight: "var(--fw-bold)" }}>
          {t("code.lsp.actionsTitle")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(actions ?? []).map((a) => (
            <button
              key={a.index}
              type="button"
              className="btn sm"
              disabled={actionsBusy}
              onClick={() => runCodeAction(a.index)}
              style={{ justifyContent: "flex-start", textAlign: "left", gap: 8 }}
            >
              {/* 서버가 "이걸 먼저" 라고 표시한 것 — 대개 진짜 고치려던 fix 다. */}
              {a.preferred ? <Star size={13} fill="currentColor" style={{ color: "var(--accent-text)", flex: "none" }} aria-hidden /> : null}
              <span style={{ flex: 1 }}>{a.title}</span>
              {a.kind ? (
                <span style={{ fontSize: "var(--fs-2)", color: "var(--text-3)" }}>{a.kind}</span>
              ) : null}
            </button>
          ))}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("code.lsp.renameHint")}
        </p>
      </div>
    </AppDialog>
  );
}
