/**
 * ipmitool 출력 파서(순수). 출력 형식은 ipmitool 1.8.18~1.8.19 기준이며, 장비·버전에 따라 열이 다를 수 있어
 * 못 읽는 줄은 버리지 않고 `raw` 에 남긴다(화면이 원문을 같이 보여 준다).
 */

const clip = (s, n = 200) => String(s ?? '').slice(0, n);

/** 'Key : Value' 형식 → 객체. 같은 키가 다시 나오면 배열로 모은다. 들여쓴 이어지는 줄은 앞 키에 붙인다. */
export function parseKeyValue(text) {
  const out = {};
  let last = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^\s*([^:]{1,80}?)\s*:\s?(.*)$/.exec(line);
    if (m && m[1].trim()) {
      const k = m[1].trim();
      const v = clip(m[2].trim(), 400);
      if (k in out) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
      else out[k] = v;
      last = k;
    } else if (last) {
      const extra = line.trim();
      const cur = out[last];
      out[last] = Array.isArray(cur) ? [...cur, extra] : (cur ? [cur, extra] : extra);
    }
  }
  return out;
}

/** `mc info` → 주요 필드. */
export function parseMcInfo(text) {
  const kv = parseKeyValue(text);
  const g = (k) => (Array.isArray(kv[k]) ? kv[k][0] : kv[k]) || '';
  return {
    deviceId: g('Device ID'), firmwareRevision: g('Firmware Revision'), ipmiVersion: g('IPMI Version'),
    manufacturerId: g('Manufacturer ID'), manufacturerName: g('Manufacturer Name'), productId: g('Product ID'), productName: g('Product Name'),
    deviceAvailable: g('Device Available'), raw: kv,
  };
}

/** `fru print` → [{ device, fields }]. 장치 블록은 'FRU Device Description' 으로 시작한다. */
export function parseFru(text) {
  const devices = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([^:]{1,80}?)\s*:\s?(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].trim();
    const v = clip(m[2].trim(), 200);
    if (/^FRU Device Description$/i.test(k)) { cur = { device: v, fields: {} }; devices.push(cur); continue; }
    if (!cur) { cur = { device: '(이름 없음)', fields: {} }; devices.push(cur); }
    if (!(k in cur.fields)) cur.fields[k] = v;
  }
  return devices;
}

/** FRU 에서 시리얼 후보를 뽑는다(Redfish SerialNumber 와 대조용). */
export function fruSerials(devices) {
  const out = {};
  for (const d of devices || []) {
    for (const k of ['Product Serial', 'Board Serial', 'Chassis Serial', 'Product Part Number', 'Board Part Number', 'Product Name', 'Board Product', 'Board Mfg', 'Product Manufacturer']) {
      if (d.fields[k] && !out[k]) out[k] = d.fields[k];
    }
  }
  return out;
}

/** 'CPU1 Temp | 30h | ok | 3.1 | 48 degrees C' → 센서 레코드. */
export function parseSdrElist(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 5) continue;
    const [name, id, status, entity, reading] = parts;
    const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(reading);
    rows.push({
      name: clip(name, 80), id, status, entity,
      reading: clip(reading, 80), value: m ? Number(m[1]) : null,
      unit: m ? m[2].replace(/^degrees\s*/i, '°').trim() : '',
    });
  }
  return rows;
}

/** 'sel elist' → [{ id, date, time, sensor, event, direction }]. */
export function parseSelElist(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 4) continue;
    rows.push({ id: parts[0], date: parts[1] || '', time: parts[2] || '', sensor: clip(parts[3], 120), event: clip(parts[4] || '', 160), direction: parts[5] || '' });
  }
  return rows;
}

/** `dcmi power reading` → { instantW, minW, maxW, avgW, state }. */
export function parseDcmiPower(text) {
  const kv = parseKeyValue(text);
  const w = (k) => { const v = String(kv[k] || ''); const m = /(-?\d+(?:\.\d+)?)/.exec(v); return m ? Number(m[1]) : null; };
  return {
    instantW: w('Instantaneous power reading'), minW: w('Minimum during sampling period'), maxW: w('Maximum during sampling period'),
    avgW: w('Average power reading over sample period'), state: String(kv['Power reading state is'] || '').trim(), raw: kv,
  };
}

/** `user list` 표 → [{ id, name, callin, linkAuth, ipmiMsg, priv }]. */
export function parseUserList(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\S*)\s+(true|false)\s+(true|false)\s+(true|false)\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ id: m[1], name: m[2], callin: m[3], linkAuth: m[4], ipmiMsg: m[5], priv: m[6] });
  }
  return rows;
}

/** 첫 명령 실패 사유 판정 — 인증 거부·암호 묶음 불일치·도달 불가. */
export function classifyIpmiError(stderr) {
  const s = String(stderr || '');
  if (/no matching cipher suite|invalid cipher suite|unsupported cipher|cipher suite .* not supported/i.test(s)) return 'cipher';
  if (/RAKP 2 HMAC is invalid|RAKP 2 message indicates an error|unauthorized name|invalid user name|password|Activate Session error|insufficient privilege/i.test(s)) return 'auth';
  if (/Unable to establish IPMI v2|Error: Unable to establish|no response|timeout|Get Auth Capabilities error|Get Channel Cipher Suites/i.test(s)) return 'unreachable';
  return 'error';
}
