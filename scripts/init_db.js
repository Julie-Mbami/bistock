const db = require('../src/db');

console.log('→ Création du schéma SQLite (Le Traiteur du Bistrot)...');

db.exec(`
-- =============================================================
-- ACTIVITES : les 4 pôles cloisonnés
-- =============================================================
CREATE TABLE IF NOT EXISTS activite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,        -- TRAIT, CAN, PAT, BUR
  nom TEXT NOT NULL,                -- 'Le Traiteur', 'La Cantine', etc.
  type TEXT NOT NULL,               -- 'B2B_COMMANDE' ou 'B2C_CAISSE'
  couleur TEXT DEFAULT '#1e3a8a',
  icone TEXT DEFAULT 'bi-shop',
  actif INTEGER DEFAULT 1,
  cree_le TEXT DEFAULT (datetime('now'))
);

-- =============================================================
-- UTILISATEURS avec rôle nommé + activité (nullable pour transversaux)
-- =============================================================
CREATE TABLE IF NOT EXISTS utilisateur (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  titre TEXT DEFAULT '',                -- 'Mme', 'M.', etc.
  role TEXT NOT NULL,                   -- DG | SECRETARIAT | DISTRIBUTION | GESTIONNAIRE | CAISSIER
  activite_id INTEGER REFERENCES activite(id),  -- null pour DG / DISTRIBUTION
  telephone TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  date_joined TEXT DEFAULT (datetime('now'))
);

-- Table de liaison : quels utilisateurs travaillent sur quelles activités
-- (permet à Mario par ex. de couvrir Traiteur+Cantine si besoin, à Sandra secrétariat idem)
CREATE TABLE IF NOT EXISTS utilisateur_activite (
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  activite_id INTEGER NOT NULL REFERENCES activite(id) ON DELETE CASCADE,
  PRIMARY KEY (utilisateur_id, activite_id)
);

-- Permissions granulaires par feature (surcharges du rôle par défaut)
-- Si aucune ligne pour un utilisateur : on applique les permissions du rôle par défaut.
-- Une ligne autorise=0 : refuse explicitement (blackliste une feature normalement autorisée par le rôle).
-- Une ligne autorise=1 : autorise explicitement (permet une feature normalement refusée par le rôle).
CREATE TABLE IF NOT EXISTS permission_utilisateur (
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
  activite_id INTEGER REFERENCES activite(id) ON DELETE CASCADE,  -- NULL = global (features admin)
  feature TEXT NOT NULL,
  autorise INTEGER NOT NULL DEFAULT 1,
  modifie_le TEXT DEFAULT (datetime('now')),
  modifie_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  PRIMARY KEY (utilisateur_id, activite_id, feature)
);
CREATE INDEX IF NOT EXISTS idx_perm_user ON permission_utilisateur(utilisateur_id);

-- =============================================================
-- CATALOGUE : catégories + fournisseurs + produits, chacun rattaché à UNE activité
-- =============================================================
CREATE TABLE IF NOT EXISTS categorie (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  nom TEXT NOT NULL,
  description TEXT DEFAULT '',
  cree_le TEXT DEFAULT (datetime('now')),
  UNIQUE(activite_id, nom)
);

CREATE TABLE IF NOT EXISTS fournisseur (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  raison_sociale TEXT NOT NULL,
  contact TEXT DEFAULT '',
  telephone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  delai_livraison_jours INTEGER DEFAULT 7,
  actif INTEGER DEFAULT 1,
  cree_le TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  reference TEXT NOT NULL,
  designation TEXT NOT NULL,
  description TEXT DEFAULT '',
  categorie_id INTEGER NOT NULL REFERENCES categorie(id),
  fournisseur_id INTEGER REFERENCES fournisseur(id),
  prix_achat REAL DEFAULT 0,
  prix_vente REAL DEFAULT 0,
  stock_actuel INTEGER DEFAULT 0,
  stock_minimum INTEGER DEFAULT 5,
  stock_maximum INTEGER DEFAULT 100,
  unite TEXT DEFAULT 'pièce',
  image TEXT DEFAULT '',
  actif INTEGER DEFAULT 1,
  cree_le TEXT DEFAULT (datetime('now')),
  modifie_le TEXT DEFAULT (datetime('now')),
  UNIQUE(activite_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_produit_activite ON produit(activite_id);
CREATE INDEX IF NOT EXISTS idx_produit_designation ON produit(designation);

-- =============================================================
-- STOCKS : mouvements, alertes, inventaires (cloisonnés)
-- =============================================================
CREATE TABLE IF NOT EXISTS mouvement_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  type TEXT NOT NULL,                   -- ENTREE | SORTIE | AJUST_P | AJUST_M | RETOUR | PERTE
  quantite INTEGER NOT NULL,
  motif TEXT DEFAULT '',
  reference_doc TEXT DEFAULT '',
  stock_avant INTEGER DEFAULT 0,
  stock_apres INTEGER DEFAULT 0,
  utilisateur_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  date_mouvement TEXT DEFAULT (datetime('now')),
  ligne_distribution_id INTEGER REFERENCES ligne_distribution(id) ON DELETE SET NULL  -- traçabilité vers la distribution d'origine
);
CREATE INDEX IF NOT EXISTS idx_mvt_activite_date ON mouvement_stock(activite_id, date_mouvement DESC);
CREATE INDEX IF NOT EXISTS idx_mvt_produit ON mouvement_stock(produit_id, type);

CREATE TABLE IF NOT EXISTS alerte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  produit_id INTEGER NOT NULL REFERENCES produit(id) ON DELETE CASCADE,
  niveau TEXT DEFAULT 'ALERTE',
  message TEXT NOT NULL,
  vue INTEGER DEFAULT 0,
  creee_le TEXT DEFAULT (datetime('now')),
  vue_le TEXT,
  vue_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventaire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  reference TEXT UNIQUE NOT NULL,
  libelle TEXT DEFAULT '',
  statut TEXT DEFAULT 'EN_COURS',       -- EN_COURS | VALIDE | ANNULE
  categorie_id INTEGER REFERENCES categorie(id) ON DELETE SET NULL,
  cree_par_id INTEGER NOT NULL REFERENCES utilisateur(id),
  valide_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  date_creation TEXT DEFAULT (datetime('now')),
  date_validation TEXT,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ligne_inventaire (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventaire_id INTEGER NOT NULL REFERENCES inventaire(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  stock_theorique INTEGER NOT NULL,
  stock_physique INTEGER,
  motif_ecart TEXT DEFAULT '',
  compte_le TEXT,
  compte_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  UNIQUE(inventaire_id, produit_id)
);

-- =============================================================
-- CLIENTS et VENTES B2C (caisse quotidienne : Pâtisserie, Bona Burger)
-- =============================================================
CREATE TABLE IF NOT EXISTS client (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  type_client TEXT DEFAULT 'PART',       -- PART (particulier) | ENTR (entreprise)
  nom TEXT NOT NULL,
  telephone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  adresse TEXT DEFAULT '',
  niu TEXT DEFAULT '',                   -- NIU camerounais
  rccm TEXT DEFAULT '',
  contact_personne TEXT DEFAULT '',
  delai_paiement_jours INTEGER DEFAULT 30,
  cree_le TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  numero TEXT UNIQUE NOT NULL,           -- TIC-PAT-2026-0001
  date_vente TEXT DEFAULT (datetime('now')),
  caissier_id INTEGER NOT NULL REFERENCES utilisateur(id),
  client_id INTEGER REFERENCES client(id) ON DELETE SET NULL,
  mode_paiement TEXT DEFAULT 'ESPECES',  -- ESPECES | CARTE | ORANGE | MTN
  montant_total REAL DEFAULT 0,
  montant_remise REAL DEFAULT 0,
  montant_tva REAL DEFAULT 0,
  taux_tva REAL DEFAULT 0,
  montant_paye REAL DEFAULT 0,
  cloture_id INTEGER,                    -- rattachée à une clôture caisse (voir Phase 3)
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vente_activite_date ON vente(activite_id, date_vente DESC);

CREATE TABLE IF NOT EXISTS ligne_vente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vente_id INTEGER NOT NULL REFERENCES vente(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  quantite INTEGER DEFAULT 1,
  prix_unitaire REAL NOT NULL,
  remise REAL DEFAULT 0
);

-- =============================================================
-- ACHATS (Mme Sandra) et DISTRIBUTIONS (Nestor)
-- Circuit interne : achat externe → distribution vers activités → réception par gestionnaire
-- =============================================================
CREATE TABLE IF NOT EXISTS achat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE NOT NULL,           -- ACH-2026-0001 (global)
  fournisseur_id INTEGER REFERENCES fournisseur(id) ON DELETE SET NULL,
  fournisseur_libre TEXT DEFAULT '',     -- si fournisseur ponctuel non enregistré
  date_achat TEXT DEFAULT (datetime('now')),
  numero_facture_fournisseur TEXT DEFAULT '',
  montant_total REAL DEFAULT 0,
  statut TEXT DEFAULT 'SAISI',           -- SAISI | RECEPTIONNE | DISTRIBUE | CLOTURE | ANNULE
  cree_par_id INTEGER NOT NULL REFERENCES utilisateur(id),
  receptionne_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  date_reception TEXT,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_achat_statut ON achat(statut);
CREATE INDEX IF NOT EXISTS idx_achat_date ON achat(date_achat DESC);

CREATE TABLE IF NOT EXISTS ligne_achat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achat_id INTEGER NOT NULL REFERENCES achat(id) ON DELETE CASCADE,
  fournisseur_id INTEGER REFERENCES fournisseur(id) ON DELETE SET NULL,   -- fournisseur propre à la ligne
  numero_facture_fournisseur TEXT DEFAULT '',                             -- facture propre à la ligne
  designation TEXT NOT NULL,             -- libellé libre saisi par Mme Sandra
  unite TEXT DEFAULT 'unité',
  quantite REAL NOT NULL,
  prix_unitaire REAL DEFAULT 0,
  activite_pressentie_id INTEGER REFERENCES activite(id) ON DELETE SET NULL, -- optionnel (Nestor peut arbitrer)
  quantite_distribuee REAL DEFAULT 0,    -- cumul des distributions faites (calculé/maintenu)
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lachat_achat ON ligne_achat(achat_id);
CREATE INDEX IF NOT EXISTS idx_lachat_fournisseur ON ligne_achat(fournisseur_id);

CREATE TABLE IF NOT EXISTS distribution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE NOT NULL,           -- DIST-2026-0001 (global)
  activite_id INTEGER NOT NULL REFERENCES activite(id),  -- activité destinataire
  gestionnaire_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  date_creation TEXT DEFAULT (datetime('now')),
  date_remise TEXT,
  date_reception TEXT,
  statut TEXT DEFAULT 'PREPAREE',        -- PREPAREE | REMISE | RECEPTIONNEE | REFUSEE | ANNULEE
  cree_par_id INTEGER NOT NULL REFERENCES utilisateur(id), -- Nestor
  remise_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  receptionne_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  motif_refus TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dist_activite_statut ON distribution(activite_id, statut);
CREATE INDEX IF NOT EXISTS idx_dist_date ON distribution(date_creation DESC);

CREATE TABLE IF NOT EXISTS ligne_distribution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_id INTEGER NOT NULL REFERENCES distribution(id) ON DELETE CASCADE,
  ligne_achat_id INTEGER REFERENCES ligne_achat(id) ON DELETE SET NULL, -- lien traçabilité vers l'achat d'origine
  produit_id INTEGER NOT NULL REFERENCES produit(id),  -- produit du catalogue de l'activité destinataire
  quantite_annoncee REAL NOT NULL,
  quantite_recue REAL,                   -- renseigné à la réception par le gestionnaire
  motif_ecart TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ldist_dist ON ligne_distribution(distribution_id);
CREATE INDEX IF NOT EXISTS idx_ldist_achat ON ligne_distribution(ligne_achat_id);

-- =============================================================
-- COMMANDES B2B (Traiteur + Cantine) — squelette Phase 2, table créée dès Phase 1 pour éviter migration
-- =============================================================
CREATE TABLE IF NOT EXISTS commande (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  numero TEXT UNIQUE NOT NULL,           -- CMD-TRAIT-2026-0001
  statut TEXT DEFAULT 'PROFORMA',        -- PROFORMA | VALIDE | EN_PRODUCTION | LIVREE | FACTUREE | PAYEE | ANNULEE
  client_id INTEGER NOT NULL REFERENCES client(id),
  date_commande TEXT DEFAULT (datetime('now')),
  date_livraison_prevue TEXT,
  date_livraison_reelle TEXT,
  date_echeance TEXT,                    -- deadline paiement
  mode_paiement TEXT DEFAULT 'VIREMENT', -- VIREMENT | CHEQUE
  montant_ht REAL DEFAULT 0,
  montant_total REAL DEFAULT 0,
  montant_remise REAL DEFAULT 0,
  montant_tva REAL DEFAULT 0,
  taux_tva REAL DEFAULT 0,
  montant_acompte REAL DEFAULT 0,
  montant_paye REAL DEFAULT 0,
  numero_proforma TEXT,
  numero_bon_commande TEXT,
  numero_facture TEXT,
  numero_bl TEXT,
  cree_par_id INTEGER NOT NULL REFERENCES utilisateur(id),
  valide_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cmd_activite_statut ON commande(activite_id, statut);
CREATE INDEX IF NOT EXISTS idx_cmd_echeance ON commande(date_echeance);

CREATE TABLE IF NOT EXISTS ligne_commande (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commande(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  designation TEXT NOT NULL,
  quantite REAL NOT NULL,
  prix_unitaire REAL NOT NULL,
  remise REAL DEFAULT 0
);

-- Paiements (peuvent être multiples pour B2B, un seul pour B2C)
CREATE TABLE IF NOT EXISTS paiement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  commande_id INTEGER REFERENCES commande(id) ON DELETE CASCADE,
  vente_id INTEGER REFERENCES vente(id) ON DELETE CASCADE,
  numero_recu TEXT UNIQUE,               -- REC-TRAIT-2026-0001
  date_paiement TEXT DEFAULT (datetime('now')),
  mode_paiement TEXT NOT NULL,
  montant REAL NOT NULL,
  reference_transaction TEXT DEFAULT '', -- n° chèque, référence virement
  piece_jointe TEXT DEFAULT '',          -- chemin relatif fichier (copie chèque, ordre virement)
  cree_par_id INTEGER NOT NULL REFERENCES utilisateur(id),
  notes TEXT DEFAULT ''
);

-- =============================================================
-- FICHES TECHNIQUES (recettes) — un plat fini vendu se compose d'ingrédients
-- Décrémente automatiquement les ingrédients à chaque vente / livraison
-- =============================================================
CREATE TABLE IF NOT EXISTS fiche_technique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id INTEGER NOT NULL UNIQUE REFERENCES produit(id) ON DELETE CASCADE,
  rendement INTEGER DEFAULT 1,
  actif INTEGER DEFAULT 1,
  mode_production TEXT DEFAULT 'BATCH',  -- BATCH : production en amont, vente décrémente produit fini
                                          -- DIRECT : vente décrémente directement les ingrédients (fast-food)
  notes TEXT DEFAULT '',
  cree_le TEXT DEFAULT (datetime('now')),
  modifie_le TEXT DEFAULT (datetime('now')),
  cree_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL
);

-- Ordres de production (bons de fabrication)
CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  numero TEXT UNIQUE NOT NULL,           -- FAB-BUR-2026-0001
  produit_id INTEGER NOT NULL REFERENCES produit(id),
  quantite_produite REAL NOT NULL,
  date_production TEXT DEFAULT (datetime('now')),
  produit_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  cout_matiere REAL DEFAULT 0,           -- coût matière calculé à la production
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_prod_activite_date ON production(activite_id, date_production DESC);

CREATE TABLE IF NOT EXISTS composition_fiche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiche_technique(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES produit(id),  -- un produit ingrédient
  quantite REAL NOT NULL,                -- quantité par portion (dans l'unité du stock de l'ingrédient)
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_composition_fiche ON composition_fiche(fiche_id);
CREATE INDEX IF NOT EXISTS idx_composition_ingredient ON composition_fiche(ingredient_id);

-- =============================================================
-- RELANCES B2B — J+7 (rappel amical) / J+15 (ferme) / J+30 (mise en demeure)
-- =============================================================
CREATE TABLE IF NOT EXISTS relance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commande(id) ON DELETE CASCADE,
  niveau TEXT NOT NULL,                  -- J7 | J15 | J30
  canal TEXT DEFAULT 'IMPRIMEE',         -- IMPRIMEE | EMAIL | TELEPHONE | SMS
  date_envoi TEXT DEFAULT (datetime('now')),
  envoye_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_relance_commande ON relance(commande_id, date_envoi DESC);

-- =============================================================
-- CAISSE : ouverture / clôture quotidienne (Phase 3, table préparée)
-- =============================================================
CREATE TABLE IF NOT EXISTS cloture_caisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activite_id INTEGER NOT NULL REFERENCES activite(id),
  numero TEXT UNIQUE NOT NULL,           -- CLO-PAT-2026-0001
  date_ouverture TEXT DEFAULT (datetime('now')),
  date_cloture TEXT,
  fond_ouverture REAL DEFAULT 0,
  ouvert_par_id INTEGER NOT NULL REFERENCES utilisateur(id),
  cloture_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  total_theorique_especes REAL DEFAULT 0,
  total_compte_especes REAL DEFAULT 0,
  total_carte REAL DEFAULT 0,
  total_orange REAL DEFAULT 0,
  total_mtn REAL DEFAULT 0,
  ecart REAL DEFAULT 0,
  statut TEXT DEFAULT 'OUVERTE',         -- OUVERTE | CLOTUREE
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cloture_activite ON cloture_caisse(activite_id, statut);

-- =============================================================
-- JOURNAL D'AUDIT (Phase 5, préparé)
-- =============================================================
CREATE TABLE IF NOT EXISTS journal_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  activite_id INTEGER REFERENCES activite(id),
  action TEXT NOT NULL,                  -- CREATION_UTIL, VALIDATION_FACTURE, CLOTURE_CAISSE, REMISE_EXCEPT...
  entite TEXT DEFAULT '',                -- 'vente', 'commande', 'utilisateur'
  entite_id INTEGER,
  details TEXT DEFAULT '',
  date_action TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON journal_audit(date_action DESC);

-- =============================================================
-- PARAMÈTRES SYSTÈME (modifiables via /admin/parametres)
-- =============================================================
CREATE TABLE IF NOT EXISTS parametre (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  libelle TEXT DEFAULT '',
  type TEXT DEFAULT 'texte',    -- texte | nombre | booleen
  modifie_le TEXT DEFAULT (datetime('now')),
  modifie_par_id INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL
);

-- Paramètres par défaut
INSERT OR IGNORE INTO parametre (cle, valeur, libelle, type) VALUES
  ('entreprise_nom',     'Le Traiteur du Bistrot',     'Nom de l''entreprise',           'texte'),
  ('entreprise_adresse', 'Douala, Cameroun',           'Adresse',                        'texte'),
  ('entreprise_tel',     '+237 690 00 00 00',          'Téléphone',                      'texte'),
  ('entreprise_email',   'contact@traiteurbistrot.cm', 'Email',                          'texte'),
  ('entreprise_niu',     '',                            'NIU de l''entreprise',           'texte'),
  ('entreprise_rccm',    '',                            'RCCM',                           'texte'),
  ('entreprise_banque_nom',     '',                     'Nom de la banque (pour virements)',   'texte'),
  ('entreprise_banque_compte',  '',                     'Numéro de compte / RIB / IBAN',       'texte'),
  ('entreprise_banque_swift',   '',                     'Code SWIFT / BIC',                    'texte'),
  ('entreprise_cheque_libelle', '',                     'Libellé du chèque (à l''ordre de...)', 'texte'),
  ('devise',             'FCFA',                        'Devise',                         'texte'),
  ('taux_tva',           '19.25',                       'Taux TVA (%)',                   'nombre'),
  ('delai_paiement_defaut', '30',                       'Délai paiement B2B par défaut (jours)', 'nombre'),
  ('remise_max_gestionnaire', '10',                     'Remise max sans validation DG (%)',     'nombre');
`);

console.log('✓ Schéma créé (13 tables).');
console.log('  Base : ' + require('../src/config').DB_PATH);
