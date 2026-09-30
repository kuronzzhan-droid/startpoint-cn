import {fail} from './model.mjs';
import {IMAGE_BYTES} from './dungeon-model.mjs';

const invalid = () => fail(415, 'invalid_image', '仅支持完整的静态 PNG、JPEG 或 WebP 图片。');
const ascii = (bytes, at, text) => [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));
function png(bytes, view) {
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) invalid();
  let at = 8, width, height, data = false, ended = false;
  while (at + 12 <= bytes.length) {
    const size = view.getUint32(at), end = at + 12 + size;
    if (end > bytes.length) invalid();
    if (at === 8) {
      if (!ascii(bytes, at + 4, 'IHDR') || size !== 13) invalid();
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
    } else if (ascii(bytes, at + 4, 'IHDR') || ascii(bytes, at + 4, 'acTL')) invalid();
    if (ascii(bytes, at + 4, 'IDAT')) data = true;
    if (ascii(bytes, at + 4, 'IEND')) {
      if (size || end !== bytes.length) invalid(); ended = true;
    }
    at = end;
  }
  if (!data || !ended || at !== bytes.length) invalid();
  return {width, height, mime: 'image/png'};
}
function jpeg(bytes, view) {
  if (bytes.length < 24 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
  let at = 2, width, height;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 255) invalid();
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (at + 2 > bytes.length || marker === 0 || marker === 216 || marker === 217) invalid();
    const size = view.getUint16(at);
    if (size < 2 || at + size > bytes.length - 2) invalid();
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (size < 8 || width) invalid(); height = view.getUint16(at + 3); width = view.getUint16(at + 5);
    }
    if (marker === 218) {
      if (!width || size < 6 || at + size >= bytes.length - 2) invalid();
      return {width, height, mime: 'image/jpeg'};
    }
    at += size;
  }
  invalid();
}
function webp(bytes, view) {
  if (bytes.length < 26 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || view.getUint32(4, true) + 8 !== bytes.length) invalid();
  let at = 12, width, height, image = false;
  const u24 = (i) => bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true), body = at + 8, end = body + size + (size & 1);
    if (end > bytes.length) invalid();
    let dimensions;
    if (ascii(bytes, at, 'VP8X')) {
      if (at !== 12 || size !== 10 || bytes[body] & 2) invalid();
      width = u24(body + 4) + 1; height = u24(body + 7) + 1;
    } else if (ascii(bytes, at, 'VP8 ')) {
      if (size < 10 || ![157, 1, 42].every((v, i) => bytes[body + 3 + i] === v)) invalid();
      dimensions = [view.getUint16(body + 6, true) & 16383, view.getUint16(body + 8, true) & 16383];
    } else if (ascii(bytes, at, 'VP8L')) {
      if (size < 5 || bytes[body] !== 47) invalid();
      dimensions = [1 + (bytes[body + 1] | (bytes[body + 2] & 63) << 8),
        1 + (bytes[body + 2] >> 6 | bytes[body + 3] << 2 | (bytes[body + 4] & 15) << 10)];
    } else if (ascii(bytes, at, 'ANIM') || ascii(bytes, at, 'ANMF')) invalid();
    if (dimensions) {
      if (image || width && (width !== dimensions[0] || height !== dimensions[1])) invalid();
      [width, height] = dimensions; image = true;
    }
    at = end;
  }
  if (!image || at !== bytes.length) invalid();
  return {width, height, mime: 'image/webp'};
}
export function inspectImage(input, contentType) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length || bytes.length > IMAGE_BYTES) fail(413, 'image_too_large', '每张攻略图片不能超过 512 KiB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mime = String(contentType || '').toLowerCase().trim();
  const parser = {'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp}[mime];
  if (!parser) invalid();
  const info = parser(bytes, view);
  if (!info.width || !info.height || info.width > 4096 || info.height > 4096 || info.width * info.height > 12 * 1024 * 1024)
    fail(400, 'image_dimensions', '图片宽高最多 4096 像素，总像素最多 1200 万左右，请先缩小图片。');
  return {...info, bytes: bytes.length};
}
