import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const HKEY = 'nadaum_applications';
const FKEY = 'nadaum_files'; // 현금 지급 증빙 서류 원본 — 관리자만 내려받을 수 있음

const FILE_KINDS = { biz: '사업자등록증(고유번호증)', bank: '통장사본' };
const FIELD_ID = { biz: 'fileBiz', bank: 'fileBank' };
const MAX_FILE_BYTES = 2.5 * 1024 * 1024;

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

// 파일 형식(JPG·PNG·PDF)을 실제 내용으로 확인하고 크기를 제한
function checkFile(kind, f) {
  if (!f || typeof f.data !== 'string' || !f.data) return null;
  const buf = Buffer.from(f.data, 'base64');
  if (!buf.length) return { error: `${FILE_KINDS[kind]} 파일이 비어 있습니다.` };
  if (buf.length > MAX_FILE_BYTES) return { error: `${FILE_KINDS[kind]} 파일이 너무 큽니다. 2.5MB 이하로 올려 주세요.` };

  let type = null;
  if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
  else if (buf.subarray(0, 4).toString('hex') === '89504e47') type = 'image/png';
  else if (buf.subarray(0, 4).toString('latin1') === '%PDF') type = 'application/pdf';
  if (!type) return { error: `${FILE_KINDS[kind]}는 JPG, PNG, PDF 파일만 올릴 수 있습니다.` };

  const name = String(f.name || kind).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
  return { file: { name, type, data: f.data }, meta: { name, type, size: buf.length } };
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
  const { track, files: uploads, ...d } = body;

  const bad = validate(track, d);
  if (bad) return res.status(400).json({ ok: false, field: bad[0], message: bad[1] });

  const emailKey = String(d.email).trim().toLowerCase();
  const isCash = d.pay === '현금';

  const incoming = {};
  if (isCash && uploads && typeof uploads === 'object') {
    for (const kind of Object.keys(FILE_KINDS)) {
      const r = checkFile(kind, uploads[kind]);
      if (r && r.error) return res.status(400).json({ ok: false, field: FIELD_ID[kind], message: r.error });
      if (r) incoming[kind] = r;
    }
  }

  try {
    const existingRaw = await redis.hget(HKEY, emailKey);
    const existing = existingRaw ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) : {};
    const prevFiles = (existing[track] && existing[track].files) || {};
    const now = new Date().toISOString();

    // 현금이면 두 서류 모두 필요 (새로 올렸거나 이전에 올린 파일)
    const filesMeta = {};
    if (isCash) {
      for (const kind of Object.keys(FILE_KINDS)) {
        if (incoming[kind]) filesMeta[kind] = incoming[kind].meta;
        else if (prevFiles[kind]) filesMeta[kind] = prevFiles[kind];
        else return res.status(400).json({ ok: false, field: FIELD_ID[kind], message: `현금 지급을 원하시면 ${FILE_KINDS[kind]}를 올려 주세요.` });
      }
    }

    // 파일은 하나씩 저장 (요청 크기를 줄이기 위해)
    for (const kind of Object.keys(incoming)) {
      await redis.hset(FKEY, { [`${emailKey}|${track}|${kind}`]: JSON.stringify(incoming[kind].file) });
    }
    // 상품권으로 바꾸면 더 필요 없는 서류는 지움
    if (!isCash && Object.keys(prevFiles).length) {
      await redis.hdel(FKEY, ...Object.keys(prevFiles).map(kind => `${emailKey}|${track}|${kind}`));
    }

    const merged = Object.assign({}, existing, {
      org: d.org, orgType: d.orgType, region: d.region,
      manager: d.manager, phone: d.phone, email: d.email, updatedAt: now,
    });
    const record = Object.assign({}, d, { submittedAt: now });
    if (isCash) record.files = filesMeta;
    merged[track] = record;

    await redis.hset(HKEY, { [emailKey]: JSON.stringify(merged) });
    return res.status(200).json({ ok: true, submittedAt: now, files: isCash ? filesMeta : null });
  } catch (err) {
    console.error('submit error', err);
    return res.status(500).json({ ok: false, message: '서버 오류로 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
