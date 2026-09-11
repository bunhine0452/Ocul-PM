import { useEffect, useState } from "react";
import { Download, X } from "@/components/Icons";
import { useUpdater } from "@/lib/updater";
import { useT } from "@/i18n";

// Launch-time self-update banner. On mount it asks the updater plugin (via the
// shared `useUpdater` hook) whether a newer signed build exists; when one does
// we show a dismissible banner that downloads, installs and relaunches in place
// — no manual re-download. Offline / no-update / private-repo all fail closed,
// so the banner simply doesn't appear. The Settings → 데이터 "업데이트" section
// reuses the same hook for a manual check. See src/lib/updater.ts.

/** True if `latest` is strictly newer than `current` (semver-ish: "1.2.0" /
 *  "v1.2.0"). Kept as a tested helper; the updater plugin does its own
 *  comparison server-side via latest.json. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.trim().replace(/^v/i, "").split("-")[0].split(".").map((n) => Number(n));
  const a = parse(latest);
  const b = parse(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 주기 확인 간격 — 하루. */
const PERIODIC_MS = 24 * 60 * 60 * 1000;
/** 깨어날 때 다시 묻는 최소 간격 — 6시간. */
const WAKE_MIN_MS = 6 * 60 * 60 * 1000;

export function UpdateBanner() {
  const { t } = useT();
  const { status, check, install, restartNow } = useUpdater();
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Once we've seen an available update we keep showing the banner through its
  // install / failure transitions. A *check* error (offline, private repo) never
  // flips this, so silent launch-time failures stay hidden.
  const [version, setVersion] = useState<string | null>(null);

  // 기동 1회 + **하루 한 번** + 깨어날 때 (감사 라운드 2026-09-11 E1). 트레이
  // 상주(`tray.keep_running`)면 창을 닫아도 프로세스가 며칠을 살아, 기동 때
  // 한 번 물어본 뒤로는 새 버전을 영영 몰랐다. 깨어남은 마지막 확인에서
  // `WAKE_MIN_MS` 가 지났을 때만 — 창을 오갈 때마다 GitHub 을 두드리지 않는다.
  useEffect(() => {
    let last = Date.now();
    void check();
    const timer = window.setInterval(() => {
      last = Date.now();
      void check();
    }, PERIODIC_MS);
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < WAKE_MIN_MS) return;
      last = Date.now();
      void check();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [check]);

  useEffect(() => {
    if (status.kind === "available") setVersion(status.version);
  }, [status]);

  // 닫은 배너는 **그 버전**에 대해서만 닫힌 것이다 — 나중에 더 새 버전이
  // 오면 다시 뜬다.
  if (version == null || dismissed === version) return null;

  const installing = status.kind === "installing";
  const failed = status.kind === "error";
  // 새 버전은 이미 깔렸고 재시작만 남았다 — 끊으면 안 되는 일이 끝나기를 기다린다.
  const awaiting = status.kind === "awaiting" ? status.reason : null;

  return (
    <div className="update-banner" role="status">
      <Download size={15} />
      <div className="update-banner-text">
        {awaiting ? (
          <>{t("update.awaiting", { reason: awaiting })}</>
        ) : failed ? (
          <>{t("update.failed")}</>
        ) : (
          <>
            {t("update.availablePrefix")} <b>v{version}</b> {t("update.availableSuffix")}
          </>
        )}
      </div>
      <button
        type="button"
        className="update-banner-cta"
        onClick={() => void (awaiting ? restartNow() : install())}
        disabled={installing}
      >
        {awaiting
          ? t("update.restartNow")
          : installing
            ? t("update.installing")
            : t("update.now")}
      </button>
      <button
        type="button"
        className="update-banner-x"
        onClick={() => setDismissed(version)}
        aria-label={t("update.dismiss")}
        disabled={installing}
      >
        <X size={15} />
      </button>
    </div>
  );
}
