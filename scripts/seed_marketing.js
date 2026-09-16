// =============================================================================
// SEED MARKETING — Données test pour offres, promotions et statistiques
// =============================================================================
// USAGE :
//   node scripts/seed_marketing.js              → dry-run (affiche le plan)
//   node scripts/seed_marketing.js --confirm    → exécute réellement
//   node scripts/seed_marketing.js --confirm --reset → supprime les promos existantes avant
//
// Peuple :
//   - Paramètre livraison gratuite (10 000 FCFA)
//   - Catégories "Menus" pour BUR et PAT (pour la section "Nos Menus & Combos")
//   - Produits de démo (menus BUR, produits PAT)
//   - 8 promotions couvrant tous les scénarios : code %/FCFA, auto, happy hour,
//     livraison offerte, expirée, à venir, ciblée catégorie
//   - ~30 utilisations réparties sur les 30 derniers jours pour peupler le dashboard stats
// =============================================================================

const db = require('../src/db');

const args = new Set(process.argv.slice(2));
const CONFIRME = args.has('--confirm');
const RESET = args.has('--reset');

const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const isoDT = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const dansJours = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// -----------------------------------------------------------------------------
// AIDE : Trouver ou créer une entité
// -----------------------------------------------------------------------------
function trouverActivite(code) {
  return db.prepare('SELECT id FROM activite WHERE code = ?').get(code)?.id;
}
function trouverOuCreerCategorie(activiteId, nom, description = '') {
  const existante = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND nom = ?').get(activiteId, nom);
  if (existante) return existante.id;
  const info = db.prepare('INSERT INTO categorie (activite_id, nom, description, cree_le) VALUES (?, ?, ?, datetime(\'now\'))').run(activiteId, nom, description);
  return Number(info.lastInsertRowid);
}
function trouverOuCreerProduit(activiteId, ref, nom, prix, categorieId, unite = 'pièce') {
  const existant = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND reference = ?').get(activiteId, ref);
  if (existant) {
    db.prepare('UPDATE produit SET prix_vente = ?, actif = 1, categorie_id = ? WHERE id = ?').run(prix, categorieId, existant.id);
    return existant.id;
  }
  const info = db.prepare(`INSERT INTO produit
    (activite_id, reference, designation, categorie_id, prix_achat, prix_vente,
     stock_actuel, stock_minimum, stock_maximum, unite, actif, cree_le, temps_preparation_min)
    VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, ?, 1, datetime('now'), 10)`)
    .run(activiteId, ref, nom, categorieId, prix, unite);
  return Number(info.lastInsertRowid);
}

// -----------------------------------------------------------------------------
// PROMOTIONS À CRÉER (couvre tous les cas)
// -----------------------------------------------------------------------------
function definirPromotions(ctx) {
  return [
    // 1. Code de bienvenue — 1er commande uniquement
    {
      nom: 'Bienvenue nouveau client',
      code: 'BIENVENUE20',
      type: 'POURCENTAGE', valeur: 20,
      panier_min: 2000, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: dansJours(90),
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: 500, usage_par_client: 1,
      description: '-20% pour votre première commande, panier min 2000 FCFA',
      actif: 1,
    },
    // 2. Code saisonnier — montant fixe
    {
      nom: 'Fête des Mères 2026',
      code: 'MAMAN500',
      type: 'MONTANT_FIXE', valeur: 500,
      panier_min: 3000, activite_id: ctx.patId, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: dansJours(30),
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: null, usage_par_client: 2,
      description: '-500 FCFA sur toute la pâtisserie',
      actif: 1,
    },
    // 3. Happy Hour Café — automatique + créneau horaire
    {
      nom: 'Happy Hour Boissons',
      code: null,
      type: 'POURCENTAGE', valeur: 25,
      panier_min: 0, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: dansJours(60),
      heure_debut: '00:00', heure_fin: '23:59', jours_semaine: 'MON,TUE,WED,THU,FRI,SAT,SUN',
      afficher_banniere: 1,
      usage_max: null, usage_par_client: null,
      description: '-25% sur toutes les boissons chaudes',
      actif: 1,
    },
    // 4. Livraison offerte automatique en soirée
    {
      nom: 'Livraison offerte weekend',
      code: null,
      type: 'LIVRAISON_OFFERTE', valeur: 0,
      panier_min: 5000, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: null,
      heure_debut: '00:00', heure_fin: '23:59', jours_semaine: 'SAT,SUN',
      afficher_banniere: 1,
      usage_max: null, usage_par_client: null,
      description: 'Livraison offerte le weekend dès 5000 FCFA',
      actif: 1,
    },
    // 5. Code partenaire — pourcentage sur activité BUR
    {
      nom: 'Partenaire Bona Burger',
      code: 'BURGER15',
      type: 'POURCENTAGE', valeur: 15,
      panier_min: 3500, activite_id: ctx.burId, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: dansJours(45),
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: 200, usage_par_client: 3,
      description: '-15% Bona Burger, valable 3 fois par client',
      actif: 1,
    },
    // 6. Promotion à venir (activation dans 5 jours)
    {
      nom: 'Ramadan 2027 (à venir)',
      code: 'RAMADAN25',
      type: 'POURCENTAGE', valeur: 25,
      panier_min: 5000, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: dansJours(5), date_fin: dansJours(35),
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: 1000, usage_par_client: 3,
      description: '-25% pendant tout le Ramadan',
      actif: 1,
    },
    // 7. Promotion expirée (démonstration)
    {
      nom: 'Nouvel An 2026 (expiré)',
      code: 'NOEL10',
      type: 'POURCENTAGE', valeur: 10,
      panier_min: 0, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: dansJours(-40), date_fin: dansJours(-15),
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: 300, usage_par_client: 1,
      description: '-10% pour la fin d\'année',
      actif: 1,
    },
    // 8. Promo suspendue (démonstration)
    {
      nom: 'Test admin (suspendue)',
      code: 'TEST50',
      type: 'MONTANT_FIXE', valeur: 500,
      panier_min: 1000, activite_id: null, categorie_id: null, produit_id: null,
      date_debut: null, date_fin: null,
      heure_debut: '', heure_fin: '', jours_semaine: '', afficher_banniere: 0,
      usage_max: null, usage_par_client: null,
      description: 'Test suspendu — ne s\'applique jamais',
      actif: 0,
    },
  ];
}

// -----------------------------------------------------------------------------
// USAGES HISTORIQUES POUR STATS
// -----------------------------------------------------------------------------
// On génère ~30 utilisations réparties sur les 30 derniers jours, majoritairement
// concentrées sur weekends + happy hour horaire pour un dashboard cohérent.
function genererUsages(promoIds) {
  const usages = [];
  const telsFictifs = ['237699111222', '237655444333', '237691234567', '237677889900', '237696112233', '237655667788'];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  for (let i = 0; i < 35; i++) {
    // Date : dans les 30 derniers jours, biais vers weekends
    const jourOffset = -rand(0, 29);
    const d = new Date();
    d.setDate(d.getDate() + jourOffset);
    // Biais horaire : plus d'usages entre 12h-14h et 18h-21h
    const heureBiais = [12, 13, 14, 18, 19, 20, 21, 10, 15, 17];
    d.setHours(heureBiais[rand(0, heureBiais.length - 1)]);
    d.setMinutes(rand(0, 59));
    d.setSeconds(rand(0, 59));

    // Choix promo : 60% code de bienvenue, 25% happy hour auto, 15% autre
    let promoId;
    const r = Math.random();
    if (r < 0.35) promoId = promoIds.BIENVENUE20;
    else if (r < 0.60) promoId = promoIds.HAPPY_HOUR;
    else if (r < 0.75) promoId = promoIds.LIVRAISON_WEEKEND;
    else if (r < 0.88) promoId = promoIds.BURGER15;
    else promoId = promoIds.MAMAN500;

    if (!promoId) continue;

    const remise = rand(300, 3500);
    usages.push({
      promotion_id: promoId,
      client_tel: telsFictifs[rand(0, telsFictifs.length - 1)],
      remise_appliquee: remise,
      date_usage: isoDT(d),
    });
  }
  return usages;
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   SEED MARKETING — Offres, Promotions, Stats             ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const burId = trouverActivite('BUR');
const patId = trouverActivite('PAT');
if (!burId || !patId) throw new Error('Activités BUR/PAT introuvables');

console.log('  Activités : BUR=' + burId + ' · PAT=' + patId);
console.log('  Mode      : ' + (CONFIRME ? '⚠  EXÉCUTION RÉELLE' : '🔍 SIMULATION (dry-run)'));
if (RESET) console.log('  Reset     : ⚠  suppression des promos existantes avant');

const promosPrevues = definirPromotions({ burId, patId });
console.log('\n  À créer :');
console.log('  - Paramètre  : web_livraison_gratuite_seuil = 10000');
console.log('  - Catégories : 2 (Menus BUR, Menus PAT)');
console.log('  - Produits   : 4 menus (2 BUR, 2 PAT)');
console.log('  - Promotions : ' + promosPrevues.length + ' (' + promosPrevues.filter(p => p.code).length + ' codes, ' + promosPrevues.filter(p => !p.code).length + ' auto)');
console.log('  - Usages     : ~35 sur les 30 derniers jours');

if (!CONFIRME) {
  console.log('\n  💡 Mode simulation — aucune modification.');
  console.log('     Pour exécuter : ajouter --confirm\n');
  process.exit(0);
}

const trx = db.transaction(() => {
  // 1. Paramètre livraison gratuite
  const paramExiste = db.prepare("SELECT 1 FROM parametre WHERE cle = 'web_livraison_gratuite_seuil'").get();
  if (paramExiste) {
    db.prepare("UPDATE parametre SET valeur = '10000' WHERE cle = 'web_livraison_gratuite_seuil'").run();
  } else {
    db.prepare("INSERT INTO parametre (cle, valeur, description) VALUES ('web_livraison_gratuite_seuil', '10000', 'Seuil livraison offerte')").run();
  }
  console.log('  ✓ Paramètre livraison gratuite = 10 000 FCFA');

  // 2. Catégories Menus
  const catMenuBUR = trouverOuCreerCategorie(burId, 'Menus complets', 'Nos menus signature avec burger + accompagnement + boisson');
  const catMenuPAT = trouverOuCreerCategorie(patId, 'Combos brunch', 'Formules brunch et goûter à prix doux');
  const catBoissonPAT = trouverOuCreerCategorie(patId, 'Boissons chaudes', 'Café, thé, chocolat chaud');
  console.log('  ✓ Catégories créées / mises à jour');

  // 3. Produits (Menus BUR + PAT + Boissons pour happy hour)
  trouverOuCreerProduit(burId, 'MENU-CHEESE', 'Menu Cheese Deluxe', 5000, catMenuBUR);
  trouverOuCreerProduit(burId, 'MENU-KIDS', 'Menu Kids Bona', 3000, catMenuBUR);
  trouverOuCreerProduit(patId, 'COMBO-BRUNCH', 'Combo Brunch weekend', 6500, catMenuPAT);
  trouverOuCreerProduit(patId, 'COMBO-GOUTER', 'Combo Goûter enfant', 3500, catMenuPAT);
  trouverOuCreerProduit(patId, 'CAFE-EXPRESSO', 'Café espresso', 500, catBoissonPAT);
  trouverOuCreerProduit(patId, 'CAFE-CAPPUCCINO', 'Cappuccino', 1000, catBoissonPAT);
  trouverOuCreerProduit(patId, 'THE-VERT', 'Thé vert menthe', 800, catBoissonPAT);
  trouverOuCreerProduit(patId, 'CHOCOLAT-CHAUD', 'Chocolat chaud maison', 1200, catBoissonPAT);
  console.log('  ✓ 8 produits ajoutés');

  // 4. Activer canal web sur PAT et BUR si pas déjà fait
  const paramWebIds = db.prepare("SELECT valeur FROM parametre WHERE cle = 'web_activites_ids'").get();
  const idsActuels = String(paramWebIds?.valeur || '').split(',').filter(Boolean);
  if (!idsActuels.includes(String(burId))) idsActuels.push(String(burId));
  if (!idsActuels.includes(String(patId))) idsActuels.push(String(patId));
  const nouvelleVal = idsActuels.join(',');
  db.prepare("UPDATE parametre SET valeur = ? WHERE cle = 'web_activites_ids'").run(nouvelleVal);
  console.log('  ✓ Canal web activé sur : ' + nouvelleVal);

  // 5. Reset des promos si demandé
  if (RESET) {
    db.prepare('DELETE FROM promotion_usage').run();
    db.prepare('DELETE FROM promotion').run();
    console.log('  ✓ Promotions existantes vidées');
  }

  // 6. Créer les promotions
  const promoIds = {};
  const insertPromo = db.prepare(`INSERT INTO promotion
    (nom, code, type, valeur, panier_min, categorie_id, produit_id, activite_id,
     date_debut, date_fin, heure_debut, heure_fin, jours_semaine, afficher_banniere,
     usage_max, usage_par_client, description, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updatePromo = db.prepare(`UPDATE promotion SET
    code = ?, type = ?, valeur = ?, panier_min = ?, categorie_id = ?, produit_id = ?, activite_id = ?,
    date_debut = ?, date_fin = ?, heure_debut = ?, heure_fin = ?, jours_semaine = ?, afficher_banniere = ?,
    usage_max = ?, usage_par_client = ?, description = ?, actif = ?,
    modifie_le = datetime('now')
    WHERE nom = ?`);

  for (const p of promosPrevues) {
    const existante = db.prepare('SELECT id FROM promotion WHERE nom = ?').get(p.nom);
    if (existante) {
      updatePromo.run(p.code, p.type, p.valeur, p.panier_min, p.categorie_id, p.produit_id, p.activite_id,
        p.date_debut, p.date_fin, p.heure_debut, p.heure_fin, p.jours_semaine, p.afficher_banniere,
        p.usage_max, p.usage_par_client, p.description, p.actif, p.nom);
      promoIds[p.nom] = existante.id;
    } else {
      const info = insertPromo.run(p.nom, p.code, p.type, p.valeur, p.panier_min, p.categorie_id, p.produit_id, p.activite_id,
        p.date_debut, p.date_fin, p.heure_debut, p.heure_fin, p.jours_semaine, p.afficher_banniere,
        p.usage_max, p.usage_par_client, p.description, p.actif);
      promoIds[p.nom] = Number(info.lastInsertRowid);
    }
  }
  console.log('  ✓ ' + promosPrevues.length + ' promotions créées / mises à jour');

  // 7. Créer historique d'usages
  const idsPourUsages = {
    BIENVENUE20:       promoIds['Bienvenue nouveau client'],
    MAMAN500:          promoIds['Fête des Mères 2026'],
    HAPPY_HOUR:        promoIds['Happy Hour Boissons'],
    LIVRAISON_WEEKEND: promoIds['Livraison offerte weekend'],
    BURGER15:          promoIds['Partenaire Bona Burger'],
  };
  const usages = genererUsages(idsPourUsages);
  const insertUsage = db.prepare(`INSERT INTO promotion_usage
    (promotion_id, commande_web_id, client_tel, remise_appliquee, date_usage)
    VALUES (?, NULL, ?, ?, ?)`);
  const incUsage = db.prepare('UPDATE promotion SET usage_count = usage_count + 1 WHERE id = ?');
  for (const u of usages) {
    insertUsage.run(u.promotion_id, u.client_tel, u.remise_appliquee, u.date_usage);
    incUsage.run(u.promotion_id);
  }
  console.log('  ✓ ' + usages.length + ' utilisations historiques créées (30 derniers jours)');
});

trx();

// Récap
const nbPromos = db.prepare('SELECT COUNT(*) AS n FROM promotion').get().n;
const nbUsages = db.prepare('SELECT COUNT(*) AS n FROM promotion_usage').get().n;
const remiseTotal = db.prepare('SELECT COALESCE(SUM(remise_appliquee),0) AS s FROM promotion_usage').get().s;

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   SEED TERMINÉ                                            ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('  Total promotions en base : ' + nbPromos);
console.log('  Total utilisations      : ' + nbUsages);
console.log('  Remise totale accordée  : ' + Math.round(remiseTotal).toLocaleString('fr-FR').replace(/,/g, ' ') + ' FCFA\n');

console.log('  📋 À VÉRIFIER :');
console.log('     1. Redémarrer le serveur si pas déjà fait (npm start)');
console.log('     2. Ouvrir http://localhost:9000/commander/ → Happy Hour bannière + section Menus');
console.log('     3. Aller sur /commander/offres → 5-6 offres visibles');
console.log('     4. Connecté en DG → /admin/promotions/ → 8 promotions listées');
console.log('     5. Cliquer "Statistiques" → dashboard peuplé avec graphiques');
console.log('     6. Codes à tester au checkout : BIENVENUE20, MAMAN500, BURGER15\n');
