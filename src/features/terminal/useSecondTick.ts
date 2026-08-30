// 1초 시계는 앱 전역 하나로 합쳤다 (완성도 라운드 Phase 3) — 여기 있던
// 컴포넌트별 인터벌은 `@/hooks/useSecondTick` 의 공유 시계가 대신한다. 기존
// import 경로를 위해 다시 내보낸다.
export { useSecondTick } from "@/hooks/useSecondTick";
