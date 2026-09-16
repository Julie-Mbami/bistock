// =============================================================================
// GÉNÉRATEUR IMPORTS B-STOCK — Fichiers Excel prêts à l'import
// =============================================================================
// USAGE : node scripts/generer_imports_bstock.js
//
// Produit dans docs/import_bstock/ des fichiers respectant EXACTEMENT le format
// attendu par le module "Catalogue → Produits → Importer" et
// "Catalogue → Catégories → Importer" de Bistock.
//
// STRUCTURE (per activité TRAIT / CAN / PAT / BUR) :
//   01_categories_<CODE>.xlsx  → à importer d'abord (catégories)
//   02_produits_<CODE>.xlsx    → à importer ensuite (produits finis + ingrédients + revente + consommables)
//
// L'utilisateur bascule sur l'activité concernée (chip en haut à droite)
// puis fait un import pour chaque fichier de cette activité.
// =============================================================================

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'import_bstock');

// -----------------------------------------------------------------------------
// DATA SOURCE — reprise depuis generer_catalogue_reference.js
// -----------------------------------------------------------------------------
const { ACT, CATEGORIES, PRODUITS_FINIS, INGREDIENTS, REVENTE, CONSOMMABLES } =
  require('./generer_catalogue_reference');

// -----------------------------------------------------------------------------
// NORMALISATION DES UNITÉS
// -----------------------------------------------------------------------------
// L'app accepte : pièce, kg, g, litre, ml, carton, paquet, sac, sachet, plaque, barquette, bouteille
const UNITE_MAP = {
  'pièce': 'pièce', 'unité': 'pièce', 'plateau': 'pièce', 'buffet': 'pièce',
  'boule': 'pièce', 'verre': 'pièce', 'coupe': 'pièce', 'pers': 'pièce',
  'assiette': 'pièce', 'menu': 'pièce', 'formule': 'pièce', 'tasse': 'pièce',
  'portion': 'pièce', 'pizza': 'pièce', 'jour': 'pièce', 'bol': 'pièce',
  'botte': 'paquet', 'pot': 'paquet', 'boîte': 'paquet', 'boite': 'paquet',
  'barq.': 'barquette', 'barquette': 'barquette',
  'kg': 'kg', 'g': 'g', 'L': 'litre', 'litre': 'litre', 'ml': 'ml',
  'carton': 'carton', 'rouleau': 'carton', 'bloc': 'carton',
  'paquet': 'paquet', 'sachet': 'sachet', 'sac': 'sac',
  'plaque': 'plaque', 'bouteille': 'bouteille',
  'bidon': 'bouteille', 'flacon': 'bouteille',
};

function normaliserUnite(u) {
  return UNITE_MAP[u] || 'pièce';
}

// -----------------------------------------------------------------------------
// COLONNES EXACTES ATTENDUES PAR B-STOCK
// -----------------------------------------------------------------------------
const COLONNES_CATEGORIES = [
  { header: 'Nom',         key: 'nom',         width: 32, required: true },
  { header: 'Description', key: 'description', width: 60 },
];

const COLONNES_PRODUITS = [
  { header: 'Référence',         key: 'reference',       width: 16 },
  { header: 'Désignation',       key: 'designation',     width: 42, required: true },
  { header: 'Catégorie',         key: 'categorie',       width: 30, required: true },
  { header: 'Fournisseur',       key: 'fournisseur',     width: 22 },
  { header: 'Prix achat (FCFA)', key: 'prix_achat',      width: 15 },
  { header: 'Prix vente (FCFA)', key: 'prix_vente',      width: 15 },
  { header: 'Stock actuel',      key: 'stock_actuel',    width: 12 },
  { header: 'Stock minimum',     key: 'stock_minimum',   width: 13 },
  { header: 'Stock maximum',     key: 'stock_maximum',   width: 13 },
  { header: 'Unité',             key: 'unite',           width: 12, options: ['pièce', 'kg', 'g', 'litre', 'ml', 'carton', 'paquet', 'sac', 'sachet', 'plaque', 'barquette', 'bouteille'] },
  { header: 'Description',       key: 'description',     width: 40 },
  { header: 'Actif',             key: 'actif',           width: 8,  options: ['Oui', 'Non'] },
];

// -----------------------------------------------------------------------------
// AGRÉGATION PAR ACTIVITÉ
// -----------------------------------------------------------------------------
// Chaque activité reçoit :
//   - Ses catégories PROPRES + toutes les catégories MULTI (partagées)
//   - Ses produits finis + ingrédients + revente + consommables

const ACT_CODES = ['TRAIT', 'CAN', 'PAT', 'BUR'];
const ACT_NOMS = {
  TRAIT: 'Le Traiteur',
  CAN:   'La Cantine',
  PAT:   'Pâtisserie / Salon / Restaurant',
  BUR:   '237 Bona Burger',
};

function categoriesPourActivite(code) {
  return [
    ...CATEGORIES.filter(c => c.act === code).map(c => ({ nom: c.nom, description: c.desc })),
    ...CATEGORIES.filter(c => c.act === ACT.MULTI).map(c => ({ nom: c.nom, description: c.desc })),
  ];
}

function produitsPourActivite(code) {
  const lignes = [];
  // Finis propres à l'activité
  for (const p of PRODUITS_FINIS.filter(x => x.act === code)) {
    lignes.push({
      reference:      p.ref,
      designation:    p.nom,
      categorie:      p.cat,
      fournisseur:    '',
      prix_achat:     p.pa || 0,
      prix_vente:     p.pv || 0,
      stock_actuel:   0,
      stock_minimum:  p.sm || 0,
      stock_maximum:  (p.sm || 0) * 5,
      unite:          normaliserUnite(p.u),
      description:    '',
      actif:          'Oui',
    });
  }
  // Ingrédients (partagés → dupliqués dans chaque activité)
  for (const p of INGREDIENTS) {
    lignes.push({
      reference:      p.ref + '-' + code,
      designation:    p.nom,
      categorie:      p.cat,
      fournisseur:    '',
      prix_achat:     p.pa || 0,
      prix_vente:     0,
      stock_actuel:   0,
      stock_minimum:  p.sm || 0,
      stock_maximum:  (p.sm || 0) * 5,
      unite:          normaliserUnite(p.u),
      description:    '',
      actif:          'Oui',
    });
  }
  // Revente (dupliquée)
  for (const p of REVENTE) {
    lignes.push({
      reference:      p.ref + '-' + code,
      designation:    p.nom,
      categorie:      p.cat,
      fournisseur:    '',
      prix_achat:     p.pa || 0,
      prix_vente:     p.pv || 0,
      stock_actuel:   0,
      stock_minimum:  p.sm || 0,
      stock_maximum:  (p.sm || 0) * 5,
      unite:          normaliserUnite(p.u),
      description:    '',
      actif:          'Oui',
    });
  }
  // Consommables (dupliqués)
  for (const p of CONSOMMABLES) {
    lignes.push({
      reference:      p.ref + '-' + code,
      designation:    p.nom,
      categorie:      p.cat,
      fournisseur:    '',
      prix_achat:     p.pa || 0,
      prix_vente:     0,
      stock_actuel:   0,
      stock_minimum:  p.sm || 0,
      stock_maximum:  (p.sm || 0) * 5,
      unite:          normaliserUnite(p.u),
      description:    '',
      actif:          'Oui',
    });
  }
  return lignes;
}

// -----------------------------------------------------------------------------
// GÉNÉRATION D'UN FICHIER EXCEL — MÊME STRUCTURE QUE LE MODÈLE B-STOCK
// -----------------------------------------------------------------------------
async function creerFichier(cheminSortie, titreFeuille, colonnes, lignes, instructions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bistock';
  wb.created = new Date();

  // Feuille de données (première = celle lue par l'import)
  const ws = wb.addWorksheet(titreFeuille, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = colonnes.map(c => ({ header: c.header + (c.required ? ' *' : ''), key: c.key, width: c.width || 20 }));

  // Style entête (bleu foncé + trait doré — identique au modèle app)
  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFCA8A04' } } };
  });

  // Données
  for (const l of lignes) ws.addRow(l);

  // Validations dropdown pour colonnes à options
  colonnes.forEach((c, i) => {
    if (c.options && c.options.length) {
      const col = String.fromCharCode(65 + i);
      ws.dataValidations.add(`${col}2:${col}5000`, {
        type: 'list',
        allowBlank: !c.required,
        formulae: [`"${c.options.join(',')}"`],
      });
    }
  });

  // Autofilter
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };

  // Feuille instructions
  const wsI = wb.addWorksheet('Instructions');
  wsI.getColumn(1).width = 100;
  wsI.addRow(['📋 ' + titreFeuille + ' — Comment utiliser ce fichier']).font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } };
  wsI.addRow([]);
  for (const inst of instructions) wsI.addRow([inst]).font = { size: 11 };
  wsI.addRow([]);
  wsI.addRow(['💡 Les colonnes avec * sont obligatoires. Vous pouvez supprimer les lignes que vous ne souhaitez pas importer.']).font = { italic: true, color: { argb: 'FF64748B' } };

  await wb.xlsx.writeFile(cheminSortie);
  return fs.statSync(cheminSortie).size;
}

// -----------------------------------------------------------------------------
// LISEZ-MOI global
// -----------------------------------------------------------------------------
function contenuLisezMoi() {
  return `
IMPORTS B-STOCK — Le Traiteur du Bistrot
=========================================

Ces fichiers sont prêts à être importés directement dans Bistock.

── PROCÉDURE ────────────────────────────────────────────────────────

Pour CHAQUE activité (à faire une seule fois par activité) :

  1. Connectez-vous en tant que Directrice Générale (msandra)
  2. En haut à droite, cliquez sur la puce d'activité (TRAIT / CAN / PAT / BUR)
     pour basculer sur l'activité que vous voulez remplir

  3. Allez dans "Catalogue → Catégories"
     → Cliquez "Importer Excel"
     → Téléversez  01_categories_<CODE>.xlsx  (correspondant à l'activité active)
     → Vérifiez l'aperçu, cliquez "Valider et importer"

  4. Allez dans "Catalogue → Produits"
     → Cliquez "Importer Excel"
     → Téléversez  02_produits_<CODE>.xlsx  (correspondant à l'activité active)
     → Vérifiez l'aperçu, cliquez "Valider et importer"

  5. Basculez sur l'activité suivante et recommencez.

── FICHIERS FOURNIS ──────────────────────────────────────────────────

  01_categories_TRAIT.xlsx   → Catégories pour Le Traiteur
  01_categories_CAN.xlsx     → Catégories pour La Cantine
  01_categories_PAT.xlsx     → Catégories pour Pâtisserie / Salon / Restaurant
  01_categories_BUR.xlsx     → Catégories pour 237 Bona Burger

  02_produits_TRAIT.xlsx     → Produits pour Le Traiteur
  02_produits_CAN.xlsx       → Produits pour La Cantine
  02_produits_PAT.xlsx       → Produits pour Pâtisserie / Salon / Restaurant
  02_produits_BUR.xlsx       → Produits pour 237 Bona Burger

── AVANT DE VALIDER L'IMPORT ─────────────────────────────────────────

  • Vérifiez / ajustez les prix (colonne "Prix achat" et "Prix vente")
  • Supprimez les lignes que vous ne souhaitez pas (ex : produits inutiles pour vous)
  • Ajustez "Stock minimum" selon votre logique d'alerte
  • L'unité doit rester dans la liste déroulante (pièce, kg, litre…)
  • Si vous mettez un nom de fournisseur, il doit EXACTEMENT correspondre
    à un fournisseur existant (sinon laissez vide)

── QUE FAIRE APRÈS L'IMPORT ? ────────────────────────────────────────

  • Fournisseurs : les rattacher manuellement produit par produit si besoin
  • Fiches techniques (recettes) : à créer manuellement pour les produits finis
    qui nécessitent une production (ex: burger, gâteau)
  • Images : à uploader manuellement sur chaque produit
  • Suppléments : à saisir manuellement pour les produits en ligne

── NOMBRES DE LIGNES PAR FICHIER ─────────────────────────────────────

  Chaque fichier produits contient environ :
   - Les produits finis PROPRES à l'activité
   - + 135 ingrédients (dupliqués pour chaque activité, obligatoire pour les fiches techniques)
   - + 41 produits de revente (sodas, bières, snacks)
   - + 47 consommables (emballages, hygiène, nettoyage)

  Total ≈ 240-400 lignes par activité. Vous pouvez tout garder ou trier.

────────────────────────────────────────────────────────────────────
Fichier généré automatiquement le ${new Date().toISOString().slice(0, 10)}
`.trim();
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   GÉNÉRATION IMPORTS B-STOCK                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Sortie : ${OUT_DIR}\n`);

  const stats = [];

  for (const code of ACT_CODES) {
    const nom = ACT_NOMS[code];
    console.log(`  → ${code} · ${nom}`);

    // Catégories
    const cats = categoriesPourActivite(code);
    const cheminCat = path.join(OUT_DIR, `01_categories_${code}.xlsx`);
    const tailleCat = await creerFichier(cheminCat, 'Categories', COLONNES_CATEGORIES, cats, [
      `Activité de destination : ${nom} (${code})`,
      '',
      'Avant d\'importer, basculez sur cette activité dans Bistock',
      '(chip en haut à droite de l\'écran).',
      '',
      'Colonnes :',
      '  • Nom * : nom de la catégorie (obligatoire)',
      '  • Description : texte libre (facultatif)',
      '',
      'Les catégories déjà existantes seront ignorées.',
      'Vous pouvez supprimer des lignes avant d\'importer.',
    ]);

    // Produits
    const prods = produitsPourActivite(code);
    const cheminProd = path.join(OUT_DIR, `02_produits_${code}.xlsx`);
    const tailleProd = await creerFichier(cheminProd, 'Produits', COLONNES_PRODUITS, prods, [
      `Activité de destination : ${nom} (${code})`,
      '',
      'Avant d\'importer, basculez sur cette activité dans Bistock',
      '(chip en haut à droite de l\'écran) et importez D\'ABORD les catégories.',
      '',
      'Colonnes :',
      '  • Référence : code interne unique. Laissez vide pour auto-génération.',
      '  • Désignation * : nom commercial (obligatoire)',
      '  • Catégorie * : DOIT correspondre à une catégorie existante (ou sera créée)',
      '  • Fournisseur : nom exact d\'un fournisseur existant (facultatif — laisser vide sinon)',
      '  • Prix achat / Prix vente : en FCFA, sans espace ni décimale (ex : 1500)',
      '  • Stock actuel / minimum / maximum : quantités entières',
      '  • Unité : à choisir dans la liste déroulante (pièce, kg, litre…)',
      '  • Description : texte libre',
      '  • Actif : "Oui" pour vendre, "Non" pour désactiver',
      '',
      'Ce fichier contient :',
      `  - ${PRODUITS_FINIS.filter(p => p.act === code).length} produits finis propres à ${code}`,
      `  - ${INGREDIENTS.length} ingrédients (dupliqués pour cette activité)`,
      `  - ${REVENTE.length} produits de revente`,
      `  - ${CONSOMMABLES.length} consommables`,
      '',
      'Total ≈ ' + prods.length + ' lignes. Supprimez ce dont vous n\'avez pas besoin.',
    ]);

    stats.push({ code, cats: cats.length, prods: prods.length, tailleCat, tailleProd });
    console.log(`      • categories: ${cats.length} lignes (${Math.round(tailleCat / 1024)} Ko)`);
    console.log(`      • produits  : ${prods.length} lignes (${Math.round(tailleProd / 1024)} Ko)`);
  }

  // LISEZ-MOI
  const cheminReadme = path.join(OUT_DIR, 'LISEZ-MOI.txt');
  fs.writeFileSync(cheminReadme, contenuLisezMoi(), 'utf-8');
  console.log(`\n  ✓ LISEZ-MOI.txt écrit`);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   RÉCAPITULATIF                                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  const totalCats = stats.reduce((s, x) => s + x.cats, 0);
  const totalProds = stats.reduce((s, x) => s + x.prods, 0);
  console.log(`  Total catégories : ${totalCats}`);
  console.log(`  Total produits   : ${totalProds}`);
  console.log(`  Total fichiers   : ${stats.length * 2 + 1}`);
  console.log(`  Dossier          : ${OUT_DIR}\n`);
}

main().catch(e => { console.error('✗ Erreur :', e.message); console.error(e.stack); process.exit(1); });
