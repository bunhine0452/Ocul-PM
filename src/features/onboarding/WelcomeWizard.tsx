/**
 * 첫 실행 마법사 — 설치하고 **처음 켠 사람**에게만 한 번 뜨는 창.
 *
 * Cursor·Antigravity 가 첫 실행에 언어·테마를 묻고 폴더 하나를 열게 하는 것과
 * 같은 자리다. 그전까지 이 앱의 첫 화면은 프로젝트가 0개인 시작 탭이었고,
 * 처음 온 사람에게는 "무엇을 눌러야 시작인지" 가 카드 하나(＋ 추가)에만 있었다.
 *
 * 묻는 것은 셋뿐이다 — **되돌릴 수 없거나(언어·기록), 안 물으면 앱을 못 쓰는
 * 것(프로젝트)**. 나머지(모델·API 키·자동화)는 필요한 자리에서 묻는 편이 낫다.
 * 첫 실행에 다 물으면 아직 무엇인지 모르는 것들에 답하게 된다.
 *
 * 세 가지 규칙:
 *
 *  1. **뜨는 조건은 두 개가 모두 참일 때뿐이다** — `onboarded=false` 이고
 *     등록된 프로젝트가 0개. 두 번째 조건이 없으면 이미 쓰던 사용자가
 *     업데이트 후에 안내를 다시 받는다 (`onboarded` 는 이번에 생긴 키라
 *     기존 설치본에서 전부 false 다).
 *  2. **어느 출구로 나가도 `onboarded` 를 적는다** — 끝내기·건너뛰기·Esc.
 *     한 번 본 창이 다음에 또 뜨면 그건 버그로 읽힌다.
 *  3. **고르는 즉시 적용된다** — 미리보기 상자를 따로 두지 않는다. 테마를
 *     누르면 이 창을 포함한 앱 전체가 그 색이 되는 것이 곧 미리보기다
 *     (테마 편집기와 같은 관용구).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  FolderOpen,
  Languages,
  Monitor,
  Moon,
  FolderPlus,
  OculIcon,
  Sun,
} from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { ACCENTS } from "@/features/theme/accents";
import { normalizeLangSetting, useT, type I18nKey, type LangSetting } from "@/i18n";
import type { Project } from "@/lib/bindings";
import type { ColorTheme, Theme } from "@/lib/settings";

import "./welcome.css";

/** 묻는 단계 셋. `ready` 는 프로젝트를 실제로 들여왔을 때만 서는 마무리 판이다. */
const STEPS = ["lang", "look", "project"] as const;
type Step = (typeof STEPS)[number] | "ready";

const STEP_LABEL: Record<(typeof STEPS)[number], I18nKey> = {
  lang: "welcome.step.lang",
  look: "welcome.step.look",
  project: "welcome.step.project",
};

const LANGS: Array<{ id: LangSetting; labelKey: I18nKey }> = [
  { id: "system", labelKey: "settings.language.system" },
  { id: "ko", labelKey: "settings.language.ko" },
  { id: "en", labelKey: "settings.language.en" },
];

const THEMES: Array<{ id: Theme; labelKey: I18nKey; Icon: typeof Sun }> = [
  { id: "light", labelKey: "welcome.look.light", Icon: Sun },
  { id: "dark", labelKey: "welcome.look.dark", Icon: Moon },
  { id: "system", labelKey: "welcome.look.system", Icon: Monitor },
];

export interface WelcomeWizardProps {
  /** 폴더를 골라 프로젝트로 등록한다. 사용자가 취소하면 `null`. */
  onPickFolder: () => Promise<Project | null>;
  /** 새 프로젝트(그린필드) 마법사로 넘긴다 — 이 창은 닫힌다. */
  onStartGreenfield: () => void;
  /** 방금 들여온 프로젝트를 이 탭에서 연다. */
  onOpenProject: (p: Project) => void;
  /** 창을 닫는다. `onboarded` 기록은 이 컴포넌트가 이미 마쳤다. */
  onClose: () => void;
}

export function WelcomeWizard({
  onPickFolder,
  onStartGreenfield,
  onOpenProject,
  onClose,
}: WelcomeWizardProps) {
  const { t } = useT();
  const { settings, set } = useSettings();

  const [step, setStep] = useState<Step>("lang");
  /** 폴더 선택 대화상자가 떠 있는 동안 — 버튼을 두 번 누르지 못하게. */
  const [picking, setPicking] = useState(false);
  const [added, setAdded] = useState<Project | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const index = STEPS.indexOf(step as (typeof STEPS)[number]);

  /** 어느 출구로 나가든 한 번만 적는다 (규칙 2). */
  const seal = useCallback(async () => {
    if (!settings.onboarded) await set("onboarded", true);
  }, [settings.onboarded, set]);

  const skip = useCallback(() => {
    void seal().then(onClose);
  }, [seal, onClose]);

  // 창이 열리면 카드로 초점을 옮긴다 — 뒤에 있는 시작 화면의 검색창이 키를
  // 먹지 않게. Esc 는 건너뛰기와 같은 출구다 (규칙 2 가 지켜지므로 안전하다).
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 뒤에 있는 시작 화면은 **document 에 키 리스너를 건다** — 아무 글자나
    // 치면 검색창으로 초점을 옮긴다. 마법사가 떠 있는 동안 그 손이 닿으면
    // 보이지도 않는 입력창이 키를 먹으므로, 여기서 위로 새지 않게 막는다.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      skip();
      return;
    }
    // Enter 는 "다음" 이다 — 마지막 두 판(project·ready)에는 명시적 선택이
    // 필요하므로 넘기지 않는다.
    if (e.key === "Enter" && (step === "lang" || step === "look")) {
      e.preventDefault();
      setStep(step === "lang" ? "look" : "project");
    }
  };

  const pickLang = (next: LangSetting) => {
    void set("language", next);
    // AI 작성 언어를 **여기서만** 함께 맞춘다. 설정 화면에서는 토스트로 물어
    // 보는 축이지만(디스크에 남는 문서의 언어라 되돌리기 어렵다), 첫 실행에는
    // 아직 일지가 한 건도 없어 섞일 이력 자체가 없다 — 그래서 묻지 않고 맞추고,
    // 갈라 쓰고 싶다면 설정 → 모양에서 나눌 수 있다고 아래 줄에 적어 둔다.
    void set("contentLanguage", next);
  };

  const pickFolder = async () => {
    setPicking(true);
    try {
      const project = await onPickFolder();
      if (!project) return;
      setAdded(project);
      setStep("ready");
    } finally {
      setPicking(false);
    }
  };

  const startGreenfield = () => {
    void seal().then(() => {
      onClose();
      onStartGreenfield();
    });
  };

  const openAdded = () => {
    if (!added) return;
    void seal().then(() => {
      onClose();
      onOpenProject(added);
    });
  };

  return (
    <div className="wz-scrim" role="dialog" aria-modal="true" aria-label={t("welcome.aria")}>
      {/* 창을 끌 자리 — 마법사가 탭 줄을 덮으므로 여기서 다시 내준다. */}
      <div className="wz-drag" data-tauri-drag-region aria-hidden="true" />

      <div className="wz-card" ref={cardRef} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="wz-head">
          <span className="wz-brand">
            <OculIcon size={20} />
            Ocul-PM
          </span>
          <ol className="wz-dots" aria-hidden="true">
            {STEPS.map((s, i) => (
              <li key={s} className={"wz-dot" + (i === index ? " on" : i < index ? " done" : "")}>
                <span className="wz-dot-mark">{i < index ? <Check size={11} /> : i + 1}</span>
                <span className="wz-dot-label">{t(STEP_LABEL[s])}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className="wz-body">
          {step === "lang" && (
            <section className="wz-panel">
              <h1 className="wz-title">{t("welcome.lang.title")}</h1>
              <p className="wz-sub">{t("welcome.lang.sub")}</p>
              <div className="wz-choices" role="radiogroup" aria-label={t("welcome.step.lang")}>
                {LANGS.map((o) => {
                  const on = normalizeLangSetting(settings.language) === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={"wz-choice" + (on ? " on" : "")}
                      onClick={() => pickLang(o.id)}
                    >
                      {o.id === "system" ? <Monitor size={18} /> : <Languages size={18} />}
                      <span>{t(o.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="wz-note">{t("welcome.lang.note")}</p>
            </section>
          )}

          {step === "look" && (
            <section className="wz-panel">
              <h1 className="wz-title">{t("welcome.look.title")}</h1>
              <p className="wz-sub">{t("welcome.look.sub")}</p>

              <p className="wz-label">{t("welcome.look.themeLabel")}</p>
              <div className="wz-choices" role="radiogroup" aria-label={t("welcome.look.themeLabel")}>
                {THEMES.map(({ id, labelKey, Icon }) => {
                  const on = settings.theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={"wz-choice" + (on ? " on" : "")}
                      onClick={() => void set("theme", id)}
                    >
                      <Icon size={18} />
                      <span>{t(labelKey)}</span>
                    </button>
                  );
                })}
              </div>

              <p className="wz-label">{t("welcome.look.accentLabel")}</p>
              <div className="wz-accents" role="radiogroup" aria-label={t("welcome.look.accentLabel")}>
                {ACCENTS.map((a) => {
                  const on = settings.colorTheme === (a.id as ColorTheme);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={t(a.labelKey)}
                      title={t(a.labelKey)}
                      className={"wz-accent" + (on ? " on" : "")}
                      style={{ background: a.color }}
                      onClick={() => void set("colorTheme", a.id)}
                    />
                  );
                })}
              </div>
              <p className="wz-note">{t("welcome.look.note")}</p>
            </section>
          )}

          {step === "project" && (
            <section className="wz-panel">
              <h1 className="wz-title">{t("welcome.project.title")}</h1>
              <p className="wz-sub">{t("welcome.project.sub")}</p>
              <div className="wz-cards">
                <button
                  type="button"
                  className="wz-bigcard"
                  onClick={() => void pickFolder()}
                  disabled={picking}
                >
                  <FolderOpen size={22} />
                  <b>{picking ? t("welcome.project.working") : t("welcome.project.open")}</b>
                  <span>{t("welcome.project.openDesc")}</span>
                </button>
                <button type="button" className="wz-bigcard" onClick={startGreenfield}>
                  <FolderPlus size={22} />
                  <b>{t("welcome.project.new")}</b>
                  <span>{t("welcome.project.newDesc")}</span>
                </button>
              </div>
              <p className="wz-note">{t("welcome.project.note")}</p>
            </section>
          )}

          {/* 마무리 판은 **아직 일어나지 않은 일**을 말하지 않는다 (v3-surface
              {#wizard-tense}). 이 시점에 실제로 벌어진 것은 둘뿐이다: DB 행
              하나(`create_project`)와 방금 시작된 코드 색인(`index_project`).
              `.oculpm/` 과 AGENTS.md 는 **프로젝트를 열 때** 생긴다
              (`ProjectTab` 의 `oculpmInit`) — 그래서 목록은 체크(✓ 끝났다)가
              아니라 화살표(→ 열면 이렇게 된다)를 단다. */}
          {step === "ready" && added && (
            <section className="wz-panel">
              <h1 className="wz-title">{t("welcome.ready.title", { name: added.name })}</h1>
              <p className="wz-sub">{t("welcome.ready.sub")}</p>
              <p className="wz-label">{t("welcome.ready.listLabel")}</p>
              <ul className="wz-list">
                <li>
                  <ArrowRight size={13} />
                  <span>{t("welcome.ready.li1")}</span>
                </li>
                <li>
                  <ArrowRight size={13} />
                  <span>{t("welcome.ready.li2")}</span>
                </li>
                <li>
                  <ArrowRight size={13} />
                  <span>{t("welcome.ready.li3")}</span>
                </li>
              </ul>
              <p className="wz-note">{t("welcome.ready.note")}</p>
            </section>
          )}
        </div>

        <footer className="wz-foot">
          <button type="button" className="wz-ghost" onClick={skip}>
            {step === "ready" ? t("welcome.later") : t("welcome.skip")}
          </button>
          <div className="wz-foot-right">
            {index > 0 && (
              <button
                type="button"
                className="wz-ghost"
                onClick={() => setStep(STEPS[index - 1])}
              >
                <ArrowLeft size={14} />
                {t("welcome.back")}
              </button>
            )}
            {index >= 0 && index < STEPS.length - 1 && (
              <button
                type="button"
                className="wz-primary"
                onClick={() => setStep(STEPS[index + 1])}
              >
                {t("welcome.next")}
                <ArrowRight size={14} />
              </button>
            )}
            {step === "ready" && (
              <button type="button" className="wz-primary" onClick={openAdded}>
                {t("welcome.ready.open")}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default WelcomeWizard;
