// Planche comparative des 4 logos Bistock dans 4 contextes réels
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'logos_bistock_v2');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const NOIR = '#0A0A0A';
const OR   = '#C9A227';

// SVG des logos (versions adaptées pour chaque contexte)
const logos = {
  A: {
    label: 'A · Point i doré',
    // Wordmark
    wordmark: (h) => `<svg viewBox="0 0 800 200" style="height:${h}px"><text x="0" y="140" font-family="Inter,Helvetica,Arial" font-weight="700" font-size="130" fill="${NOIR}" letter-spacing="-4">bistock</text><rect x="117" y="36" width="20" height="20" fill="${OR}"/></svg>`,
    // Favicon (juste le "b" avec accent)
    favicon: (bg, fg) => `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${bg}"/><text x="10" y="52" font-family="Inter,Helvetica" font-weight="800" font-size="52" fill="${fg}" letter-spacing="-2">b</text><rect x="41" y="10" width="6" height="6" fill="${OR}"/></svg>`,
    // Sidebar (fond noir)
    sidebar: () => `<svg viewBox="0 0 200 60" style="height:36px"><text x="0" y="42" font-family="Inter,Helvetica" font-weight="700" font-size="32" fill="#fff" letter-spacing="-1">bistock</text><rect x="29" y="8" width="5" height="5" fill="${OR}"/></svg>`,
  },
  B: {
    label: 'B · Monogramme B + wordmark',
    wordmark: (h) => `<svg viewBox="0 0 700 200" style="height:${h}px"><rect x="0" y="30" width="140" height="140" rx="26" fill="${NOIR}"/><text x="70" y="140" font-family="Inter,Helvetica" font-weight="800" font-size="100" fill="#fff" text-anchor="middle">B</text><rect x="28" y="152" width="84" height="3" fill="${OR}"/><text x="170" y="132" font-family="Inter,Helvetica" font-weight="600" font-size="78" fill="${NOIR}" letter-spacing="-2">Bistock</text></svg>`,
    favicon: (bg, fg) => `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${NOIR}"/><text x="32" y="47" font-family="Inter,Helvetica" font-weight="800" font-size="42" fill="#fff" text-anchor="middle">B</text><rect x="16" y="53" width="32" height="2" fill="${OR}"/></svg>`,
    sidebar: () => `<svg viewBox="0 0 200 60" style="height:36px"><rect x="0" y="4" width="36" height="36" rx="7" fill="#fff"/><text x="18" y="30" font-family="Inter,Helvetica" font-weight="800" font-size="24" fill="${NOIR}" text-anchor="middle">B</text><rect x="7" y="33" width="22" height="1.5" fill="${OR}"/><text x="45" y="30" font-family="Inter,Helvetica" font-weight="600" font-size="22" fill="#fff" letter-spacing="-0.5">Bistock</text></svg>`,
  },
  C: {
    label: 'C · Point final doré',
    wordmark: (h) => `<svg viewBox="0 0 800 200" style="height:${h}px"><text x="0" y="150" font-family="Inter,Helvetica" font-weight="800" font-size="140" fill="${NOIR}" letter-spacing="-6">Bistock</text><rect x="580" y="128" width="24" height="24" fill="${OR}"/></svg>`,
    favicon: (bg, fg) => `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${bg}"/><text x="10" y="48" font-family="Inter,Helvetica" font-weight="800" font-size="42" fill="${fg}" letter-spacing="-2">B</text><rect x="46" y="42" width="7" height="7" fill="${OR}"/></svg>`,
    sidebar: () => `<svg viewBox="0 0 200 60" style="height:36px"><text x="0" y="42" font-family="Inter,Helvetica" font-weight="800" font-size="34" fill="#fff" letter-spacing="-1.5">Bistock</text><rect x="146" y="30" width="6" height="6" fill="${OR}"/></svg>`,
  },
  D: {
    label: 'D · Barre or verticale',
    wordmark: (h) => `<svg viewBox="0 0 800 200" style="height:${h}px"><rect x="0" y="16" width="7" height="150" fill="${OR}"/><text x="30" y="145" font-family="Inter,Helvetica" font-weight="700" font-size="130" fill="${NOIR}" letter-spacing="-4">bistock</text></svg>`,
    favicon: (bg, fg) => `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${bg}"/><rect x="10" y="14" width="4" height="36" fill="${OR}"/><text x="20" y="47" font-family="Inter,Helvetica" font-weight="700" font-size="40" fill="${fg}" letter-spacing="-1.5">b</text></svg>`,
    sidebar: () => `<svg viewBox="0 0 200 60" style="height:36px"><rect x="0" y="10" width="3" height="24" fill="${OR}"/><text x="10" y="34" font-family="Inter,Helvetica" font-weight="700" font-size="30" fill="#fff" letter-spacing="-1">bistock</text></svg>`,
  },
};

function celluleContexte(logoKey, contexte) {
  const l = logos[logoKey];
  if (contexte === 'favicon-light') {
    return `<div class="cell">
      <div class="ctx-lbl">Favicon (32×32)</div>
      <div class="favicon-small">${l.favicon('#fff', NOIR).replace('viewBox="0 0 64 64"', 'viewBox="0 0 64 64" width="32" height="32"')}</div>
      <div class="favicon-big" style="margin-top:12px">${l.favicon('#fff', NOIR).replace('viewBox="0 0 64 64"', 'viewBox="0 0 64 64" width="96" height="96"')}</div>
    </div>`;
  }
  if (contexte === 'sidebar') {
    return `<div class="cell sidebar-mock">
      <div class="ctx-lbl light">Sidebar (fond navy)</div>
      <div class="sidebar-box">
        ${l.sidebar()}
      </div>
    </div>`;
  }
  if (contexte === 'wordmark') {
    return `<div class="cell">
      <div class="ctx-lbl">Wordmark principal</div>
      <div class="wordmark-wrap">${l.wordmark(70)}</div>
    </div>`;
  }
  if (contexte === 'card-login') {
    return `<div class="cell login-mock">
      <div class="ctx-lbl">Page connexion</div>
      <div class="login-card">
        <div class="login-logo">${l.wordmark(48)}</div>
        <div class="login-sub">Espace de gestion</div>
        <div class="login-input"></div>
        <div class="login-input"></div>
        <div class="login-btn">Se connecter</div>
      </div>
    </div>`;
  }
}

function pageHTML() {
  const contextes = ['favicon-light', 'sidebar', 'wordmark', 'card-login'];
  const cellules = [];
  for (const key of ['A', 'B', 'C', 'D']) {
    cellules.push(`<div class="col-header">${logos[key].label}</div>`);
  }
  for (const ctx of contextes) {
    for (const key of ['A', 'B', 'C', 'D']) {
      cellules.push(celluleContexte(key, ctx));
    }
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: Inter, Helvetica, Arial, sans-serif; }
    body { background: #f4f4f5; padding: 30px; }
    .planche {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      max-width: 1600px;
      margin: 0 auto;
    }
    .col-header {
      background: #0a0a0a;
      color: #fff;
      padding: 12px 16px;
      font-weight: 700;
      font-size: 14px;
      border-radius: 8px 8px 0 0;
      text-align: center;
      letter-spacing: 0.5px;
    }
    .cell {
      background: #fff;
      padding: 20px 18px;
      border-radius: 10px;
      min-height: 170px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .ctx-lbl {
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 14px;
      font-weight: 600;
    }
    .ctx-lbl.light { color: #C9A227; }
    .wordmark-wrap { display: flex; align-items: center; justify-content: center; flex: 1; width: 100%; }
    .sidebar-mock { background: #0a0a0a; }
    .sidebar-box { background: #0a0a0a; padding: 8px 12px; border-radius: 6px; width: 100%; }
    .login-mock { background: #f8f9fa; }
    .login-card {
      background: #fff;
      padding: 24px 20px;
      border-radius: 12px;
      width: 100%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      text-align: center;
    }
    .login-logo { display: flex; justify-content: center; }
    .login-sub { font-size: 10px; letter-spacing: 3px; color: #999; margin: 8px 0 16px; text-transform: uppercase; }
    .login-input { height: 26px; background: #f4f4f5; border-radius: 5px; margin-bottom: 8px; }
    .login-btn { background: #0a0a0a; color: #fff; padding: 8px; border-radius: 5px; font-size: 11px; font-weight: 600; margin-top: 4px; }
    .favicon-small svg, .favicon-big svg { display: block; }
    .titre-planche {
      text-align: center;
      color: #0a0a0a;
      font-weight: 800;
      font-size: 22px;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }
    .sous-titre {
      text-align: center;
      color: #666;
      font-size: 12px;
      margin-bottom: 24px;
    }
  </style></head><body>
    <div class="titre-planche">Bistock — Planche comparative des 4 logos</div>
    <div class="sous-titre">Chaque colonne = un concept · Chaque ligne = un contexte d'usage réel</div>
    <div class="planche">${cellules.join('\n')}</div>
  </body></html>`;
}

(async () => {
  console.log('→ Génération planche comparative...');
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1720, height: 1300, deviceScaleFactor: 1.3 });
  await page.setContent(pageHTML(), { waitUntil: 'networkidle0' });
  const out = path.join(OUT_DIR, 'planche_comparative.png');
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('   ✓ ' + out);
})();
