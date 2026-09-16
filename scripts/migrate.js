// Script de migration : ajoute les colonnes manquantes sans effacer les données existantes
const db = require('../src/db');

function colonneExiste(table, colonne) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === colonne);
}

function ajouterColonne(table, colonne, definition, description) {
  if (colonneExiste(table, colonne)) {
    console.log(`  ✓ ${table}.${colonne} déjà présent (${description})`);
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
  console.log(`  + ${table}.${colonne} ajouté (${description})`);
}

console.log('→ Migration du schéma...');

// 1. Colonnes fournisseur_id et numero_facture_fournisseur sur ligne_achat
ajouterColonne('ligne_achat', 'fournisseur_id',
  'INTEGER REFERENCES fournisseur(id) ON DELETE SET NULL',
  'fournisseur par ligne d\'achat');
ajouterColonne('ligne_achat', 'numero_facture_fournisseur',
  'TEXT DEFAULT \'\'',
  'n° facture par ligne');

// 2. Colonne ligne_distribution_id sur mouvement_stock (déjà là normalement)
ajouterColonne('mouvement_stock', 'ligne_distribution_id',
  'INTEGER REFERENCES ligne_distribution(id) ON DELETE SET NULL',
  'lien traçabilité vers distribution');

// 3. Recopier les valeurs de achat.fournisseur_id / achat.numero_facture_fournisseur
//    dans les lignes existantes qui n'auraient pas la valeur
try {
  const infos = db.prepare(`SELECT id, fournisseur_id, numero_facture_fournisseur FROM achat`).all();
  const upd = db.prepare(`UPDATE ligne_achat
                          SET fournisseur_id = COALESCE(fournisseur_id, ?),
                              numero_facture_fournisseur = COALESCE(NULLIF(numero_facture_fournisseur, ''), ?)
                          WHERE achat_id = ?`);
  let n = 0;
  for (const a of infos) { const r = upd.run(a.fournisseur_id || null, a.numero_facture_fournisseur || '', a.id); n += r.changes; }
  if (n) console.log(`  ✓ ${n} ligne(s) d'achat rétro-remplie(s) avec fournisseur/facture du bon d'achat`);
} catch (e) {
  console.warn('  ⚠ Impossible de rétro-remplir : ' + e.message);
}

// 4. Créer les index s'ils n'existent pas
try { db.exec('CREATE INDEX IF NOT EXISTS idx_lachat_fournisseur ON ligne_achat(fournisseur_id)'); console.log('  ✓ index idx_lachat_fournisseur'); } catch(e){}

console.log('\n✓ Migration terminée.');
