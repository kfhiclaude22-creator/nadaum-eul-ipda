import { buildRows } from './admin-list.js';

function checkAuth(req) {
  const key = req.headers['x-admin-key'];
  return Boolean(key) && Boolean(process.env.ADMIN_PASSWORD) && key === process.env.ADMIN_PASSWORD;
}

function q(s) {
  return '"' + String(s ?? '').replace(/"/g, '""') + '"';
}

export default async function handler(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ ok: false, message: '비밀번호가 올바르지 않습니다.' });

  try {
    const { rows } = await buildRows();
    const head = ['유형', '기관명', '기관유형', '지역', '담당자', '연락처', '이메일', '인원/가구', '상반기지원', '연령·월령 구성', '주 사용 언어', '기저귀 소요액 의견', '지급방식', '신청사유', '접수일시'];
    const lines = rows.map(([k, d]) => [
      k, d.org, d.orgType, d.region, d.manager, d.phone, d.email,
      k === '속옷' ? d.count : d.households,
      d.prev || '',
      d.ages ? `8~13:${d.ages.a8_13} 14~18:${d.ages.a14_18} 19~24:${d.ages.a19_24}` : (d.months ? `0~11:${d.months.m0_11} 12~23:${d.months.m12_23} 24~35:${d.months.m24_35}` : ''),
      d.langs || '', d.diaperCost || '', d.pay, d.reason, d.submittedAt,
    ].map(q).join(','));

    const csv = '\ufeff' + [head.map(q).join(',')].concat(lines).join('\r\n');
    const filename = encodeURIComponent('나다움을입다_접수현황.csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nadaum_applications.csv"; filename*=UTF-8''${filename}`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('admin-csv error', err);
    return res.status(500).json({ ok: false, message: 'CSV를 만들지 못했습니다.' });
  }
}
