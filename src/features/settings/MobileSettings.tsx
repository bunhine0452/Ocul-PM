// 설정 → 모바일 탭 (.oculpm/planner/mobile-bridge.md #mb0-settings-ui).
//
// 서버 수명(켜기/끄기·주소)·기기 페어링(6자리 코드·QR·카운트다운)·연결 기기
// 목록/해제. 서버 로직은 전부 백엔드(mobile_bridge/) — 여기는 커맨드 6개의
// 얇은 소비자다. 실패 사유(Tailscale 미탐지 등)는 백엔드 문자열을 그대로 보여
// 준다 (플랜 D5 — 탐지 실패는 정상 상태의 하나).
import { useCallback, useEffect, useRef, useState } from "react";
import { renderSVG } from "uqr";

import {
  commands,
  type MobileBridgeStatus,
  type MobileDevice,
  type PairingInfo,
} from "@/lib/bindings";
import { useT } from "@/i18n";

/** 페어링 코드가 사는 동안 기기 목록을 몇 번, 얼마 간격으로 확인하는가. */
const POLL_TRIES = 60;
const POLL_INTERVAL_MS = 5_000;

export function MobileSettings({
  Section,
  Field,
}: {
  Section: React.ComponentType<{ title: string; description?: string; children: React.ReactNode }>;
  Field: React.ComponentType<{ label: string; hint?: string; children: React.ReactNode }>;
}) {
  const { t } = useT();

  const [status, setStatus] = useState<MobileBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * 지금 살아 있는 페어링 시도의 번호 (2026-09-08).
   *
   * 기기 폴링은 5초 × 60 = **5분**을 도는 루프인데 이것을 끊을 신호가 하나도
   * 없었다 — 코드가 만료돼도, 서버를 꺼도, 화면을 떠나도 계속 돌며 백엔드를
   * 두드리고 사라진 컴포넌트에 `setDevices` 를 했다. 「코드 발급」을 두 번
   * 누르면 루프가 둘 겹쳤고, 먼저 뜬 쪽은 낡은 `before` 로 판정했다.
   *
   * 새 시도·서버 정지·만료·언마운트가 전부 이 번호를 올리고, 루프는 매 바퀴
   * 자기 번호가 아직 최신인지 확인한다.
   */
  const pairingRunRef = useRef(0);

  const refresh = useCallback(async () => {
    const [st, dv] = await Promise.all([
      commands.mobileBridgeStatus(),
      commands.mobileBridgeDevices(),
    ]);
    if (st.status === "ok") setStatus(st.data);
    if (dv.status === "ok") setDevices(dv.data);
  }, []);

  /** 카운트다운과 기기 폴링을 **함께** 끊는다 — 코드가 죽으면 둘 다 할 일이 없다. */
  const stopPairing = useCallback(() => {
    pairingRunRef.current += 1;
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 언마운트 — 타이머와 폴링 루프를 같이 걷는다.
    return stopPairing;
  }, [refresh, stopPairing]);

  // 코드가 만료되면 카운트다운도 폴링도 멈춘다.
  //
  // 예전에는 `setSecondsLeft` 의 **업데이터 함수 안에서** `clearInterval` 을
  // 불렀다. 업데이터는 순수해야 하고(StrictMode 개발 모드는 두 번 부른다),
  // 무엇보다 그 자리에서는 폴링 루프에 손이 닿지 않았다.
  useEffect(() => {
    if (pairing && secondsLeft === 0) stopPairing();
  }, [pairing, secondsLeft, stopPairing]);

  const running = status?.running ?? false;

  const toggleServer = async () => {
    setBusy(true);
    setStartError(null);
    const res = running ? await commands.mobileBridgeStop() : await commands.mobileBridgeStart();
    setBusy(false);
    if (res.status === "error") {
      setStartError(res.error);
      return;
    }
    setStatus(res.data);
    // 서버가 꺼지면 페어링 세션도 죽는다 — 카운트다운과 폴링까지 같이 걷는다.
    if (!res.data.running) {
      stopPairing();
      setPairing(null);
    }
  };

  const beginPairing = async () => {
    const res = await commands.mobileBridgePairingBegin();
    if (res.status === "error") {
      setStartError(res.error);
      return;
    }
    // 앞 시도가 남아 있으면 먼저 끊는다 — 두 번 눌러 루프가 겹치던 자리다.
    stopPairing();
    const run = pairingRunRef.current;
    const before = devices.length;
    setPairing(res.data);
    setSecondsLeft(res.data.expires_in_secs);
    countdownRef.current = setInterval(() => {
      // 업데이터는 **순수하게** — 멈추는 판단은 위의 만료 이펙트가 한다.
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    // 페어링이 완료되면 기기 목록에 나타난다 — 코드가 사는 동안 주기 폴링.
    void pollDevicesWhilePairing(run, before);
  };

  const pollDevicesWhilePairing = async (run: number, before: number) => {
    /** 이 시도가 아직 최신인가 — 만료·서버 정지·언마운트·재발급이면 아니다. */
    const live = () => pairingRunRef.current === run;
    for (let i = 0; i < POLL_TRIES; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!live()) return;
      const dv = await commands.mobileBridgeDevices();
      // 왕복 사이에도 끝났을 수 있다 — 답을 받은 뒤 한 번 더 본다.
      if (!live()) return;
      if (dv.status !== "ok") continue;
      setDevices(dv.data);
      if (dv.data.length > before) {
        stopPairing(); // 등록 성공 — 카운트다운도 이 루프도 여기서 끝.
        setPairing(null); // 코드 카드를 접는다.
        return;
      }
    }
  };

  const revoke = async (id: number) => {
    const res = await commands.mobileBridgeRevokeDevice(id);
    if (res.status === "ok") setDevices(res.data);
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <span className="shrink-0 px-1.5 py-0.5 rounded-md text-fs-1 font-bold tracking-wide bg-primary/12 text-primary">
          BETA
        </span>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.mobile.betaNote")}</p>
      </div>
      <Section title={t("settings.mobile.serverTitle")} description={t("settings.mobile.serverDesc")}>
        <Field label={running ? t("settings.mobile.running") : t("settings.mobile.stopped")}
          hint={running && status?.addr ? `http://${status.addr}/` : undefined}>
          <button
            onClick={() => void toggleServer()}
            disabled={busy}
            className={`px-3 py-1.5 rounded-md text-fs-4 font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              running
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {running ? t("settings.mobile.stop") : t("settings.mobile.start")}
          </button>
        </Field>
        {startError ? (
          <p className="text-xs text-destructive whitespace-pre-wrap">
            {t("settings.mobile.startFailed", { message: startError })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.mobile.sleepNote")}</p>
      </Section>

      {running ? (
        <Section title={t("settings.mobile.pairTitle")} description={t("settings.mobile.pairDesc")}>
          {pairing && secondsLeft > 0 ? (
            <div className="flex items-start gap-4">
              <div
                aria-hidden
                className="w-28 h-28 shrink-0 rounded-md border border-border bg-white p-1.5"
                // uqr 은 정적 SVG 문자열만 만든다 (외부 입력 없음 — 우리 주소뿐).
                dangerouslySetInnerHTML={{ __html: renderSVG(pairing.url) }}
              />
              <div className="space-y-1.5">
                <div className="text-2xl font-mono tracking-[0.3em] text-foreground">{pairing.code}</div>
                <div className="text-xs font-mono text-muted-foreground">{pairing.url}</div>
                <div className="text-xs text-muted-foreground">
                  {t("settings.mobile.pairCodeHint", { secs: String(secondsLeft) })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {pairing && secondsLeft === 0 ? (
                <p className="text-xs text-destructive">{t("settings.mobile.pairExpired")}</p>
              ) : null}
              <button
                onClick={() => void beginPairing()}
                className="px-3 py-1.5 rounded-md text-fs-4 font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              >
                {t("settings.mobile.pairBegin")}
              </button>
            </div>
          )}
        </Section>
      ) : null}

      <Section title={t("settings.mobile.devicesTitle")}>
        {devices.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.mobile.devicesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-fs-4 text-foreground truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.mobile.paired", { time: fmtTime(d.created_at) })}
                    {" · "}
                    {t("settings.mobile.lastSeen", { time: fmtTime(d.last_seen_at) })}
                  </div>
                </div>
                <button
                  onClick={() => void revoke(d.id)}
                  className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                >
                  {t("settings.mobile.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
