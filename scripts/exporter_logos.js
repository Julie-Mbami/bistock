// Exporte le logo SVG dans toutes les tailles standards (PNG haute qualité)
// Usage : node scripts/exporter_logos.js

const fs = require('fs');
const path = require('path');

const SOURCE_SVG = path.join(__dirname, '..', 'public', 'logos', 'bstock-icon.svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'logos', 'export');

// Tailles standards :
//   favicon web (16, 32, 48)
//   touch icons iOS/Android (57, 60, 72, 76, 114, 120, 144, 152, 180)
//   PWA / manifest (192, 256, 512)
//   Print/haute résolution (1024)
const TAILLES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024];

async function main() {
  if (!fs.existsSync(SOURCE_SVG)) {
    console.error('✗ SVG source introuvable :', SOURCE_SVG);
    process.exit(1);
  }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const svgContent = fs.readFileSync(SOURCE_SVG, 'utf-8');

  // Dynamic import de puppeteer (ES module)
  const puppeteer = await import('puppeteer');
  console.log('  → Lancement navigateur headless...');
  const browser = await puppeteer.default.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const taille of TAILLES) {
    // On charge le SVG dans une page HTML minimale à la taille souhaitée
    const html = `<!DOCTYPE html><html><head><style>
      * { margin: 0; padding: 0; }
      html, body { width: ${taille}px; height: ${taille}px; overflow: hidden; background: transparent; }
      svg { width: 100%; height: 100%; display: block; }
    </style></head><body>${svgContent}</body></html>`;

    await page.setViewport({ width: taille, height: taille, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const cheminSortie = path.join(OUTPUT_DIR, `bstock-icon-${taille}.png`);
    await page.screenshot({
      path: cheminSortie,
      type: 'png',
      omitBackground: true,
      clip: { x: 0, y: 0, width: taille, height: taille },
    });
    const stat = fs.statSync(cheminSortie);
    console.log(`  ✓ ${taille}×${taille}  →  bstock-icon-${taille}.png (${Math.round(stat.size / 1024)} Ko)`);
  }

  // Copie du SVG original pour référence
  fs.copyFileSync(SOURCE_SVG, path.join(OUTPUT_DIR, 'bstock-icon.svg'));
  console.log('  ✓ SVG source copié');

  // Génération du favicon.ico (16, 32, 48 combinés dans un seul .ico)
  // Simple version : copie du PNG 32 en .ico (Windows/browsers acceptent PNG-in-ICO)
  const favicon32 = fs.readFileSync(path.join(OUTPUT_DIR, 'bstock-icon-32.png'));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'favicon.ico'), favicon32);
  console.log('  ✓ favicon.ico (basé sur 32×32)');

  await browser.close();
  console.log('\n  ✅ Terminé. Fichiers dans :', OUTPUT_DIR);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
