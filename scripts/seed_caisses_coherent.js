// Régénère des sessions de caisse cohérentes pour Pâtisserie et Bona Burger
// avec les 4 modes de paiement RÉELS : ESPECES, CARTE_CREDIT, ORANGE, MTN.
//
// Étape 1 : purge les ventes B2C existantes + clôtures + écritures comptables liées.
// Étape 2 : régénère 6 jours clôturés (écart = 0) + 1 session ouverte pour aujourd'hui.
//
// Utilisation : node scripts/seed_caisses_coherent.js
//               (ou : npm run seed:caisses)

const db = require('../src/db');
const h = require('../src/helpers');

// PRNG déterministe (même graine → mêmes données à chaque run)
let seed = 137;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function randint(a, b) { return Math.floor(rand() * (b - a + 1)) + a; }
function sample(arr, k) {
  const copy = arr.slice(); const out = [];
  for (let i = 0; i < k && copy.length; i++) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}

// Répartition réaliste des modes de paiement B2C au Cameroun
const MODES = [
  { code: 'ESPECES',      poids: 55 },
  { code: 'CARTE_CREDIT', poids: 20 },
  { code: 'ORANGE',       poids: 15 },
  { code: 'MTN',          poids: 10 },
];
function choisirMode() {
  const total = MODES.reduce((s, m) => s + m.poids, 0);
  let r = rand() * total;
  for (const m of MODES) { r -= m.poids; if (r <= 0) return m.code; }
  return 'ESPECES';
}

function iso(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

function activites() {
  return {
    PAT: db.prepare("SELECT * FROM activite WHERE code = 'PAT'").get(),
    BUR: db.prepare("SELECT * FROM activite WHERE code = 'BUR'").get(),
  };
}
function caissiers() {
  return {
    PAT: db.prepare("SELECT * FROM utilisateur WHERE username = 'caiss_pat'").get(),
    BUR: db.prepare("SELECT * FROM utilisateur WHERE username = 'caiss_bur'").get(),
  };
}

function purgerB2C() {
  console.log('→ Purge des ventes et clôtures existantes (PAT + BUR)...');
  const acts = activites();
  let nbVentes = 0, nbClot = 0, nbEcr = 0, nbMvt = 0;
  for (const code of ['PAT', 'BUR']) {
    const a = acts[code];
    if (!a) continue;
    // 1. Écritures comptables liées aux ventes de cette activité
    const ventes = db.prepare('SELECT id FROM vente WHERE activite_id = ?').all(a.id);
    for (const v of ventes) {
      const r = db.prepare("DELETE FROM ecriture_comptable WHERE reference_metier = ?").run(`VENTE#${v.id}`);
      nbEcr += r.changes || 0;
    }
    // 2. Mouvements de stock issus des ventes
    const rMvt = db.prepare("DELETE FROM mouvement_stock WHERE activite_id = ? AND motif LIKE 'Vente %'").run(a.id);
    nbMvt += rMvt.changes || 0;
    // 3. Ventes (lignes cascade via ON DELETE CASCADE)
    const rV = db.prepare('DELETE FROM vente WHERE activite_id = ?').run(a.id);
    nbVentes += rV.changes || 0;
    // 4. Clôtures de caisse
    const rC = db.prepare('DELETE FROM cloture_caisse WHERE activite_id = ?').run(a.id);
    nbClot += rC.changes || 0;
  }
  console.log(`   ${nbVentes} ventes · ${nbClot} clôtures · ${nbMvt} mouvements · ${nbEcr} écritures supprimées.`);
}

// Génère une session complète pour une activité donnée à une date donnée
function creerSession(activiteCode, caissier, dateJour, fond, statutOuvert) {
  const act = db.prepare("SELECT * FROM activite WHERE code = ?").get(activiteCode);
  const numeroCloture = h.prochainNumeroCloture(db, activiteCode);
  const dtOuv = new Date(dateJour); dtOuv.setHours(8, 0, 0, 0);
  const dtClot = new Date(dateJour); dtClot.setHours(20, 30, 0, 0);

  // Produits vendables de l'activité
  const produits = db.prepare(`SELECT * FROM produit WHERE activite_id = ? AND prix_vente > 0 AND actif = 1`).all(act.id);
  if (produits.length === 0) throw new Error(`Aucun produit vendable pour ${activiteCode}`);

  // Insérer la clôture (encore OUVERTE) pour avoir son ID
  const infoClot = db.prepare(`INSERT INTO cloture_caisse
    (activite_id, numero, date_ouverture, fond_ouverture, ouvert_par_id, statut)
    VALUES (?, ?, ?, ?, ?, 'OUVERTE')`).run(
      act.id, numeroCloture, iso(dtOuv), fond, caissier.id
    );
  const clotureId = Number(infoClot.lastInsertRowid);

  // Volume de ventes selon jour de semaine
  const wd = dtOuv.getDay();
  const nbVentes = activiteCode === 'BUR'
    ? (wd === 0 || wd === 6 ? randint(35, 50) : randint(25, 40))
    : (wd === 0 || wd === 6 ? randint(25, 40) : randint(20, 35));

  const insertVente = db.prepare(`INSERT INTO vente
    (activite_id, numero, date_vente, caissier_id, mode_paiement, montant_total, montant_paye, cloture_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLigne = db.prepare(`INSERT INTO ligne_vente
    (vente_id, produit_id, quantite, prix_unitaire) VALUES (?, ?, ?, ?)`);

  const totaux = { ESPECES: 0, CARTE_CREDIT: 0, ORANGE: 0, MTN: 0 };
  let nbLignesTotal = 0;

  for (let k = 0; k < nbVentes; k++) {
    const dt = new Date(dtOuv);
    dt.setHours(randint(9, 20), randint(0, 59), randint(0, 59));
    const numero = h.prochainNumeroVente(db, activiteCode);
    const mode = choisirMode();

    const info = insertVente.run(act.id, numero, iso(dt), caissier.id, mode, 0, 0, clotureId);
    const venteId = Number(info.lastInsertRowid);

    const nbL = randint(1, 3);
    const chosen = sample(produits, nbL);
    let sousTotal = 0;
    for (const p of chosen) {
      const qte = randint(1, 3);
      insertLigne.run(venteId, p.id, qte, p.prix_vente);
      sousTotal += qte * p.prix_vente;
    }
    // montant_paye = montant_total (le client a payé exactement la note)
    db.prepare('UPDATE vente SET montant_total = ?, montant_paye = ? WHERE id = ?')
      .run(sousTotal, sousTotal, venteId);
    totaux[mode] += sousTotal;
    nbLignesTotal += nbL;
  }

  const caTotal = totaux.ESPECES + totaux.CARTE_CREDIT + totaux.ORANGE + totaux.MTN;

  // Si la session doit être clôturée : équilibrer parfaitement (compté = théorique, écart = 0)
  if (!statutOuvert) {
    const theoriqueEsp = fond + totaux.ESPECES;
    db.prepare(`UPDATE cloture_caisse SET
                  date_cloture = ?,
                  statut = 'CLOTUREE',
                  total_theorique_especes = ?,
                  total_compte_especes = ?,
                  total_carte_credit = ?,
                  total_orange = ?,
                  total_mtn = ?,
                  ecart = 0,
                  cloture_par_id = ?
                WHERE id = ?`)
      .run(iso(dtClot), theoriqueEsp, theoriqueEsp,
           totaux.CARTE_CREDIT, totaux.ORANGE, totaux.MTN,
           caissier.id, clotureId);
  }

  const statutLbl = statutOuvert ? 'OUVERTE ' : 'CLOTUREE';
  console.log(`   ${activiteCode} ${numeroCloture} · ${statutLbl} · ${nbVentes} ventes / ${nbLignesTotal} lignes · CA ${caTotal.toLocaleString('fr-FR')} FCFA` +
              `  [ESP ${totaux.ESPECES.toLocaleString('fr-FR')} · CC ${totaux.CARTE_CREDIT.toLocaleString('fr-FR')} · OM ${totaux.ORANGE.toLocaleString('fr-FR')} · MTN ${totaux.MTN.toLocaleString('fr-FR')}]`);
}

function main() {
  const c = caissiers();
  if (!c.PAT || !c.BUR) {
    console.error('\n  ✗ Caissiers introuvables (caiss_pat / caiss_bur). Lancez d\'abord `npm run setup`.\n');
    process.exit(1);
  }

  const NB_JOURS_CLOTURES = 6;
  const FOND = { PAT: 15000, BUR: 20000 };

  const runAll = db.transaction(() => {
    purgerB2C();

    console.log(`\n→ Génération de ${NB_JOURS_CLOTURES} jours clôturés + 1 session ouverte (PAT + BUR)...\n`);
    const now = new Date();

    for (let j = NB_JOURS_CLOTURES; j >= 1; j--) {
      const jour = new Date(now.getTime() - j * 86400000);
      creerSession('PAT', c.PAT, jour, FOND.PAT, false);
      creerSession('BUR', c.BUR, jour, FOND.BUR, false);
    }
    // Aujourd'hui : sessions encore ouvertes (encaissement en cours)
    creerSession('PAT', c.PAT, now, FOND.PAT, true);
    creerSession('BUR', c.BUR, now, FOND.BUR, true);
  });
  runAll();

  console.log('\n  ✓ Données cohérentes injectées.');
  console.log(`     · ${NB_JOURS_CLOTURES} clôtures équilibrées par activité (écart = 0)`);
  console.log('     · 1 session OUVERTE par activité (aujourd\'hui)');
  console.log('     · Modes utilisés : ESPECES, CARTE_CREDIT, ORANGE, MTN');
  console.log('\n  → Ouvrez /caisses/ dans l\'app pour vérifier.\n');
}

main();
