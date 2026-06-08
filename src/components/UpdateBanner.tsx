import { useEffect, useState } from "react";
import { Download, X } from "@/components/Icons";
import { useUpdater } from "@/lib/updater";

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

export function UpdateBanner() {
  const { status, check, install } = useUpdater();
  const [dismissed, setDismissed] = useState(false);
  // Once we've seen an available update we keep showing the banner through its
  // install / failure transitions. A *check* error (offline, private repo) never
  // flips this, so silent launch-time failures stay hidden.
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (status.kind === "available") setVersion(status.version);
  }, [status]);

  if (dismissed || version == null) return null;

  const installing = status.kind === "installing";
  const failed = status.kind === "error";

  return (
    <div className="update-banner" role="status">
      <Download size={16} />
      <div className="update-banner-text">
        {failed ? (
          <>업데이트 실패 — 잠시 후 다시 시도해 주세요</>
        ) : (
          <>
            새 버전 <b>v{version}</b> 이 나왔어요
          </>
        )}
      </div>
      <button
        type="button"
        className="update-banner-cta"
        onClick={() => void install()}
        disabled={installing}
      >
        {installing ? "설치 중…" : "지금 업데이트"}
      </button>
      <button
        type="button"
        className="update-banner-x"
        onClick={() => setDismissed(true)}
        aria-label="알림 닫기"
        disabled={installing}
      >
        <X size={14} />
      </button>
    </div>
  );
}
