import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const HKEY = 'nadaum_applications';

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: '허용되지 않은 요청입니다.' });
  }

  const email = String(req.query.email || '').trim().toLowerCase();
  const phone = String(req.query.phone || '').trim();
  if (!email || !phone) {
    return res.status(400).json({ ok: false, message: '이메일과 연락처를 모두 입력해 주세요.' });
  }

  try {
    const raw = await redis.hget(HKEY, email);
    if (!raw) return res.status(404).json({ ok: false, message: '일치하는 제출 내역을 찾지 못했습니다.' });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (digitsOnly(data.phone) !== digitsOnly(phone)) {
      return res.status(404).json({ ok: false, message: '이메일과 연락처가 일치하는 제출 내역을 찾지 못했습니다.' });
    }
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('lookup error', err);
    return res.status(500).json({ ok: false, message: '조회 중 오류가 발생했습니다.' });
  }
}
