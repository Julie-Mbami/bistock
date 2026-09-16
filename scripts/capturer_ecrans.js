// Capture automatique des écrans clés de l'application via Puppeteer
// Prérequis : le serveur doit être démarré (npm start) sur http://localhost:9000
// Génère les images dans docs/screenshots/

const path = require('path');
const fs = require('fs');
let puppeteer; // chargé dynamiquement (ESM)

const BASE_URL = process.env.APP_URL || 'http://localhost:9000';
const SCREENS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(SCREENS_DIR)) fs.mkdirSync(SCREENS_DIR, { recursive: true });

// Liste des captures à faire : { fichier, url, description, utilisateur, mdp, activite? }
const CAPTURES = [
  // === Connexion ===
  { fichier: '01_connexion.png', url: '/comptes/connexion', desc: 'Écran de connexion' },

  // === DG (Mme Sandra) — Toutes activités ===
  { fichier: '02_dashboard_dg.png', url: '/tableau-de-bord/', desc: 'Tableau de bord Direction Générale', user: 'msandra', mdp: 'admin2026' },
  { fichier: '03_rapport_mensuel.png', url: '/admin/rapport-mensuel/', desc: 'Rapport mensuel', user: 'msandra', mdp: 'admin2026' },
  { fichier: '04_journal_audit.png', url: '/admin/audit/', desc: 'Journal d\'audit', user: 'msandra', mdp: 'admin2026' },
  { fichier: '05_parametres.png', url: '/admin/parametres/', desc: 'Paramètres système', user: 'msandra', mdp: 'admin2026' },
  { fichier: '06_utilisateurs.png', url: '/comptes/utilisateurs', desc: 'Gestion des utilisateurs', user: 'msandra', mdp: 'admin2026' },

  // === Bona Burger ===
  { fichier: '10_produits_bur.png', url: '/produits/', desc: 'Catalogue produits Bona Burger (badges par type)', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '11_fiche_technique.png', url: '/produits/', desc: 'Fiche technique d\'un burger', user: 'msandra', mdp: 'admin2026', activite: 'BUR', clickFicheTech: true },
  { fichier: '12_productions.png', url: '/productions/', desc: 'Ordres de production', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '13_nouvelle_production.png', url: '/productions/nouveau', desc: 'Créer un ordre de production', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '14_etat_stock.png', url: '/stocks/etat/', desc: 'État du stock avec onglets par type', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '15_mouvements.png', url: '/stocks/mouvements/', desc: 'Mouvements de stock', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '16_top_ventes.png', url: '/produits/analytics/ventes-produits', desc: 'Top ventes produits', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '17_caisse.png', url: '/ventes/caisse/', desc: 'Interface de caisse', user: 'caiss_bur', mdp: 'caisse2026', activite: 'BUR' },
  { fichier: '18_historique_ventes.png', url: '/ventes/', desc: 'Historique des ventes', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },
  { fichier: '19_clotures.png', url: '/caisses/', desc: 'Clôtures de caisse', user: 'msandra', mdp: 'admin2026', activite: 'BUR' },

  // === Traiteur (B2B) ===
  { fichier: '20_commandes_b2b.png', url: '/commandes/', desc: 'Liste des commandes B2B Traiteur', user: 'sandra', mdp: 'secret2026', activite: 'TRAIT' },
  { fichier: '21_nouveau_proforma.png', url: '/commandes/nouveau', desc: 'Créer un proforma', user: 'sandra', mdp: 'secret2026', activite: 'TRAIT' },
  { fichier: '22_factures_encaisser.png', url: '/commandes/factures/', desc: 'Factures à encaisser', user: 'sandra', mdp: 'secret2026', activite: 'TRAIT' },
  { fichier: '23_relances.png', url: '/commandes/relances/', desc: 'Factures à relancer', user: 'sandra', mdp: 'secret2026', activite: 'TRAIT' },
  { fichier: '24_dashboard_secretariat.png', url: '/tableau-de-bord/', desc: 'Dashboard Secrétariat', user: 'sandra', mdp: 'secret2026', activite: 'TRAIT' },

  // === Cantine ===
  { fichier: '25_commandes_cantine.png', url: '/commandes/', desc: 'Commandes B2B Cantine (avec blocage jours fériés)', user: 'sandra', mdp: 'secret2026', activite: 'CAN' },

  // === Nestor Distribution ===
  { fichier: '30_dashboard_nestor.png', url: '/tableau-de-bord/', desc: 'Dashboard Distribution (Nestor)', user: 'nestor', mdp: 'dist2026' },
  { fichier: '31_achats.png', url: '/achats/', desc: 'Liste des bons d\'achat', user: 'nestor', mdp: 'dist2026' },
  { fichier: '32_distributions.png', url: '/distributions/', desc: 'Bons de distribution', user: 'nestor', mdp: 'dist2026' },

  // === Gestionnaire (Floriane Pâtisserie) ===
  { fichier: '40_dashboard_gestionnaire.png', url: '/tableau-de-bord/', desc: 'Dashboard Gestionnaire', user: 'floriane', mdp: 'pat2026' },
  { fichier: '41_receptions.png', url: '/stocks/receptions/', desc: 'Réceptions à traiter', user: 'floriane', mdp: 'pat2026' },
  { fichier: '42_alertes.png', url: '/stocks/alertes/', desc: 'Alertes stock', user: 'floriane', mdp: 'pat2026' },
];

async function capturer() {
  console.log('→ Chargement puppeteer...');
  puppeteer = (await import('puppeteer')).default;
  console.log('→ Vérification serveur...');
  const testRes = await fetch(BASE_URL + '/comptes/connexion').catch(() => null);
  if (!testRes) {
    console.error('\n✗ Le serveur ne répond pas sur ' + BASE_URL);
    console.error('  Démarrez-le d\'abord avec : npm start');
    console.error('  Puis relancez : npm run capturer\n');
    process.exit(1);
  }
  console.log('   ✓ Serveur accessible');

  console.log('→ Démarrage du navigateur headless...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1440, height: 900 },
  });

  let currentUser = null;
  let currentActivite = null;

  for (const cap of CAPTURES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    try {
      // (Re)connexion si utilisateur différent
      if (cap.user && cap.user !== currentUser) {
        console.log(`   → Connexion en ${cap.user}...`);
        // Déconnexion propre
        await page.goto(BASE_URL + '/comptes/deconnexion', { waitUntil: 'networkidle0' }).catch(() => {});
        await page.goto(BASE_URL + '/comptes/connexion', { waitUntil: 'networkidle0' });
        await page.type('input[name="username"]', cap.user);
        await page.type('input[name="password"]', cap.mdp);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle0' }),
          page.click('button[type="submit"]'),
        ]);
        currentUser = cap.user;
        currentActivite = null;
      } else if (!cap.user && currentUser) {
        // Page de connexion : déconnexion
        await page.goto(BASE_URL + '/comptes/deconnexion', { waitUntil: 'networkidle0' }).catch(() => {});
        currentUser = null;
      }

      // Bascule activité si nécessaire
      if (cap.activite && cap.activite !== currentActivite) {
        // Trouver l'ID de l'activité via une requête à la DB serait plus propre,
        // ici on utilise l'URL /basculer-activite/<id> ou on cherche via un clic sur le lien
        const db = require('../src/db');
        const act = db.prepare('SELECT id FROM activite WHERE code = ?').get(cap.activite);
        if (act) {
          await page.goto(BASE_URL + '/basculer-activite/' + act.id, { waitUntil: 'networkidle0' }).catch(() => {});
          currentActivite = cap.activite;
        }
      }

      // Naviguer vers l'URL cible
      await page.goto(BASE_URL + cap.url, { waitUntil: 'networkidle0', timeout: 15000 });

      // Cas particulier : cliquer sur "Fiche technique" du premier produit fini
      if (cap.clickFicheTech) {
        // Aller sur un produit ayant une fiche technique
        const db = require('../src/db');
        const p = db.prepare(`SELECT p.id FROM produit p JOIN activite a ON a.id = p.activite_id
                              JOIN fiche_technique ft ON ft.produit_id = p.id
                              WHERE a.code = ? LIMIT 1`).get(cap.activite);
        if (p) {
          await page.goto(`${BASE_URL}/produits/${p.id}/fiche-technique`, { waitUntil: 'networkidle0' });
        }
      }

      // Petit délai pour les animations/rendus JS
      await new Promise(r => setTimeout(r, 500));

      // Capture
      const cheminFichier = path.join(SCREENS_DIR, cap.fichier);
      await page.screenshot({ path: cheminFichier, fullPage: true });
      console.log(`   ✓ ${cap.fichier} — ${cap.desc}`);
    } catch (e) {
      console.error(`   ✗ ${cap.fichier} : ${e.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('\n✓ Captures terminées. Fichiers dans docs/screenshots/');
  console.log('  Régénérez le guide avec : npm run guide\n');
}

capturer().catch(e => { console.error(e); process.exit(1); });
