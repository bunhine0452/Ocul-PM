/**
 * 설정 · 앱 — 언어 · 파일 열기 · 판과 업데이트 · 로그 · 캐시 정리. 프로젝트와 무관한 앱 전역의 것들.
 *
 * 캐시는 디스크에서 다시 만들 수 있는 것만 담는다. 「정리하기」(빈 자리를 되찾는 VACUUM)는 확인 없이
 * 누를 수 있다 — 잃는 것이 없다. 이 프로젝트의 캐시를 다시 만드는 것은 이 프로젝트 칸에 있다 (11-15).
 *
 * 파일 이름이 `DataSection` 인 것은 옛 「데이터」 칸의 흔적이다 — `UpdateRow` 를 다른 곳(업데이트 배너
 * 시험)이 이 경로로 들인다.
 */
import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { toAppError } from "@/api/invoke";
import { appDataApi } from "@/api/settings";
import { useSettings } from "@/contexts/SettingsContext";
import { resolveLang, useT, type Lang } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { DbHealth } from "@/lib/bindings";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useUpdater } from "@/lib/updater";
import { RELEASES_PAGE } from "@/lib/updaterRoute";
import { EditorRow } from "./EditorRow";
import { useSaveSetting } from "./saveSetting";
import { PrefsCard, PrefsRow, PrefsSeg, useReportFix } from "./prefsUi";

/** 캐시가 디스크에서 차지하는 몫 — 본체 + WAL. */
export function cacheBytes(h: DbHealth | null): number | null {
  if (!h || h.db_bytes == null) return null;
  return h.db_bytes + (h.wal_bytes ?? 0);
}

/** 앱 판 + 업데이트 — 열 때 한 번 스스로 묻는다(「최신이에요」가 숨지 않게). 새 판이 있으면 「고칠 것」. */
export function UpdateRow() {
  const { t } = useT();
  const { status, check, install, restartNow } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void appDataApi
      .info()
      .then((info) => setVersion(info.version))
      .catch(() => {});
    void check();
  }, [check]);
  useReportFix(
    "update",
    status.kind === "available"
      ? { section: "data", label: "Ocul", detail: version ? `${version} → ${status.version}` : status.version, mono: true }
      : null,
  );

  let state: string | null = null;
  if (status.kind === "checking") state = t("prefs.data.checking");
  else if (status.kind === "uptodate") state = t("prefs.data.upToDate");
  else if (status.kind === "available") state = t("prefs.data.available", { version: status.version });
  else if (status.kind === "installing") state = t("prefs.data.installing");
  // 깔아 두고 재시작을 기다린다 — 무엇 때문인지와 「지금 재시작」 을 여기서도(배너만 보이던 것).
  else if (status.kind === "awaiting") state = t("update.awaiting", { reason: status.reason });
  else if (status.kind === "error") state = t("prefs.data.checkFailed");
  else if (status.kind === "packageManaged") state = t("prefs.data.packageManaged", { format: status.format });
  else if (status.kind === "noBuild") state = t("prefs.data.noBuild");

  // 줄의 동작은 테두리 단추 하나다 — 설치 · 재시작도 채우지 않는다(영수증 규칙 3, 11-15 검수): 「기록 켜기」 와 한
  // 쪽에 채운 단추가 둘 섰다. 할 일이라는 표시는 맨 위 「고칠 것」 줄이 한다.
  const action =
    status.kind === "awaiting" ? (
      <button type="button" className="btn sm" onClick={() => void restartNow()}>
        {t("update.restartNow")}
      </button>
    ) : status.kind === "available" ? (
      <button type="button" className="btn sm" onClick={() => void install()}>
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
    );

  return (
    <PrefsRow label={t("prefs.data.app")} actions={action}>
      {/* 판 번호는 기계 글씨 — mono (영수증 규칙 2). */}
      <span>
        Ocul <span className="mono">{version ?? ""}</span>
      </span>
      {state ? <span className="prefs-dim">· {state}</span> : null}
    </PrefsRow>
  );
}

/** 로그 — 자기 줄이다. 업데이트 줄의 동작으로 서던 때 범위가 다른 두 단추가 한 줄에 섰다. */
function LogsRow() {
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
    <PrefsRow
      label={t("prefs.data.logs")}
      actions={
        <button type="button" className="btn sm" onClick={() => void open()}>
          {t("prefs.project.reveal")}
        </button>
      }
    />
  );
}

function LanguageRow() {
  const { t } = useT();
  const { settings } = useSettings();
  const save = useSaveSetting();
  return (
    <PrefsRow label={t("prefs.display.language")}>
      <PrefsSeg<Lang>
        label={t("prefs.display.language")}
        value={resolveLang(settings.language)}
        options={[
          { id: "ko", label: t("settings.language.ko") },
          { id: "en", label: t("settings.language.en") },
        ]}
        onChange={(next) => save("language", next)}
      />
    </PrefsRow>
  );
}

export function AppSection({ id, arrived }: { id: string; arrived?: number }) {
  const { t } = useT();
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void appDataApi
      .health()
      .then(setHealth)
      .catch(() => {});
  }, []);

  const compact = async () => {
    setBusy(true);
    const before = cacheBytes(health);
    try {
      const after = await appDataApi.compact();
      setHealth(after);
      const now = cacheBytes(after);
      // 얼마나 줄었는지 모르면 줄었다는 숫자를 꾸미지 않는다 — 「—」 가 문장에 박혀 나왔다.
      toast.info(
        before != null && now != null
          ? t("prefs.data.compacted", { freed: formatBytes(Math.max(0, before - now)) })
          : t("prefs.data.compactedPlain"),
      );
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const size = cacheBytes(health);
  const free = health?.free_bytes ?? null;

  return (
    <PrefsCard id={id} title={t("prefs.data.title")} arrived={arrived}>
      <LanguageRow />
      <EditorRow />
      <UpdateRow />
      <LogsRow />
      <PrefsRow
        label={t("prefs.data.cache")}
        meta={
          size == null
            ? undefined
            : free
              ? t("prefs.data.cacheSizeFree", { size: formatBytes(size), free: formatBytes(free) })
              : t("prefs.data.cacheSize", { size: formatBytes(size) })
        }
        actions={
          <button type="button" className="btn sm" onClick={() => void compact()} disabled={busy}>
            {t("prefs.data.compact")}
          </button>
        }
      />
    </PrefsCard>
  );
}
