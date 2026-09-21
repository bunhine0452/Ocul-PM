import { useCallback, useState } from "react";

import { AppDialog } from "@/components/ui/AppDialog";
import { ErrorCard } from "@/components/ErrorCard";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import type { ReleaseNotesDraft } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";

/**
 * 「릴리스 노트 초안」 (journal-scale-round `{#release-notes-draft}`).
 *
 * **이 시트는 파일을 고치지 않는다.** 릴리스는 다섯 면(버전 6파일 ·
 * `CHANGELOG.md` · README ko/en · 랜딩 ko/en)을 사람이 한 번에 훑는 규율이고
 * (`docs/RELEASE.md`), 그중 한 면만 자동이 되면 나머지 넷이 조용히 뒤처진다.
 * 그래서 산출물은 **클립보드까지**고, 붙여 넣는 것은 사람이다 — 아래 안내 줄이
 * 그 사실을 매번 말한다.
 *
 * 버전도 짓지 않는다. 초안의 첫 줄은 `## v?` 자리표시이며, 실제 버전은
 * `scripts/bump-version.mjs` 가 여섯 파일과 함께 정한다.
 *
 * 브랜치 화면에서 여는 이유: 범위(`지난 태그..HEAD`)가 곧 "이 브랜치에서 무엇을
 * 했나"의 다른 이름이고, 커밋·일지·파일을 한 좌표로 읽는 자리가 이미 여기다.
 */
export function ReleaseNotesSheet({
  projectId,
  open,
  onClose,
}: {
  projectId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const [fromRef, setFromRef] = useState("");
  const [toRef, setToRef] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReleaseNotesDraft | null>(null);

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await oculpmApi.releaseNotesDraft(
        projectId,
        fromRef.trim() || null,
        toRef.trim() || null,
        useLlm,
      );
      setDraft(res);
      if (res.note) toast.info(res.note);
    } catch (e) {
      setDraft(null);
      setError(e instanceof OculpmApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, fromRef, toRef, useLlm]);

  const copy = useCallback(
    async (withHint: boolean) => {
      if (!draft) return;
      try {
        await navigator.clipboard.writeText(draft.markdown);
        toast.info(withHint ? t("branch.relnotes.pasteHint") : t("branch.relnotes.copied"));
      } catch {
        toast.destructive(t("branch.relnotes.copyFailed"));
      }
    },
    [draft, t],
  );

  return (
    <AppDialog open={open} onClose={onClose} label={t("branch.relnotes.title")} width={760}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="font-medium">{t("branch.relnotes.title")}</span>
        <span className="text-fs-2 text-muted-foreground">{t("branch.relnotes.noWrite")}</span>
      </div>

      <div className="flex flex-col gap-3 overflow-auto px-4 py-3">
        <p className="text-fs-3 text-muted-foreground">{t("branch.relnotes.intro")}</p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-fs-2 text-muted-foreground">
            {t("branch.relnotes.from")}
            <input
              className="set-input"
              style={{ minWidth: 0, maxWidth: 200 }}
              value={fromRef}
              placeholder={t("branch.relnotes.fromHint")}
              onChange={(e) => setFromRef(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-fs-2 text-muted-foreground">
            {t("branch.relnotes.to")}
            <input
              className="set-input"
              style={{ minWidth: 0, maxWidth: 200 }}
              value={toRef}
              placeholder={t("branch.relnotes.toHint")}
              onChange={(e) => setToRef(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-fs-3" title={t("branch.relnotes.aiHint")}>
            <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />
            {t("branch.relnotes.ai")}
          </label>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void generate()}>
            {busy ? t("branch.relnotes.busy") : t("branch.relnotes.generate")}
          </button>
        </div>

        {error ? (
          <ErrorCard
            title={t("branch.relnotes.failed")}
            error={error}
            onRetry={() => void generate()}
          />
        ) : null}

        {draft ? (
          <>
            <div className="text-fs-2 text-muted-foreground">
              {t("branch.relnotes.stats", {
                commits: draft.commits,
                entries: draft.entries,
                linked: draft.linked,
              })}
              {" · "}
              {t("branch.relnotes.range", {
                from: draft.from_ref ?? t("branch.relnotes.noTag"),
                to: draft.to_ref,
              })}
              {" · "}
              {draft.used_llm ? t("branch.relnotes.byAi") : t("branch.relnotes.byRule")}
            </div>
            <pre className="max-h-[46vh] overflow-auto rounded-lg border border-border bg-[color:var(--bg-inset)] p-3 text-fs-3 font-mono whitespace-pre-wrap text-foreground">
              {draft.markdown}
            </pre>
          </>
        ) : (
          <p className="text-fs-3 text-muted-foreground">{t("branch.relnotes.empty")}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {/* 다섯 면 규율은 접히지 않는다 — 복사 버튼 옆에 늘 서 있게 둔다. */}
        <span className="flex-1 text-fs-2 text-muted-foreground">
          {t("branch.relnotes.discipline")}
        </span>
        <button
          type="button"
          className="btn sm"
          {...blocked(draft ? null : t("branch.relnotes.blockedNoDraft"))}
          onClick={() => void copy(false)}
        >
          {t("branch.relnotes.copy")}
        </button>
        <button
          type="button"
          className="btn sm"
          {...blocked(draft ? null : t("branch.relnotes.blockedNoDraft"))}
          onClick={() => void copy(true)}
        >
          {t("branch.relnotes.paste")}
        </button>
        <button type="button" className="btn sm" onClick={onClose}>
          {t("branch.relnotes.close")}
        </button>
      </div>
    </AppDialog>
  );
}
