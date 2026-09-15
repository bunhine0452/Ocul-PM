// 삭제 확인 다이얼로그 — 함께 닫힐 탭·미저장 편집을 **누르기 전에** 말한다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { AppDialog } from "@/components/ui/AppDialog";
import { t } from "@/i18n";

import { baseName } from "../fileOps";
import type { PendingDelete } from "../useFileOps";

interface DeleteConfirmDialogProps {
  pendingDelete: PendingDelete | null;
  deleting: boolean;
  /** 미저장 편집이 있는 파일 — 목록에서 그 탭을 따로 표시한다. */
  dirtyPaths: Set<string>;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  pendingDelete,
  deleting,
  dirtyPaths,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AppDialog
      open={pendingDelete != null}
      onClose={onCancel}
      label={t("code.ops.deleteTitle")}
      width={440}
    >
      <div style={{ padding: "18px 20px 16px" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: "var(--fs-5)", fontWeight: "var(--fw-bold)" }}>
          {t("code.ops.deleteTitle")}
        </h2>
        <p style={{ margin: 0, fontSize: "var(--fs-4)", lineHeight: 1.7 }}>
          {/* 하나면 그 이름을 부른다 — 여럿이면 이름 열 개를 늘어놓는 대신
              개수로 말하고, 무엇이 걸렸는지는 아래 탭 목록이 보여 준다. */}
          {pendingDelete && pendingDelete.targets.length > 1
            ? t("code.ops.deleteManyAsk", { count: pendingDelete.targets.length })
            : t(
                pendingDelete?.targets[0]?.isDir
                  ? "code.ops.deleteFolderAsk"
                  : "code.ops.deleteFileAsk",
                { name: pendingDelete ? baseName(pendingDelete.targets[0]?.path ?? "") : "" },
              )}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: 1.6 }}>
          {t("code.ops.deleteTrashNote")}
        </p>
        {/* 열려 있던 탭·미저장 편집은 **누르기 전에** 말한다. */}
        {pendingDelete && pendingDelete.openTabs.length > 0 ? (
          <div className="code-delete-open" role="note">
            <strong>{t("code.ops.deleteOpenTabs", { count: pendingDelete.openTabs.length })}</strong>
            <ul>
              {pendingDelete.openTabs.map((p) => (
                <li key={p} className={dirtyPaths.has(p) ? "dirty" : undefined}>
                  {p}
                  {dirtyPaths.has(p) ? ` — ${t("code.dirty")}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            className="btn sm"
            onClick={onCancel}
            disabled={deleting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn sm code-conflict-overwrite"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? t("code.ops.deleting") : t("code.ops.delete")}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
