const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');
const algo = require('../src/algorithmes');

const router = express.Router();

function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
router.use(requireActivite);

// =========================================================
// PREVISIONS
// =========================================================
router.get('/previsions/', (req, res) => {
  const produits = db.prepare(`SELECT p.*, c.nom AS categorie_nom FROM produit p
                               LEFT JOIN categorie c ON c.id = p.categorie_id
                               WHERE p.activite_id = ? AND p.actif = 1 ORDER BY p.designation`).all(req.activiteId).map(h.enrichirProduit);
  const produitId = req.query.produit;
  let produit_selectionne = null, resultat = null;
  let points_historique_json = '[]', points_prevision_json = '[]', points_prevision_basse_json = '[]', points_prevision_haute_json = '[]';
  if (produitId) {
    const p = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(produitId, req.activiteId);
    if (p) {
      produit_selectionne = h.enrichirProduit(p);
      resultat = algo.prevoirVentes(produit_selectionne, 30);
      points_historique_json = JSON.stringify(resultat.points_historique);
      points_prevision_json = JSON.stringify(resultat.points_prevision);
      points_prevision_basse_json = JSON.stringify(resultat.points_prevision_basse);
      points_prevision_haute_json = JSON.stringify(resultat.points_prevision_haute);
    }
  }
  res.render('intelligence/previsions', {
    title: 'Prévisions', page_title: 'Prévisions de ventes',
    produits, produit_selectionne, resultat,
    points_historique_json, points_prevision_json,
    points_prevision_basse_json, points_prevision_haute_json,
  });
});

// =========================================================
// CLASSIFICATION ABC
// =========================================================
router.get('/classification-abc/', (req, res) => {
  let periode = parseInt(req.query.periode || '90', 10);
  if (![30, 90, 180, 365].includes(periode)) periode = 90;
  const classes = algo.classificationABC(periode, 0, req.activiteId);
  const classesPrec = algo.classificationABC(periode, periode, req.activiteId);

  const mapPrec = new Map(classesPrec.map(c => [c.produit.id, c.classe]));
  const caPrecMap = new Map(classesPrec.map(c => [c.produit.id, c.ca_total]));

  const repartition = { A: 0, B: 0, C: 0 };
  const ca_par_classe = { A: 0, B: 0, C: 0 };
  const repartition_prec = { A: 0, B: 0, C: 0 };
  for (const c of classes) { repartition[c.classe]++; ca_par_classe[c.classe] += c.ca_total; }
  for (const c of classesPrec) { repartition_prec[c.classe]++; }
  const total_ca = ca_par_classe.A + ca_par_classe.B + ca_par_classe.C || 1;
  const total_produits = repartition.A + repartition.B + repartition.C || 1;
  const pct_ca = { A: +(ca_par_classe.A / total_ca * 100).toFixed(1), B: +(ca_par_classe.B / total_ca * 100).toFixed(1), C: +(ca_par_classe.C / total_ca * 100).toFixed(1) };
  const pct_produits = { A: +(repartition.A / total_produits * 100).toFixed(1), B: +(repartition.B / total_produits * 100).toFixed(1), C: +(repartition.C / total_produits * 100).toFixed(1) };

  const rang = { A: 0, B: 1, C: 2 };
  const rising = [], falling = [], nouveaux = [];
  for (const c of classes) {
    const avant = mapPrec.get(c.produit.id);
    const ca_avant = caPrecMap.get(c.produit.id) || 0;
    const ca_maint = c.ca_total;
    const evolution_pct = ca_avant > 0 ? +(((ca_maint - ca_avant) / ca_avant) * 100).toFixed(1) : null;
    const item = { produit: c.produit, classe_avant: avant || '—', classe_maint: c.classe, ca_avant, ca_maint, evolution_pct };
    if (!avant) nouveaux.push(item);
    else if (rang[c.classe] < rang[avant]) rising.push(item);
    else if (rang[c.classe] > rang[avant]) falling.push(item);
  }
  rising.sort((a, b) => b.ca_maint - a.ca_maint);
  falling.sort((a, b) => b.ca_avant - a.ca_avant);
  nouveaux.sort((a, b) => b.ca_maint - a.ca_maint);

  // Top categories
  const catMap = new Map();
  for (const c of classes) {
    const cat = c.produit.categorie_nom || 'Sans catégorie';
    catMap.set(cat, (catMap.get(cat) || 0) + c.ca_total);
  }
  const top_categories = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([nom, ca]) => ({ categorie: { nom, ...h.categorieStyle(nom) }, ca, pct: +(ca / total_ca * 100).toFixed(1) }));

  // Top fournisseurs
  const fournMap = new Map();
  for (const c of classes) {
    if (c.produit.fournisseur_nom) {
      const key = c.produit.fournisseur_id;
      fournMap.set(key, (fournMap.get(key) || { nom: c.produit.fournisseur_nom, ca: 0 }));
      fournMap.get(key).ca += c.ca_total;
    }
  }
  const top_fournisseurs = [...fournMap.values()].sort((a, b) => b.ca - a.ca).slice(0, 5)
    .map(f => ({ fournisseur: { raison_sociale: f.nom }, ca: f.ca, pct: +(f.ca / total_ca * 100).toFixed(1) }));

  // Concentration : combien de % de produits font 80% du CA
  let cumul = 0, nb80 = 0;
  const seuil80 = total_ca * 0.8;
  for (const c of classes) { cumul += c.ca_total; nb80++; if (cumul >= seuil80) break; }
  const pct_produits_80 = classes.length ? +(nb80 / classes.length * 100).toFixed(1) : 0;
  let concentration_label, concentration_class;
  if (pct_produits_80 <= 25) { concentration_label = 'très forte'; concentration_class = 'critique'; }
  else if (pct_produits_80 <= 40) { concentration_label = 'forte'; concentration_class = 'elevee'; }
  else if (pct_produits_80 <= 55) { concentration_label = 'modérée'; concentration_class = 'moderee'; }
  else { concentration_label = 'faible'; concentration_class = 'faible'; }

  const pareto_labels = JSON.stringify(classes.slice(0, 30).map(c => (c.produit.designation || '').substring(0, 25)));
  const pareto_ca = JSON.stringify(classes.slice(0, 30).map(c => c.ca_total));
  const pareto_cumul = JSON.stringify(classes.slice(0, 30).map(c => c.cumul_pct));
  const top_a = classes.filter(c => c.classe === 'A').slice(0, 5);

  const delta_repartition = {
    A: repartition.A - repartition_prec.A,
    B: repartition.B - repartition_prec.B,
    C: repartition.C - repartition_prec.C,
  };

  res.render('intelligence/abc', {
    title: 'Classification ABC', page_title: 'Classification ABC des produits',
    classes: classes.map(c => ({ ...c, produit: h.enrichirProduit(c.produit) })),
    repartition, delta_repartition, ca_par_classe, pct_ca, pct_produits,
    total_ca, total_produits_classes: total_produits,
    periode, pareto_labels, pareto_ca, pareto_cumul, top_a,
    rising_stars: rising.slice(0, 5), falling_stars: falling.slice(0, 5), nouveaux: nouveaux.slice(0, 5),
    top_categories, top_fournisseurs,
    dependance_fourn: top_fournisseurs[0] || null,
    nb_produits_80: nb80, pct_produits_80, concentration_label, concentration_class,
  });
});

// =========================================================
// RECOMMANDATIONS
// =========================================================
router.get('/recommandations/', (req, res) => {
  let recos = algo.recommandationsReapprovisionnement(60, req.activiteId);
  const filtre_urgence = req.query.urgence || '';
  const filtre_classe = req.query.classe || '';
  if (filtre_urgence) recos = recos.filter(r => r.urgence === filtre_urgence);
  if (filtre_classe) recos = recos.filter(r => r.classe_abc === filtre_classe);

  const nb_haute = recos.filter(r => r.urgence === 'haute').length;
  const nb_moyenne = recos.filter(r => r.urgence === 'moyenne').length;
  const nb_basse = recos.filter(r => r.urgence === 'basse').length;
  const cout_total = recos.reduce((s, r) => s + r.quantite_a_commander * r.produit.prix_achat, 0);
  const cout_haute = recos.filter(r => r.urgence === 'haute').reduce((s, r) => s + r.quantite_a_commander * r.produit.prix_achat, 0);

  const fournMap = new Map();
  const ordreU = { haute: 3, moyenne: 2, basse: 1 };
  for (const r of recos) {
    const key = r.produit.fournisseur_id || 0;
    if (!fournMap.has(key)) {
      fournMap.set(key, {
        fournisseur: r.produit.fournisseur_id ? { id: r.produit.fournisseur_id, raison_sociale: r.produit.fournisseur_nom, delai_livraison_jours: r.delai_livraison } : null,
        lignes: [], nb_references: 0, total_qte: 0, total_cout: 0, max_urgence: 'basse',
      });
    }
    const g = fournMap.get(key);
    g.lignes.push(r);
    g.nb_references++;
    g.total_qte += r.quantite_a_commander;
    g.total_cout += r.quantite_a_commander * r.produit.prix_achat;
    if (ordreU[r.urgence] > ordreU[g.max_urgence]) g.max_urgence = r.urgence;
  }
  const groupes_fourn = [...fournMap.values()].sort((a, b) => b.total_cout - a.total_cout);

  res.render('intelligence/recommandations', {
    title: 'Recommandations', page_title: 'Recommandations de réapprovisionnement',
    recommandations: recos.map(r => ({ ...r, produit: h.enrichirProduit(r.produit) })),
    nb_haute, nb_moyenne, nb_basse, cout_total, cout_haute, groupes_fourn,
    filtre_urgence, filtre_classe, nb_total: recos.length,
  });
});

module.exports = router;
