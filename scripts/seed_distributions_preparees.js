// Génère plusieurs distributions au statut PREPAREE (prêtes à être remises)
// Objectif : tester la nouvelle fonctionnalité de validation groupée depuis /distributions/
// Idempotent : ne crée rien si au moins 4 distributions PREPAREE existent déjà.

const db = require('../src/db');

let seed = 42;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function randint(a, b) { return Math.floor(rand() * (b - a + 1)) + a; }
function choice(arr) { return arr[Math.floor(rand() * arr.length)]; }

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function nextNum(prefix, table, col) {
  const dernier = db.prepare(`SELECT ${col} AS num FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`).get(prefix + '%');
  let n = 1;
  if (dernier && dernier.num) {
    const p = parseInt(String(dernier.num).substring(prefix.length), 10);
    if (!Number.isNaN(p)) n = p + 1;
  }
  return prefix + String(n).padStart(4, '0');
}

function seedDistributionsPreparees() {
  const dejaPrep = db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'PREPAREE'").get().n;
  if (dejaPrep >= 4) {
    console.log(`   ${dejaPrep} distributions déjà au statut « Préparée ». Aucune nouvelle ajoutée.`);
    return dejaPrep;
  }

  const nestor = db.prepare("SELECT id FROM utilisateur WHERE username = 'nestor'").get();
  const sandra = db.prepare("SELECT id FROM utilisateur WHERE username = 'msandra'").get();
  if (!nestor || !sandra) {
    console.log('⚠️  Utilisateurs Nestor ou Mme Sandra manquants — lancez d\'abord seed_data.js.');
    return 0;
  }

  const activites = db.prepare("SELECT * FROM activite WHERE actif = 1 ORDER BY id").all();
  if (!activites.length) { console.log('⚠️  Aucune activité — lancez seed_data.js.'); return 0; }

  const nbAcreer = 6 - dejaPrep;
  let nbCrees = 0;
  const annee = new Date().getFullYear();

  console.log(`→ Création de ${nbAcreer} distributions au statut « Préparée »...`);

  for (let i = 0; i < nbAcreer; i++) {
    const activite = activites[i % activites.length];

    // Prendre des produits actifs de cette activité (les ingrédients servent bien à la distribution)
    const produits = db.prepare(`SELECT * FROM produit
                                 WHERE activite_id = ? AND actif = 1
                                 ORDER BY RANDOM() LIMIT 4`).all(activite.id);
    if (!produits.length) {
      console.log(`   Aucun produit pour l'activité ${activite.code}, saut.`);
      continue;
    }

    // Créer un achat "source" au statut RECEPTIONNE pour porter les lignes
    // (chaque ligne_distribution doit référencer une ligne_achat pour tracer)
    const fournisseur = db.prepare("SELECT * FROM fournisseur WHERE activite_id = ? OR activite_id IS NULL LIMIT 1").get(activite.id);
    const nomFourn = fournisseur ? fournisseur.raison_sociale : 'Fournisseur divers';
    const jourAchat = randint(1, 4);
    const numAchat = nextNum(`ACH-${annee}-`, 'achat', 'numero');
    const infoA = db.prepare(`INSERT INTO achat (numero, fournisseur_id, fournisseur_libre, date_achat, statut,
                                                 montant_total, cree_par_id, notes)
                              VALUES (?, ?, ?, ?, 'RECEPTIONNE', 0, ?, ?)`)
      .run(numAchat, fournisseur ? fournisseur.id : null, nomFourn, isoDate(jourAchat), sandra.id,
           `Achat ${numAchat} — attente distribution`);
    const achatId = Number(infoA.lastInsertRowid);

    // Lignes d'achat
    let total = 0;
    const lignesAchat = [];
    for (const p of produits) {
      const qte = randint(5, 25);
      const pu = p.prix_achat || randint(500, 3000);
      const infoL = db.prepare(`INSERT INTO ligne_achat (achat_id, designation, quantite, prix_unitaire,
                                                          fournisseur_id, activite_pressentie_id, quantite_distribuee)
                                VALUES (?, ?, ?, ?, ?, ?, 0)`)
        .run(achatId, p.designation, qte, pu, fournisseur ? fournisseur.id : null, activite.id);
      lignesAchat.push({ id: Number(infoL.lastInsertRowid), produit_id: p.id, qte, designation: p.designation });
      total += qte * pu;
    }
    db.prepare('UPDATE achat SET montant_total = ? WHERE id = ?').run(total, achatId);

    // Créer la distribution PREPAREE
    const numDist = nextNum(`DIST-${annee}-`, 'distribution', 'numero');
    const infoD = db.prepare(`INSERT INTO distribution (numero, activite_id, statut, date_creation,
                                                        cree_par_id, notes)
                              VALUES (?, ?, 'PREPAREE', ?, ?, ?)`)
      .run(numDist, activite.id, isoDate(Math.max(0, jourAchat - 0.2)), nestor.id,
           `Distribution ${numDist} vers ${activite.nom} — prête à remettre au gestionnaire`);
    const distId = Number(infoD.lastInsertRowid);

    // Lignes de distribution (on distribue tout de la ligne d'achat)
    for (const la of lignesAchat) {
      db.prepare(`INSERT INTO ligne_distribution (distribution_id, ligne_achat_id, produit_id,
                                                   quantite_annoncee, quantite_recue)
                  VALUES (?, ?, ?, ?, NULL)`)
        .run(distId, la.id, la.produit_id, la.qte);
      db.prepare('UPDATE ligne_achat SET quantite_distribuee = quantite_distribuee + ? WHERE id = ?')
        .run(la.qte, la.id);
    }
    // Marquer l'achat comme DISTRIBUE (100% des lignes distribuées)
    db.prepare("UPDATE achat SET statut = 'DISTRIBUE' WHERE id = ?").run(achatId);

    console.log(`   ✓ ${numDist} → ${activite.nom} (${lignesAchat.length} produits, ${lignesAchat.reduce((s, l) => s + l.qte, 0)} unités)`);
    nbCrees++;
  }

  console.log(`\n✅ ${nbCrees} distributions au statut « Préparée » créées.`);
  console.log('   → Ouvrez /distributions/ (compte Nestor : nestor / dist2026) pour tester.');
  return nbCrees;
}

if (require.main === module) {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SEED — Distributions préparées (pour test validation groupée)');
  console.log('══════════════════════════════════════════════════════════════\n');
  const n = seedDistributionsPreparees();
  const total = db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'PREPAREE'").get().n;
  console.log(`\nTotal distributions « Préparée » en base : ${total}`);
  process.exit(0);
}

module.exports = seedDistributionsPreparees;
