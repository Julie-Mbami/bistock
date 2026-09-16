// Raffinement du logo B — palette SANS NOIR : or dégradé + gris chaud + crème
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'logos_bistock_v3');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Palette sans noir : anthracite chaud + or dégradé + crème
const ANTHRACITE = '#3D3025';   // Gris chaud/marron foncé (au lieu du noir)
const OR_FONCE   = '#8B6914';
const OR         = '#C9A227';
const OR_CLAIR   = '#E9D8A6';
const CREME      = '#FBF8ED';
const BLANC      = '#FFFFFF';

// Dégradé or riche : or clair → or → or foncé
const gradOr = `
  <linearGradient id="grad-or" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%"   stop-color="#F5D97A"/>
    <stop offset="45%"  stop-color="#D4AF37"/>
    <stop offset="100%" stop-color="#8B6914"/>
  </linearGradient>
`;
// Dégradé or inverse (clair en bas, pour éclat sous le B)
const gradOrDoux = `
  <linearGradient id="grad-or-doux" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%"   stop-color="#B8891F"/>
    <stop offset="50%"  stop-color="#E9D8A6"/>
    <stop offset="100%" stop-color="#B8891F"/>
  </linearGradient>
`;

// =====================================================================
// VARIANTE 1 — Cercle crème avec contour or épais + B or dégradé + chevron
// =====================================================================
function variante1() {
  return `<svg viewBox="0 0 800 260" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradOr}${gradOrDoux}</defs>
    <!-- Cercle crème avec anneau or épais (comme un blason financier) -->
    <circle cx="130" cy="130" r="102" fill="${CREME}"/>
    <circle cx="130" cy="130" r="102" fill="none" stroke="url(#grad-or)" stroke-width="8"/>
    <circle cx="130" cy="130" r="90" fill="none" stroke="${OR_FONCE}" stroke-width="1" opacity="0.5"/>
    <!-- B en dégradé or -->
    <text x="130" y="180"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="150"
          fill="url(#grad-or)"
          text-anchor="middle">B</text>
    <!-- Petit chevron ascendant sous le B (croissance) -->
    <path d="M 105,210 L 130,192 L 155,210" fill="none" stroke="url(#grad-or)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Wordmark en anthracite chaud -->
    <text x="270" y="152"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="88"
          fill="${ANTHRACITE}"
          letter-spacing="-3">Bistock</text>
  </svg>`;
}

// =====================================================================
// VARIANTE 2 — B or dégradé sur fond BLANC + barres horizontales dorées + wordmark
// =====================================================================
function variante2() {
  return `<svg viewBox="0 0 800 260" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradOr}</defs>
    <!-- Carré blanc avec bordure or dégradé -->
    <rect x="30" y="30" width="200" height="200" rx="34" fill="${BLANC}" stroke="url(#grad-or)" stroke-width="4"/>
    <!-- Éclat subtil crème pour donner de la texture -->
    <rect x="34" y="34" width="192" height="70" rx="30" fill="${CREME}" opacity="0.5"/>
    <!-- B en dégradé or -->
    <text x="118" y="180"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="160"
          fill="url(#grad-or)"
          text-anchor="middle">B</text>
    <!-- 3 barres horizontales dorées empilées (dashboard/données) -->
    <rect x="176" y="118" width="36" height="10" rx="2" fill="url(#grad-or)"/>
    <rect x="176" y="136" width="28" height="10" rx="2" fill="${OR}"/>
    <rect x="176" y="154" width="20" height="10" rx="2" fill="${OR}" opacity="0.65"/>

    <!-- Wordmark anthracite chaud -->
    <text x="270" y="152"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="88"
          fill="${ANTHRACITE}"
          letter-spacing="-3">Bistock</text>
  </svg>`;
}

// =====================================================================
// VARIANTE 3 — B or plein sans cadre + soulignement or dégradé horizontal + tick
// (le plus épuré, entièrement or/beige/anthracite)
// =====================================================================
function variante3() {
  return `<svg viewBox="0 0 800 260" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradOr}${gradOrDoux}</defs>
    <!-- Grand B or dégradé sans cadre, position gauche -->
    <text x="130" y="200"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="220"
          fill="url(#grad-or)"
          text-anchor="middle">B</text>
    <!-- Filet or dégradé horizontal sous le B (comme un souligné signature) -->
    <rect x="45" y="222" width="170" height="4" fill="url(#grad-or-doux)"/>
    <!-- Petit tick or discret sous le filet -->
    <path d="M 155,240 L 170,252 L 200,225" fill="none" stroke="${OR}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>

    <!-- Wordmark anthracite chaud, gros -->
    <text x="270" y="152"
          font-family="Helvetica, Arial, sans-serif"
          font-weight="900"
          font-size="88"
          fill="${ANTHRACITE}"
          letter-spacing="-3">Bistock</text>
    <!-- Petit soulignement or subtil sous le wordmark -->
    <rect x="270" y="168" width="345" height="2" fill="url(#grad-or-doux)"/>
  </svg>`;
}

(async () => {
  console.log('→ Génération raffinements Logo B (sans noir)...');
  const variantes = [
    { nom: 'B1_cercle_creme',   label: 'B1 · Cercle crème + anneau or + chevron', gen: variante1 },
    { nom: 'B2_blanc_barres',   label: 'B2 · Carré blanc + barres horizontales',  gen: variante2 },
    { nom: 'B3_epure_signature',label: 'B3 · Épuré or + soulignement + tick',     gen: variante3 },
  ];

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new' });

  for (const v of variantes) {
    fs.writeFileSync(path.join(OUT_DIR, v.nom + '.svg'), v.gen());
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 320, deviceScaleFactor: 2 });
    const html = `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 40px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; font-family: Inter, Arial, sans-serif; }
      .card { background: #fff; padding: 32px 40px; box-shadow: 0 4px 30px rgba(0,0,0,0.08); border-radius: 14px; }
      .label { font-size: 11px; letter-spacing: 2px; color: #999; text-transform: uppercase; margin-bottom: 18px; font-weight: 600; }
      svg { display: block; width: 720px; height: 234px; }
    </style></head><body><div class="card"><div class="label">${v.label}</div>${v.gen()}</div></body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(OUT_DIR, v.nom + '.png'), clip: { x: 0, y: 0, width: 900, height: 320 } });
    await page.close();
    console.log('   ✓ ' + v.label);
  }
  await browser.close();
})();
