/**
 * BMC 벤더 판별 — The.DVC `server/src/idrac/vendorMatch.js`(기준 커밋 d75a13c) 를 그대로 옮겼다.
 * The.DVC 가 이 장비를 무엇으로 볼지 재현하는 것이 목적이라 판정식을 바꾸지 않는다(바꾸면 비교가 무의미해진다).
 */
const OEM_KEYS = [
  ['dell', /^dell$/i], ['hpe', /^hpe?$/i], ['lenovo', /^lenovo$/i], ['supermicro', /^supermicro$/i],
  ['cisco', /^cisco$/i], ['fujitsu', /^(ts_)?fujitsu$/i], ['inspur', /^inspur$/i], ['huawei', /^huawei$/i],
  ['ami', /^ami$/i], ['intel', /^intel(_rackscale)?$/i],
];
const NAME_RULES = [
  ['dell', /\bdell\b/i], ['hpe', /\b(hpe|hewlett[\s-]?packard|hp)\b/i], ['lenovo', /\blenovo\b/i],
  ['supermicro', /\bsuper\s?micro\b/i], ['cisco', /\bcisco\b/i], ['fujitsu', /\bfujitsu\b/i],
  ['inspur', /\binspur\b/i], ['huawei', /\bhuawei\b/i], ['ami', /\b(ami|american megatrends)\b/i], ['intel', /\bintel\b/i],
];
const PRODUCT_RULES = [
  ['dell', /idrac|integrated (dell )?remote access/i],
  ['hpe', /\bilo\b|integrated lights[\s-]?out/i],
  ['lenovo', /\bxcc\b|xclarity/i],
  ['cisco', /\bcimc\b|integrated management controller/i],
  ['fujitsu', /\birmc\b/i],
  ['supermicro', /supermicro/i],
];
export const VENDOR_LABEL = {
  dell: 'Dell', hpe: 'HPE', lenovo: 'Lenovo', supermicro: 'Supermicro', cisco: 'Cisco', fujitsu: 'Fujitsu',
  inspur: 'Inspur', huawei: 'Huawei', ami: 'AMI(범용 BMC)', intel: 'Intel', unknown: '벤더 미확인',
};

const str = (v) => (v == null ? '' : String(v));

export function isRedfishRoot(root) {
  if (!root || typeof root !== 'object') return false;
  if (str(root.RedfishVersion)) return true;
  if (str(root['@odata.id']).startsWith('/redfish/v1')) return true;
  if (root.Links && typeof root.Links === 'object' && root.Links.Sessions) return true;
  return false;
}

function matchTable(table, text) {
  const t = str(text);
  if (!t) return null;
  for (const [vendor, re] of table) if (re.test(t)) return vendor;
  return null;
}

/** { redfish, vendor, label, evidence, product } — The.DVC classifyBmcVendor 와 같은 결과. */
export function classifyBmcVendor({ root, manufacturer, model } = {}) {
  const redfish = isRedfishRoot(root);
  const product = str(root?.Product);
  let vendor = null; let evidence = '';
  const oemKeys = root?.Oem && typeof root.Oem === 'object' ? Object.keys(root.Oem) : [];
  for (const k of oemKeys) { const v = matchTable(OEM_KEYS, k); if (v) { vendor = v; evidence = `oem:${k}`; break; } }
  if (!vendor) { const v = matchTable(NAME_RULES, root?.Vendor); if (v) { vendor = v; evidence = `vendor:${str(root.Vendor)}`; } }
  if (!vendor) { const v = matchTable(NAME_RULES, manufacturer); if (v) { vendor = v; evidence = `manufacturer:${str(manufacturer)}`; } }
  if (!vendor) { const v = matchTable(NAME_RULES, product) || matchTable(PRODUCT_RULES, product); if (v) { vendor = v; evidence = `product:${product}`; } }
  if (!vendor) {
    const sig = JSON.stringify(root || {}).toLowerCase() + ' ' + str(model).toLowerCase();
    if (sig.includes('idrac') || sig.includes('dell')) { vendor = 'dell'; evidence = 'signature'; }
  }
  if (!vendor) vendor = 'unknown';
  return { redfish, vendor, label: VENDOR_LABEL[vendor] || vendor, evidence, product };
}

/**
 * The.DVC 스캔(idrac/scan.js:59-69·191)이 이 벤더를 어떻게 처리하는가.
 * dell → 등록·수집, hpe → iLO 계정이 있으면 등록, 그 밖의 Redfish → unsupported(등록 안 함).
 */
export function dvcScanOutcome(vendor) {
  if (vendor === 'dell') return { registered: true, label: 'Dell 로 등록·수집' };
  if (vendor === 'hpe') return { registered: true, label: 'HPE(iLO 계정 있을 때) 등록·수집' };
  return { registered: false, label: `미지원 서버(unsupported)로 분류 — 등록·수집하지 않음` };
}
