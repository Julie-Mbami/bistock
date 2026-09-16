// =============================================================================
// PURGE PRODUCTION — Vider les données de test avant la mise en production
// =============================================================================
// USAGE :
//   node scripts/purge_prod.js              → mode dry-run (affiche le plan, ne modifie rien)
//   node scripts/purge_prod.js --confirm    → exécute la purge après backup automatique
//   node scripts/purge_prod.js --confirm --vider-tiers      → vide aussi clients + fournisseurs
//   node scripts/purge_prod.js --confirm --vider-catalogue  → vide aussi produits + catégories + fiches
//   node scripts/purge_prod.js --confirm --tout             → vide TOUT sauf activités + utilisateurs + paramètres
//
// Ce script est intentionnellement verbose et exige --confirm : impossible à lancer par erreur.
// =============================================================================

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const config = require('../src/config');
const h = require('../src/helpers');

const args = new Set(process.argv.slice(2));
const CONFIRME = args.has('--confirm');
const VIDER_TIERS = args.has('--vider-tiers') || args.has('--tout');
const VIDER_CATALOGUE = args.has('--vider-catalogue') || args.has('--tout');
const TOUT = args.has('--tout');

// -----------------------------------------------------------------------------
// CLASSIFICATION DES TABLES
// -----------------------------------------------------------------------------

// Tables toujours vidées (données transactionnelles = données de test)
const TABLES_TRANSACTIONNELLES = [
  // Ventes B2C
  'ligne_vente', 'vente',
  // Commandes B2B
  'relance', 'paiement', 'ligne_commande', 'commande',
  // Canal web (+ suppléments choisis par le client — cascade FK mais on est explicite)
  'ligne_commande_web_supplement', 'ligne_commande_client_web', 'commande_client_web',
  // Achats + distributions
  'ligne_distribution', 'distribution', 'ligne_achat', 'achat',
  // Stocks
  'ligne_inventaire', 'inventaire', 'mouvement_stock', 'alerte',
  // Caisse
  'cloture_caisse',
  // Production
  'production',
  // Comptabilité
  'ecriture_comptable',
  // Audit
  'journal_audit',
];

// Tables vidées seulement avec --vider-tiers
const TABLES_TIERS = ['client', 'fournisseur'];

// Tables vidées seulement avec --vider-catalogue
// Ordre important : supplement + composition_fiche + fiche_technique avant produit (FK cascade)
const TABLES_CATALOGUE = ['supplement', 'composition_fiche', 'fiche_technique', 'produit', 'categorie'];

// Tables JAMAIS purgées (structure et config)
const TABLES_PROTEGEES = [
  'activite',                // Les 4 pôles TRAIT/CAN/PAT/BUR
  'utilisateur',             // Comptes (mdp à réinitialiser par la DG)
  'utilisateur_activite',    // Liaison secrétariat → activités
  'permission_utilisateur',  // Surcharges de permissions
  'parametre',               // Config entreprise (NIU, RCCM, banque…)
  'compte_comptable',        // Plan OHADA
  'journal_comptable',       // Journaux comptables
];

// -----------------------------------------------------------------------------
// BACKUP AUTOMATIQUE
// -----------------------------------------------------------------------------
function creerBackup() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const dirBackup = path.join(path.dirname(config.DB_PATH), 'backups');
  if (!fs.existsSync(dirBackup)) fs.mkdirSync(dirBackup, { recursive: true });
  const cheminBackup = path.join(dirBackup, `avant-purge-prod-${stamp}.db`);
  fs.copyFileSync(config.DB_PATH, cheminBackup);
  return cheminBackup;
}

// -----------------------------------------------------------------------------
// ANALYSE AVANT
// -----------------------------------------------------------------------------
function compter(table) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  catch { return 0; }
}

function afficherPlan(tables, label) {
  console.log(`\n  ${label}`);
  console.log('  ' + '─'.repeat(48));
  let total = 0;
  for (const t of tables) {
    const n = compter(t);
    total += n;
    console.log('    ' + t.padEnd(32) + String(n).padStart(8) + ' lignes');
  }
  console.log('  ' + '─'.repeat(48));
  console.log('    ' + 'TOTAL'.padEnd(32) + String(total).padStart(8) + ' lignes');
  return total;
}

function afficherProteges() {
  console.log('\n  Tables PROTÉGÉES (jamais purgées)');
  console.log('  ' + '─'.repeat(48));
  for (const t of TABLES_PROTEGEES) {
    console.log('    ✓ ' + t.padEnd(30) + String(compter(t)).padStart(8) + ' lignes conservées');
  }
}

// -----------------------------------------------------------------------------
// PURGE
// -----------------------------------------------------------------------------
function purger(tables) {
  const trx = db.transaction(() => {
    for (const t of tables) {
      try {
        db.prepare(`DELETE FROM ${t}`).run();
        // Réinitialiser AUTOINCREMENT (sqlite_sequence)
        try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t); } catch {}
      } catch (e) {
        console.warn(`    ! ${t} : ${e.message}`);
      }
    }
  });
  trx();
}

function resetStockProduits() {
  const info = db.prepare(`UPDATE produit SET stock_actuel = 0`).run();
  return info.changes;
}

function resetCompteursAudit() {
  // Rien à faire — la table journal_audit a déjà été vidée.
  // Le premier événement de production repartira avec id=1.
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   PURGE PRODUCTION — Le Traiteur du Bistrot              ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

console.log('  Base de données : ' + config.DB_PATH);
console.log('  Mode            : ' + (CONFIRME ? '⚠  EXÉCUTION RÉELLE' : '🔍 SIMULATION (dry-run)'));
console.log('  Options         : ' +
  (VIDER_TIERS ? '+ clients/fournisseurs ' : '') +
  (VIDER_CATALOGUE ? '+ catalogue produits ' : '') +
  (!VIDER_TIERS && !VIDER_CATALOGUE ? 'transactions uniquement' : ''));

// Plan
let totalASupprimer = 0;
totalASupprimer += afficherPlan(TABLES_TRANSACTIONNELLES, 'Tables transactionnelles à VIDER');
if (VIDER_TIERS) totalASupprimer += afficherPlan(TABLES_TIERS, 'Clients + fournisseurs à VIDER (option)');
if (VIDER_CATALOGUE) totalASupprimer += afficherPlan(TABLES_CATALOGUE, 'Catalogue produits à VIDER (option)');
afficherProteges();

console.log('\n  ' + '═'.repeat(48));
console.log('  ' + `Total à supprimer : ${totalASupprimer} lignes`);
console.log('  Stock produits    : remis à 0 (comptage physique attendu)');
if (VIDER_CATALOGUE) {
  console.log('  ⚠  Le catalogue sera VIDE : ressaisir tous les produits.');
}
console.log('  ' + '═'.repeat(48));

if (!CONFIRME) {
  console.log('\n  💡 Mode simulation — aucune modification.');
  console.log('     Pour exécuter réellement : ajouter --confirm');
  console.log('     Options supplémentaires  : --vider-tiers, --vider-catalogue, --tout\n');
  process.exit(0);
}

// Confirmation OK → backup puis purge
console.log('\n  → Sauvegarde de la base actuelle...');
const backup = creerBackup();
console.log('    ✓ Backup : ' + backup);
console.log('    ✓ Taille : ' + Math.round(fs.statSync(backup).size / 1024) + ' Ko');

console.log('\n  → Purge en cours...');
// Ordre important : le catalogue (produit → fournisseur FK) doit être vidé AVANT les tiers
const tables = [...TABLES_TRANSACTIONNELLES];
if (VIDER_CATALOGUE) tables.push(...TABLES_CATALOGUE);
if (VIDER_TIERS) tables.push(...TABLES_TIERS);
purger(tables);
console.log('    ✓ ' + tables.length + ' tables vidées');

if (!VIDER_CATALOGUE) {
  const n = resetStockProduits();
  console.log('    ✓ Stock remis à 0 sur ' + n + ' produits');
}

resetCompteursAudit();

// Journalisation du reset dans le journal d'audit (nouveau, id=1)
try {
  const admin = db.prepare("SELECT id FROM utilisateur WHERE role = 'DG' LIMIT 1").get();
  h.journaliser(db, {
    user: admin ? { id: admin.id } : null,
    action: 'PARAM_MODIFIE',
    entite: 'systeme',
    details: `Purge production exécutée · ${totalASupprimer} lignes supprimées · options=${VIDER_TIERS?'tiers ':''}${VIDER_CATALOGUE?'catalogue ':''}${(!VIDER_TIERS && !VIDER_CATALOGUE)?'transactions':''} · backup=${path.basename(backup)}`,
  });
} catch {}

// Récap final
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   PURGE TERMINÉE                                          ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log(`  ✓ ${totalASupprimer} lignes supprimées`);
console.log(`  ✓ Backup avant purge : ${path.basename(backup)}`);
console.log('  ✓ Numérotation documents : repart à 0001 pour ' + new Date().getFullYear());
console.log('  ✓ Journal d\'audit : réinitialisé, prochain événement id=1');

console.log('\n  📋 PROCHAINES ÉTAPES POUR LA DG :');
console.log('  1. Se connecter avec msandra / admin2026');
console.log('  2. Administration → Utilisateurs → réinitialiser TOUS les mots de passe');
console.log('     (les mdp de démo comme "admin2026", "trait2026" sont publics dans le guide)');
console.log('  3. Administration → Paramètres → vérifier NIU, RCCM, banque, TVA');
console.log('  4. Si --vider-catalogue : ressaisir les produits par activité');
console.log('  5. Lancer les premières opérations réelles (achat, distribution, vente)');

console.log('\n  💾 En cas de problème : restaurer le backup');
console.log(`     copy "${backup}" "${config.DB_PATH}"\n`);
