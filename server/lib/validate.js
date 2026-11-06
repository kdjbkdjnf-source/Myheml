import { badRequest } from './http.js';

export function str(value, field, { min = 0, max = 200, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field}不能为空`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field}格式不正确`);
  const trimmed = value.trim();
  if (required && trimmed.length < Math.max(1, min)) {
    throw badRequest(`${field}至少 ${Math.max(1, min)} 个字符`);
  }
  if (trimmed.length > max) throw badRequest(`${field}不能超过 ${max} 个字符`);
  return trimmed;
}

export function optionalStr(value, field, opts = {}) {
  return str(value, field, { ...opts, required: false });
}

export function int(value, field, { min, max, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${field}不能为空`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field}必须是整数`);
  if (min !== undefined && n < min) throw badRequest(`${field}不能小于 ${min}`);
  if (max !== undefined && n > max) throw badRequest(`${field}不能大于 ${max}`);
  return n;
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw badRequest(`${field}取值不合法`);
  return value;
}

export const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;

export function username(value) {
  const v = str(value, '用户名', { min: 3, max: 20 });
  if (!USERNAME_RE.test(v)) throw badRequest('用户名需为 3-20 位字母、数字、下划线或中文');
  return v;
}

export function password(value) {
  const v = str(value, '密码', { min: 8, max: 64 });
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) throw badRequest('密码需同时包含字母和数字');
  return v;
}

/** 收拢连续空白，去掉零宽字符与控制字符，避免内容注入与排版破坏 */
export function cleanText(value, field, opts = {}) {
  const v = str(value, field, opts);
  return v
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

export function contactValue(value, field) {
  const v = optionalStr(value, field, { max: 60 });
  if (!v) return '';
  if (!/^[A-Za-z0-9_\-.@+\u4e00-\u9fa5 ]{2,60}$/.test(v)) throw badRequest(`${field}包含不支持的字符`);
  return v;
}

/** 校验图片 dataURL，返回 { buffer, ext } */
export function parseImageDataUrl(dataUrl, { maxBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof dataUrl !== 'string') throw badRequest('图片格式不正确');
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw badRequest('仅支持 JPG / PNG / WEBP 图片');
  const declared = match[1] === 'jpg' ? 'jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 100) throw badRequest('图片内容为空');
  if (buffer.length > maxBytes) throw badRequest('单张图片不能超过 4MB');

  // 校验文件魔数，防止伪造 Content-Type
  let ext = null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ext = 'jpg';
  else if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
  if (!ext) throw badRequest('图片内容校验失败，请重新上传');

  return { buffer, ext, declared };
}
