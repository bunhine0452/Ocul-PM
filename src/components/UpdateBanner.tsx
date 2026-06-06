import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/lib/bindings";
import { Download, X } from "@/components/Icons";

// Release update notifier (1.0). On launch, compares the running app version
// (app_info) against the newest published GitHub release (github_releases —
// reused, public repo so no token). If a newer version exists, a dismissible
// floating banner links to the release download page. No self-update / signing
// keys — a notifier only (user installs the new build manually). Best-effort:
// offline / rate-limited / no-releases all silently skip.

const REPO_OWNER = "bunhine0452";
const REPO_NAME = "Ocul-PM";

/** True if `latest` is strictly newer than `current` (semver-ish: "1.2.0" /
 *  "v1.2.0"). Pre-release/odd tags that don't parse cleanly → false (no nag). */
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
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await commands.appInfo();
        if (cancelled || info.status !== "ok") return;
        const current = info.data.version;
        const rel = await commands.githubReleases(REPO_OWNER, REPO_NAME, 10);
        if (cancelled || rel.status !== "ok") return;
        const latest = rel.data.find((r) => !r.draft && !r.prerelease);
        if (latest && isNewerVersion(latest.tag_name, current)) {
          setUpdate({ version: latest.tag_name.replace(/^v/i, ""), url: latest.html_url });
        }
      } catch {
        // offline / rate-limited / no releases — skip quietly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <Download size={16} />
      <div className="update-banner-text">
        새 버전 <b>v{update.version}</b> 이 나왔어요
      </div>
      <button
        type="button"
        className="update-banner-cta"
        onClick={() => void openUrl(update.url)}
      >
        다운로드
      </button>
      <button
        type="button"
        className="update-banner-x"
        onClick={() => setDismissed(true)}
        aria-label="알림 닫기"
      >
        <X size={14} />
      </button>
    </div>
  );
}
