import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const HKEY = 'nadaum_applications';

function checkAuth(req) {
  const key = req.headers['x-admin-key'];
  return Boolean(key) && Boolean(process.env.ADMIN_PASSWORD) && key === process.env.ADMIN_PASSWORD;
}

export async function buildRows() {
  const all = (await redis.hgetall(HKEY)) || {};
  const rows = [];
  let under = 0, diaper = 0;

  for (const raw of Object.values(all)) {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const base = { org: d.org, orgType: d.orgType, region: d.region, manager: d.manager, phone: d.phone, email: d.email };
    const key = String(d.email || '').trim().toLowerCase(); // 첨부파일 조회용
    if (d.under) { under += d.under.count || 0; rows.push(['속옷', Object.assign({}, base, d.under, { key, track: 'under' })]); }
    if (d.diaper) { diaper += d.diaper.households || 0; rows.push(['기저귀', Object.assign({}, base, d.diaper, { key, track: 'diaper' })]); }
  }
  rows.sort((a, b) => (b[1].submittedAt || '').localeCompare(a[1].submittedAt || ''));
  return { under, diaper, rows };
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, message: '비밀번호가 올바르지 않습니다.' });

  try {
    const { under, diaper, rows } = await buildRows();
    return res.status(200).json({ ok: true, under, diaper, rows });
  } catch (err) {
    console.error('admin-list error', err);
    return res.status(500).json({ ok: false, message: '현황을 불러오지 못했습니다.' });
  }
}
