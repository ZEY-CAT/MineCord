const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('canvas');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'assets', 'minecord-icon.svg');
const svgBytes = fs.readFileSync(svgPath);
const imageCache = new Map();

async function renderPng(size, maskable = false) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  const svg = maskable
    ? Buffer.from(svgBytes.toString('utf8').replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512"'))
    : svgBytes;
  const key = maskable ? 'maskable' : 'standard';
  if (!imageCache.has(key)) imageCache.set(key, await loadImage(svg));
  const image = imageCache.get(key);
  context.drawImage(image, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}

function makeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(image => image.png)]);
}

function makeIcns(images) {
  const chunks = images.map(({ type, png }) => {
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([chunk, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + header.length, 4);
  return Buffer.concat([header, body]);
}

function write(relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

async function main() {
  write('public/icons/minecord-icon.svg', svgBytes);
  const sizes = new Map();
  for (const size of [16, 32, 48, 64, 72, 96, 128, 144, 180, 192, 256, 512, 1024]) {
    sizes.set(size, await renderPng(size));
  }
  write('assets/minecord-icon.png', sizes.get(512));
  write('public/icons/icon-192.png', sizes.get(192));
  write('public/icons/icon-512.png', sizes.get(512));
  write('public/icons/apple-touch-icon.png', sizes.get(180));
  write('public/icons/maskable-192.png', await renderPng(192, true));
  write('public/icons/maskable-512.png', await renderPng(512, true));
  write('src-tauri/icons/icon.png', sizes.get(512));

  const androidSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(androidSizes)) {
    write(`src-tauri/gen/android/app/src/main/res/mipmap-${density}/ic_launcher.png`, sizes.get(size));
    write(`src-tauri/gen/android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, sizes.get(size));
  }

  const icoImages = [16, 32, 48, 64, 128, 256].map(size => ({ size, png: sizes.get(size) }));
  const ico = makeIco(icoImages);
  write('public/favicon.ico', ico);
  write('assets/minecord.ico', ico);
  write('src-tauri/icons/icon.ico', ico);
  const icnsImages = [
    { type: 'ic07', png: sizes.get(128) },
    { type: 'ic08', png: sizes.get(256) },
    { type: 'ic09', png: sizes.get(512) },
    { type: 'ic10', png: sizes.get(1024) }
  ];
  write('src-tauri/icons/icon.icns', makeIcns(icnsImages));
  console.log('Generated MineCord PWA, favicon, Android, Windows, and macOS icons from assets/minecord-icon.svg.');
}

main().catch(error => {
  console.error('Could not generate MineCord icons:', error.message);
  process.exitCode = 1;
});
