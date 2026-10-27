/**
 * 저장·화면용 비밀 가림. BMC 응답에도 비밀 필드가 실릴 수 있다(AccountService 의 Password 는 보통 null 이지만
 * SNMP community·SMTP 비밀번호·인증서 개인키 같은 Oem 필드가 있을 수 있다). 키 이름으로 판정한다.
 */
const SECRET_KEY = /pass(word|phrase)?$|^pass|password|secret|token|community|private\s*key|privkey|authkey|auth[_-]?key|encryption\s*key|credential/i;
const KEEP_KEY = /^(passwordchangerequired|passwordexpiration|passwordpolicy|minpasswordlength|maxpasswordlength|passwordlength|tokenexpir)/i;

export const MASK = '***';

/** 'scheme://user:pass@host' 꼴 URL 의 비밀번호 — VirtualMedia Image·이벤트 구독 Destination 같은 필드에 실릴 수 있다. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]{0,15}:\/\/[^/\s:@]{0,128}:)[^@\s/]{1,256}@/gi;
export function maskUrlCredentials(s) { return String(s).replace(URL_USERINFO, `$1${MASK}@`); }

/** 깊은 복사하며 비밀 키의 값을 가린다(null·빈 문자열은 그대로 — '없음' 을 지우지 않는다). URL 속 비밀번호도 가린다. */
export function maskSecrets(value, depth = 0) {
  if (depth > 64) return null;
  if (typeof value === 'string') return value.includes('@') ? maskUrlCredentials(value) : value;
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && !KEEP_KEY.test(k) && v != null && v !== '' && typeof v !== 'boolean' && typeof v !== 'object') {
        out[k] = MASK;
      } else {
        out[k] = maskSecrets(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** 문자열에서 주어진 비밀 값을 지운다(로그·오류 문구에 비밀번호가 섞이지 않게). */
export function scrub(text, secrets = []) {
  let s = String(text ?? '');
  for (const sec of secrets) {
    if (sec && String(sec).length >= 3) s = s.split(String(sec)).join(MASK);
  }
  return s;
}
