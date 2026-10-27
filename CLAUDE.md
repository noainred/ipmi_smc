# CLAUDE.md

Supermicro BMC(Redfish + IPMI) 수집 호환성 PoC — The.DVC(noainred/The.DVC)의 Dell iDRAC 수집과 같은 항목을 읽어 비교한다. 사용법은 `README.md`.

- **응답·문서·주석은 한국어**, 사용자에게는 존댓말. 근거 있는 사실만 — Supermicro 동작에 대한 말은 실장비 결과가 없으면 '추정' 이라고 쓴다.
- **읽기 전용을 깨지 말 것**: Redfish 는 `BmcClient._assertAllowed`(GET + 세션 POST/내 세션 DELETE), IPMI 는 `assertReadOnly`·`COMMANDS` 화이트리스트.
  새 명령·경로를 넣을 때 화이트리스트를 넓히지 말고 읽기 자원인지 먼저 본다. 401 확정 뒤 재시도 금지(계정 잠금).
- **비밀**: 비밀번호는 `data/servers.json`(600)에만. API·결과·원본 덤프·로그에 싣지 않는다(`publicView`·`maskSecrets`·`scrub`). 주소가 바뀌면 비밀번호 승계 금지.
- **화면**: BMC 응답은 신뢰하지 않는 입력 — `web/app.js` 는 `h()`(textContent)만, innerHTML 금지. CSP 가 인라인 style 속성을 막으니 `el.style.x` 로.
- **The.DVC 판정식 사본**(`src/dvc/rules.js`)은 원본을 고치지 않고 옮긴다(기준 커밋 `src/version.js DVC_BASE_COMMIT`). 다시 옮기면 둘 다 갱신.
- 목 서버(`mock/fixtures.js`)·가짜 ipmitool(`test/fixtures/fake-ipmitool.cjs`)은 **합성** — 실장비 근거로 쓰지 말 것.
- 검증: `npm test`(node:test). 화면을 바꾸면 목 서버 + `node app.js` 를 Chromium 1440/400 으로 확인.
- 의존성 0 을 유지한다(맥에서 `node app.js` 만으로 실행되어야 한다 — Node 20.6+).
