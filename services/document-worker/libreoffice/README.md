# LibreOffice 렌더 엔진 패치

이 디렉터리는 PPTX를 화면 비교와 자체 검증에 쓰는 headless LibreOffice 엔진을 관리한다. 브라우저에서 사람이 편집하는 Collabora 엔진은 [`../../office-editor/libreoffice`](../../office-editor/libreoffice)에서 별도로 관리한다. 두 엔진은 같은 LibreOffice 계열이지만 릴리스와 ABI가 다르므로 바이너리나 패치를 서로 복사하지 않는다.

## 단일 정본

[`upstream.json`](./upstream.json)에 다음을 한 번만 고정한다.

- 공식 설치 바이너리 버전·다운로드 URL·SHA-256
- 공식 소스 버전·tag·commit·tarball URL·SHA-256
- 순서가 있는 patch series와 patch level
- 빌드할 라이브러리, 필수 upstream C++ 시험, 런타임 marker
- 결과 artifact 이름

GCS bucket과 cache 위치는 비공개 운영 설정이고 이 공개 가능한 엔진 계약에 넣지 않는다. [`write-build-env.mjs`](./write-build-env.mjs)가 배포 시 받은 build-asset root와 위 manifest를 결합한다. Cloud Build, document-worker 이미지와 시험이 이 결과를 소비하므로 버전 문자열을 각 파일에 수동 복제하지 않는다.

현재 공식 최신 stable 26.8.0과 고정 기준이 같다. “최신”은 자동 배포 신호가 아니다. 읽기 전용 확인은 다음과 같이 실행한다.

```sh
node services/document-worker/libreoffice/audit-upgrade.mjs
```

새 소스가 보이면 공식 tarball을 받아 SHA와 patch 적용을 함께 확인한다.

```sh
node services/document-worker/libreoffice/audit-upgrade.mjs --download
```

이미 검증용 소스를 풀어 둔 경우 288MB를 다시 받지 않는다.

```sh
node services/document-worker/libreoffice/audit-upgrade.mjs \
  --version 26.8.0.3 \
  --source /absolute/path/to/libreoffice-26.8.0.3
```

## 패치 설계 규칙

1. PPTX import 의미 전달, 문서 단위 호환, 글꼴 fallback처럼 책임이 다른 변경은 patch를 나눈다.
2. slide 번호·font 이름·좌표·특정 corpus ID를 조건으로 삼지 않는다.
3. 포맷 의미는 `oox`, PPTX 전용 동작은 Impress 문서 호환 플래그, 일반 glyph 검색은 `vcl`의 기존 확장점에서 고친다.
4. 화면만 맞추기 위한 OOXML 보정은 원본이 아니라 렌더 복사본에 한정하며 구조·시각 회귀를 모두 측정한다.
5. patch는 항상 `--batch --fuzz=0`으로 적용한다. 충돌을 큰 context 완화나 `--forward`로 숨기지 않는다.
6. upstream이 같은 문제를 해결했다면 우리 patch를 재적용하지 말고, 반례 시험으로 동등성을 확인한 뒤 제거한다.
7. 일반화 가능한 수정은 upstream에 제안하되, 반영·release 전까지는 고정 patch와 시험을 유지한다.

## 승격 관문

신버전은 다음을 순서대로 모두 통과한 경우에만 `upstream.json`의 기준으로 승격한다.

1. 공식 서명 대상 tarball의 URL·SHA와 Git tag의 peeled commit 일치
2. patch series 무충돌 적용과 `git diff --check`
3. `Library_merged`, `Library_sd` 빌드와 manifest의 필수 C++ 시험
4. artifact 내부 라이브러리 SHA, patch 사본, source commit, runtime marker 확인
5. 국소 반례 → 공개 118장 → 실전 503장 구조·윤곽·RMSE 비교
6. PPTX 저장·재개방, PowerPoint 기준 화면과 P0/P1 사람 판정
7. 이전 승인 image digest를 유지한 canary와 즉시 rollback

새 버전이 더 최신이라는 이유만으로 기존 승인 엔진을 덮어쓰지 않는다. 후보가 134장을 악화시켰던 과거 결과처럼, 상류 개선과 PowerPoint 충실도는 같은 명제가 아니다.
