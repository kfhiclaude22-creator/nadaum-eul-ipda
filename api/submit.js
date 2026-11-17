import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const HKEY = 'nadaum_applications';

function validate(track, d) {
  if (!d.org) return ['org', '기관명을 입력해 주세요.'];
  if (!d.orgType) return ['orgType', '기관 유형을 선택해 주세요.'];
  if (!d.region) return ['region', '소재지를 선택해 주세요.'];
  if (!d.manager) return ['manager', '담당자 이름을 입력해 주세요.'];
  if (!/^[0-9\-+ ()]{9,}$/.test(d.phone || '')) return ['phone', '담당자 연락처를 확인해 주세요.'];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) return ['email', '이메일 주소 형식을 확인해 주세요.'];
  if (track === 'under') {
    if (!d.count) return ['count', '지원 희망 인원을 1명 이상 입력해 주세요.'];
    if (d.count > 100) return ['count', '한 기관은 100명까지 신청할 수 있습니다.'];
  } else if (track === 'diaper') {
    if (!d.households) return ['households', '추천 가구 수를 1가구 이상 입력해 주세요.'];
    if (d.households > 50) return ['households', '추천은 50가구까지 받습니다.'];
  } else {
    return ['track', '잘못된 요청입니다.'];
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: '허용되지 않은 요청입니다.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const { track, ...d } = body;

  const bad = validate(track, d);
  if (bad) return res.status(400).json({ ok: false, field: bad[0], message: bad[1] });

  const emailKey = String(d.email).trim().toLowerCase();

  try {
    const existingRaw = await redis.hget(HKEY, emailKey);
    const existing = existingRaw ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) : {};
    const now = new Date().toISOString();

    const merged = Object.assign({}, existing, {
      org: d.org,
      orgType: d.orgType,
      region: d.region,
      manager: d.manager,
      phone: d.phone,
      email: d.email,
      updatedAt: now,
    });
    merged[track] = Object.assign({}, d, { submittedAt: now });

    await redis.hset(HKEY, { [emailKey]: JSON.stringify(merged) });
    return res.status(200).json({ ok: true, submittedAt: now });
  } catch (err) {
    console.error('submit error', err);
    return res.status(500).json({ ok: false, message: '서버 오류로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
