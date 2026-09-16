// Génère 4 concepts de logo Bistock en PNG
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'logos_bistock');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const NOIR = '#0A0A0A';
const OR   = '#C9A227';
const OR_F = '#8B6914';
const CREME= '#FBF8ED';
const GRIS = '#666666';

// =====================================================================
// LOGO 1 — Boîte carton (stock) avec BS gravé + trait facture
// =====================================================================
function logo1() {
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
    <!-- Boîte cube 3D -->
    <g transform="translate(80,90)">
      <!-- Face top -->
      <polygon points="0,50 120,20 240,50 120,80" fill="${OR}" stroke="${NOIR}" stroke-width="3"/>
      <!-- Face gauche -->
      <polygon points="0,50 0,190 120,220 120,80" fill="${NOIR}" stroke="${NOIR}" stroke-width="3"/>
      <!-- Face droite -->
      <polygon points="240,50 240,190 120,220 120,80" fill="${OR_F}" stroke="${NOIR}" stroke-width="3"/>
      <!-- Texte BS sur face gauche -->
      <text x="60" y="160" font-family="Helvetica" font-weight="900" font-size="70" fill="${OR}" text-anchor="middle">BS</text>
      <!-- Petit trait facture blanc coin haut -->
      <rect x="150" y="90" width="60" height="45" rx="2" fill="${CREME}" stroke="${NOIR}" stroke-width="2" transform="rotate(-8 180 112)"/>
      <line x1="160" y1="102" x2="200" y2="102" stroke="${NOIR}" stroke-width="1.5" transform="rotate(-8 180 112)"/>
      <line x1="160" y1="112" x2="200" y2="112" stroke="${NOIR}" stroke-width="1.5" transform="rotate(-8 180 112)"/>
      <line x1="160" y1="122" x2="185" y2="122" stroke="${NOIR}" stroke-width="1.5" transform="rotate(-8 180 112)"/>
    </g>
    <!-- Wordmark -->
    <text x="200" y="360" font-family="Helvetica" font-weight="800" font-size="48" fill="${NOIR}" text-anchor="middle" letter-spacing="3">Bistock</text>
  </svg>`;
}

// =====================================================================
// LOGO 2 — Monogramme B stylisé avec code-barres intégré
// =====================================================================
function logo2() {
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
    <!-- Fond carré arrondi noir -->
    <rect x="60" y="60" width="280" height="280" rx="40" fill="${NOIR}"/>
    <!-- Filet or bordure interne -->
    <rect x="72" y="72" width="256" height="256" rx="32" fill="none" stroke="${OR}" stroke-width="2"/>
    <!-- Grand B doré -->
    <text x="200" y="240" font-family="Helvetica" font-weight="900" font-size="200" fill="${OR}" text-anchor="middle">B</text>
    <!-- Code-barres en bas (évoque stock/produits) -->
    <g transform="translate(120,275)">
      <rect x="0"  y="0" width="3"  height="20" fill="${OR}"/>
      <rect x="6"  y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="10" y="0" width="4"  height="20" fill="${OR}"/>
      <rect x="18" y="0" width="2"  height="20" fill="${OR}"/>
      <rect x="24" y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="28" y="0" width="3"  height="20" fill="${OR}"/>
      <rect x="35" y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="40" y="0" width="4"  height="20" fill="${OR}"/>
      <rect x="48" y="0" width="2"  height="20" fill="${OR}"/>
      <rect x="54" y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="60" y="0" width="3"  height="20" fill="${OR}"/>
      <rect x="68" y="0" width="4"  height="20" fill="${OR}"/>
      <rect x="76" y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="82" y="0" width="2"  height="20" fill="${OR}"/>
      <rect x="88" y="0" width="4"  height="20" fill="${OR}"/>
      <rect x="96" y="0" width="1"  height="20" fill="${OR}"/>
      <rect x="102" y="0" width="3" height="20" fill="${OR}"/>
      <rect x="110" y="0" width="4" height="20" fill="${OR}"/>
      <rect x="118" y="0" width="2" height="20" fill="${OR}"/>
      <rect x="124" y="0" width="1" height="20" fill="${OR}"/>
      <rect x="128" y="0" width="4" height="20" fill="${OR}"/>
      <rect x="136" y="0" width="2" height="20" fill="${OR}"/>
      <rect x="142" y="0" width="1" height="20" fill="${OR}"/>
      <rect x="148" y="0" width="3" height="20" fill="${OR}"/>
      <rect x="155" y="0" width="4" height="20" fill="${OR}"/>
    </g>
    <!-- Wordmark -->
    <text x="200" y="385" font-family="Helvetica" font-weight="800" font-size="32" fill="${NOIR}" text-anchor="middle" letter-spacing="3">Bistock</text>
  </svg>`;
}

// =====================================================================
// LOGO 3 — B + S imbriqués avec ticket/facture qui sort
// =====================================================================
function logo3() {
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
    <!-- Cercle or fond -->
    <circle cx="200" cy="180" r="120" fill="${OR}"/>
    <!-- Cercle intérieur noir décoratif -->
    <circle cx="200" cy="180" r="105" fill="none" stroke="${NOIR}" stroke-width="2"/>
    <!-- Lettres BS entrelacées -->
    <text x="155" y="220" font-family="Georgia" font-weight="900" font-size="140" fill="${NOIR}">B</text>
    <text x="215" y="220" font-family="Georgia" font-weight="900" font-size="140" fill="${NOIR}" opacity="0.85">S</text>
    <!-- Petit ticket qui sort par le bas -->
    <g transform="translate(155,265)">
      <rect x="0" y="0" width="90" height="55" fill="${CREME}" stroke="${NOIR}" stroke-width="2"/>
      <!-- Perforation haut -->
      <path d="M 0,0 L 6,4 L 12,0 L 18,4 L 24,0 L 30,4 L 36,0 L 42,4 L 48,0 L 54,4 L 60,0 L 66,4 L 72,0 L 78,4 L 84,0 L 90,4"
            fill="none" stroke="${NOIR}" stroke-width="1"/>
      <!-- Lignes de ticket -->
      <line x1="10" y1="18" x2="80" y2="18" stroke="${NOIR}" stroke-width="1.5"/>
      <line x1="10" y1="28" x2="80" y2="28" stroke="${NOIR}" stroke-width="1.5"/>
      <line x1="10" y1="38" x2="55" y2="38" stroke="${NOIR}" stroke-width="1.5"/>
      <line x1="60" y1="38" x2="80" y2="38" stroke="${NOIR}" stroke-width="2"/>
    </g>
    <!-- Wordmark -->
    <text x="200" y="380" font-family="Helvetica" font-weight="800" font-size="42" fill="${NOIR}" text-anchor="middle" letter-spacing="3">Bistock</text>
  </svg>`;
}

// =====================================================================
// LOGO 4 — Minimaliste : monogramme "Bs" avec accent doré
// =====================================================================
function logo4() {
  return `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
    <!-- Bloc carré noir avec Bs stylisé -->
    <rect x="80" y="80" width="240" height="240" rx="24" fill="${NOIR}"/>
    <!-- B majuscule doré -->
    <text x="130" y="245" font-family="Helvetica" font-weight="900" font-size="180" fill="${OR}">B</text>
    <!-- s minuscule blanc en exposant -->
    <text x="238" y="220" font-family="Helvetica" font-weight="700" font-size="100" fill="${CREME}">s</text>
    <!-- Petit filet or horizontal (facture) -->
    <rect x="100" y="270" width="200" height="3" fill="${OR}"/>
    <!-- Points sous filet (stock) -->
    <circle cx="120" cy="290" r="4" fill="${OR}"/>
    <circle cx="140" cy="290" r="4" fill="${OR}"/>
    <circle cx="160" cy="290" r="4" fill="${OR}"/>
    <circle cx="180" cy="290" r="4" fill="${OR}"/>
    <circle cx="200" cy="290" r="4" fill="${OR}"/>
    <circle cx="220" cy="290" r="4" fill="${OR}"/>
    <circle cx="240" cy="290" r="4" fill="${OR}"/>
    <circle cx="260" cy="290" r="4" fill="${OR}"/>
    <circle cx="280" cy="290" r="4" fill="${OR}"/>
    <!-- Wordmark -->
    <text x="200" y="370" font-family="Helvetica" font-weight="300" font-size="42" fill="${NOIR}" text-anchor="middle" letter-spacing="6">BISTOCK</text>
  </svg>`;
}

(async () => {
  console.log('→ Génération des 4 concepts de logo Bistock...');
  const modeles = [
    { nom: '1_boite_stock',     label: 'Boîte 3D + BS + facture', gen: logo1 },
    { nom: '2_monogramme_barcode', label: 'B monogramme + code-barres', gen: logo2 },
    { nom: '3_cercle_bs_ticket', label: 'Cercle doré BS + ticket',  gen: logo3 },
    { nom: '4_minimal_bs',       label: 'Minimaliste Bs',           gen: logo4 },
  ];

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new' });

  for (const m of modeles) {
    // Sauver SVG source
    fs.writeFileSync(path.join(OUT_DIR, m.nom + '.svg'), m.gen());
    // Générer PNG via puppeteer
    const page = await browser.newPage();
    await page.setViewport({ width: 500, height: 500, deviceScaleFactor: 2 });
    const html = `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 30px; background: #fafafa; display: flex; align-items: center; justify-content: center; }
      svg { width: 440px; height: 440px; background: #fff; padding: 10px; box-shadow: 0 2px 20px rgba(0,0,0,0.12); border-radius: 8px; }
    </style></head><body>${m.gen()}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const outPng = path.join(OUT_DIR, m.nom + '.png');
    await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width: 500, height: 500 } });
    await page.close();
    console.log('   ✓ ' + m.label + ' → ' + m.nom + '.png');
  }
  await browser.close();
  console.log('\n' + modeles.length + ' logos disponibles dans docs/logos_bistock/');
})();
