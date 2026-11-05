import { useEffect, useRef, useState } from "react";
import { Download, X } from "@/components/Icons";
import { updateGateApi } from "@/api/installKind";
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

/**
 * 업데이터 스모크 빌드 표식 (portability.yml `updater-smoke`, 크로스플랫폼 L-UPD
 * `#w3-updater-smoke`). 그 잡이 굽는 **스모크 전용 판**만 `VITE_OCULPM_UPDATER_SMOKE=1`
 * 로 빌드한다 — 새 버전을 찾으면 배너의 「지금 업데이트」 를 누른 것과 같은 `install()`
 * 을 바로 부른다(CI 에는 누를 사람이 없고, Linux AppImage 는 WebDriver 로 붙을 수 없다).
 * 릴리스·개발 빌드에는 이 값이 없어 늘 false 다 — 서명 검증·설치 경로는 그대로다.
 */
export const SMOKE_AUTO_INSTALL = import.meta.env.VITE_OCULPM_UPDATER_SMOKE === "1";

/** 주기 확인 간격 — 하루. */
const PERIODIC_MS = 24 * 60 * 60 * 1000;
/** 깨어날 때 다시 묻는 최소 간격 — 6시간. */
const WAKE_MIN_MS = 6 * 60 * 60 * 1000;
/** 확인이 실패한 동안 다시 묻는 간격 — 10분. */
const FAILED_RETRY_MS = 10 * 60 * 1000;

/**
 * 배너의 **자동** 확인 — 창마다의 규칙(위 간격들)을 지난 뒤, 앱 전체 관문(`update_gate.rs`)에
 * 한 번 더 묻는다. 다른 창이 묻는 중이거나 방금 「새 판 없음」을 받았으면 GitHub 에 가지 않는다
 * (11-05 실측: 창 여럿을 연 1분에 확인 12번이 몰려 실패). 설정의 확인 단추는 관문을 거치지 않는다.
 */
async function autoCheck(check: () => Promise<unknown>, urgent = false): Promise<void> {
  if (await updateGateApi.claim(urgent)) await check();
}

export function UpdateBanner() {
  const { t } = useT();
  const { status, check, install, restartNow } = useUpdater();
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Once we've seen an available update we keep showing the banner through its
  // install / failure transitions. A *check* error (offline, private repo) never
  // flips this, so silent launch-time failures stay hidden.
  const [version, setVersion] = useState<string | null>(null);

  // 기동 1회 + **하루 한 번** + 깨어날 때 (감사 라운드 2026-09-11 E1). macOS 는
  // 창을 닫아도 앱이 살아 있어 프로세스가 며칠을 살고, 기동 때
  // 한 번 물어본 뒤로는 새 버전을 영영 몰랐다. 깨어남은 마지막 확인에서
  // `WAKE_MIN_MS` 가 지났을 때만 — 창을 오갈 때마다 GitHub 을 두드리지 않는다.
  //
  // 확인이 **실패**했으면(오프라인 등) 그 시각은 「물어봤다」 로 치지 않는다 — 네트워크가
  // 돌아오는 순간(`online`)과 다음 깨어남에서 6시간을 기다리지 않고 바로 다시 묻는다.
  // 예전에는 끊긴 채 켠 앱이 다시 연결돼도 6~24시간 새 버전을 몰랐다(11-03).
  const failedRef = useRef(false);
  useEffect(() => {
    failedRef.current = status.kind === "error";
  }, [status]);

  useEffect(() => {
    let last = Date.now();
    void autoCheck(check);
    const timer = window.setInterval(() => {
      last = Date.now();
      void autoCheck(check);
    }, PERIODIC_MS);
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      if (!failedRef.current && Date.now() - last < WAKE_MIN_MS) return;
      last = Date.now();
      void autoCheck(check);
    };
    const onOnline = () => {
      if (!failedRef.current) return;
      last = Date.now();
      void autoCheck(check, true);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onOnline);
    };
  }, [check]);

  // Wi-Fi 는 붙어 있는데 인터넷만 안 되는 경우(로그인 화면이 있는 공용 와이파이 등)는
  // `online` 이 오지 않는다 — 실패한 동안은 짧은 간격으로 스스로 다시 묻는다.
  // 관문이 다른 창 몫이라며 거절하면 상태가 그대로라 — 한 번 뒤가 아니라 실패한 동안 계속 돈다.
  useEffect(() => {
    if (status.kind !== "error") return;
    const retry = window.setInterval(() => void autoCheck(check), FAILED_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [status.kind, check]);

  useEffect(() => {
    if (status.kind === "available") setVersion(status.version);
  }, [status]);

  useEffect(() => {
    if (SMOKE_AUTO_INSTALL && status.kind === "available") void install();
  }, [status.kind, install]);

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
