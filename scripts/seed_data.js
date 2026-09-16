const bcrypt = require('bcryptjs');
const db = require('../src/db');

let seed = 42;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function randint(a, b) { return Math.floor(rand() * (b - a + 1)) + a; }
function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }
function sample(arr, k) {
  const copy = arr.slice(); const out = [];
  for (let i = 0; i < k && copy.length; i++) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}

// =====================================================================
// 1. Les 4 activités
// =====================================================================
function creerActivites() {
  console.log('→ Création des 4 activités...');
  const list = [
    // code, nom, type, couleur, icone
    ['TRAIT', 'Le Traiteur',                     'B2B_COMMANDE', '#7c2d12', 'bi-bag-heart'],
    ['CAN',   'La Cantine',                      'B2B_COMMANDE', '#047857', 'bi-basket3'],
    ['PAT',   'Pâtisserie / Salon / Restaurant', 'B2C_CAISSE',   '#ca8a04', 'bi-cup-hot'],
    ['BUR',   '237 Bona Burger',                 'B2C_CAISSE',   '#b91c1c', 'bi-fire'],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO activite (code, nom, type, couleur, icone) VALUES (?, ?, ?, ?, ?)');
  for (const row of list) ins.run(...row);
  console.log(`   ${db.prepare('SELECT COUNT(*) AS n FROM activite').get().n} activités.`);
}

function getActivite(code) {
  return db.prepare('SELECT * FROM activite WHERE code = ?').get(code);
}

// =====================================================================
// 2. Utilisateurs nommés + caissiers B2C
// =====================================================================
function creerUtilisateurs() {
  console.log('→ Utilisateurs...');
  const TRAIT = getActivite('TRAIT').id;
  const CAN   = getActivite('CAN').id;
  const PAT   = getActivite('PAT').id;
  const BUR   = getActivite('BUR').id;

  const users = [
    // username, mdp, titre, prénom, nom, rôle, activite_id, tel
    ['msandra',    'admin2026',   'Mme',  'Sandra',   '(DG)',           'DG',                 null,  '+237 690 00 01'],
    ['sandra',     'secret2026',  '',     'Sandra',   '(Secrétariat)',  'SECRETARIAT',        null,  '+237 690 00 02'],
    ['nestor',     'dist2026',    'M.',   'Nestor',   'NGUEMA',         'DISTRIBUTION',       null,  '+237 690 00 03'],
    ['mario',      'trait2026',   'M.',   'Mario',    'ONANA',          'GESTIONNAIRE',       TRAIT, '+237 690 00 04'],
    ['mariano',    'can2026',     'M.',   'Mariano',  'FOUDA',          'GESTIONNAIRE',       CAN,   '+237 690 00 05'],
    ['floriane',   'pat2026',     'Mme',  'Floriane', 'RAMY',           'GESTIONNAIRE',       PAT,   '+237 690 00 06'],
    ['nikolas',    'bur2026',     'M.',   'Nikolas',  'KAMGA',          'GESTIONNAIRE',       BUR,   '+237 690 00 07'],
    ['caiss_pat',  'caisse2026',  '',     'Caissier', 'Pâtisserie',     'CAISSIER',           PAT,   '+237 690 00 08'],
    ['caiss_bur',  'caisse2026',  '',     'Caissier', 'Bona Burger',    'CAISSIER',           BUR,   '+237 690 00 09'],
    // Cuisiniers — un par activité qui produit en cuisine (à renommer par la DG selon le personnel réel)
    ['cuis_trait', 'cuisine2026', 'Chef', 'Cuisinier', 'Traiteur',      'CUISINIER',          TRAIT, '+237 690 00 10'],
    ['cuis_pat',   'cuisine2026', 'Chef', 'Pâtissier', 'Pâtisserie',    'CUISINIER',          PAT,   '+237 690 00 11'],
    ['cuis_can',   'cuisine2026', 'Chef', 'Cuisinier', 'Cantine',       'CUISINIER',          CAN,   '+237 690 00 12'],
    ['cuis_bur',   'cuisine2026', 'Chef', 'Cuisinier', 'Bona Burger',   'CUISINIER',          BUR,   '+237 690 00 13'],
  ];

  const ins = db.prepare(`INSERT OR IGNORE INTO utilisateur
    (username, password, titre, first_name, last_name, role, activite_id, telephone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  for (const [username, mdp, titre, prenom, nom, role, activiteId, tel] of users) {
    ins.run(username, bcrypt.hashSync(mdp, 8), titre, prenom, nom, role, activiteId, tel);
  }

  // Liaison Sandra Secrétariat → Traiteur + Cantine
  const sandraId = db.prepare("SELECT id FROM utilisateur WHERE username = 'sandra'").get().id;
  const linkIns = db.prepare('INSERT OR IGNORE INTO utilisateur_activite (utilisateur_id, activite_id) VALUES (?, ?)');
  linkIns.run(sandraId, TRAIT);
  linkIns.run(sandraId, CAN);

  console.log(`   ${db.prepare('SELECT COUNT(*) AS n FROM utilisateur').get().n} utilisateurs.`);
}

// =====================================================================
// 3. Catalogue par activité (catégories, fournisseurs, produits)
// =====================================================================
function creerCatalogueActivite(activiteCode, categoriesData, fournisseursData, produitsData) {
  const activite = getActivite(activiteCode);

  // Catégories
  const catIns = db.prepare('INSERT OR IGNORE INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)');
  for (const [nom, desc] of categoriesData) catIns.run(activite.id, nom, desc);

  // Fournisseurs
  const fournIns = db.prepare(`INSERT OR IGNORE INTO fournisseur
    (activite_id, raison_sociale, contact, telephone, email, delai_livraison_jours)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const [raison, contact, tel, email, delai] of fournisseursData) {
    fournIns.run(activite.id, raison, contact, tel, email, delai);
  }

  // Produits
  const prodIns = db.prepare(`INSERT OR IGNORE INTO produit
    (activite_id, reference, designation, categorie_id, fournisseur_id, prix_achat, prix_vente,
     stock_actuel, stock_minimum, stock_maximum, unite, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const fournisseurs = db.prepare('SELECT id FROM fournisseur WHERE activite_id = ?').all(activite.id).map(r => r.id);
  let idx = 1;
  for (const [designation, catNom, pa, pv, smin, smax, sinit, unite] of produitsData) {
    const cat = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND nom = ?').get(activite.id, catNom);
    if (!cat) continue;
    const ref = `${activiteCode}${String(idx).padStart(3, '0')}`;
    prodIns.run(activite.id, ref, designation, cat.id, choice(fournisseurs), pa, pv, sinit, smin, smax, unite, designation);
    idx++;
  }
}

function creerCatalogues() {
  console.log('→ Catalogues par activité...');

  // ---------- LE TRAITEUR ----------
  creerCatalogueActivite('TRAIT',
    [
      ['Ingrédients traiteur', 'Riz, viandes, poissons, épices'],
      ['Boissons réception',   'Vins, jus, eaux'],
      ['Matériel événement',   'Vaisselle, nappes, chaises'],
    ],
    [
      ['Congélation Douala SARL', 'Jean BILONGA', '+237 690 11 01', 'contact@congelation.cm', 5],
      ['Vins & Spiritueux CMR',   'Anne KAMDEM',  '+237 690 11 02', 'ventes@vins-cmr.cm',     7],
      ['Location Événements',     'Léon TCHINDA', '+237 690 11 03', 'loc@evenements.cm',      10],
    ],
    [
      // designation, cat, prix_achat, prix_vente, smin, smax, sinit, unite
      ['Riz basmati sac 25kg',     'Ingrédients traiteur', 22000, 32000, 3, 20, 12,  'sac'],
      ['Poulet fermier entier',    'Ingrédients traiteur', 3500,  5500,  10,50, 24,  'pièce'],
      ['Poisson bar frais',        'Ingrédients traiteur', 4200,  7500,  8, 40, 15,  'kg'],
      ['Épices safran assort.',    'Ingrédients traiteur', 8500,  15000, 3, 15, 8,   'boîte'],
      ['Vin rouge bouteille',      'Boissons réception',   3500,  6000,  15,80, 42,  'bouteille'],
      ['Jus de fruits carton 1L',  'Boissons réception',   750,   1500,  30,120,65,  'brique'],
      ['Eau minérale pack 6',      'Boissons réception',   1200,  2000,  20,80, 38,  'pack'],
      ['Vaisselle porcelaine',     'Matériel événement',   1200,  0,     50,300,180, 'set'],
      ['Nappe blanche 3m',         'Matériel événement',   3500,  0,     20,80, 40,  'pièce'],
      ['Chaise Chiavari or',       'Matériel événement',   8000,  0,     100,500,220,'pièce'],
    ]
  );

  // ---------- LA CANTINE ----------
  creerCatalogueActivite('CAN',
    [
      ['Denrées de base',      'Riz, huile, sel, oignons'],
      ['Protéines',            'Viandes, poissons, œufs'],
      ['Légumes frais',        'Salades, tomates, épinards'],
      ['Emballages livraison', 'Barquettes, sachets, plats'],
    ],
    [
      ['Marché Central Achats', 'Rose ATANGA',   '+237 690 22 01', '',                       2],
      ['Bio Douala',            'Charles MBALA', '+237 690 22 02', 'contact@bio-douala.cm',  3],
      ['Emballages Pro',        'Guy NANGA',     '+237 690 22 03', 'ventes@emb-pro.cm',      7],
    ],
    [
      ['Riz local sac 50kg',      'Denrées de base',      18000, 25000, 2, 15, 8,   'sac'],
      ['Huile végétale bidon 20L','Denrées de base',      14000, 20000, 3, 15, 7,   'bidon'],
      ['Oignons sac 25kg',        'Denrées de base',      4500,  6500,  4, 20, 10,  'sac'],
      ['Bœuf carcasse',           'Protéines',            2800,  4200,  20,100,45,  'kg'],
      ['Poulet cuisse pack 10',   'Protéines',            5500,  8000,  10,50, 22,  'pack'],
      ['Œufs plateau de 30',      'Protéines',            2200,  3200,  15,80, 40,  'plateau'],
      ['Tomates fraîches',        'Légumes frais',        800,   1400,  30,120,60,  'kg'],
      ['Épinards botte',          'Légumes frais',        300,   600,   40,150,80,  'botte'],
      ['Barquette repas 750ml',   'Emballages livraison', 55,    120,   500,3000,1600,'pièce'],
      ['Sachet emballage plat',   'Emballages livraison', 25,    60,    500,3000,1400,'pièce'],
    ]
  );

  // ---------- PÂTISSERIE / SALON / RESTAURANT ----------
  creerCatalogueActivite('PAT',
    [
      ['Pâtisseries', 'Gâteaux, viennoiseries'],
      ['Boissons',    'Café, thé, jus, sodas'],
      ['Plats',       'Menu restauration'],
      ['Épicerie',    'Sucre, beurre, farine, chocolat'],
    ],
    [
      ['Grands Moulins CMR',       'Pierre BIYA',  '+237 690 33 01', 'grand.moulins@cmr.cm', 2],
      ['Boissons Distribution',    'Sylvie NGOK',  '+237 690 33 02', 'ventes@bd.cm',         3],
      ['Chocolatier Fournisseur',  'Éric MELOME',  '+237 690 33 03', '',                      5],
    ],
    [
      ['Croissant beurre',           'Pâtisseries', 250,  600,   30,150,75,  'pièce'],
      ['Pain au chocolat',           'Pâtisseries', 300,  700,   30,150,72,  'pièce'],
      ['Éclair café / chocolat',     'Pâtisseries', 450,  1200,  20,100,52,  'pièce'],
      ['Millefeuille',               'Pâtisseries', 500,  1500,  15,80, 40,  'pièce'],
      ['Café expresso',              'Boissons',    150,  500,   50,300,140, 'tasse'],
      ['Thé assortiment',            'Boissons',    100,  400,   50,300,180, 'tasse'],
      ['Jus d\'orange pressé',       'Boissons',    400,  1200,  20,100,50,  'verre'],
      ['Coca-Cola 33cl',             'Boissons',    350,  700,   40,200,110, 'canette'],
      ['Plat du jour',               'Plats',       1500, 3500,  0, 30, 0,   'plat'],
      ['Sandwich club',              'Plats',       800,  2000,  10,60, 25,  'pièce'],
      ['Sucre en poudre 1kg',        'Épicerie',    650,  1200,  10,50, 22,  'kg'],
      ['Beurre plaque 500g',         'Épicerie',    2200, 3500,  8, 40, 18,  'plaque'],
      ['Farine boulangère 25kg',     'Épicerie',    12000,17000, 3, 15, 6,   'sac'],
      ['Chocolat noir 1kg',          'Épicerie',    8500, 14000, 4, 20, 9,   'kg'],
    ]
  );

  // ---------- 237 BONA BURGER ----------
  creerCatalogueActivite('BUR',
    [
      ['Burgers',     'Hamburgers signature'],
      ['Pizzas',      'Pizzas cuites sur place'],
      ['Boissons',    'Sodas, jus, eaux'],
      ['Ingrédients', 'Pains, viandes, fromages, sauces'],
    ],
    [
      ['Viandes Premium CMR',  'Denis ZOA',    '+237 690 44 01', 'commande@vp-cmr.cm', 2],
      ['Boulangerie du Coin',  'Marc NDJOCK',  '+237 690 44 02', '',                    1],
      ['Épicerie & Sauces',    'Amélie FOSSO', '+237 690 44 03', 'sauces@epicerie.cm', 4],
    ],
    [
      ['Bona Classic Burger',        'Burgers',     0,    3500, 0, 0, 0, 'burger'],
      ['Bona Cheese Burger',         'Burgers',     0,    4200, 0, 0, 0, 'burger'],
      ['Bona Double Burger',         'Burgers',     0,    5500, 0, 0, 0, 'burger'],
      ['Bona Chicken Burger',        'Burgers',     0,    4000, 0, 0, 0, 'burger'],
      ['Pizza Margherita 30cm',      'Pizzas',      0,    5000, 0, 0, 0, 'pizza'],
      ['Pizza 4 fromages 30cm',      'Pizzas',      0,    6500, 0, 0, 0, 'pizza'],
      ['Pizza Bona spécial 30cm',    'Pizzas',      0,    7500, 0, 0, 0, 'pizza'],
      ['Coca-Cola 50cl',             'Boissons',    450,  1000, 30,150,80,  'bouteille'],
      ['Eau minérale 50cl',          'Boissons',    250,  500,  30,150,75,  'bouteille'],
      ['Jus mangue 33cl',            'Boissons',    350,  800,  20,100,45,  'brique'],
      ['Pain burger unité',          'Ingrédients', 100,  0,    50,300,180, 'pièce'],
      ['Steak haché bœuf 125g',      'Ingrédients', 400,  0,    50,300,155, 'unité'],
      ['Fromage cheddar tranche',    'Ingrédients', 80,   0,    100,500,250,'tranche'],
      ['Sauce burger 5L',            'Ingrédients', 4500, 0,    3, 15, 8,   'bidon'],
      ['Pâte à pizza boule 300g',    'Ingrédients', 300,  0,    30,150,70,  'boule'],
    ]
  );

  console.log(`   Catégories : ${db.prepare('SELECT COUNT(*) AS n FROM categorie').get().n}`);
  console.log(`   Fournisseurs : ${db.prepare('SELECT COUNT(*) AS n FROM fournisseur').get().n}`);
  console.log(`   Produits : ${db.prepare('SELECT COUNT(*) AS n FROM produit').get().n}`);
}

// =====================================================================
// 4. Clients (B2B pour Traiteur/Cantine, B2C pour PAT/BUR — minimalistes)
// =====================================================================
function creerClients() {
  console.log('→ Clients...');
  const TRAIT = getActivite('TRAIT').id;
  const CAN   = getActivite('CAN').id;
  const PAT   = getActivite('PAT').id;
  const BUR   = getActivite('BUR').id;

  const clients = [
    // activite_id, type, nom, tel, email, adresse, niu, rccm, contact, delai
    [TRAIT, 'ENTR', 'Hôtel Sawa',            '+237 690 55 01', 'contact@sawa.cm',      'Bonanjo, Douala',       'P123456789012K', 'RC/DLA/2020/B/0001', 'M. Ekwalla',           30],
    [TRAIT, 'PART', 'Famille MBALLA',        '+237 690 55 02', '',                     'Bonaberi, Douala',      '', '', '', 30],
    [TRAIT, 'ENTR', 'Ministère des Sports',  '+237 222 55 03', 'sec@minsports.gov.cm', 'Yaoundé',               '', '', 'Dir. Cabinet', 45],
    [TRAIT, 'PART', 'Mariage NDONGO',        '+237 691 55 04', '',                     'Kribi',                 '', '', '', 15],
    [CAN,   'ENTR', 'Société PALADI',        '+237 691 66 01', 'admin@paladi.cm',      'Bepanda, Douala',       'P987654321012F', 'RC/DLA/2018/B/0055', 'Mme Kouotou',        30],
    [CAN,   'ENTR', 'Cabinet AEC',           '+237 691 66 02', 'contact@aec.cm',       'Akwa, Douala',          '', '', 'Me NDONKEU',            30],
    [CAN,   'ENTR', 'Groupe TOTAL Douala',   '+237 691 66 03', 'rh@total-douala.cm',   'Zone industrielle',     'P456789123012G', 'RC/DLA/2010/B/0100', 'Resp. RH',            60],
    [CAN,   'ENTR', 'École Saint Joseph',    '+237 691 66 04', 'compta@stjoseph.cm',   'Bafoussam',             '', '', 'Sœur Économe',          30],
    [PAT,   'PART', 'M. TCHOUALEU Étienne',  '+237 692 77 01', '',                     'Bonapriso',             '', '', '', 0],
    [PAT,   'PART', 'Mme FONGA Estelle',     '+237 692 77 02', 'estelle.f@email.cm',   'Akwa',                  '', '', '', 0],
    [PAT,   'ENTR', 'Bureau AVOCAT NGOMO',   '+237 692 77 03', '',                     'Bonanjo',               'P111222333012A', 'RC/DLA/2015/B/0500', 'Me NGOMO',           0],
    [BUR,   'PART', 'Livraison rapide',      '+237 693 88 01', '',                     '',                      '', '', '', 0],
    [BUR,   'ENTR', 'Entreprise BATO',       '+237 693 88 02', 'ordres@bato.cm',       'Zone Portuaire',        '', '', 'Resp. Achats', 0],
  ];

  const ins = db.prepare(`INSERT OR IGNORE INTO client
    (activite_id, type_client, nom, telephone, email, adresse, niu, rccm, contact_personne, delai_paiement_jours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const c of clients) ins.run(...c);
  console.log(`   ${db.prepare('SELECT COUNT(*) AS n FROM client').get().n} clients.`);
}

// =====================================================================
// 5. Ventes historiques minimales — Pâtisserie et Bona Burger (30 jours)
//    (Traiteur/Cantine seront ajoutés en Phase 2 avec le workflow commandes)
// =====================================================================
function numeroVenteSuivant(codeActivite, dt) {
  const annee = dt.getFullYear();
  const prefix = `TIC-${codeActivite}-${annee}-`;
  const row = db.prepare("SELECT numero FROM vente WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1").get(prefix + '%');
  let n = 1;
  if (row) {
    const parsed = parseInt(row.numero.substring(prefix.length), 10);
    if (!Number.isNaN(parsed)) n = parsed + 1;
  }
  return prefix + String(n).padStart(4, '0');
}

function creerVentesB2C() {
  console.log('→ Ventes historiques Pâtisserie et Bona Burger (30 jours)...');

  const activites = {
    PAT: getActivite('PAT').id,
    BUR: getActivite('BUR').id,
  };
  const caissiers = {
    PAT: db.prepare("SELECT id FROM utilisateur WHERE username = 'caiss_pat'").get().id,
    BUR: db.prepare("SELECT id FROM utilisateur WHERE username = 'caiss_bur'").get().id,
  };
  const modesB2C = ['ESPECES', 'CARTE', 'ORANGE', 'MTN'];

  const insertVente = db.prepare(`INSERT INTO vente
    (activite_id, numero, date_vente, caissier_id, mode_paiement, montant_total, montant_paye)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertLigne = db.prepare(`INSERT INTO ligne_vente
    (vente_id, produit_id, quantite, prix_unitaire) VALUES (?, ?, ?, ?)`);
  const insertMvt = db.prepare(`INSERT INTO mouvement_stock
    (activite_id, produit_id, type, quantite, motif, reference_doc, stock_avant, stock_apres, utilisateur_id, date_mouvement)
    VALUES (?, ?, 'SORTIE', ?, ?, ?, ?, ?, ?, ?)`);

  const nbJours = 30;
  const now = new Date();
  let total = 0;

  const trx = db.transaction(() => {
    for (const code of ['PAT', 'BUR']) {
      const activiteId = activites[code];
      const caissierId = caissiers[code];
      const produits = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND prix_vente > 0').all(activiteId);
      const stockMap = new Map(produits.map(p => [p.id, p.stock_actuel]));

      for (let j = 0; j < nbJours; j++) {
        const jour = new Date(now.getTime() - (nbJours - j) * 86400000);
        const wd = jour.getDay();
        // Plus de ventes weekend pour BUR, moins pour PAT
        const baseCount = code === 'BUR'
          ? (wd === 0 || wd === 6 ? randint(25, 45) : randint(15, 30))
          : (wd === 0 || wd === 6 ? randint(15, 30) : randint(20, 40));

        for (let k = 0; k < baseCount; k++) {
          const dt = new Date(jour);
          dt.setHours(randint(9, 20), randint(0, 59), randint(0, 59));
          const numero = numeroVenteSuivant(code, dt);
          const mode = choice(modesB2C);

          const info = insertVente.run(activiteId, numero, dt.toISOString().slice(0, 19).replace('T', ' '), caissierId, mode, 0, 0);
          const venteId = Number(info.lastInsertRowid);

          const nbLignes = randint(1, 3);
          const chosen = sample(produits, nbLignes);
          let sousTotal = 0;
          for (const p of chosen) {
            const qte = randint(1, 3);
            const stock = stockMap.get(p.id);
            const stockApres = Math.max(stock - qte, 0);
            insertLigne.run(venteId, p.id, qte, p.prix_vente);
            sousTotal += qte * p.prix_vente;
            insertMvt.run(activiteId, p.id, qte, 'Vente ' + numero, numero, stock, stockApres, caissierId, dt.toISOString().slice(0, 19).replace('T', ' '));
            stockMap.set(p.id, stockApres);
          }
          db.prepare('UPDATE vente SET montant_total = ?, montant_paye = ? WHERE id = ?')
            .run(sousTotal, sousTotal, venteId);
          total++;
        }
      }
      // Persister les stocks
      const updStock = db.prepare('UPDATE produit SET stock_actuel = ? WHERE id = ?');
      for (const [id, s] of stockMap) updStock.run(s, id);
    }
  });
  trx();
  console.log(`   ${total} ventes B2C créées.`);
}

// =====================================================================
// 6. Alertes de stock
// =====================================================================
function creerAlertes() {
  console.log('→ Génération des alertes...');
  const insertAlerte = db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, message, vue, creee_le)
                                    VALUES (?, ?, ?, ?, 0, datetime('now'))`);
  let nbAlertes = 0;
  for (const p of db.prepare("SELECT * FROM produit WHERE actif = 1 AND stock_maximum > 0").all()) {
    if (p.stock_actuel <= 0) {
      insertAlerte.run(p.activite_id, p.id, 'CRITIQUE', `Rupture de stock pour ${p.designation}`);
      nbAlertes++;
    } else if (p.stock_actuel <= p.stock_minimum) {
      insertAlerte.run(p.activite_id, p.id, 'ALERTE', `Stock bas pour ${p.designation} : ${p.stock_actuel} restant (seuil : ${p.stock_minimum})`);
      nbAlertes++;
    }
  }
  console.log(`   ${nbAlertes} alerte(s) créée(s).`);
}

// =====================================================================
// MAIN
// =====================================================================
function main() {
  creerActivites();
  creerUtilisateurs();
  creerCatalogues();
  creerClients();
  creerVentesB2C();
  creerAlertes();

  console.log('\n✓ Seed Le Traiteur du Bistrot terminé.\n');
  console.log('  === Comptes de démonstration ===');
  console.log('    Mme Sandra (DG)                 : msandra / admin2026');
  console.log('    Sandra (Secrétariat)            : sandra / secret2026');
  console.log('    Nestor (Distribution)           : nestor / dist2026');
  console.log('    Mario (Stock Traiteur)          : mario / trait2026');
  console.log('    Mariano (Stock Cantine)         : mariano / can2026');
  console.log('    Floriane Ramy (Pâtisserie)      : floriane / pat2026');
  console.log('    Nikolas (Bona Burger)           : nikolas / bur2026');
  console.log('    Caissier Pâtisserie             : caiss_pat / caisse2026');
  console.log('    Caissier Bona Burger            : caiss_bur / caisse2026');
}

main();
