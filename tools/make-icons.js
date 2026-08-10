// 生成扩展图标：品牌色圆角方块 + 白色下箭头（表达“下载 / 转换”）。
// 纯 Node + zlib 手写 PNG，无第三方依赖。用法：node tools/make-icons.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, '..', 'icons');

const BRAND = [0x4c, 0x8b, 0xf5, 0xff]; // #4c8bf5
const WHITE = [0xff, 0xff, 0xff, 0xff];

// 归一化坐标系里的形状测试（含圆角）
const M = 0.08; // 外边距
function inRoundedRect(px, py) {
  const x0 = M, y0 = M, x1 = 1 - M, y1 = 1 - M;
  const r = 0.22 * (1 - 2 * M);
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r + 1e-9;
}

function inArrow(px, py) {
  // 箭杆
  const shaftW = 0.30, shaftTop = 0.30, shaftBottom = 0.52;
  if (py >= shaftTop && py <= shaftBottom && Math.abs(px - 0.5) <= shaftW / 2) return true;
  // 箭头三角
  const headTop = shaftBottom, headBottom = 0.80, halfBase = 0.30;
  if (py > headTop && py <= headBottom) {
    const t = (py - headTop) / (headBottom - headTop);
    return Math.abs(px - 0.5) <= halfBase * t;
  }
  return false;
}

function pixel(x, y, size) {
  const px = (x + 0.5) / size;
  const py = (y + 0.5) / size;
  if (!inRoundedRect(px, py)) return [0, 0, 0, 0];
  return inArrow(px, py) ? WHITE : BRAND;
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const i = (y * size + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  const file = path.join(OUT_DIR, 'icon' + size + '.png');
  fs.writeFileSync(file, encodePNG(size, rgba));
  console.log('✓ ' + file + ' (' + size + 'x' + size + ')');
}
