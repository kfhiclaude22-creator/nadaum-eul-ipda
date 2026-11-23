import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const FKEY = 'nadaum_files';

function checkAuth(req) {
  const key = req.headers['x-admin-key'];
  return Boolean(key) && Boolean(process.env.ADMIN_PASSWORD) && key === process.env.ADMIN_PASSWORD;
}

// 관리자용: 현금 지급 증빙 서류 내려받기
export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, message: '비밀번호가 올바르지 않습니다.' });

  const email = String(req.query.email || '').trim().toLowerCase();
  const track = String(req.query.track || '');
  const kind = String(req.query.kind || '');
  if (!email || !['under', 'diaper'].includes(track) || !['biz', 'bank'].includes(kind)) {
    return res.status(400).json({ ok: false, message: '잘못된 요청입니다.' });
  }

  try {
    const raw = await redis.hget(FKEY, `${email}|${track}|${kind}`);
    if (!raw) return res.status(404).json({ ok: false, message: '파일이 없습니다.' });
    const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const buf = Buffer.from(f.data, 'base64');

    res.setHeader('Content-Type', f.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('admin-file error', err);
    return res.status(500).json({ ok: false, message: '파일을 불러오지 못했습니다.' });
  }
}
