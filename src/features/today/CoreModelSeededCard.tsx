import { Cpu, X } from "@/components/Icons";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { openSettings } from "@/lib/settingsNav";

// 배경 작업 모델 1회 안내 카드 (Osaurus 라운드 Phase 0, D2).
//
// 배경 작업(자동 화해·일지 초안)이 대화 모델을 그대로 쓰던 것에서 전용
// `core_*` 슬롯으로 옮겨졌다. 이미 자동화를 켜 둔 사용자에게 강제만 하면 잘
// 되던 기능이 **말없이 멈춘다** — 그래서 백엔드가 프로젝트를 열 때 대화 모델을
// 1회 복사한다(`core_model::seed_if_automation_enabled`, 동작 변화 0).
//
// 이 카드는 그 복사를 사람에게 알린다. 조용한 시드는 조용한 정지와 마찬가지로
// 정직하지 않다 — 값이 어디로 갔고 왜 바꿀 만한지 한 번은 말해야 한다.
// 표식(`core_model_seeded`)을 비우는 것이 닫기다 (`lastSeenVersion` 과 같은 규약).
export function CoreModelSeededCard() {
  const { t } = useT();
  const settings = useOptionalSettings();
  const seeded = settings?.settings.coreModelSeeded ?? "";
  const set = settings?.set;

  if (!seeded || !set) return null;
  const dismiss = () => void set("coreModelSeeded", "");

  return (
    <div className="card card-pad" role="status" style={{ marginBottom: 16 }}>
      <div className="stat-top">
        <Cpu size={15} color="var(--accent-text)" />
        <strong>{t("today.coreModelSeeded.title")}</strong>
        <button className="btn ghost sm right" onClick={dismiss} aria-label={t("common.dismiss")}>
          <X size={13} />
        </button>
      </div>
      <p className="empty-hint" style={{ margin: "6px 0 0" }}>
        {t("today.coreModelSeeded.body", { value: seeded })}
      </p>
      <div className="first-run-actions">
        <button
          className="btn sm"
          onClick={() => {
            dismiss();
            openSettings("llm");
          }}
        >
          {t("today.coreModelSeeded.open")}
        </button>
      </div>
    </div>
  );
}
