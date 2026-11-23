/**
 * 설정 · 앱의 한 줄 — 잠자기 막기 (11-23 사용자 결정, love-round L6).
 *
 * 켜 두면 일하는(OSC 7501 working) Claude 세션이 하나라도 있는 동안만 기기가 잠들지 않는다 — 언제 잡고 푸는지는
 * 백엔드가 정한다(`src-tauri/src/keep_awake.rs`, 세션이 0 이 되면 바로 · 앱을 끌 때도 푼다). 기본 꺼짐.
 * macOS 는 IOPMAssertion, Windows 는 SetThreadExecutionState — 둘 다 프로세스 안 API 라 새 자식 프로세스가 없다.
 * Linux 는 프로세스 안에서 막는 길이 없어 단추 없이 안내만 한다. 켜짐 · 꺼짐 모두 예외가 아니라 회색 글이다.
 */
import { useSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { getPlatform, type Platform } from "@/lib/platform";
import { useSaveSetting } from "./saveSetting";
import { PrefsRow } from "./prefsUi";

/** 이 OS 에서 앱이 잠자기를 막을 수 있나 — 백엔드 `keep_awake::SUPPORTED` 와 같은 표. */
export function keepAwakeSupported(platform: Platform): boolean {
  return platform === "mac" || platform === "windows";
}

export function KeepAwakeRow() {
  const { t } = useT();
  const { settings, loaded, ready } = useSettings();
  const save = useSaveSetting();
  const label = t("prefs.keepAwake.label");

  if (!keepAwakeSupported(getPlatform())) {
    return (
      <PrefsRow label={label}>
        <span className="prefs-dim">{t("prefs.keepAwake.unsupported")}</span>
      </PrefsRow>
    );
  }

  const on = settings.keepAwake === "on";
  let body;
  if (!loaded) body = <span className="prefs-dim">{t("prefs.checking")}</span>;
  // 설정을 읽지 못했다 — 켜졌는지 모르니 어느 쪽이라고도 말하지 않는다.
  else if (!ready) body = <span className="prefs-dim">{t("prefs.unknown")}</span>;
  else body = <span className="prefs-dim">{on ? t("prefs.keepAwake.on") : t("prefs.keepAwake.off")}</span>;

  return (
    <PrefsRow
      label={label}
      meta={t("prefs.keepAwake.meta")}
      // 읽어 내기 전에는 단추가 없다 — 그때의 값은 기본값(꺼짐)이라 「켜기」 가 모르는 상태를 꺼짐이라 말한다.
      actions={
        ready ? (
          <button type="button" className="btn sm" onClick={() => save("keepAwake", on ? "off" : "on")}>
            {on ? t("prefs.keepAwake.turnOff") : t("prefs.keepAwake.turnOn")}
          </button>
        ) : undefined
      }
    >
      {body}
    </PrefsRow>
  );
}
