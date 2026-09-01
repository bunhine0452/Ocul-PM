/**
 * 첫 실행 마법사를 켤 것인가 — 순수 판정 하나.
 *
 * 컴포넌트에서 떼어 둔 이유는 두 가지다. (1) 마법사 본체는 지연 로드라
 * `StartTab` 이 정적으로 가져올 수 없고, (2) 여기서 틀리면 **이미 쓰고 있던
 * 사용자가 업데이트 직후 안내를 다시 받는다** — 눈으로 확인하기 어려운 회귀라
 * 테스트가 지켜야 한다 (`welcome_wizard.test.tsx`).
 */
export interface WelcomeGateInput {
  /** 이 탭이 화면에 보이는가 (배경 탭에서 조용히 뜨면 안 된다). */
  active: boolean;
  /** 설정을 읽어 왔는가 — 읽기 전 기본값(`onboarded=false`)으로 판정하면 번쩍인다. */
  settingsLoaded: boolean;
  /** 프로젝트 목록 조회가 **성공적으로** 끝났는가. */
  projectsLoaded: boolean;
  /** 첫 실행 마법사를 이미 끝냈거나 건너뛰었는가. */
  onboarded: boolean;
  /** 등록된 프로젝트 수. */
  projectCount: number;
}

export function shouldOpenWelcome(input: WelcomeGateInput): boolean {
  const { active, settingsLoaded, projectsLoaded, onboarded, projectCount } = input;
  if (!active || !settingsLoaded || !projectsLoaded) return false;
  if (onboarded) return false;
  // 프로젝트가 하나라도 있으면 "처음 켠 사람" 이 아니다. `onboarded` 는 이번에
  // 생긴 키라 기존 설치본에서 전부 false 이므로, 이 조건이 유일한 방어다.
  return projectCount === 0;
}
