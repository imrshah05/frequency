const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const logoDir = path.join(root, 'assets/logo');
const imagesDir = path.join(root, 'assets/images');
const masterPath = path.join(logoDir, 'frequency-logo.svg');
const darkBackground = '#0B0F0D';
const logoSage = '#6F9A78';

const masterSvg = fs.readFileSync(masterPath, 'utf8');

function monochromeSvg(color) {
  return masterSvg
    .replace(/<linearGradient[\s\S]*?<\/linearGradient>/, '')
    .replace(/fill="url\(#freqGradient\)"/g, `fill="${color}"`)
    .replace(/stroke="url\(#freqGradient\)"/g, `stroke="${color}"`);
}

function writeColorVariants() {
  fs.writeFileSync(path.join(logoDir, 'frequency-logo-white.svg'), monochromeSvg('#F2FAF7'));
  fs.writeFileSync(path.join(logoDir, 'frequency-logo-monochrome.svg'), monochromeSvg(logoSage));
}

async function logoBuffer(source, size) {
  return sharp(source, { density: 1024 })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function makeCanvas({ file, canvas, logo, background, source = Buffer.from(masterSvg) }) {
  const base = sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  if (!logo) {
    await base.png().toFile(path.join(imagesDir, file));
    return;
  }

  const renderedLogo = await logoBuffer(source, logo);

  await base
    .composite([
      {
        input: renderedLogo,
        left: Math.round((canvas - logo) / 2),
        top: Math.round((canvas - logo) / 2),
      },
    ])
    .png()
    .toFile(path.join(imagesDir, file));
}

async function main() {
  writeColorVariants();

  const whiteSvg = Buffer.from(fs.readFileSync(path.join(logoDir, 'frequency-logo-white.svg'), 'utf8'));

  await makeCanvas({ file: 'icon.png', canvas: 1024, logo: 620, background: darkBackground });
  await makeCanvas({ file: 'splash-icon.png', canvas: 1024, logo: 650 });
  await makeCanvas({ file: 'android-icon-foreground.png', canvas: 512, logo: 300 });
  await makeCanvas({ file: 'android-icon-background.png', canvas: 512, logo: 0, background: darkBackground });
  await makeCanvas({ file: 'android-icon-monochrome.png', canvas: 432, logo: 270, source: whiteSvg });
  await makeCanvas({ file: 'favicon.png', canvas: 48, logo: 32, background: darkBackground });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
