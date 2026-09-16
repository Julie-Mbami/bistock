// =============================================================================
// SEED CATALOGUE WEB — Peupler le catalogue en ligne (Pâtisserie + Bona Burger)
// =============================================================================
// USAGE :
//   node scripts/seed_catalogue_web.js              → dry-run (affiche ce qui serait fait)
//   node scripts/seed_catalogue_web.js --confirm    → exécute réellement (idempotent)
//   node scripts/seed_catalogue_web.js --confirm --reset  → supprime tout le catalogue web avant
//
// Le script est IDEMPOTENT : ré-exécutable sans doublon (upsert sur activite_id + reference).
// Il ne touche PAS aux ventes, commandes, stocks : uniquement catégories + produits.
// =============================================================================

const db = require('../src/db');

const args = new Set(process.argv.slice(2));
const CONFIRME = args.has('--confirm');
const RESET = args.has('--reset');

// -----------------------------------------------------------------------------
// DONNÉES SEED
// -----------------------------------------------------------------------------
// Prix en FCFA · unite = 'pièce' (produit vendu à l'unité au client)
// temps_preparation_min = temps que la cuisine met à préparer (indicatif interne)

const CATALOGUE = {
  // Pâtisserie — code activité PAT
  PAT: {
    categories: [
      { nom: 'Viennoiseries',   description: 'Croissants, pains chocolats, brioches — cuits du matin' },
      { nom: 'Pâtisseries fines', description: 'Éclairs, tartes, mille-feuilles — spécialités maison' },
      { nom: 'Gâteaux à la part', description: 'Parts individuelles de nos gâteaux signatures' },
      { nom: 'Biscuits & petits fours', description: 'Cookies, macarons, financiers, sablés' },
      { nom: 'Boissons chaudes',  description: 'Café, thé, chocolat chaud — préparés à la demande' },
    ],
    produits: [
      // Viennoiseries
      { cat: 'Viennoiseries',   ref: 'PAT-VIE-001', nom: 'Croissant au beurre',       prix: 500,  temps: 3,  desc: 'Feuilletage doré, pur beurre de qualité. Le classique du matin.' },
      { cat: 'Viennoiseries',   ref: 'PAT-VIE-002', nom: 'Pain au chocolat',          prix: 600,  temps: 3,  desc: 'Deux barres de chocolat noir enrobées d\'une pâte feuilletée croustillante.' },
      { cat: 'Viennoiseries',   ref: 'PAT-VIE-003', nom: 'Brioche aux pépites',       prix: 700,  temps: 3,  desc: 'Brioche moelleuse aux pépites de chocolat.' },
      { cat: 'Viennoiseries',   ref: 'PAT-VIE-004', nom: 'Chausson aux pommes',       prix: 800,  temps: 4,  desc: 'Pommes fondantes légèrement caramélisées dans un feuilletage croustillant.' },

      // Pâtisseries fines
      { cat: 'Pâtisseries fines', ref: 'PAT-FIN-001', nom: 'Éclair au chocolat',      prix: 1200, temps: 5,  desc: 'Choux garni de crème pâtissière chocolat, glaçage brillant.' },
      { cat: 'Pâtisseries fines', ref: 'PAT-FIN-002', nom: 'Éclair café',             prix: 1200, temps: 5,  desc: 'Crème pâtissière au café intense, glaçage moka.' },
      { cat: 'Pâtisseries fines', ref: 'PAT-FIN-003', nom: 'Mille-feuille vanille',   prix: 1500, temps: 6,  desc: 'Trois couches de pâte feuilletée, crème diplomate à la vanille de Madagascar.' },
      { cat: 'Pâtisseries fines', ref: 'PAT-FIN-004', nom: 'Tarte au citron meringuée', prix: 1500, temps: 6, desc: 'Sablé breton, curd de citron acidulé, meringue italienne.' },
      { cat: 'Pâtisseries fines', ref: 'PAT-FIN-005', nom: 'Paris-Brest',             prix: 1800, temps: 6,  desc: 'Couronne de pâte à choux garnie de praliné noisette.' },

      // Gâteaux à la part
      { cat: 'Gâteaux à la part', ref: 'PAT-GAT-001', nom: 'Part de forêt noire',    prix: 1500, temps: 5,  desc: 'Génoise cacao, cerises griottes, chantilly mascarpone.' },
      { cat: 'Gâteaux à la part', ref: 'PAT-GAT-002', nom: 'Part d\'opéra',          prix: 1800, temps: 5,  desc: 'Biscuit joconde, ganache chocolat, crème au beurre café.' },
      { cat: 'Gâteaux à la part', ref: 'PAT-GAT-003', nom: 'Cheesecake New York',    prix: 2000, temps: 5,  desc: 'Base spéculoos, crème fromage frais légère, coulis fruits rouges.' },
      { cat: 'Gâteaux à la part', ref: 'PAT-GAT-004', nom: 'Fondant au chocolat',    prix: 1800, temps: 8,  desc: 'Cœur coulant chocolat noir 70%. Servi tiède avec boule de glace.' },
      { cat: 'Gâteaux à la part', ref: 'PAT-GAT-005', nom: 'Tiramisu maison',        prix: 1800, temps: 4,  desc: 'Recette italienne authentique, café espresso, mascarpone.' },

      // Biscuits & petits fours
      { cat: 'Biscuits & petits fours', ref: 'PAT-BIS-001', nom: 'Macaron (à l\'unité)', prix: 500,  temps: 2, desc: 'Coque croquante, cœur fondant. Parfums variés selon arrivage.' },
      { cat: 'Biscuits & petits fours', ref: 'PAT-BIS-002', nom: 'Cookie chocolat noir', prix: 800, temps: 3, desc: 'Gros cookie moelleux au chocolat noir de couverture.' },
      { cat: 'Biscuits & petits fours', ref: 'PAT-BIS-003', nom: 'Financier amande',    prix: 600, temps: 2, desc: 'Petit gâteau à la poudre d\'amande, moelleux et beurré.' },
      { cat: 'Biscuits & petits fours', ref: 'PAT-BIS-004', nom: 'Brownie noix pécan',  prix: 900, temps: 3, desc: 'Fondant, dense, aux éclats de noix de pécan grillées.' },

      // Boissons chaudes
      { cat: 'Boissons chaudes', ref: 'PAT-BOI-001', nom: 'Café espresso',            prix: 500,  temps: 2, desc: 'Café serré, sélection maison.' },
      { cat: 'Boissons chaudes', ref: 'PAT-BOI-002', nom: 'Cappuccino',               prix: 1000, temps: 3, desc: 'Espresso, lait chaud mousseux, cacao en poudre.' },
      { cat: 'Boissons chaudes', ref: 'PAT-BOI-003', nom: 'Chocolat chaud maison',    prix: 1200, temps: 4, desc: 'Chocolat noir fondu dans du lait entier, chantilly maison sur le dessus.' },
      { cat: 'Boissons chaudes', ref: 'PAT-BOI-004', nom: 'Thé au choix',             prix: 800,  temps: 3, desc: 'Sélection de thés noirs, verts et infusions.' },
    ],
  },

  // 237 Bona Burger — code activité BUR
  BUR: {
    categories: [
      { nom: 'Burgers signature',  description: 'Nos burgers cultes, pain brioché maison, viande fraîche' },
      { nom: 'Burgers poulet',     description: 'Poulet mariné et frit croustillant' },
      { nom: 'Menus',              description: 'Burger + frites + boisson à prix doux' },
      { nom: 'Accompagnements',    description: 'Frites, sauces et sides' },
      { nom: 'Boissons',           description: 'Sodas, jus et eaux fraîches' },
    ],
    produits: [
      // Burgers signature
      { cat: 'Burgers signature', ref: 'BUR-SIG-001', nom: 'Burger Classique',    prix: 3000, temps: 10, desc: 'Steak haché 150g, cheddar fondu, salade, tomate, oignon, sauce burger maison.' },
      { cat: 'Burgers signature', ref: 'BUR-SIG-002', nom: 'Cheese Burger',       prix: 3500, temps: 10, desc: 'Double cheddar fondu, steak 150g, cornichons, sauce cheese.' },
      { cat: 'Burgers signature', ref: 'BUR-SIG-003', nom: 'Double Cheese',       prix: 5000, temps: 12, desc: 'Deux steaks 150g, double cheddar, bacon, sauce BBQ. Pour les gros appétits.' },
      { cat: 'Burgers signature', ref: 'BUR-SIG-004', nom: 'Bacon Burger',        prix: 4500, temps: 12, desc: 'Steak 150g, bacon fumé croustillant, cheddar, oignons caramélisés, sauce BBQ.' },
      { cat: 'Burgers signature', ref: 'BUR-SIG-005', nom: 'Bona Spicy',          prix: 4000, temps: 11, desc: '🔥 Steak 150g, jalapeños, cheddar épicé, sauce piquante maison. Ça pique.' },

      // Burgers poulet
      { cat: 'Burgers poulet', ref: 'BUR-POU-001', nom: 'Chicken Crispy',         prix: 3500, temps: 11, desc: 'Filet de poulet pané croustillant, salade, tomate, sauce mayo-ail.' },
      { cat: 'Burgers poulet', ref: 'BUR-POU-002', nom: 'Chicken BBQ',            prix: 4000, temps: 11, desc: 'Filet de poulet grillé, bacon, cheddar, oignons frits, sauce BBQ.' },

      // Menus
      { cat: 'Menus', ref: 'BUR-MEN-001', nom: 'Menu Classique (Burger + Frites + Soda)', prix: 4500, temps: 12, desc: 'Burger Classique + frites maison + soda 33cl au choix.' },
      { cat: 'Menus', ref: 'BUR-MEN-002', nom: 'Menu Cheese (Burger + Frites + Soda)',    prix: 5000, temps: 12, desc: 'Cheese Burger + frites maison + soda 33cl au choix.' },
      { cat: 'Menus', ref: 'BUR-MEN-003', nom: 'Menu Kids',                               prix: 3000, temps: 10, desc: 'Mini burger poulet + petites frites + jus + surprise.' },

      // Accompagnements
      { cat: 'Accompagnements', ref: 'BUR-ACC-001', nom: 'Frites maison',        prix: 1500, temps: 6,  desc: 'Pommes de terre fraîches taillées et frites deux fois. Sel de mer.' },
      { cat: 'Accompagnements', ref: 'BUR-ACC-002', nom: 'Frites cheese',        prix: 2000, temps: 7,  desc: 'Frites maison nappées de sauce cheddar fondue.' },
      { cat: 'Accompagnements', ref: 'BUR-ACC-003', nom: 'Onion rings (6 pcs)', prix: 1500, temps: 6,  desc: 'Rondelles d\'oignon panées et frites.' },
      { cat: 'Accompagnements', ref: 'BUR-ACC-004', nom: 'Nuggets (6 pcs)',     prix: 2000, temps: 7,  desc: 'Nuggets de poulet pané, sauce au choix.' },

      // Boissons
      { cat: 'Boissons', ref: 'BUR-BOI-001', nom: 'Coca-Cola 33cl',              prix: 700, temps: 1, desc: 'Bien fraîche.' },
      { cat: 'Boissons', ref: 'BUR-BOI-002', nom: 'Fanta 33cl',                  prix: 700, temps: 1, desc: 'Orange, bien fraîche.' },
      { cat: 'Boissons', ref: 'BUR-BOI-003', nom: 'Sprite 33cl',                 prix: 700, temps: 1, desc: 'Bien fraîche.' },
      { cat: 'Boissons', ref: 'BUR-BOI-004', nom: 'Eau minérale 50cl',           prix: 500, temps: 1, desc: 'Tangui ou Supermont.' },
      { cat: 'Boissons', ref: 'BUR-BOI-005', nom: 'Jus naturel du jour',         prix: 1500, temps: 2, desc: 'Mangue, ananas, gingembre ou passion — selon arrivage.' },
    ],
  },
};

// -----------------------------------------------------------------------------
// EXÉCUTION
// -----------------------------------------------------------------------------
function trouverActivite(code) {
  const a = db.prepare('SELECT id FROM activite WHERE code = ?').get(code);
  if (!a) throw new Error(`Activité ${code} introuvable`);
  return a.id;
}

function upsertCategorie(activiteId, nom, description) {
  const existante = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND nom = ?').get(activiteId, nom);
  if (existante) {
    db.prepare('UPDATE categorie SET description = ? WHERE id = ?').run(description, existante.id);
    return { id: existante.id, cree: false };
  }
  const info = db.prepare(`
    INSERT INTO categorie (activite_id, nom, description, cree_le)
    VALUES (?, ?, ?, datetime('now'))
  `).run(activiteId, nom, description);
  return { id: info.lastInsertRowid, cree: true };
}

function upsertProduit(activiteId, categorieId, p) {
  const existant = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND reference = ?').get(activiteId, p.ref);
  if (existant) {
    db.prepare(`
      UPDATE produit
      SET designation = ?, description = ?, categorie_id = ?, prix_vente = ?,
          temps_preparation_min = ?, actif = 1, unite = 'pièce',
          modifie_le = datetime('now')
      WHERE id = ?
    `).run(p.nom, p.desc, categorieId, p.prix, p.temps, existant.id);
    return { id: existant.id, cree: false };
  }
  const info = db.prepare(`
    INSERT INTO produit
      (activite_id, reference, designation, description, categorie_id,
       prix_achat, prix_vente, stock_actuel, stock_minimum, stock_maximum,
       unite, actif, cree_le, temps_preparation_min)
    VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, 'pièce', 1, datetime('now'), ?)
  `).run(activiteId, p.ref, p.nom, p.desc, categorieId, p.prix, p.temps);
  return { id: info.lastInsertRowid, cree: true };
}

function activerWebSurActivites(ids) {
  const val = ids.join(',');
  const existe = db.prepare("SELECT valeur FROM parametre WHERE cle = 'web_activites_ids'").get();
  if (existe) {
    db.prepare("UPDATE parametre SET valeur = ? WHERE cle = 'web_activites_ids'").run(val);
  } else {
    db.prepare("INSERT INTO parametre (cle, valeur) VALUES ('web_activites_ids', ?)").run(val);
  }
}

function resetCatalogueWeb(activiteIds) {
  const placeholders = activiteIds.map(() => '?').join(',');
  const trx = db.transaction(() => {
    db.prepare(`DELETE FROM produit WHERE activite_id IN (${placeholders})`).run(...activiteIds);
    db.prepare(`DELETE FROM categorie WHERE activite_id IN (${placeholders})`).run(...activiteIds);
  });
  trx();
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   SEED CATALOGUE WEB — Pâtisserie + Bona Burger          ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const patId = trouverActivite('PAT');
const burId = trouverActivite('BUR');
console.log(`  Activité PAT (Pâtisserie)   : id=${patId}`);
console.log(`  Activité BUR (Bona Burger)  : id=${burId}`);
console.log(`  Mode                        : ${CONFIRME ? '⚠  EXÉCUTION RÉELLE' : '🔍 SIMULATION (dry-run)'}`);
if (RESET) console.log(`  Reset                       : ⚠  suppression du catalogue existant avant`);

// Compte le plan
let totalCat = 0, totalProd = 0;
for (const code of ['PAT', 'BUR']) {
  totalCat += CATALOGUE[code].categories.length;
  totalProd += CATALOGUE[code].produits.length;
}
console.log(`\n  À créer/mettre à jour : ${totalCat} catégories · ${totalProd} produits\n`);

if (!CONFIRME) {
  console.log('  💡 Mode simulation — aucune modification.');
  console.log('     Pour exécuter réellement : ajouter --confirm');
  console.log('     Pour repartir de zéro    : ajouter --confirm --reset\n');
  process.exit(0);
}

if (RESET) {
  console.log('  → Suppression du catalogue existant PAT + BUR...');
  resetCatalogueWeb([patId, burId]);
  console.log('    ✓ Catalogue vidé pour ces activités');
}

const stats = { catCrees: 0, catMaj: 0, prodCrees: 0, prodMaj: 0 };

const trx = db.transaction(() => {
  for (const [code, activiteId] of [['PAT', patId], ['BUR', burId]]) {
    console.log(`\n  → ${code} · ${CATALOGUE[code].categories.length} catégories, ${CATALOGUE[code].produits.length} produits`);

    // Créer les catégories
    const catIdParNom = {};
    for (const c of CATALOGUE[code].categories) {
      const res = upsertCategorie(activiteId, c.nom, c.description);
      catIdParNom[c.nom] = res.id;
      if (res.cree) stats.catCrees++; else stats.catMaj++;
    }

    // Créer les produits
    for (const p of CATALOGUE[code].produits) {
      const catId = catIdParNom[p.cat];
      if (!catId) {
        console.warn(`    ! Catégorie inconnue pour ${p.ref} : ${p.cat}`);
        continue;
      }
      const res = upsertProduit(activiteId, catId, p);
      if (res.cree) stats.prodCrees++; else stats.prodMaj++;
    }
  }

  // Activer le canal web sur PAT + BUR
  activerWebSurActivites([patId, burId]);
});
trx();

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   SEED TERMINÉ                                            ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  ✓ Catégories créées      : ${stats.catCrees}`);
console.log(`  ✓ Catégories mises à jour: ${stats.catMaj}`);
console.log(`  ✓ Produits créés         : ${stats.prodCrees}`);
console.log(`  ✓ Produits mis à jour    : ${stats.prodMaj}`);
console.log(`  ✓ Canal web activé sur   : PAT (${patId}), BUR (${burId})`);
console.log('\n  📋 Vérification :');
console.log('     1. Redémarrer le serveur si nécessaire (npm start)');
console.log('     2. Ouvrir http://localhost:9000/commander/');
console.log('     3. Les produits doivent s\'afficher, cliquer, ajouter au panier');
console.log('     4. Passer une commande test pour valider le flux caissier\n');
