/**
 * 설정 · 데이터 — 기록 원본은 프로젝트 폴더의 마크다운이고, 여기는 앱의 **캐시**다.
 *
 * 캐시는 디스크에서 다시 만들 수 있는 것만 담는다. 그래서 「정리해서 돌려받기」(빈 자리를
 * 되찾는 VACUUM)와 「처음부터 다시 만들기」(이 프로젝트의 색인을 디스크에서 다시 투영)는
 * 둘 다 확인 없이 누를 수 있다 — 잃는 것이 없다.
 */
import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { appDataApi } from "@/api/settings";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { DbHealth } from "@/lib/bindings";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useUpdater } from "@/lib/updater";
import { RELEASES_PAGE } from "@/lib/updaterRoute";
import { PrefsCard, PrefsRow } from "./prefsUi";

/** 캐시가 디스크에서 차지하는 몫 — 본체 + WAL. */
export function cacheBytes(h: DbHealth | null): number | null {
  if (!h || h.db_bytes == null) return null;
  return h.db_bytes + (h.wal_bytes ?? 0);
}

/** 앱 판 + 업데이트 — 열 때 한 번 스스로 묻는다(「최신이에요」가 숨지 않게). */
export function UpdateRow() {
  const { t } = useT();
  const { status, check, install } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void appDataApi
      .info()
      .then((info) => setVersion(info.version))
      .catch(() => {});
    void check();
  }, [check]);

  let state: string | null = null;
  if (status.kind === "checking") state = t("prefs.data.checking");
  else if (status.kind === "uptodate") state = t("prefs.data.upToDate");
  else if (status.kind === "available") state = t("prefs.data.available", { version: status.version });
  else if (status.kind === "installing" || status.kind === "awaiting") state = t("prefs.data.installing");
  else if (status.kind === "error") state = t("prefs.data.checkFailed");
  else if (status.kind === "packageManaged") state = t("prefs.data.packageManaged", { format: status.format });
  else if (status.kind === "noBuild") state = t("prefs.data.noBuild");

  return (
    <PrefsRow label={t("prefs.data.app")}>
      <span>Ocul-PM {version ?? ""}</span>
      {state ? <span className="prefs-dim">· {state}</span> : null}
      <span className="prefs-push" />
      {status.kind === "available" ? (
        <button type="button" className="btn sm primary" onClick={() => void install()}>
          {t("prefs.data.install", { version: status.version })}
        </button>
      ) : status.kind === "packageManaged" || status.kind === "noBuild" ? (
        <a className="btn sm" href={RELEASES_PAGE} target="_blank" rel="noreferrer">
          {t("prefs.data.releases")}
        </a>
      ) : (
        <button
          type="button"
          className="btn sm"
          onClick={() => void check()}
          disabled={status.kind === "checking" || status.kind === "installing"}
        >
          {t("prefs.data.check")}
        </button>
      )}
      <LogFolderButton />
    </PrefsRow>
  );
}

function LogFolderButton() {
  const { t } = useT();
  const open = async () => {
    try {
      const dir = await appDataApi.logDir();
      if (!dir) {
        toast.warning(t("prefs.data.noLogs"));
        return;
      }
      await revealItemInDir(dir);
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  };
  return (
    <button type="button" className="btn ghost sm" onClick={() => void open()}>
      {t("prefs.data.logs")}
    </button>
  );
}

export function DataSection({ id }: { id: string }) {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [busy, setBusy] = useState<"compact" | "rebuild" | null>(null);

  useEffect(() => {
    void appDataApi
      .health()
      .then(setHealth)
      .catch(() => {});
  }, []);

  const compact = async () => {
    setBusy("compact");
    const before = cacheBytes(health);
    try {
      const after = await appDataApi.compact();
      setHealth(after);
      const freed = before != null && cacheBytes(after) != null ? Math.max(0, before - (cacheBytes(after) ?? 0)) : null;
      toast.info(t("prefs.data.compacted", { freed: formatBytes(freed) }));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    if (projectId == null) return;
    setBusy("rebuild");
    try {
      await oculpmApi.reindexCache(projectId);
      toast.info(t("prefs.data.rebuilt"));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(null);
    }
  };

  const size = cacheBytes(health);
  const free = health?.free_bytes ?? null;

  return (
    <PrefsCard id={id} title={t("prefs.data.title")}>
      <PrefsRow
        label={t("prefs.data.cache")}
        meta={
          size == null
            ? undefined
            : free
              ? t("prefs.data.cacheSizeFree", { size: formatBytes(size), free: formatBytes(free) })
              : t("prefs.data.cacheSize", { size: formatBytes(size) })
        }
      >
        <button type="button" className="btn sm" onClick={() => void compact()} disabled={busy != null}>
          {t("prefs.data.compact")}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => void rebuild()}
          disabled={busy != null}
          title={t("prefs.data.rebuildHint")}
        >
          {t("prefs.data.rebuild")}
        </button>
      </PrefsRow>
      <UpdateRow />
    </PrefsCard>
  );
}
