const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

async function createICNS() {
  const pngPath = path.join(__dirname, 'icons', 'icon.png');
  const outputPath = path.join(__dirname, 'icons', 'icon.icns');
  
  // Load the source image once
  const sourceImage = await loadImage(pngPath);
  
  // Create canvas and draw 512x512 image
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceImage, 0, 0, 512, 512);
  const pngBuffer = canvas.toBuffer('image/png');
  
  // Create minimal ICNS with just ic09 (512x512)
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns', 0);
  const totalLength = 8 + 8 + pngBuffer.length;
  icnsHeader.writeUInt32BE(totalLength, 4);
  
  const ic09Entry = Buffer.alloc(8 + pngBuffer.length);
  ic09Entry.write('ic09', 0, 4);
  ic09Entry.writeUInt32BE(8 + pngBuffer.length, 4);
  pngBuffer.copy(ic09Entry, 8);
  
  const finalICNS = Buffer.concat([icnsHeader, ic09Entry]);
  fs.writeFileSync(path.join(__dirname, 'icons', 'icon.icns'), finalICNS);
  console.log('icon.icns created successfully');
}

createICNS().catch(console.error);