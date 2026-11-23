/**
 * 설정 · 앱의 한 줄 — 이 앱이 기기를 떠나는 것 (11-23 love-round G2 #egress-visible, 약속 7).
 *
 * 약속의 가장 강한 증거(egress 원장)를 사용자는 웹 개인정보 쪽으로 나가야 봤다. 여기서 사람 말로 보인다 — 앱에 실린
 * 정적 문구뿐이고 웹 요청은 없다. 목록의 출처는 `egressDoors.json` 하나다: 송출 자리 원장(`egress_inventory.rs`)과
 * 기동 원장(`egress_spawn_ledger.rs`)이 그 표와 집합으로 대조해서, 원장에 새 문이 생기면 이 줄도 늘지 않고는 빌드가
 * 통과하지 않는다. 문 이름이 사전(`prefs.egress.<id>`)에 없으면 `egress_row.test.tsx` 가 막는다.
 */
import { useT, type I18nKey } from "@/i18n";
import doors from "./egressDoors.json";
import { PrefsRow } from "./prefsUi";

export const EGRESS_DOOR_IDS: readonly string[] = doors.doors.map((d) => d.id);

export function EgressRow() {
  const { t } = useT();
  return (
    <PrefsRow label={t("prefs.egress.label")} meta={t("prefs.egress.meta")}>
      <ul className="prefs-egress" aria-label={t("prefs.egress.label")}>
        {EGRESS_DOOR_IDS.map((id) => (
          <li key={id} data-door={id}>
            <b>{t(`prefs.egress.${id}` as I18nKey)}</b>
            <span className="prefs-dim">{t(`prefs.egress.${id}.detail` as I18nKey)}</span>
          </li>
        ))}
      </ul>
    </PrefsRow>
  );
}
