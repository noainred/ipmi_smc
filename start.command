#!/bin/bash
# macOS 더블클릭 실행 — 이 폴더에서 PoC 웹 화면을 띄우고 브라우저를 연다.
# Finder 에서 연 터미널은 PATH 에 Homebrew 경로가 없을 수 있어 직접 더한다(Apple Silicon: /opt/homebrew).
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 없습니다. https://nodejs.org 에서 LTS(22)를 설치하거나: brew install node@22"
  read -r -p "Enter 를 누르면 닫습니다" _
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) 은 너무 오래되었습니다 — 20 이상(권장 22 LTS)이 필요합니다."
  read -r -p "Enter 를 누르면 닫습니다" _
  exit 1
fi
if ! command -v ipmitool >/dev/null 2>&1; then
  echo "참고: ipmitool 이 없어 IPMI 단계는 건너뜁니다(설치: brew install ipmitool)."
fi
exec node app.js
