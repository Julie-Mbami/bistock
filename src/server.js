const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const helpers = require('./helpers');

const app = express();

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(config.BASE_DIR, 'views'));

// ---------- Middlewares ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(config.BASE_DIR, 'public')));
app.use('/media', express.static(config.UPLOADS_DIR));

// Warning explicite si on tourne en dev avec le secret par défaut (ne bloque pas mais alerte)
if (config.NODE_ENV !== 'production' && config.SESSION_SECRET === 'dev-insecure-key-change-me') {
  console.warn('  ⚠  SESSION_SECRET utilise la valeur par défaut de dev. En production, définissez-le dans .env');
}
// Cookie sécurisé activable via variable d'env COOKIE_SECURE=1 (seulement si l'app est
// derrière HTTPS avec un reverse proxy correctement configuré). En local HTTP, laisser à 0.
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.COOKIE_SECURE === '1',
    sameSite: 'lax',
  },
}));
app.use(flash());

// Vérifier que le schéma existe
const schemaExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='utilisateur'").get();
if (!schemaExists) {
  console.error('\n  ✗ La base est vide. Exécutez d\'abord : npm run setup\n');
  process.exit(1);
}
// Vérifier que la table activite existe (post-refonte)
const hasActivite = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activite'").get();
if (!hasActivite) {
  console.error('\n  ✗ Le schéma est obsolète (pas de table activite). Réinitialisez avec : Remove-Item data\\app.db -Force; npm run setup\n');
  process.exit(1);
}

// ---------- Migrations légères (idempotentes) ----------
function ajouterColonneSiAbsente(table, colonne, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === colonne)) {
    try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`).run(); console.log(`  + Colonne ajoutée : ${table}.${colonne}`); }
    catch (e) { console.warn(`  ! Migration ${table}.${colonne} : ${e.message}`); }
  }
}
ajouterColonneSiAbsente('commande', 'montant_ht', 'REAL DEFAULT 0');
// TVA par ligne d'article (0 = exonéré, sinon taux %)
ajouterColonneSiAbsente('ligne_commande', 'taux_tva', 'REAL DEFAULT 0');
// Frais de livraison sur la commande (0 = livraison offerte, > 0 = facturée)
ajouterColonneSiAbsente('commande', 'frais_livraison', 'REAL DEFAULT 0');
ajouterColonneSiAbsente('paiement', 'piece_jointe', "TEXT DEFAULT ''");
// Nouveau mode de paiement B2C : Carte de crédit (colonne dédiée dans les clôtures de caisse)
ajouterColonneSiAbsente('cloture_caisse', 'total_carte_credit', 'REAL DEFAULT 0');
ajouterColonneSiAbsente('alerte', 'source', "TEXT DEFAULT 'STOCK'");
ajouterColonneSiAbsente('alerte', 'contexte_json', "TEXT DEFAULT ''");

// Table relance (créée si absente sur les bases anciennes)
db.exec(`CREATE TABLE IF NOT EXISTS relance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commande(id) ON DELETE CASCADE,
  niveau TEXT NOT NULL,
  canal TEXT DEFAULT 'IMPRIMEE',
  date_envoi TEXT DEFAULT (datetime('now')),
  envoye_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_relance_commande ON relance(commande_id, date_envoi DESC);`);

// Tables fiche_technique + composition_fiche (recettes / nomenclatures cuisine)
db.exec(`CREATE TABLE IF NOT EXISTS fiche_technique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL UNIQUE REFERENCES produit(id) ON DELETE CASCADE,
  rendement INTEGER DEFAULT 1,
  actif INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  cree_le TEXT DEFAULT (datetime('now')),
  modifie_le TEXT DEFAULT (datetime('now')),
  cree_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS composition_fiche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiche_technique(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES produit(id),
  quantite REAL NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_composition_fiche ON composition_fiche(fiche_id);
CREATE INDEX IF NOT EXISTS idx_composition_ingredient ON composition_fiche(ingredient_id);
CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  numero TEXT UNIQUE NOT NULL,
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  quantite_produite REAL NOT NULL,
  date_production TEXT DEFAULT (datetime('now')),
  produit_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  cout_matiere REAL DEFAULT 0,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_prod_activite_date ON production(activite_id, date_production DESC);`);
ajouterColonneSiAbsente('fiche_technique', 'mode_production', "TEXT DEFAULT 'BATCH'");
// Workflow production en 3 étapes : BROUILLON (cuisinier) → EN_COURS (gestionnaire a sorti les ingrédients) → TERMINEE (cuisinier a fini)
// Les productions historiques sans statut sont considérées TERMINEE (comportement précédent : tout fait en 1 clic)
ajouterColonneSiAbsente('production', 'statut', "TEXT DEFAULT 'TERMINEE'");
ajouterColonneSiAbsente('production', 'valide_par_id', 'INTEGER');
ajouterColonneSiAbsente('production', 'date_validation', 'TEXT');
ajouterColonneSiAbsente('production', 'date_fin', 'TEXT');
ajouterColonneSiAbsente('production', 'motif_annulation', "TEXT DEFAULT ''");
// Notif cuisinier : timestamp de la dernière consultation par le créateur (pour badge notifs validation/refus)
ajouterColonneSiAbsente('production', 'vue_par_cuisinier_le', 'TEXT');
// Lien vers une commande web B2C — permet au caissier de déclencher la préparation cuisine depuis /ventes-web
ajouterColonneSiAbsente('production', 'commande_web_id', 'INTEGER');
// Mapping comptable par activité (rend l'ajout d'une nouvelle activité 100% dynamique)
ajouterColonneSiAbsente('activite', 'journal_code',  "TEXT DEFAULT ''");  // ex: CA-TR, CA-XX
ajouterColonneSiAbsente('activite', 'compte_caisse', "TEXT DEFAULT ''");  // ex: 571, 575
// Temps de préparation cuisine, affiché sur le catalogue web et utilisé pour l'estimation "Prêt vers HH:MM"
ajouterColonneSiAbsente('produit', 'temps_preparation_min', 'INTEGER DEFAULT 15');

// ============================================================
// SUPPLÉMENTS PRODUITS — cases à cocher optionnelles par produit
// (ex: burger + fromage +500F, + bacon +800F...)
// ============================================================
db.exec(`CREATE TABLE IF NOT EXISTS supplement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL REFERENCES produit(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  prix REAL NOT NULL DEFAULT 0,
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_supplement_produit ON supplement(produit_id, ordre);

-- Suppléments choisis par le client au sein d'une commande web (snapshot du nom et prix)
CREATE TABLE IF NOT EXISTS ligne_commande_web_supplement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ligne_id INTEGER NOT NULL REFERENCES ligne_commande_client_web(id) ON DELETE CASCADE,
  supplement_id INTEGER,
  nom TEXT NOT NULL,
  prix REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lcws_ligne ON ligne_commande_web_supplement(ligne_id);
`);

// Backfill des 4 activités seed avec leur mapping historique
const seedMapActivite = [
  ['TRAIT', 'CA-TR', '571'], ['TRAITEUR', 'CA-TR', '571'],
  ['CAN',   'CA-CA', '572'], ['CANTINE',  'CA-CA', '572'],
  ['PAT',   'CA-PA', '573'], ['PATISSERIE', 'CA-PA', '573'],
  ['BUR',   'CA-BU', '574'], ['BURGER',   'CA-BU', '574'],
];
const majActMap = db.prepare("UPDATE activite SET journal_code = ?, compte_caisse = ? WHERE code = ? AND (journal_code = '' OR journal_code IS NULL)");
for (const [code, jrn, cpt] of seedMapActivite) majActMap.run(jrn, cpt, code);

// ============================================================
// COMPTABILITÉ — Plan comptable OHADA + écritures + journaux
// Régime : Assujetti TVA 19,25% · 4 caisses (571-574) · 1 banque (521) · Journalisation à partir d'installation
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS compte_comptable (
  numero TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  classe INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'BILAN',       -- BILAN ou RESULTAT
  sens_normal TEXT NOT NULL DEFAULT 'D',    -- D ou C (sens du solde normal)
  actif INTEGER DEFAULT 1,
  parent_numero TEXT,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS journal_comptable (
  code TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  compte_contrepartie TEXT,                 -- compte par défaut du journal (ex: 571 pour CA-TR)
  couleur TEXT DEFAULT '#3B82F6',
  actif INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ecriture_comptable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_ecriture TEXT NOT NULL,
  journal TEXT NOT NULL,
  numero_piece TEXT NOT NULL,               -- ex: VE-2026-000042
  libelle TEXT NOT NULL,
  compte TEXT NOT NULL,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  reference_metier TEXT DEFAULT '',         -- ex: VENTE#1234, COMMANDE#567, ACHAT#42
  activite_id INTEGER,
  utilisateur_id INTEGER,
  lettrage TEXT DEFAULT '',
  cree_le TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ecriture_compte ON ecriture_comptable(compte);
CREATE INDEX IF NOT EXISTS idx_ecriture_date ON ecriture_comptable(date_ecriture);
CREATE INDEX IF NOT EXISTS idx_ecriture_journal ON ecriture_comptable(journal);
CREATE INDEX IF NOT EXISTS idx_ecriture_ref ON ecriture_comptable(reference_metier);
`);

// Seed plan comptable OHADA — comptes utilisés par l'app (idempotent : INSERT OR IGNORE)
const seedCompte = db.prepare(`INSERT OR IGNORE INTO compte_comptable (numero, libelle, classe, type, sens_normal, parent_numero) VALUES (?, ?, ?, ?, ?, ?)`);
const COMPTES_OHADA = [
  // Classe 1 — Ressources durables
  ['10',  'Capital et réserves',           1, 'BILAN', 'C', null],
  ['101', 'Capital social',                1, 'BILAN', 'C', '10'],
  ['106', 'Réserves',                       1, 'BILAN', 'C', '10'],
  ['12',  'Résultat en instance',           1, 'BILAN', 'C', null],
  ['120', 'Report à nouveau',              1, 'BILAN', 'C', '12'],
  ['130', 'Résultat de l\'exercice',        1, 'BILAN', 'C', '12'],
  // Classe 2 — Immobilisations
  ['24',  'Matériel',                       2, 'BILAN', 'D', null],
  ['241', 'Matériel et outillage',          2, 'BILAN', 'D', '24'],
  ['244', 'Matériel informatique',          2, 'BILAN', 'D', '24'],
  ['245', 'Matériel de transport',          2, 'BILAN', 'D', '24'],
  ['281', 'Amortissements des immobilisations', 2, 'BILAN', 'C', null],
  // Classe 3 — Stocks
  ['31',  'Marchandises',                   3, 'BILAN', 'D', null],
  ['311', 'Marchandises A',                 3, 'BILAN', 'D', '31'],
  ['32',  'Matières premières',             3, 'BILAN', 'D', null],
  ['322', 'Matières premières (ingrédients)', 3, 'BILAN', 'D', '32'],
  ['35',  'Produits finis',                 3, 'BILAN', 'D', null],
  ['355', 'Produits finis fabriqués',       3, 'BILAN', 'D', '35'],
  // Classe 4 — Tiers
  ['401', 'Fournisseurs',                   4, 'BILAN', 'C', null],
  ['411', 'Clients',                        4, 'BILAN', 'D', null],
  ['419', 'Clients — avances reçues',       4, 'BILAN', 'C', null],
  ['421', 'Personnel — rémunérations dues', 4, 'BILAN', 'C', null],
  ['431', 'CNPS — cotisations à payer',     4, 'BILAN', 'C', null],
  ['443', 'État — TVA facturée (collectée)', 4, 'BILAN', 'C', null],
  ['445', 'État — TVA récupérable (déductible)', 4, 'BILAN', 'D', null],
  ['4441', 'État — Impôt sur les sociétés', 4, 'BILAN', 'C', null],
  ['4451', 'État — TVA à décaisser (net)',  4, 'BILAN', 'C', null],
  // Classe 5 — Trésorerie
  ['52',  'Banques',                        5, 'BILAN', 'D', null],
  ['521', 'Banque compte principal',        5, 'BILAN', 'D', '52'],
  ['57',  'Caisses',                        5, 'BILAN', 'D', null],
  ['571', 'Caisse — Traiteur',              5, 'BILAN', 'D', '57'],
  ['572', 'Caisse — Cantine',               5, 'BILAN', 'D', '57'],
  ['573', 'Caisse — Pâtisserie/Salon/Restaurant', 5, 'BILAN', 'D', '57'],
  ['574', 'Caisse — 237 Bona Burger',       5, 'BILAN', 'D', '57'],
  // Classe 6 — Charges
  ['601', 'Achats de marchandises',         6, 'RESULTAT', 'D', null],
  ['604', 'Achats stockés — matières premières', 6, 'RESULTAT', 'D', null],
  ['605', 'Autres achats (fournitures)',    6, 'RESULTAT', 'D', null],
  ['611', 'Transport',                      6, 'RESULTAT', 'D', null],
  ['622', 'Locations',                      6, 'RESULTAT', 'D', null],
  ['624', 'Entretien et maintenance',       6, 'RESULTAT', 'D', null],
  ['641', 'Impôts et taxes',                6, 'RESULTAT', 'D', null],
  ['654', 'Pertes sur stocks',              6, 'RESULTAT', 'D', null],
  ['661', 'Rémunérations directes (salaires)', 6, 'RESULTAT', 'D', null],
  ['664', 'Charges sociales (CNPS)',        6, 'RESULTAT', 'D', null],
  ['674', 'Autres charges',                 6, 'RESULTAT', 'D', null],
  // Classe 7 — Produits
  ['701', 'Ventes de produits finis',       7, 'RESULTAT', 'C', null],
  ['707', 'Ventes de marchandises',         7, 'RESULTAT', 'C', null],
  ['708', 'Produits accessoires (livraison)', 7, 'RESULTAT', 'C', null],
  ['754', 'Produits sur excédents',         7, 'RESULTAT', 'C', null],
  ['758', 'Produits divers',                7, 'RESULTAT', 'C', null],
];
for (const c of COMPTES_OHADA) seedCompte.run(...c);

// Seed journaux comptables
const seedJournal = db.prepare(`INSERT OR IGNORE INTO journal_comptable (code, libelle, compte_contrepartie, couleur) VALUES (?, ?, ?, ?)`);
const JOURNAUX = [
  ['VE', 'Ventes',                     null,  '#10B981'],
  ['AC', 'Achats',                     '401', '#F59E0B'],
  ['CA-TR', 'Caisse Traiteur',         '571', '#3B82F6'],
  ['CA-CA', 'Caisse Cantine',          '572', '#3B82F6'],
  ['CA-PA', 'Caisse Pâtisserie',       '573', '#3B82F6'],
  ['CA-BU', 'Caisse Bona Burger',      '574', '#3B82F6'],
  ['BQ', 'Banque',                     '521', '#8B5CF6'],
  ['PA', 'Paie',                       null,  '#EC4899'],
  ['ST', 'Stocks (production, perte)', null,  '#6B7280'],
  ['OD', 'Opérations diverses',        null,  '#64748B'],
];
for (const j of JOURNAUX) seedJournal.run(...j);


// Canal web B2C : trace de l'origine des ventes + lien vers la commande web
ajouterColonneSiAbsente('vente', 'origine', "TEXT DEFAULT 'CAISSE'"); // 'CAISSE' ou 'WEB'
ajouterColonneSiAbsente('vente', 'commande_web_id', "INTEGER");
// Commandes web : mode de paiement indicatif choisi par le client + motif d'annulation
ajouterColonneSiAbsente('commande_client_web', 'mode_paiement_prevu', "TEXT DEFAULT ''");
ajouterColonneSiAbsente('commande_client_web', 'motif_annulation', "TEXT DEFAULT ''");
ajouterColonneSiAbsente('commande_client_web', 'annulee_par', "TEXT DEFAULT ''"); // 'CLIENT' ou 'CAISSIER'
// SQLite refuse un default non-constant sur ALTER TABLE — on ajoute la colonne sans default puis on peuple
ajouterColonneSiAbsente('commande_client_web', 'modifie_le', "TEXT");
try { db.prepare("UPDATE commande_client_web SET modifie_le = COALESCE(modifie_le, date_creation, datetime('now')) WHERE modifie_le IS NULL OR modifie_le = ''").run(); } catch(e) {}
// Phase 2 marketing — colonnes de traçabilité promotion
ajouterColonneSiAbsente('commande_client_web', 'promotion_id', 'INTEGER');
ajouterColonneSiAbsente('commande_client_web', 'code_promo_utilise', "TEXT DEFAULT ''");
ajouterColonneSiAbsente('commande_client_web', 'remise_promo', 'REAL DEFAULT 0');
// Phase 3 — happy hour / créneaux horaires sur les promotions
ajouterColonneSiAbsente('promotion', 'heure_debut', "TEXT DEFAULT ''"); // HH:MM ex '14:00'
ajouterColonneSiAbsente('promotion', 'heure_fin', "TEXT DEFAULT ''");   // HH:MM ex '18:00'
ajouterColonneSiAbsente('promotion', 'jours_semaine', "TEXT DEFAULT ''"); // 'MON,TUE,WED,...' vide = tous
ajouterColonneSiAbsente('promotion', 'afficher_banniere', 'INTEGER DEFAULT 1'); // 1 = visible en bannière si auto

// ============================================================
// PROMOTIONS (Phase 2 marketing — codes promo + réductions auto)
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS promotion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  code TEXT UNIQUE,                       -- NULL = promo automatique sans code
  type TEXT NOT NULL,                     -- 'POURCENTAGE' | 'MONTANT_FIXE' | 'LIVRAISON_OFFERTE'
  valeur REAL NOT NULL DEFAULT 0,
  panier_min REAL NOT NULL DEFAULT 0,
  categorie_id INTEGER,                   -- NULL = tout le catalogue
  produit_id INTEGER,                     -- NULL = tout produit (si categorie_id aussi NULL)
  activite_id INTEGER,                    -- NULL = toutes activités web
  date_debut TEXT,                        -- ISO date, NULL = actif immédiatement
  date_fin TEXT,                          -- ISO date, NULL = pas de fin
  usage_max INTEGER,                      -- NULL = illimité
  usage_par_client INTEGER,               -- NULL = illimité par client
  usage_count INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_promo_code ON promotion(code);
CREATE INDEX IF NOT EXISTS idx_promo_actif ON promotion(actif);

CREATE TABLE IF NOT EXISTS promotion_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion_id INTEGER NOT NULL,
  commande_web_id INTEGER,
  client_tel TEXT DEFAULT '',
  remise_appliquee REAL NOT NULL DEFAULT 0,
  date_usage TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotion(id)
);
CREATE INDEX IF NOT EXISTS idx_promo_usage_promo ON promotion_usage(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_tel ON promotion_usage(client_tel);
`);

// ============================================================
// CANAL B2C WEB (commandes en ligne clients finaux) — tables isolées
// ============================================================
db.exec(`
CREATE TABLE IF NOT EXISTS commande_client_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_suivi TEXT UNIQUE NOT NULL,
  client_nom TEXT NOT NULL,
  client_tel TEXT NOT NULL,
  mode_recuperation TEXT NOT NULL,        -- 'RETRAIT' ou 'LIVRAISON'
  quartier TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  sous_total REAL NOT NULL DEFAULT 0,
  frais_livraison REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'NOUVELLE',  -- NOUVELLE, CONFIRMEE, PRETE, RECUPEREE, LIVREE, ANNULEE
  notes_client TEXT DEFAULT '',
  date_creation TEXT DEFAULT (datetime('now')),
  date_confirmation TEXT,
  date_prete TEXT,
  date_fin TEXT,
  confirme_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS ligne_commande_client_web (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commande_client_web(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produit(id) ON DELETE RESTRICT,
  activite_id INTEGER NOT NULL REFERENCES activite(id) ON DELETE RESTRICT,
  designation TEXT NOT NULL,
  prix_unitaire REAL NOT NULL,
  quantite INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ccw_statut ON commande_client_web(statut);
CREATE INDEX IF NOT EXISTS idx_ccw_code ON commande_client_web(code_suivi);
CREATE INDEX IF NOT EXISTS idx_lccw_commande ON ligne_commande_client_web(commande_id);
CREATE INDEX IF NOT EXISTS idx_lccw_activite ON ligne_commande_client_web(activite_id);
`);

// Paramètres bancaires + pré-remplissage infos réelles Traiteur du Bistrot (source: facture 2026)
const insParam = db.prepare("INSERT OR IGNORE INTO parametre (cle, valeur, libelle, type) VALUES (?, ?, ?, 'texte')");
insParam.run('entreprise_banque_nom',     'SGC Douala Bonanjo', 'Nom de la banque (pour virements)');
insParam.run('entreprise_banque_compte',  '06010429558 55', 'Numéro de compte / RIB / IBAN');
insParam.run('entreprise_banque_swift',   '', 'Code SWIFT / BIC');
insParam.run('entreprise_cheque_libelle', 'LE TRAITEUR DU BISTROT SUARL', "Libellé du chèque (à l'ordre de...)");
// Paramètres du canal web B2C
insParam.run('web_canal_actif',      '1',    'Activer le canal de commande en ligne (0/1)');
insParam.run('web_frais_livraison',  '1000', 'Frais de livraison par défaut (FCFA)');
insParam.run('web_livraison_gratuite_seuil', '0', 'Seuil de sous-total pour livraison offerte (FCFA, 0 = jamais offerte)');
insParam.run('web_activites_ids',    '',     "IDs d'activités visibles sur le canal web (séparés par virgule, vide = toutes B2C)");
insParam.run('web_horaires',         'Lun-Ven 8h-22h', 'Horaires affichés sur le canal client');
// Corriger la valeur existante si elle était encore à l'ancien défaut (idempotent, ignore si la DG a personnalisé)
try { db.prepare("UPDATE parametre SET valeur = 'Lun-Ven 8h-22h' WHERE cle = 'web_horaires' AND valeur = 'Lun-Sam 8h-22h'").run(); } catch(e) {}
insParam.run('web_note_moyenne',     '4.8',  'Note affichée sur le canal client (0 pour cacher)');
insParam.run('web_nb_avis',          '',     "Nombre d'avis affiché entre parenthèses (vide pour cacher)");
insParam.run('web_orange_code',      '',     'Code marchand Orange Money affiché au client (ex: 699695969)');
insParam.run('web_mtn_code',         '',     'Code marchand MTN Mobile Money affiché au client (ex: 699695969)');

// Compléter identité entreprise si vide (une seule fois)
const majParam = db.prepare("UPDATE parametre SET valeur = ? WHERE cle = ? AND (valeur IS NULL OR valeur = '' OR valeur = ?)");
majParam.run('LE TRAITEUR DU BISTROT SUARL', 'entreprise_nom', 'Le Traiteur du Bistrot');
majParam.run('Rue Bâti bois, Bonapriso - BP: 434 Douala, Cameroun', 'entreprise_adresse', 'Douala, Cameroun');
majParam.run('(237) 699 69 59 69 / 699 97 20 48', 'entreprise_tel', '+237 690 00 00 00');
majParam.run('bistrolatin97@yahoo.fr', 'entreprise_email', 'contact@traiteurbistrot.cm');
majParam.run('M011300044639Y', 'entreprise_niu', '');
majParam.run('RC/DLA/2013/B/514', 'entreprise_rccm', '');

// ============================================================
// Contexte global — chargement user + activité courante + res.locals
// ============================================================
app.use((req, res, next) => {
  let user = null;
  if (req.session.userId) {
    user = db.prepare('SELECT * FROM utilisateur WHERE id = ? AND is_active = 1').get(req.session.userId);
  }
  req.user = user;

  // Activités accessibles et activité courante
  let activitesAcc = [];
  let activiteCourante = null;
  let activiteObj = null;
  if (user) {
    const ids = helpers.activitesAccessibles(db, user);
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      activitesAcc = db.prepare(`SELECT * FROM activite WHERE id IN (${placeholders}) ORDER BY id`).all(...ids);
      activiteCourante = helpers.currentActiviteId(db, user, req.session);
      activiteObj = db.prepare('SELECT * FROM activite WHERE id = ?').get(activiteCourante);
    }
  }
  req.activiteId = activiteCourante;
  req.activite = activiteObj;
  req.activitesAccessibles = activitesAcc;

  // Compteur d'alertes non lues — dans le périmètre de l'utilisateur
  let nb_alertes_non_lues = 0;
  let nb_receptions_en_attente = 0;
  let nb_relances_a_faire = 0;
  // Compteurs pour la Distribution (achats à réceptionner, distributions à remettre)
  let nb_achats_a_receptionner = 0;
  let nb_distributions_a_remettre = 0;
  // Commandes web à traiter (sur l'activité courante)
  let nb_commandes_web = 0;
  if (user && activitesAcc.length) {
    const ids = activitesAcc.map(a => a.id);
    const placeholders = ids.map(() => '?').join(',');
    const row = db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE vue = 0 AND activite_id IN (${placeholders})`).get(...ids);
    nb_alertes_non_lues = row ? row.n : 0;
    // Compteurs uniquement pour le rôle DISTRIBUTION — la DG et les autres rôles ne font pas ces gestes
    if (helpers.isDistribution(user)) {
      const rA = db.prepare("SELECT COUNT(*) AS n FROM achat WHERE statut = 'SAISI'").get();
      nb_achats_a_receptionner = rA ? rA.n : 0;
      const rD = db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'PREPAREE'").get();
      nb_distributions_a_remettre = rD ? rD.n : 0;
    }
    // Réceptions à traiter dans l'activité courante
    if (activiteCourante) {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'REMISE'`).get(activiteCourante);
      nb_receptions_en_attente = r ? r.n : 0;

      // Demandes de production en attente de validation par le gestionnaire de l'activité
      const rProd = db.prepare(`SELECT COUNT(*) AS n FROM production
                                 WHERE activite_id = ? AND statut = 'BROUILLON'`).get(activiteCourante);
      res.locals.nb_productions_a_valider = rProd ? rProd.n : 0;
      // Demandes de production issues d'une commande web (envoyées par le caissier)
      // encore non terminées (BROUILLON ou EN_COURS) — visible pour cuisinier / gestionnaire / DG
      const rProdWeb = db.prepare(`SELECT COUNT(*) AS n FROM production
                                    WHERE activite_id = ? AND commande_web_id IS NOT NULL
                                      AND statut IN ('BROUILLON', 'EN_COURS')`).get(activiteCourante);
      res.locals.nb_productions_web_a_traiter = rProdWeb ? rProdWeb.n : 0;

      // Notifications cuisinier : ses propres demandes qui viennent d'être validées ou refusées et qu'il n'a pas encore consultées
      if (helpers.isCuisinier(user)) {
        const rNotif = db.prepare(`SELECT COUNT(*) AS n FROM production
                                    WHERE activite_id = ? AND produit_par_id = ?
                                      AND (
                                        (statut = 'EN_COURS' AND (vue_par_cuisinier_le IS NULL OR vue_par_cuisinier_le < date_validation))
                                        OR
                                        (statut = 'ANNULEE' AND motif_annulation LIKE 'Refus gestionnaire%'
                                         AND (vue_par_cuisinier_le IS NULL OR vue_par_cuisinier_le < date_fin))
                                      )`).get(activiteCourante, user.id);
        res.locals.nb_notifs_cuisinier = rNotif ? rNotif.n : 0;
      }

      // Commandes web NOUVELLES ou CONFIRMEES/PRETE — au moins une ligne dans l'activité courante
      const rW = db.prepare(`SELECT COUNT(DISTINCT c.id) AS n FROM commande_client_web c
                              JOIN ligne_commande_client_web l ON l.commande_id = c.id
                              WHERE l.activite_id = ?
                                AND c.statut IN ('NOUVELLE', 'CONFIRMEE', 'PRETE')`).get(activiteCourante);
      nb_commandes_web = rW ? rW.n : 0;

      // Relances à faire dans l'activité courante (secretariat/DG uniquement)
      if (activiteObj && activiteObj.type === 'B2B_COMMANDE' && (helpers.isSecretariat(user) || helpers.isDG(user))) {
        const impayees = db.prepare(`SELECT c.id, c.montant_total, c.montant_paye, c.date_echeance, c.statut
                                     FROM commande c
                                     WHERE c.activite_id = ? AND c.statut = 'FACTUREE'
                                       AND c.montant_paye + 0.01 < c.montant_total`).all(activiteCourante);
        for (const cmd of impayees) {
          const relances = db.prepare('SELECT niveau FROM relance WHERE commande_id = ?').all(cmd.id);
          const a = helpers.analyseRelance(cmd, relances);
          if (a.prochain_niveau) nb_relances_a_faire++;
        }
      }
    }
  }

  // Messages flash
  const flashMessages = [];
  for (const type of ['success', 'error', 'warning', 'info']) {
    for (const msg of req.flash(type)) {
      flashMessages.push({ tags: type === 'error' ? 'danger' : type, text: msg });
    }
  }

  // Construction du user enrichi pour les templates
  const userLocal = user ? {
    ...user,
    // Rétro-compat avec l'ancienne API (pour ne pas casser les templates existants)
    est_admin: helpers.isDG(user),
    est_gestionnaire: helpers.isGestionnaire(user) || helpers.isDG(user) || helpers.isSecretariat(user),
    est_caissier: helpers.isCaissier(user) || helpers.isDG(user) || helpers.isGestionnaire(user),
    // Nouveaux prédicats
    est_dg: helpers.isDG(user),
    est_secretariat: helpers.isSecretariat(user),
    est_distribution: helpers.isDistribution(user),
    est_cuisinier: helpers.isCuisinier(user),
    est_transversal: helpers.isTransversal(user),
    // Nom affiché avec titre (ex : "Mme <prénom> (DG)" au lieu du prénom seul)
    nom_affiche: ((user.titre ? user.titre + ' ' : '') + (user.first_name || user.username || '')).trim(),
    role_label: helpers.ROLE_LABEL[user.role] || user.role,
  } : null;

  // Charger les paramètres système depuis la DB (cache 30s)
  const params = helpers.chargerParametres(db);

  res.locals.user = userLocal;
  res.locals.activite = activiteObj;
  res.locals.activites_accessibles = activitesAcc;
  res.locals.devise = params.devise || config.DEVISE;
  res.locals.entreprise_nom = params.entreprise_nom || config.ENTREPRISE_NOM;
  res.locals.entreprise_adresse = params.entreprise_adresse || config.ENTREPRISE_ADRESSE;
  res.locals.entreprise_tel = params.entreprise_tel || config.ENTREPRISE_TEL;
  res.locals.entreprise_email = params.entreprise_email || '';
  res.locals.entreprise_niu = params.entreprise_niu || '';
  res.locals.entreprise_rccm = params.entreprise_rccm || '';
  res.locals.taux_tva = params.taux_tva || config.TAUX_TVA;
  res.locals.parametres = params;
  req.parametres = params;
  res.locals.nb_alertes_non_lues = nb_alertes_non_lues;
  res.locals.nb_receptions_en_attente = nb_receptions_en_attente;
  res.locals.nb_relances_a_faire = nb_relances_a_faire;
  res.locals.nb_achats_a_receptionner = nb_achats_a_receptionner;
  res.locals.nb_distributions_a_remettre = nb_distributions_a_remettre;
  res.locals.nb_commandes_web = nb_commandes_web;
  res.locals.messages = flashMessages;
  res.locals.request_path = req.path;
  res.locals.query = req.query;
  res.locals.h = helpers;
  // Helper de permission utilisable dans les templates : peut('feature')
  res.locals.peut = user
    ? (feature) => helpers.utilisateurPeut(db, user, feature, activiteCourante)
    : () => false;
  next();
});

// ============================================================
// Sélecteur d'activité pour DG / Distribution / Secrétariat
// ============================================================
app.get('/activite/:id/selectionner', (req, res) => {
  if (!req.user) return res.redirect('/comptes/connexion');
  const cible = Number(req.params.id);
  if (!helpers.hasAccessToActivite(db, req.user, cible)) {
    req.flash('error', "Vous n'avez pas accès à cette activité.");
    return res.redirect('/tableau-de-bord/');
  }
  req.session.activiteId = cible;
  const activite = db.prepare('SELECT nom FROM activite WHERE id = ?').get(cible);
  req.flash('info', `Activité active : ${activite.nom}`);
  res.redirect(req.headers.referer || '/tableau-de-bord/');
});

// ============================================================
// Middlewares de contrôle d'accès
// ============================================================
function loginRequired(req, res, next) {
  if (!req.user) {
    req.flash('info', 'Veuillez vous connecter.');
    return res.redirect('/comptes/connexion');
  }
  next();
}
function dgRequired(req, res, next) {
  if (!req.user || !helpers.isDG(req.user)) {
    req.flash('error', 'Accès réservé à la Direction Générale.');
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
function activiteRequired(req, res, next) {
  if (!req.activiteId) {
    req.flash('warning', 'Sélectionnez une activité pour accéder à ce module.');
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
function ecritureActiviteRequired(req, res, next) {
  if (!req.activiteId || !helpers.canWriteActivite(db, req.user, req.activiteId)) {
    req.flash('error', "Vous n'avez pas le droit de modifier cette activité.");
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
// Rétro-compat
function gestionnaireRequired(req, res, next) {
  if (!req.user || !(helpers.isGestionnaire(req.user) || helpers.isDG(req.user) || helpers.isSecretariat(req.user))) {
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
function caissierRequired(req, res, next) {
  if (!req.user || !(helpers.isCaissier(req.user) || helpers.isDG(req.user))) {
    return res.redirect('/comptes/connexion');
  }
  next();
}
function adminRequired(req, res, next) { return dgRequired(req, res, next); }

app.locals.loginRequired = loginRequired;
app.locals.dgRequired = dgRequired;
app.locals.activiteRequired = activiteRequired;
app.locals.ecritureActiviteRequired = ecritureActiviteRequired;
app.locals.gestionnaireRequired = gestionnaireRequired;
app.locals.caissierRequired = caissierRequired;
app.locals.adminRequired = adminRequired;

// ============================================================
// Routes
// ============================================================
app.get('/', (req, res) => {
  // Landing page selon le rôle : le caissier n'a pas de dashboard, il va directement à la caisse
  if (req.user && helpers.isCaissier(req.user)) return res.redirect('/ventes/caisse/');
  res.redirect('/tableau-de-bord/');
});

app.use('/comptes', require('../routes/accounts'));
// Site public B2C (accessible sans authentification) — Phase 0 maquettes
app.use('/commander', require('../routes/public'));
app.use('/admin', loginRequired, require('../routes/admin'));
app.use('/admin/promotions', loginRequired, require('../routes/promotions'));
app.use('/achats', loginRequired, require('../routes/achats'));
app.use('/distributions', loginRequired, require('../routes/distributions'));
app.use('/magasin-nestor', loginRequired, require('../routes/magasin'));
app.use('/produits', loginRequired, require('../routes/produits'));
app.use('/stocks', loginRequired, require('../routes/stocks'));
app.use('/ventes', loginRequired, require('../routes/ventes'));
app.use('/ventes-web', loginRequired, require('../routes/ventes_web'));
app.use('/commandes', loginRequired, require('../routes/commandes'));
app.use('/caisses', loginRequired, require('../routes/caisses'));
app.use('/productions', loginRequired, require('../routes/productions'));
app.use('/intelligence', loginRequired, helpers.permissionRequise(db, 'intelligence.acceder'), require('../routes/intelligence'));
app.use('/tableau-de-bord', loginRequired, require('../routes/analytics'));
app.use('/comptabilite', loginRequired, require('../routes/comptabilite'));

// ============================================================
// Erreurs
// ============================================================
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page introuvable', page_title: 'Page introuvable' });
});
// Handler 500 — en prod on cache la stack pour ne pas fuiter chemins de fichiers et versions.
// La trace complète reste dans les logs serveur (console.error) pour diagnostic.
app.use((err, req, res, next) => {
  console.error('[500]', req.method, req.path, err.stack || err.message);
  if (config.NODE_ENV === 'development') {
    res.status(500).send(`<pre>${err.stack || err.message}</pre>`);
  } else {
    res.status(500).render('500', {
      title: 'Erreur serveur',
      page_title: 'Erreur',
      message: "Une erreur inattendue est survenue. Notre équipe a été notifiée.",
    });
  }
});

app.listen(config.PORT, () => {
  console.log(`\n  ✓ Serveur lancé sur http://localhost:${config.PORT}`);
  console.log(`  → Le Traiteur du Bistrot — application multi-activités\n`);
});
