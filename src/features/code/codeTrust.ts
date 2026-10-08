// 코드 실행 신뢰 키 — 백엔드 `crate::trust::key` 와 같은 모양이어야 한다.
//
// 이 기기에서 프로젝트를 신뢰하기 전엔 언어 서버를 띄우지 않는다: 언어 서버는
// 파일을 여는 것만으로 저장소의 빌드 스크립트·툴체인 설정을 실행한다. 값은 SQLite
// `settings` 에만 있고, 선언적 설정 문서는 이 키를 쓰지 못한다.
export const codeTrustKey = (projectId: number) => `code_trust.${projectId}`;
