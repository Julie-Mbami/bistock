// Génère 4 concepts de logo Bistock — VERSION 2 (wordmark épuré, style SaaS pro)
// Inspirations : Stripe, Notion, Linear, Vercel, Wave, Sage
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'logos_bistock_v2');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const NOIR = '#0A0A0A';
const OR   = '#C9A227';

// =====================================================================
// LOGO A — Wordmark pur avec point doré sur le i
// Style Stripe / Wise / Revolut
// =====================================================================
function logoA() {
  return `<svg viewBox="0 0 800 240" xmlns="http://www.w3.org/2000/svg">
    <text x="60" y="150"
          font-family="Inter, -apple-system, Helvetica, Arial, sans-serif"
          font-weight="700"
          font-size="130"
          fill="${NOIR}"
          letter-spacing="-4">bistock</text>
    <!-- Remplacement du point du "i" par un carré doré -->
    <rect x="177" y="46" width="20" height="20" fill="${OR}"/>
  </svg>`;
}

// =====================================================================
// LOGO B — Monogramme B minimal + wordmark à côté
// Style Notion / Linear (app icon + texte)
// =====================================================================
function logoB() {
  return `<svg viewBox="0 0 800 240" xmlns="http://www.w3.org/2000/svg">
    <!-- Icône carré arrondi noir avec B blanc et petit accent or -->
    <rect x="40" y="45" width="150" height="150" rx="28" fill="${NOIR}"/>
    <text x="115" y="152"
          font-family="Inter, Helvetica, Arial, sans-serif"
          font-weight="800"
          font-size="105"
          fill="#fff"
          text-anchor="middle">B</text>
    <!-- Petit trait or fin en bas de l'icône (élégance) -->
    <rect x="70" y="170" width="90" height="3" fill="${OR}"/>

    <!-- Wordmark à côté -->
    <text x="220" y="140"
          font-family="Inter, Helvetica, Arial, sans-serif"
          font-weight="600"
          font-size="82"
          fill="${NOIR}"
          letter-spacing="-2">Bistock</text>
  </svg>`;
}

// =====================================================================
// LOGO C — Wordmark avec point final doré
// Style Vercel / Framer (wordmark + ponctuation)
// =====================================================================
function logoC() {
  return `<svg viewBox="0 0 800 240" xmlns="http://www.w3.org/2000/svg">
    <text x="120" y="150"
          font-family="Inter, Helvetica, Arial, sans-serif"
          font-weight="800"
          font-size="140"
          fill="${NOIR}"
          letter-spacing="-6">Bistock</text>
    <!-- Point final doré carré -->
    <rect x="655" y="128" width="24" height="24" fill="${OR}"/>
  </svg>`;
}

// =====================================================================
// LOGO D — Wordmark avec barre verticale or (comme séparateur)
// Style Sage / Xero (colored bar + wordmark)
// =====================================================================
function logoD() {
  return `<svg viewBox="0 0 800 240" xmlns="http://www.w3.org/2000/svg">
    <!-- Barre or verticale à gauche -->
    <rect x="80" y="55" width="6" height="130" fill="${OR}"/>
    <!-- Wordmark tout minuscules, lettre-spacing serré -->
    <text x="115" y="152"
          font-family="Inter, Helvetica, Arial, sans-serif"
          font-weight="700"
          font-size="120"
          fill="${NOIR}"
          letter-spacing="-4">bistock</text>
  </svg>`;
}

(async () => {
  console.log('→ Génération des 4 concepts de logo Bistock v2...');
  const modeles = [
    { nom: 'A_wordmark_i_dote',   label: 'Wordmark avec point i doré',   gen: logoA, aspect: [800, 240] },
    { nom: 'B_monogramme_texte',  label: 'Monogramme B + wordmark',      gen: logoB, aspect: [800, 240] },
    { nom: 'C_point_final',       label: 'Wordmark + point final doré',  gen: logoC, aspect: [800, 240] },
    { nom: 'D_barre_verticale',   label: 'Barre or verticale + wordmark',gen: logoD, aspect: [800, 240] },
  ];

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new' });

  for (const m of modeles) {
    fs.writeFileSync(path.join(OUT_DIR, m.nom + '.svg'), m.gen());
    const page = await browser.newPage();
    // Preview au ratio 800x240 (bannière logo horizontal)
    await page.setViewport({ width: 900, height: 300, deviceScaleFactor: 2 });
    const html = `<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 30px; background: #fafafa; display: flex; align-items: center; justify-content: center; }
      .wrap { background: #fff; padding: 20px 30px; box-shadow: 0 2px 24px rgba(0,0,0,0.08); border-radius: 12px; }
      svg { display: block; width: 780px; height: 234px; }
    </style></head><body><div class="wrap">${m.gen()}</div></body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.join(OUT_DIR, m.nom + '.png'), clip: { x: 0, y: 0, width: 900, height: 300 } });
    await page.close();
    console.log('   ✓ ' + m.label);
  }
  await browser.close();
  console.log('\n4 logos v2 disponibles dans docs/logos_bistock_v2/');
})();
