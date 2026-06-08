import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X } from "@/components/Icons";

// Self-update (benchmarked from the uvws/PySpace setup). On launch the Tauri
// updater plugin checks the GitHub `latest.json` endpoint and verifies the
// build's signature against the pubkey embedded in tauri.conf.json. When a
// newer signed build exists we show a dismissible banner that downloads,
// installs and relaunches in place — no manual re-download. Requires the repo
// releases to be PUBLIC (the endpoint is unauthenticated); offline / no-update /
// private-repo all fail closed, so the banner simply doesn't appear.

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

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const upd = await check();
        if (!cancelled && upd) setUpdate(upd);
      } catch {
        // offline / no endpoint / private repo / no update — skip quietly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  const install = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="update-banner" role="status">
      <Download size={16} />
      <div className="update-banner-text">
        {failed ? (
          <>업데이트 실패 — 잠시 후 다시 시도해 주세요</>
        ) : (
          <>
            새 버전 <b>v{update.version}</b> 이 나왔어요
          </>
        )}
      </div>
      <button
        type="button"
        className="update-banner-cta"
        onClick={() => void install()}
        disabled={busy}
      >
        {busy ? "설치 중…" : "지금 업데이트"}
      </button>
      <button
        type="button"
        className="update-banner-x"
        onClick={() => setDismissed(true)}
        aria-label="알림 닫기"
        disabled={busy}
      >
        <X size={14} />
      </button>
    </div>
  );
}
