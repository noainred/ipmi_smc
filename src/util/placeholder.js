/**
 * 자리표시 문자열 판정 — 보드 제조사가 채우지 않은 SMBIOS 기본값.
 *
 * The.DVC 는 Dell 이 아니면 `SKU` 를 서비스태그로 먼저 쓴다(redfish.js:374 systemServiceTag). Supermicro 보드는
 * SKU·시리얼에 'To be filled by O.E.M.' 같은 기본 문자열이 남는 경우가 있다고 알려져 있다(⚠ 이 PoC 를 실장비에
 * 돌리기 전에는 추정). 그 값이 서비스태그가 되면 서로 다른 서버가 같은 장비로 합쳐진다 — 그래서 따로 판정한다.
 */
const PATTERNS = [
  /^to\s*be\s*filled\s*by\s*o\.?\s*e\.?\s*m\.?$/i,
  /^default\s*string$/i,
  /^not\s*(specified|available|applicable|set)$/i,
  /^system\s*(serial\s*number|sku\s*number|product\s*name|version)$/i,
  /^(chassis|board|product)\s*serial(\s*number)?$/i,
  /^sku\s*number$/i,
  /^(none|null|n\/?a|unknown|empty|invalid|default|tbd|oem|o\.e\.m\.?)$/i,
  /^0+$/,
  /^f+$/i,
  /^x+$/i,
  /^[.\-_* ]+$/,
  /^(0123456789|1234567890|123456789|12345678)$/,
];

/** 비었거나 자리표시면 true. */
export function isPlaceholder(v) {
  const s = String(v ?? '').trim();
  if (!s) return true;
  return PATTERNS.some((re) => re.test(s));
}

/**
 * 여러 서버의 같은 필드 값이 겹치는지 — 자리표시가 아니어도 같은 값이면 The.DVC 가 한 장비로 합친다.
 * @param {{id:string, value:string}[]} items
 * @returns {Map<string, string[]>} 값 → 그 값을 가진 id 목록(2개 이상인 것만)
 */
export function collisions(items) {
  const by = new Map();   // 소문자 키 → { value: 처음 본 원문, ids }
  for (const { id, value } of items || []) {
    const v = String(value ?? '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!by.has(k)) by.set(k, { value: v, ids: [] });
    by.get(k).ids.push(id);
  }
  return new Map([...by.values()].filter((x) => x.ids.length > 1).map((x) => [x.value, x.ids]));
}
