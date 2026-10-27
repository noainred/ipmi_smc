# Supermicro BMC ↔ The.DVC 수집 호환성 검토

> 기준: The.DVC 커밋 `d75a13c`(파일:줄은 그 커밋). **'확인' 과 '추정' 을 구분해 적는다** — 이 문서를 쓴 시점에는 실제 Supermicro 응답을 본 적이 없다.
> 이 PoC 를 현장 장비에 돌린 결과(화면의 'The.DVC 수정 지점' 탭)가 아래 '예상' 칸을 확정하거나 반증한다.

## 1. The.DVC 가 BMC 에서 읽는 경로(코드 확인)

- BMC 에 HTTP 를 보내는 파일은 `server/src/idrac/redfish.js` 하나다. 그 밖에 BMC 에 닿는 경로는
  ① `bmusage/collectors/idracEnterprise.js` 의 **SSH racadm**(Dell 전용) ② `idrac/ome.js` 의 **Dell OpenManage Enterprise** REST(Dell 관리 콘솔) 둘이다.
- 전력·Thermal·Systems 수집 폴러는 벤더를 보지 않는다 — 표준 Redfish 라서 HPE iLO 도 같은 경로로 돈다(HPE 선례: v2.495 → v2.610 → v2.611).
- 스캔은 무인증 서비스 루트로 벤더를 먼저 가른다(`idrac/vendorMatch.js` — **supermicro 항목이 이미 있다**). 그러나 등록 단계의 벤더 값은
  `dell`/`hpe` 둘뿐이라(`registry.js:503 normVendor`) Supermicro 는 **unsupported 로만 분류되고 등록·수집되지 않는다**(`idrac/scan.js:59-69,191`).

## 2. Dell 가정 13개 — PoC 가 응답에 그대로 적용해 판정

| # | 위치(The.DVC) | Dell 가정 | Supermicro 에서 예상되는 문제(**추정**) | 이식 시 수정안 |
|---|---|---|---|---|
| 1 | `idrac/scan.js:59-69,191` · `registry.js:503` | 벤더 = dell / hpe | unsupported 로 분류 — 등록·폴링 안 됨(**코드 확인**) | 벤더 열거에 supermicro, 계정 세트 분리(iLO 선례) |
| 2 | `idrac/redfish.js:374 systemServiceTag` | 비-HPE 는 SKU 우선 | SKU 가 'To be filled by O.E.M.' 같은 자리표시면 서버들이 한 장비 키로 합쳐짐 | Supermicro 는 SerialNumber 우선 + 자리표시 거부 |
| 3 | `idrac/redfish.js:982` | FirmwareInventory id 가 `Installed-` 로 시작 | id 규칙이 다르면 펌웨어 목록 0건 | 벤더별 필터 |
| 4 | `idrac/redfish.js:793` | LogServices `Sel`·`Lclog` 고정 | Supermicro 가이드(X10)는 `Managers/1/LogServices/Log1` — 이벤트 0건 | LogServices 열거 |
| 5 | `redfish.js:1186,1457` · `bmusage/parse/idracTelemetry.js` | TelemetryService `SystemUsage`(Dell Datacenter) | OOB CPU·메모리 사용률 없음 가능 | OS 경로 또는 실제 센서·리포트 이름 매핑 |
| 6 | `redfish.js:930` · `bmusage/license.js` | LicenseService / `Oem/Dell/DellLicenses`, Dell 등급명 | 라이선스 0건 → 텔레메트리 기대 판정 무의미 | Supermicro 라이선스 경로·등급 별도 |
| 7 | `bmusage/targets.js:142,193` | Enterprise 대체(racadm SSH) 제외는 hpe 만 | Dell 로 취급되면 BMC 에 SSH racadm 시도(**코드 확인**) | `vendor === 'dell'` 일 때만 허용 |
| 8 | `redfish.js:436 BIOS_KEYS` · `1004 classifyFw` | Dell BIOS 속성명·iDRAC 펌웨어명 | 주요 키 0개, BMC 펌웨어 '기타' | Supermicro 속성명 표·분류 추가 |
| 9 | `idrac/roomTemp.js:91 classifySensor` | Dell 센서명 | 흡기 센서 이름이 다르면 전산실 온도 빈칸 | 실제 이름으로 정규식 보강 |
| 10 | `idrac/redfish.js:399 fetchPower` | 전 섀시 PowerControl 합산 | 멀티노드(공유 PSU) 이중 합산 가능 | 노드 섀시만 합산 |
| 11 | `idrac/redfish.js:633` | `ipmiVersion:'2.0'` 하드코드 | 값은 같을 수 있음 | 실측값 사용 |
| 12 | `partfault/extract/idrac.js:148` · `idrac/nicPorts.js` | Dell FQDD 키 형식 | 형식만 다름(판정 영향 없음) | 표시 확인 |
| 13 | `redfish.js:391,1116` | 구 Power·Thermal 스키마만 | 신펌웨어가 PowerSubsystem·ThermalSubsystem 만 줄 가능성 | 신 스키마 폴백 |

판정 규칙은 `src/dvc/assumptions.js`, The.DVC 판정식 사본은 `src/dvc/rules.js`. **Dell 기준선 서버로 돌리면 깨짐이 0 이어야** 판정식 자체가 맞다(대조군 — 목 서버로는 0 확인).

## 3. 공개 자료 근거(링크) — 실장비 확인 전

- Supermicro Redfish 페이지: "End-to-end Redfish functionalities are covered under the SFT-DCMS-SINGLE license"(노드당) —
  https://www.supermicro.com/en/solutions/management-software/redfish . **무라이선스에서 어디까지 열리는지는 공개 자료로 확인하지 못했다**.
  → PoC 는 거부 응답의 문구로 '라이선스 추정' 을 표시한다(문구가 없으면 '권한 403').
- Supermicro Redfish Reference Guide(X10, 1.0a): 이벤트 로그 `/redfish/v1/Managers/1/LogServices/Log1/Entries`.
- Thomas-Krenn: SFT-OOB-LIC 는 SFT-DCMS-Single 에 포함 — https://www.thomas-krenn.com/de/wiki/Supermicro_Lizenzen_SFT-OOB-LIC_und_SFT-DCMS-Single
- Supermicro BMC 표: X12/X13 = AST2600, X11 = AST2500 — https://supermicro.com/en/solutions/management-software/bmc-resources

## 4. 현장 실행 뒤 할 일(제안)

1. Supermicro 대상 + Dell 기준선을 같은 날 실행 → HTML 내보내기 + `out/` 압축.
2. 'The.DVC 수정 지점' 의 **깨짐·확인** 항목만 The.DVC 작업 목록으로 옮긴다(미확인은 원인부터).
3. `raw/` 원문을 The.DVC `server/test/` 픽스처로 옮겨, 위 표의 수정안을 테스트로 고정한 뒤 고친다(HPE iLO 를 넣은 v2.610 순서와 같다:
   벤더 판별 → 스캔 등록·계정 세트 → 등록부 vendor → 서비스태그 → 펌웨어·로그·라이선스 → 사용률 대체 → racadm 제외 → 엣지 정제 화이트리스트).
4. 라이선스 추정 항목(스토리지·BIOS 등)은 SFT-DCMS-SINGLE 구매 판단 근거로 쓴다 — 문구가 아닌 실제 라이선스 적용 전후 비교가 확정 근거다.
