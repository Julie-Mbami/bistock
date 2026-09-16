// Jeu de données de TEST étendu — génère des données dans TOUS les modules et TOUTES les activités
// pour permettre de tester chaque écran avec du contenu réaliste et des dates récentes.
// Prérequis : seed_data.js a déjà été exécuté.

const db = require('../src/db');
const h = require('../src/helpers');

let seed = 12345;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function randint(a, b) { return Math.floor(rand() * (b - a + 1)) + a; }
function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
function isoJour(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}
function getActivite(code) { return db.prepare('SELECT * FROM activite WHERE code = ?').get(code); }
function getUser(username) { return db.prepare('SELECT * FROM utilisateur WHERE username = ?').get(username); }

// Numérotation générique
function nextNum(prefix, table, col) {
  const dernier = db.prepare(`SELECT ${col} AS num FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`).get(prefix + '%');
  let n = 1;
  if (dernier && dernier.num) {
    const p = parseInt(String(dernier.num).substring(prefix.length), 10);
    if (!Number.isNaN(p)) n = p + 1;
  }
  return prefix + String(n).padStart(4, '0');
}

// =============================================================================
// 1. INGREDIENTS BRUTS supplémentaires pour Traiteur et Cantine (utiles aux recettes)
// =============================================================================
function ajouterIngredientsExtra() {
  console.log('→ Ajout ingrédients supplémentaires (Traiteur, Cantine, PAT, BUR)...');
  const ingredients = [
    // [code_activite, designation, categorie, prix_achat, unite, stock]
    ['TRAIT', 'Riz jasmin 5kg',        'Ingrédients traiteur', 4500,  'sac',   20],
    ['TRAIT', 'Filet bœuf 1kg',        'Ingrédients traiteur', 6500,  'kg',    15],
    ['TRAIT', 'Crevettes fraîches',    'Ingrédients traiteur', 5000,  'kg',    12],
    ['TRAIT', 'Beurre pâtissier 500g', 'Ingrédients traiteur', 2500,  'plaque',20],
    ['TRAIT', 'Sauce soja bouteille',  'Ingrédients traiteur', 1500,  'bouteille', 25],
    ['CAN',   'Pâte de tomate 400g',   'Denrées de base',      500,   'boîte', 60],
    ['CAN',   'Ail 1kg',               'Légumes frais',        1200,  'kg',    30],
    ['CAN',   'Piment doux',           'Légumes frais',        400,   'kg',    35],
    ['CAN',   'Sel iodé 1kg',          'Denrées de base',      500,   'kg',    40],
    ['CAN',   'Poivre noir moulu',     'Denrées de base',      2500,  'boîte', 20],
    ['PAT',   'Levure boulangère 50g', 'Épicerie',             800,   'sachet',30],
    ['PAT',   'Œufs plateau 30',       'Épicerie',             2200,  'plateau', 20],
    ['PAT',   'Lait entier 1L',        'Épicerie',             900,   'brique',35],
    ['BUR',   'Salade laitue 200g',    'Ingrédients',          400,   'unité', 40],
    ['BUR',   'Tomate 1kg',            'Ingrédients',          800,   'kg',    30],
    ['BUR',   'Oignon rouge 1kg',      'Ingrédients',          700,   'kg',    25],
    ['BUR',   'Ketchup 500ml',         'Ingrédients',          1500,  'bouteille', 20],
  ];
  let nb = 0;
  for (const [code, designation, categorieNom, prix, unite, stock] of ingredients) {
    const activite = getActivite(code);
    if (!activite) continue;
    const existant = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND LOWER(designation) = LOWER(?)').get(activite.id, designation);
    if (existant) continue;
    let cat = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND nom = ?').get(activite.id, categorieNom);
    if (!cat) {
      const info = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)').run(activite.id, categorieNom, '');
      cat = { id: Number(info.lastInsertRowid) };
    }
    const ref = h.prochaineReferenceProduit(db, activite.id);
    db.prepare(`INSERT INTO produit (activite_id, reference, designation, categorie_id, prix_achat, prix_vente,
                                     stock_actuel, stock_minimum, stock_maximum, unite, actif)
                VALUES (?, ?, ?, ?, ?, 0, ?, 5, 200, ?, 1)`)
      .run(activite.id, ref, designation, cat.id, prix, stock, unite);
    nb++;
  }
  console.log(`   ${nb} ingrédients supplémentaires créés.`);
}

// =============================================================================
// 2. PRODUITS FINIS pour Traiteur et Cantine
// =============================================================================
function ajouterPlatsB2B() {
  console.log('→ Ajout plats finis Traiteur et Cantine...');
  const plats = [
    // [code, designation, categorie, prix_vente, unite]
    ['TRAIT', 'Buffet Prestige (par personne)', 'Ingrédients traiteur', 15000, 'personne'],
    ['TRAIT', 'Cocktail dînatoire (par personne)', 'Ingrédients traiteur', 8500, 'personne'],
    ['TRAIT', 'Plateau brochettes 20 pièces', 'Ingrédients traiteur', 12000, 'plateau'],
    ['TRAIT', 'Riz sauté crevettes (10 pers.)', 'Ingrédients traiteur', 25000, 'plat'],
    ['CAN', 'Menu du jour bureau', 'Denrées de base', 2500, 'repas'],
    ['CAN', 'Riz sauce arachide', 'Denrées de base', 2200, 'plat'],
    ['CAN', 'Poulet DG (10 pers.)', 'Protéines', 20000, 'plat'],
    ['CAN', 'Poisson braisé plantains (10 pers.)', 'Protéines', 22000, 'plat'],
  ];
  let nb = 0;
  for (const [code, designation, categorieNom, prixVente, unite] of plats) {
    const activite = getActivite(code);
    if (!activite) continue;
    const existant = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND LOWER(designation) = LOWER(?)').get(activite.id, designation);
    if (existant) continue;
    let cat = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND nom = ?').get(activite.id, categorieNom);
    if (!cat) {
      const info = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)').run(activite.id, categorieNom, '');
      cat = { id: Number(info.lastInsertRowid) };
    }
    const ref = h.prochaineReferenceProduit(db, activite.id);
    db.prepare(`INSERT INTO produit (activite_id, reference, designation, categorie_id, prix_achat, prix_vente,
                                     stock_actuel, stock_minimum, stock_maximum, unite, actif)
                VALUES (?, ?, ?, ?, 0, ?, 0, 0, 0, ?, 1)`)
      .run(activite.id, ref, designation, cat.id, prixVente, unite);
    nb++;
  }
  console.log(`   ${nb} plats finis B2B créés.`);
}

// =============================================================================
// 3. FICHES TECHNIQUES pour toutes les activités (recettes de plats)
// =============================================================================
function creerFichesTechniques() {
  console.log('→ Fiches techniques (recettes)...');
  const sandra = getUser('msandra');

  // [code_activite, produit_fini_designation, [[ingredient_designation, quantite], ...]]
  const recettes = [
    // BONA BURGER
    ['BUR', 'Bona Classic Burger', [['Pain burger unité', 1], ['Steak haché bœuf 125g', 1], ['Fromage cheddar tranche', 1], ['Sauce burger 5L', 0.03], ['Salade laitue 200g', 0.15], ['Tomate 1kg', 0.05], ['Oignon rouge 1kg', 0.03]]],
    ['BUR', 'Bona Cheese Burger',  [['Pain burger unité', 1], ['Steak haché bœuf 125g', 1], ['Fromage cheddar tranche', 2], ['Sauce burger 5L', 0.03], ['Salade laitue 200g', 0.15]]],
    ['BUR', 'Bona Double Burger',  [['Pain burger unité', 1], ['Steak haché bœuf 125g', 2], ['Fromage cheddar tranche', 1], ['Sauce burger 5L', 0.05], ['Tomate 1kg', 0.06]]],
    ['BUR', 'Bona Chicken Burger', [['Pain burger unité', 1], ['Fromage cheddar tranche', 1], ['Sauce burger 5L', 0.03], ['Salade laitue 200g', 0.2]]],
    ['BUR', 'Pizza Margherita 30cm',   [['Pâte à pizza boule 300g', 1], ['Fromage cheddar tranche', 3], ['Tomate 1kg', 0.2]]],
    ['BUR', 'Pizza 4 fromages 30cm',   [['Pâte à pizza boule 300g', 1], ['Fromage cheddar tranche', 5]]],
    ['BUR', 'Pizza Bona spécial 30cm', [['Pâte à pizza boule 300g', 1], ['Fromage cheddar tranche', 4], ['Steak haché bœuf 125g', 1], ['Tomate 1kg', 0.15]]],
    // PÂTISSERIE
    ['PAT', 'Croissant beurre',         [['Farine boulangère 25kg', 0.08], ['Beurre plaque 500g', 0.05], ['Sucre en poudre 1kg', 0.015], ['Levure boulangère 50g', 0.15]]],
    ['PAT', 'Pain au chocolat',         [['Farine boulangère 25kg', 0.08], ['Beurre plaque 500g', 0.05], ['Chocolat noir 1kg', 0.03], ['Levure boulangère 50g', 0.15]]],
    ['PAT', 'Éclair café / chocolat',   [['Farine boulangère 25kg', 0.06], ['Beurre plaque 500g', 0.03], ['Sucre en poudre 1kg', 0.04], ['Chocolat noir 1kg', 0.02], ['Œufs plateau 30', 0.06]]],
    ['PAT', 'Millefeuille',             [['Farine boulangère 25kg', 0.1],  ['Beurre plaque 500g', 0.08], ['Sucre en poudre 1kg', 0.05], ['Œufs plateau 30', 0.06]]],
    ['PAT', 'Sandwich club',            [['Farine boulangère 25kg', 0.05], ['Beurre plaque 500g', 0.01]]],
    ['PAT', 'Plat du jour',             [['Farine boulangère 25kg', 0.02], ['Beurre plaque 500g', 0.02], ['Œufs plateau 30', 0.03], ['Lait entier 1L', 0.15]]],
    // TRAITEUR
    ['TRAIT', 'Buffet Prestige (par personne)', [['Riz jasmin 5kg', 0.05], ['Filet bœuf 1kg', 0.15], ['Poulet fermier entier', 0.2], ['Épices safran assort.', 0.05], ['Vin rouge bouteille', 0.1]]],
    ['TRAIT', 'Cocktail dînatoire (par personne)', [['Riz jasmin 5kg', 0.02], ['Crevettes fraîches', 0.05], ['Filet bœuf 1kg', 0.05], ['Vin rouge bouteille', 0.15]]],
    ['TRAIT', 'Plateau brochettes 20 pièces', [['Filet bœuf 1kg', 1], ['Sauce soja bouteille', 0.3], ['Épices safran assort.', 0.1]]],
    ['TRAIT', 'Riz sauté crevettes (10 pers.)', [['Riz jasmin 5kg', 2], ['Crevettes fraîches', 1.5], ['Sauce soja bouteille', 0.5]]],
    // CANTINE
    ['CAN', 'Menu du jour bureau', [['Riz local sac 50kg', 0.005], ['Bœuf carcasse', 0.15], ['Tomates fraîches', 0.05], ['Barquette repas 750ml', 1], ['Sel iodé 1kg', 0.01]]],
    ['CAN', 'Riz sauce arachide', [['Riz local sac 50kg', 0.005], ['Poulet cuisse pack 10', 0.1], ['Tomates fraîches', 0.05], ['Ail 1kg', 0.01], ['Barquette repas 750ml', 1]]],
    ['CAN', 'Poulet DG (10 pers.)', [['Poulet cuisse pack 10', 1], ['Pâte de tomate 400g', 2], ['Ail 1kg', 0.05], ['Piment doux', 0.1], ['Barquette repas 750ml', 10]]],
    ['CAN', 'Poisson braisé plantains (10 pers.)', [['Œufs plateau de 30', 0.3], ['Ail 1kg', 0.05], ['Piment doux', 0.1], ['Barquette repas 750ml', 10]]],
  ];

  const insertFiche = db.prepare(`INSERT INTO fiche_technique (produit_id, rendement, actif, notes, cree_par_id) VALUES (?, 1, 1, ?, ?)`);
  const insertComp = db.prepare(`INSERT INTO composition_fiche (fiche_id, ingredient_id, quantite) VALUES (?, ?, ?)`);
  let nb = 0;
  for (const [codeAct, produitNom, ingredients] of recettes) {
    const activite = getActivite(codeAct);
    if (!activite) continue;
    const produit = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND designation = ?').get(activite.id, produitNom);
    if (!produit) { console.log(`   ! Produit fini introuvable : ${produitNom} (${codeAct})`); continue; }
    // Fiche existante ? On la supprime pour la recréer proprement
    const existant = db.prepare('SELECT id FROM fiche_technique WHERE produit_id = ?').get(produit.id);
    if (existant) {
      db.prepare('DELETE FROM composition_fiche WHERE fiche_id = ?').run(existant.id);
      db.prepare('DELETE FROM fiche_technique WHERE id = ?').run(existant.id);
    }
    const info = insertFiche.run(produit.id, `Recette : ${produitNom}`, sandra.id);
    const ficheId = Number(info.lastInsertRowid);
    for (const [ingNom, qte] of ingredients) {
      const ing = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND designation = ?').get(activite.id, ingNom);
      if (ing) insertComp.run(ficheId, ing.id, qte);
    }
    nb++;
  }
  console.log(`   ${nb} fiches techniques créées.`);
}

// =============================================================================
// 4. ORDRES DE PRODUCTION — dans les 4 activités, dont récentes
// =============================================================================
function creerProductions() {
  console.log('→ Ordres de production (toutes activités, dates récentes)...');
  // Nettoyer les productions existantes pour repartir propre
  db.prepare('DELETE FROM production').run();
  db.prepare("DELETE FROM mouvement_stock WHERE reference_doc LIKE 'FAB-%'").run();

  const productions = [
    // [code, username, produit_fini, quantite, jours_ago]
    ['BUR', 'nikolas',  'Bona Classic Burger', 60, 12],
    ['BUR', 'nikolas',  'Bona Cheese Burger',  40, 10],
    ['BUR', 'nikolas',  'Bona Double Burger',  25, 8],
    ['BUR', 'nikolas',  'Pizza Margherita 30cm', 20, 5],
    ['BUR', 'nikolas',  'Bona Classic Burger', 30, 2],  // récente
    ['BUR', 'nikolas',  'Bona Cheese Burger',  20, 1],  // hier
    ['PAT', 'floriane', 'Croissant beurre',    80, 14],
    ['PAT', 'floriane', 'Pain au chocolat',    60, 12],
    ['PAT', 'floriane', 'Éclair café / chocolat', 35, 9],
    ['PAT', 'floriane', 'Millefeuille',        25, 6],
    ['PAT', 'floriane', 'Croissant beurre',    50, 2],  // récente
    ['PAT', 'floriane', 'Pain au chocolat',    40, 1],  // hier
    ['TRAIT', 'mario',   'Buffet Prestige (par personne)', 100, 8],
    ['TRAIT', 'mario',   'Plateau brochettes 20 pièces',   5,   4],
    ['TRAIT', 'mario',   'Cocktail dînatoire (par personne)', 60, 2],
    ['CAN',   'mariano', 'Menu du jour bureau',   150, 10],
    ['CAN',   'mariano', 'Riz sauce arachide',    100, 7],
    ['CAN',   'mariano', 'Poulet DG (10 pers.)',  4,   4],
    ['CAN',   'mariano', 'Menu du jour bureau',   80,  1],  // hier
  ];

  const insertProd = db.prepare(`INSERT INTO production (activite_id, numero, produit_id, quantite_produite, date_production,
                                                          produit_par_id, cout_matiere, notes)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertMvt = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, motif, reference_doc,
                                                              stock_avant, stock_apres, utilisateur_id, date_mouvement)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updStock = db.prepare('UPDATE produit SET stock_actuel = stock_actuel + ? WHERE id = ?');
  const decStock = db.prepare('UPDATE produit SET stock_actuel = stock_actuel - ? WHERE id = ?');

  let nb = 0;
  for (const [codeAct, username, produitNom, qte, joursAgo] of productions) {
    const activite = getActivite(codeAct);
    const user = getUser(username);
    if (!activite || !user) continue;
    const produit = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND designation = ?').get(activite.id, produitNom);
    if (!produit) continue;
    const fiche = db.prepare('SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1').get(produit.id);
    if (!fiche) continue;
    const composition = db.prepare(`SELECT cf.*, p.designation, p.stock_actuel, p.prix_achat
                                    FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                    WHERE cf.fiche_id = ?`).all(fiche.id);
    if (!composition.length) continue;

    const annee = new Date(Date.now() - joursAgo * 86400000).getFullYear();
    const numero = nextNum(`FAB-${codeAct}-${annee}-`, 'production', 'numero');
    const rendement = Math.max(1, Number(fiche.rendement) || 1);
    let coutMatiere = 0;
    for (const c of composition) coutMatiere += (Number(c.quantite) * qte / rendement) * Number(c.prix_achat || 0);
    coutMatiere = Math.round(coutMatiere);

    insertProd.run(activite.id, numero, produit.id, qte, isoDate(joursAgo), user.id, coutMatiere,
                   `Production ${qte} × ${produit.designation}`);

    // Mouvements SORTIE ingrédients + ENTREE produit fini
    for (const c of composition) {
      const qteConsommee = Number(c.quantite) * qte / rendement;
      const ing = db.prepare('SELECT stock_actuel FROM produit WHERE id = ?').get(c.ingredient_id);
      const avant = ing.stock_actuel;
      insertMvt.run(activite.id, c.ingredient_id, 'SORTIE', qteConsommee,
                    `Production ${numero} · ${qte} × ${produit.designation}`, numero,
                    avant, avant - qteConsommee, user.id, isoDate(joursAgo));
      decStock.run(qteConsommee, c.ingredient_id);
    }
    const avant = produit.stock_actuel;
    insertMvt.run(activite.id, produit.id, 'ENTREE', qte, `Production ${numero}`, numero,
                  avant, avant + qte, user.id, isoDate(joursAgo));
    updStock.run(qte, produit.id);
    nb++;
  }
  console.log(`   ${nb} ordres de production créés (toutes activités).`);
}

// =============================================================================
// 5. ACHATS + DISTRIBUTIONS (Sandra achète, Nestor distribue)
// =============================================================================
function creerAchatsEtDistributions() {
  console.log('→ Achats + distributions (complément)...');
  const sandra = getUser('msandra');
  const nestor = getUser('nestor');
  const gestionnaires = {
    TRAIT: getUser('mario'), CAN: getUser('mariano'),
    PAT: getUser('floriane'), BUR: getUser('nikolas'),
  };

  // Vérifier si des données existent déjà — on complète seulement si vide
  const existants = db.prepare('SELECT COUNT(*) AS n FROM achat').get().n;
  if (existants >= 5) { console.log(`   ${existants} achats déjà existants — passer.`); return; }

  const nbCiblee = 8 - existants;
  for (let i = 0; i < nbCiblee; i++) {
    const codeActivite = choice(['TRAIT', 'CAN', 'PAT', 'BUR']);
    const activite = getActivite(codeActivite);
    const fournisseurs = db.prepare('SELECT * FROM fournisseur WHERE activite_id = ?').all(activite.id);
    if (!fournisseurs.length) continue;
    const fournisseur = choice(fournisseurs);
    const jourAchat = 30 - i * 3;
    const annee = new Date(Date.now() - jourAchat * 86400000).getFullYear();
    const numero = nextNum(`ACH-${annee}-`, 'achat', 'numero');

    const produits = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND stock_maximum > 0 ORDER BY RANDOM() LIMIT 4').all(activite.id);
    if (!produits.length) continue;

    const info = db.prepare(`INSERT INTO achat (numero, fournisseur_id, fournisseur_libre, date_achat, statut,
                                                montant_total, cree_par_id, notes)
                             VALUES (?, ?, ?, ?, 'RECEPTIONNE', 0, ?, ?)`)
      .run(numero, fournisseur.id, fournisseur.raison_sociale, isoDate(jourAchat), sandra.id, `Achat ${numero}`);
    const achatId = Number(info.lastInsertRowid);

    let total = 0;
    const lignes = [];
    for (const p of produits) {
      const qte = randint(5, 30);
      const pu = p.prix_achat || randint(500, 5000);
      const inf = db.prepare(`INSERT INTO ligne_achat (achat_id, designation, quantite, prix_unitaire, fournisseur_id, activite_pressentie_id)
                              VALUES (?, ?, ?, ?, ?, ?)`)
        .run(achatId, p.designation, qte, pu, fournisseur.id, activite.id);
      lignes.push({ id: Number(inf.lastInsertRowid), produit_id: p.id, qte, pu, designation: p.designation });
      total += qte * pu;
    }
    db.prepare('UPDATE achat SET montant_total = ? WHERE id = ?').run(total, achatId);

    // Distribution + réception
    const numeroDist = nextNum(`DIST-${annee}-`, 'distribution', 'numero');
    const isReceptionne = i < nbCiblee - 2; // 2 dernières = en REMISE (à traiter)
    const statut = isReceptionne ? 'RECEPTIONNEE' : 'REMISE';
    const infoDist = db.prepare(`INSERT INTO distribution (numero, activite_id, statut, date_creation, date_remise, date_reception,
                                                            cree_par_id, receptionne_par_id, notes)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(numeroDist, activite.id, statut, isoDate(jourAchat - 0.5), isoDate(Math.max(0, jourAchat - 1)),
           isReceptionne ? isoDate(Math.max(0, jourAchat - 2)) : null, nestor.id,
           isReceptionne ? gestionnaires[codeActivite].id : null, `Distribution ${numeroDist}`);
    const distId = Number(infoDist.lastInsertRowid);
    for (const lc of lignes) {
      const qteRecue = isReceptionne ? (randint(0, 100) < 15 ? lc.qte - randint(1, 2) : lc.qte) : null;
      const infoLD = db.prepare(`INSERT INTO ligne_distribution (distribution_id, ligne_achat_id, produit_id, quantite_annoncee, quantite_recue)
                                 VALUES (?, ?, ?, ?, ?)`).run(distId, lc.id, lc.produit_id, lc.qte, qteRecue);
      if (isReceptionne && qteRecue > 0) {
        const prod = db.prepare('SELECT stock_actuel FROM produit WHERE id = ?').get(lc.produit_id);
        db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, motif, reference_doc,
                                                  stock_avant, stock_apres, utilisateur_id, date_mouvement, ligne_distribution_id)
                    VALUES (?, ?, 'ENTREE', ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(activite.id, lc.produit_id, qteRecue,
               `Réception ${numeroDist} · ${lc.designation}`, numeroDist,
               prod.stock_actuel, prod.stock_actuel + qteRecue, gestionnaires[codeActivite].id,
               isoDate(Math.max(0, jourAchat - 2)), Number(infoLD.lastInsertRowid));
        db.prepare('UPDATE produit SET stock_actuel = stock_actuel + ? WHERE id = ?').run(qteRecue, lc.produit_id);
      }
    }
  }
  console.log(`   ${nbCiblee} achats supplémentaires créés.`);
}

// =============================================================================
// 6. COMMANDES B2B (Traiteur + Cantine) — tous statuts avec dates récentes
// =============================================================================
function creerCommandesB2B() {
  console.log('→ Commandes B2B (tous statuts, dates récentes)...');
  // Nettoyer les commandes existantes pour repartir propre
  db.prepare('DELETE FROM paiement WHERE commande_id IS NOT NULL').run();
  db.prepare('DELETE FROM relance').run();
  db.prepare('DELETE FROM ligne_commande').run();
  db.prepare('DELETE FROM commande').run();

  const sandra = getUser('sandra');
  const scenarios = [
    // [code, statut, jours_ago, ratio_paye, produits]
    // Traiteur — 8 commandes
    ['TRAIT', 'PAYEE',    18, 1.0,  ['Buffet Prestige (par personne)', 'Vin rouge bouteille']],
    ['TRAIT', 'PAYEE',    12, 1.0,  ['Cocktail dînatoire (par personne)', 'Jus de fruits carton 1L']],
    ['TRAIT', 'PAYEE',     6, 1.0,  ['Plateau brochettes 20 pièces', 'Eau minérale pack 6']],
    ['TRAIT', 'PAYEE',     2, 1.0,  ['Riz sauté crevettes (10 pers.)']],
    ['TRAIT', 'FACTUREE', 22, 0.5,  ['Buffet Prestige (par personne)']],  // impayée + acompte
    ['TRAIT', 'FACTUREE', 10, 0.0,  ['Cocktail dînatoire (par personne)', 'Vin rouge bouteille']],  // impayée
    ['TRAIT', 'LIVREE',    3, 1.0,  ['Plateau brochettes 20 pièces']],
    ['TRAIT', 'PROFORMA',  1, 0.0,  ['Buffet Prestige (par personne)', 'Vin rouge bouteille']],
    // Cantine — 7 commandes
    ['CAN', 'PAYEE',    15, 1.0,  ['Menu du jour bureau']],
    ['CAN', 'PAYEE',     8, 1.0,  ['Riz sauce arachide', 'Barquette repas 750ml']],
    ['CAN', 'PAYEE',     3, 1.0,  ['Poulet DG (10 pers.)', 'Riz local sac 50kg']],
    ['CAN', 'FACTUREE', 30, 0.0,  ['Menu du jour bureau']],  // impayée J+30 → relance J30
    ['CAN', 'FACTUREE', 12, 0.6,  ['Poisson braisé plantains (10 pers.)']],  // acompte 60%
    ['CAN', 'LIVREE',    2, 0.0,  ['Menu du jour bureau', 'Barquette repas 750ml']],  // livrée non facturée
    ['CAN', 'PROFORMA',  0, 0.0,  ['Menu du jour bureau']],  // aujourd'hui
  ];

  const insertCmd = db.prepare(`INSERT INTO commande (activite_id, numero, statut, client_id, date_commande, date_livraison_prevue,
                                                       date_livraison_reelle, date_echeance, mode_paiement, montant_total,
                                                       montant_remise, taux_tva, montant_ht, montant_tva, montant_paye,
                                                       numero_proforma, numero_bon_commande, numero_facture, numero_bl,
                                                       cree_par_id, valide_par_id, notes)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLigne = db.prepare(`INSERT INTO ligne_commande (commande_id, produit_id, designation, quantite, prix_unitaire, remise)
                                  VALUES (?, ?, ?, ?, ?, ?)`);
  const insertPaiement = db.prepare(`INSERT INTO paiement (activite_id, commande_id, numero_recu, mode_paiement, montant,
                                                            reference_transaction, cree_par_id, date_paiement, notes)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let nb = 0;
  for (const [codeAct, statut, joursAgo, ratioPayee, produitsNoms] of scenarios) {
    const activite = getActivite(codeAct);
    const clients = db.prepare('SELECT * FROM client WHERE activite_id = ?').all(activite.id);
    if (!clients.length) continue;
    const client = choice(clients);
    const annee = new Date(Date.now() - joursAgo * 86400000).getFullYear();
    const numero = nextNum(`CMD-${codeAct}-${annee}-`, 'commande', 'numero');
    const numeroProforma = nextNum(`PRO-${codeAct}-${annee}-`, 'commande', 'numero_proforma');
    const numeroBC = ['VALIDE', 'EN_PRODUCTION', 'LIVREE', 'FACTUREE', 'PAYEE'].includes(statut)
      ? nextNum(`BC-${codeAct}-${annee}-`, 'commande', 'numero_bon_commande') : null;
    const numeroBL = ['LIVREE', 'FACTUREE', 'PAYEE'].includes(statut)
      ? nextNum(`BL-${codeAct}-${annee}-`, 'commande', 'numero_bl') : null;
    const numeroFac = ['FACTUREE', 'PAYEE'].includes(statut)
      ? nextNum(`FAC-${codeAct}-${annee}-`, 'commande', 'numero_facture') : null;

    const lignes = [];
    let ht = 0;
    for (const nom of produitsNoms) {
      const p = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND designation = ?').get(activite.id, nom);
      if (!p) continue;
      const qte = randint(2, 15);
      const pu = p.prix_vente > 0 ? p.prix_vente : (p.prix_achat * 1.4);
      lignes.push({ produit_id: p.id, designation: p.designation, quantite: qte, prix_unitaire: pu });
      ht += qte * pu;
    }
    if (!lignes.length) continue;
    ht = Math.round(ht);
    const tva = Math.round(ht * 19.25 / 100);
    const ttc = ht + tva;
    const montantPaye = Math.round(ttc * ratioPayee);
    const dateCmd = isoDate(joursAgo);
    const dateLivPrev = isoJour(Math.max(0, joursAgo - 3));
    const dateLivReel = ['LIVREE', 'FACTUREE', 'PAYEE'].includes(statut) ? isoDate(Math.max(0, joursAgo - 2)) : null;
    // Pour les factures impayées anciennes : échéance passée pour déclencher relances (30j+ = mise en demeure)
    let dateEch;
    if (['FACTUREE'].includes(statut) && ratioPayee < 1) {
      // Impayée : échéance calculée pour créer du retard visible
      if (joursAgo >= 30) dateEch = isoJour(35);       // > J+30 → mise en demeure
      else if (joursAgo >= 20) dateEch = isoJour(18);  // > J+15 → rappel ferme
      else dateEch = isoJour(9);                       // > J+7 → rappel amical
    } else if (['PAYEE'].includes(statut)) {
      dateEch = isoJour(Math.max(0, joursAgo - 15));
    } else {
      dateEch = isoJour(Math.max(0, joursAgo - 5));
    }

    const info = insertCmd.run(activite.id, numero, statut, client.id, dateCmd, dateLivPrev, dateLivReel, dateEch,
                                'VIREMENT', ttc, 0, 19.25, ht, tva, montantPaye,
                                numeroProforma, numeroBC, numeroFac, numeroBL,
                                sandra.id, statut !== 'PROFORMA' ? sandra.id : null,
                                `Commande de test ${numero}`);
    const cmdId = Number(info.lastInsertRowid);
    for (const l of lignes) insertLigne.run(cmdId, l.produit_id, l.designation, l.quantite, l.prix_unitaire, 0);

    if (montantPaye > 0) {
      const numeroRecu = nextNum(`REC-${codeAct}-${annee}-`, 'paiement', 'numero_recu');
      insertPaiement.run(activite.id, cmdId, numeroRecu, 'VIREMENT', montantPaye, `VIR-${randint(1000, 9999)}`,
                         sandra.id, isoDate(Math.max(0, joursAgo - 2)), 'Paiement enregistré');
    }
    nb++;
  }
  console.log(`   ${nb} commandes B2B créées.`);
}

// =============================================================================
// 7. RELANCES
// =============================================================================
function creerRelances() {
  console.log('→ Relances sur factures impayées...');
  const sandra = getUser('sandra');
  const impayees = db.prepare(`SELECT * FROM commande WHERE statut = 'FACTUREE' AND montant_paye < montant_total AND date_echeance IS NOT NULL`).all();
  const insertRel = db.prepare(`INSERT INTO relance (commande_id, niveau, canal, date_envoi, envoye_par_id, notes)
                                VALUES (?, ?, ?, ?, ?, ?)`);
  let nb = 0;
  for (const cmd of impayees) {
    const joursRetard = Math.floor((Date.now() - new Date(cmd.date_echeance).getTime()) / 86400000);
    if (joursRetard >= 7) { insertRel.run(cmd.id, 'J7', 'EMAIL', isoDate(joursRetard - 7), sandra.id, 'Rappel amical envoyé'); nb++; }
    if (joursRetard >= 15) { insertRel.run(cmd.id, 'J15', 'TELEPHONE', isoDate(joursRetard - 15), sandra.id, 'Rappel ferme par téléphone'); nb++; }
    if (joursRetard >= 30) { insertRel.run(cmd.id, 'J30', 'IMPRIMEE', isoDate(joursRetard - 30), sandra.id, 'Mise en demeure remise en main propre'); nb++; }
  }
  console.log(`   ${nb} relances créées.`);
}

// =============================================================================
// 8. VENTES B2C aujourd'hui + hier
// =============================================================================
function creerVentesRecentes() {
  console.log('→ Ventes B2C récentes (aujourd\'hui + hier)...');
  const caissiers = {
    PAT: getUser('caiss_pat'),
    BUR: getUser('caiss_bur'),
  };
  const modes = ['ESPECES', 'CARTE', 'ORANGE', 'MTN'];
  const insertVente = db.prepare(`INSERT INTO vente (activite_id, numero, date_vente, caissier_id, mode_paiement, montant_total, montant_paye)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertLigne = db.prepare(`INSERT INTO ligne_vente (vente_id, produit_id, quantite, prix_unitaire) VALUES (?, ?, ?, ?)`);
  const insertMvt = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, motif, reference_doc,
                                                              stock_avant, stock_apres, utilisateur_id, date_mouvement)
                                VALUES (?, ?, 'SORTIE', ?, ?, ?, ?, ?, ?, ?)`);
  const updStock = db.prepare('UPDATE produit SET stock_actuel = stock_actuel - ? WHERE id = ?');

  let nb = 0;
  for (const code of ['PAT', 'BUR']) {
    const activite = getActivite(code);
    const caissier = caissiers[code];
    const produits = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND prix_vente > 0 AND stock_actuel > 0').all(activite.id);
    if (!produits.length) continue;

    for (const joursAgo of [0, 1]) {
      const nbVentes = code === 'BUR' ? randint(15, 25) : randint(10, 20);
      for (let k = 0; k < nbVentes; k++) {
        const dt = new Date(Date.now() - joursAgo * 86400000);
        dt.setHours(randint(9, 20), randint(0, 59), randint(0, 59));
        const annee = dt.getFullYear();
        const numero = nextNum(`TIC-${code}-${annee}-`, 'vente', 'numero');
        const mode = choice(modes);

        const dtStr = dt.toISOString().slice(0, 19).replace('T', ' ');
        const info = insertVente.run(activite.id, numero, dtStr, caissier.id, mode, 0, 0);
        const venteId = Number(info.lastInsertRowid);
        const chosen = [...produits].sort(() => rand() - 0.5).slice(0, randint(1, 3));
        let total = 0;
        for (const p of chosen) {
          const qte = randint(1, 3);
          insertLigne.run(venteId, p.id, qte, p.prix_vente);
          total += qte * p.prix_vente;
          const stockAvant = db.prepare('SELECT stock_actuel FROM produit WHERE id = ?').get(p.id).stock_actuel;
          insertMvt.run(activite.id, p.id, qte, `Vente ${numero}`, numero, stockAvant, Math.max(0, stockAvant - qte), caissier.id, dtStr);
          updStock.run(qte, p.id);
        }
        db.prepare('UPDATE vente SET montant_total = ?, montant_paye = ? WHERE id = ?').run(total, total, venteId);
        nb++;
      }
    }
  }
  console.log(`   ${nb} ventes B2C récentes créées.`);
}

// =============================================================================
// 9. CLÔTURES DE CAISSE (Pâtisserie + Bona Burger)
// =============================================================================
function creerClotures() {
  console.log('→ Clôtures de caisse (15 par activité B2C)...');
  db.prepare('DELETE FROM cloture_caisse').run();
  const caissiers = {
    PAT: getUser('caiss_pat'),
    BUR: getUser('caiss_bur'),
  };
  const insert = db.prepare(`INSERT INTO cloture_caisse (activite_id, numero, date_ouverture, date_cloture,
                                                          fond_ouverture, ouvert_par_id, cloture_par_id,
                                                          total_theorique_especes, total_compte_especes,
                                                          total_carte, total_orange, total_mtn, ecart, statut, notes)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let nb = 0;
  for (const code of ['PAT', 'BUR']) {
    const activite = getActivite(code);
    const caissier = caissiers[code];
    for (let j = 20; j >= 2; j--) {
      const jour = isoJour(j);
      const rows = db.prepare(`SELECT mode_paiement, COALESCE(SUM(montant_total), 0) AS mt
                               FROM vente WHERE activite_id = ? AND caissier_id = ? AND date(date_vente) = ?
                               GROUP BY mode_paiement`).all(activite.id, caissier.id, jour);
      const totals = { ESPECES: 0, CARTE: 0, ORANGE: 0, MTN: 0 };
      for (const r of rows) if (totals[r.mode_paiement] !== undefined) totals[r.mode_paiement] = Number(r.mt);
      if (totals.ESPECES + totals.CARTE + totals.ORANGE + totals.MTN === 0) continue;

      const annee = new Date(Date.now() - j * 86400000).getFullYear();
      const numero = nextNum(`CLO-${code}-${annee}-`, 'cloture_caisse', 'numero');
      const fond = 10000;
      const especesTheo = Math.round(fond + totals.ESPECES);
      const ecart = randint(0, 100) < 25 ? (randint(0, 1) ? randint(200, 900) : -randint(200, 700)) : 0;
      const compteEsp = especesTheo + ecart;

      insert.run(activite.id, numero, `${jour} 07:30:00`, `${jour} 21:15:00`, fond, caissier.id, caissier.id,
                 especesTheo, compteEsp, Math.round(totals.CARTE), Math.round(totals.ORANGE), Math.round(totals.MTN),
                 ecart, 'CLOTUREE', ecart === 0 ? 'Caisse équilibrée' : `Écart : ${ecart} FCFA`);
      nb++;
    }
  }
  console.log(`   ${nb} clôtures de caisse créées.`);
}

// =============================================================================
// 10. AJUSTEMENTS / PERTES / RETOURS
// =============================================================================
function creerAjustements() {
  console.log('→ Ajustements / pertes / retours...');
  const users = {
    TRAIT: getUser('mario'), CAN: getUser('mariano'),
    PAT: getUser('floriane'), BUR: getUser('nikolas'),
  };
  const insert = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, motif,
                                                          stock_avant, stock_apres, utilisateur_id, date_mouvement)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const ajustements = [
    ['BUR', 'AJUST_M', 'Pain burger unité', 3, 'Casse au déchargement', 8],
    ['BUR', 'PERTE',   'Fromage cheddar tranche', 5, 'Périmé', 5],
    ['BUR', 'RETOUR',  'Coca-Cola 50cl', 2, 'Retour client (bouteille cassée)', 3],
    ['PAT', 'PERTE',   'Beurre plaque 500g', 1, 'Périmé — non conforme', 4],
    ['PAT', 'AJUST_P', 'Sucre en poudre 1kg', 2, 'Correction inventaire', 2],
    ['CAN', 'RETOUR',  'Barquette repas 750ml', 20, 'Retour client (commande partielle)', 6],
    ['CAN', 'PERTE',   'Tomates fraîches', 4, 'Gaspillage', 3],
    ['CAN', 'AJUST_M', 'Œufs plateau de 30', 2, 'Casse au transport', 1],
    ['TRAIT', 'PERTE', 'Vin rouge bouteille', 1, 'Bouteille cassée', 7],
    ['TRAIT', 'AJUST_M', 'Épices safran assort.', 1, 'Correction inventaire physique', 5],
  ];
  let nb = 0;
  for (const [code, type, produitNom, qte, motif, joursAgo] of ajustements) {
    const activite = getActivite(code);
    const produit = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND designation = ?').get(activite.id, produitNom);
    if (!produit) continue;
    // Vérifier doublon
    const dup = db.prepare(`SELECT 1 FROM mouvement_stock WHERE produit_id = ? AND type = ? AND motif = ? AND date(date_mouvement) = date(?)`)
      .get(produit.id, type, motif, isoDate(joursAgo));
    if (dup) continue;
    const signe = ['AJUST_P', 'RETOUR'].includes(type) ? 1 : -1;
    const apres = produit.stock_actuel + signe * qte;
    insert.run(activite.id, produit.id, type, qte, motif, produit.stock_actuel, apres, users[code].id, isoDate(joursAgo));
    db.prepare('UPDATE produit SET stock_actuel = ? WHERE id = ?').run(apres, produit.id);
    nb++;
  }
  console.log(`   ${nb} ajustements créés.`);
}

// =============================================================================
// 11. JOURNAL D'AUDIT
// =============================================================================
function creerJournalAudit() {
  console.log('→ Journal d\'audit...');
  db.prepare('DELETE FROM journal_audit').run();
  const sandra = getUser('msandra');
  const nestor = getUser('nestor');
  const insert = db.prepare(`INSERT INTO journal_audit (utilisateur_id, activite_id, action, entite, entite_id, details, date_action)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const entrees = [
    [sandra.id, null, 'UTIL_CREE', 'utilisateur', null, 'Création utilisateur mario (GESTIONNAIRE) — Mario ONANA', 40],
    [sandra.id, null, 'PARAM_MODIFIE', 'parametre', null, 'taux_tva: "19" → "19.25"', 35],
    [sandra.id, null, 'UTIL_ROLE_CHANGE', 'utilisateur', null, 'floriane : GESTIONNAIRE → SECRETARIAT (annulé après)', 28],
    [sandra.id, getActivite('TRAIT').id, 'COMMANDE_FACTUREE', 'commande', null, 'Facture FAC-TRAIT-2026-0001 émise', 20],
    [nestor.id, getActivite('CAN').id,   'RECEPTION_ECART', 'distribution', null, 'Écart de 2 unités sur DIST-2026-0003', 18],
    [sandra.id, getActivite('TRAIT').id, 'LIVRAISON_CREDIT', 'commande', null, 'Livraison à crédit autorisée pour client fidèle (motif: paiement à 30j)', 14],
    [sandra.id, getActivite('BUR').id,   'CAISSE_ECART', 'cloture_caisse', null, 'Écart de -500 FCFA sur CLO-BUR-2026-0012', 10],
    [sandra.id, getActivite('TRAIT').id, 'RELANCE_ENVOYEE', 'commande', null, 'Relance J7 (EMAIL) sur FAC-TRAIT', 8],
    [sandra.id, getActivite('CAN').id,   'COMMANDE_ANNULEE', 'commande', null, 'Commande CMD-CAN annulée (client indisponible)', 6],
    [sandra.id, null, 'PARAM_MODIFIE', 'parametre', null, 'entreprise_banque_compte: "" → "06010429558 55"', 5],
    [sandra.id, getActivite('BUR').id,   'PAIEMENT_ENREGISTRE', 'commande', null, 'Reçu REC-BUR-2026-0005 (15 000 FCFA en ESPECES)', 3],
    [sandra.id, getActivite('PAT').id,   'CAISSE_OUVERTE', 'cloture_caisse', null, 'CLO-PAT-2026-0018 ouverte avec 10 000 FCFA de fond', 1],
  ];
  for (const e of entrees) insert.run(e[0], e[1], e[2], e[3], e[4], e[5], isoDate(e[6]));
  console.log(`   ${entrees.length} entrées journal créées.`);
}

// =============================================================================
// 12. ALERTES DE STOCK (mise à jour après tous les mouvements)
// =============================================================================
function regenererAlertes() {
  console.log('→ Régénération des alertes stock...');
  db.prepare('DELETE FROM alerte').run();
  const insert = db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, message, vue, creee_le)
                             VALUES (?, ?, ?, ?, 0, datetime('now'))`);
  let nb = 0;
  for (const p of db.prepare("SELECT * FROM produit WHERE actif = 1 AND stock_maximum > 0").all()) {
    if (p.stock_actuel <= 0) {
      insert.run(p.activite_id, p.id, 'CRITIQUE', `Rupture de stock : ${p.designation}`);
      nb++;
    } else if (p.stock_actuel <= p.stock_minimum) {
      insert.run(p.activite_id, p.id, 'ALERTE', `Stock bas : ${p.designation} (${p.stock_actuel} restant / seuil ${p.stock_minimum})`);
      nb++;
    }
  }
  console.log(`   ${nb} alerte(s) créée(s).`);
}

// =============================================================================
// MAIN
// =============================================================================
function main() {
  console.log('\n========================================');
  console.log('  SEED TEST — Génération données complètes');
  console.log('========================================\n');
  db.transaction(() => {
    ajouterIngredientsExtra();
    ajouterPlatsB2B();
    creerFichesTechniques();
    creerProductions();
    creerAchatsEtDistributions();
    creerCommandesB2B();
    creerRelances();
    creerVentesRecentes();
    creerClotures();
    creerAjustements();
    creerJournalAudit();
    regenererAlertes();
  })();

  console.log('\n✓ Seed complet terminé. Toutes les activités et tous les modules ont des données de test.\n');
  console.log('  === Contenu généré ===');
  console.log('  • Ingrédients bruts supplémentaires pour Traiteur, Cantine, PAT et BUR');
  console.log('  • Plats B2B (Buffet Prestige, Menu du jour, Poulet DG, etc.)');
  console.log('  • ~21 fiches techniques (recettes) dans les 4 activités');
  console.log('  • ~18 ordres de production, dont ventes récentes (hier, aujourd\'hui)');
  console.log('  • Achats + distributions (réceptionnées et en attente)');
  console.log('  • 15 commandes B2B (proforma → soldée + acomptes + impayées)');
  console.log('  • Relances J7, J15, J30 sur factures anciennes');
  console.log('  • Ventes B2C récentes (aujourd\'hui + hier) → dashboard alimenté');
  console.log('  • ~30 clôtures de caisse');
  console.log('  • 10 ajustements/pertes/retours de stock');
  console.log('  • 12 entrées de journal d\'audit');
  console.log('  • Alertes stock régénérées\n');
}

main();
