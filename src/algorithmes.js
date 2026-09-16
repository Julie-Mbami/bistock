// Algorithmes d'intelligence : prévision (régression linéaire), classification ABC, point de commande
const db = require('./db');
const h = require('./helpers');

const JOURS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function serieTemporelleProduit(produitId, jours = 90) {
  const debut = new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT date(v.date_vente) AS jour, SUM(l.quantite) AS q
                           FROM ligne_vente l JOIN vente v ON v.id = l.vente_id
                           WHERE l.produit_id = ? AND date(v.date_vente) >= ?
                           GROUP BY date(v.date_vente)`).all(produitId, debut);
  const map = new Map(rows.map(r => [r.jour, r.q]));
  const serie = [];
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (let i = jours - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    serie.push({ date: key, dt: d, valeur: map.get(key) || 0 });
  }
  return serie;
}

function regressionLineaire(y) {
  const n = y.length;
  if (n < 2) return { a: 0, b: y[0] || 0, r2: 0, residus: [] };
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const meanX = sumX / n, meanY = sumY / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - meanX) * (y[i] - meanY); den += (x[i] - meanX) ** 2; }
  const a = den ? num / den : 0;
  const b = meanY - a * meanX;
  const pred = x.map(v => a * v + b);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (y[i] - pred[i]) ** 2; ssTot += (y[i] - meanY) ** 2; }
  const r2 = ssTot ? Math.max(1 - ssRes / ssTot, 0) : 0;
  const residus = y.map((v, i) => v - pred[i]);
  return { a, b, r2, residus, pred };
}

function stdDev(values) {
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function prevoirVentes(produit, horizon = 30) {
  const serie = serieTemporelleProduit(produit.id, 90);
  const valeurs = serie.map(p => p.valeur);
  const moyenne = valeurs.length ? valeurs.reduce((s, v) => s + v, 0) / valeurs.length : 0;

  const debutFutur = new Date();
  debutFutur.setDate(debutFutur.getDate() + 1);

  const nbNonNuls = valeurs.filter(v => v > 0).length;

  // Saisonnalite hebdo
  const parJour = [[], [], [], [], [], [], []];
  serie.forEach(pt => parJour[pt.dt.getDay()].push(pt.valeur));
  const moyParJour = parJour.map(arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  let jourFortIdx = 0, jourCreuxIdx = 0;
  for (let i = 1; i < 7; i++) {
    if (moyParJour[i] > moyParJour[jourFortIdx]) jourFortIdx = i;
    if (moyParJour[i] < moyParJour[jourCreuxIdx]) jourCreuxIdx = i;
  }

  // Comparaison 30j
  let ventesRecents = 0, ventesPrecedents = 0;
  if (valeurs.length >= 60) {
    ventesRecents = valeurs.slice(-30).reduce((s, v) => s + v, 0);
    ventesPrecedents = valeurs.slice(-60, -30).reduce((s, v) => s + v, 0);
  } else {
    ventesRecents = valeurs.reduce((s, v) => s + v, 0);
  }
  const evolutionPct = ventesPrecedents > 0
    ? +(((ventesRecents - ventesPrecedents) / ventesPrecedents) * 100).toFixed(1)
    : 0;

  // Rupture et reco
  const consoJour = ventesRecents ? ventesRecents / 30 : moyenne;
  const joursAvantRupture = consoJour > 0 ? Math.floor(produit.stock_actuel / consoJour) : null;
  const quantiteRecommandee = Math.max(produit.stock_maximum - produit.stock_actuel, 0);

  const pointsHistorique = serie.map(pt => [pt.date, pt.valeur]);

  if (nbNonNuls < 5) {
    const prevTotal = Math.max(Math.round(moyenne * horizon), 0);
    const prevBasse = Math.round(prevTotal * 0.7);
    const prevHaute = Math.round(prevTotal * 1.3);
    const prev7j = Math.max(Math.round(moyenne * 7), 0);
    return {
      produit,
      quantite_journaliere_moyenne: +moyenne.toFixed(2),
      quantite_prevue_30j: prevTotal,
      quantite_prevue_basse_30j: prevBasse,
      quantite_prevue_haute_30j: prevHaute,
      quantite_prevue_7j: prev7j,
      tendance: 'stable', pente_pct: 0, fiabilite: 'basse', r2: 0, mae: 0,
      points_historique: pointsHistorique,
      points_prevision: Array.from({ length: horizon }, (_, i) => {
        const d = new Date(debutFutur.getTime() + i * 86400000);
        return [d.toISOString().slice(0, 10), +moyenne.toFixed(2)];
      }),
      points_prevision_basse: Array.from({ length: horizon }, (_, i) => {
        const d = new Date(debutFutur.getTime() + i * 86400000);
        return [d.toISOString().slice(0, 10), +(moyenne * 0.7).toFixed(2)];
      }),
      points_prevision_haute: Array.from({ length: horizon }, (_, i) => {
        const d = new Date(debutFutur.getTime() + i * 86400000);
        return [d.toISOString().slice(0, 10), +(moyenne * 1.3).toFixed(2)];
      }),
      ventes_30j_precedents: ventesPrecedents,
      ventes_30j_recents: ventesRecents,
      evolution_pct: evolutionPct,
      jour_fort_label: JOURS_FR[jourFortIdx],
      jour_fort_moyenne: +moyParJour[jourFortIdx].toFixed(2),
      jour_creux_label: JOURS_FR[jourCreuxIdx],
      jour_creux_moyenne: +moyParJour[jourCreuxIdx].toFixed(2),
      stock_actuel: produit.stock_actuel,
      jours_avant_rupture: joursAvantRupture,
      quantite_recommandee: quantiteRecommandee,
      scenarios: { pessimiste: prevBasse, probable: prevTotal, optimiste: prevHaute },
    };
  }

  const { a: pente, b: intercept, r2, residus } = regressionLineaire(valeurs);
  const stdResidus = stdDev(residus);
  const mae = residus.reduce((s, r) => s + Math.abs(r), 0) / residus.length;

  const futurY = Array.from({ length: horizon }, (_, i) => Math.max(pente * (valeurs.length + i) + intercept, 0));
  const futurYBasse = futurY.map(v => Math.max(v - 1.96 * stdResidus, 0));
  const futurYHaute = futurY.map(v => Math.max(v + 1.96 * stdResidus, 0));

  const prevTotal = Math.round(futurY.reduce((s, v) => s + v, 0));
  const prevBasse = Math.round(futurYBasse.reduce((s, v) => s + v, 0));
  const prevHaute = Math.round(futurYHaute.reduce((s, v) => s + v, 0));
  const prev7j = Math.round(Array.from({ length: 7 }, (_, i) => Math.max(pente * (valeurs.length + i) + intercept, 0)).reduce((s, v) => s + v, 0));

  const tendance = pente > 0.05 ? 'hausse' : pente < -0.05 ? 'baisse' : 'stable';
  const pentePct = moyenne > 0 ? +(pente / moyenne * 100).toFixed(2) : 0;
  const fiabilite = r2 >= 0.6 ? 'haute' : r2 >= 0.3 ? 'moyenne' : 'basse';

  const genPoints = (arr) => arr.map((v, i) => {
    const d = new Date(debutFutur.getTime() + i * 86400000);
    return [d.toISOString().slice(0, 10), +v.toFixed(2)];
  });

  return {
    produit,
    quantite_journaliere_moyenne: +moyenne.toFixed(2),
    quantite_prevue_30j: prevTotal,
    quantite_prevue_basse_30j: prevBasse,
    quantite_prevue_haute_30j: prevHaute,
    quantite_prevue_7j: prev7j,
    tendance, pente_pct: pentePct, fiabilite,
    r2: +r2.toFixed(3), mae: +mae.toFixed(2),
    points_historique: pointsHistorique,
    points_prevision: genPoints(futurY),
    points_prevision_basse: genPoints(futurYBasse),
    points_prevision_haute: genPoints(futurYHaute),
    ventes_30j_precedents: ventesPrecedents,
    ventes_30j_recents: ventesRecents,
    evolution_pct: evolutionPct,
    jour_fort_label: JOURS_FR[jourFortIdx],
    jour_fort_moyenne: +moyParJour[jourFortIdx].toFixed(2),
    jour_creux_label: JOURS_FR[jourCreuxIdx],
    jour_creux_moyenne: +moyParJour[jourCreuxIdx].toFixed(2),
    stock_actuel: produit.stock_actuel,
    jours_avant_rupture: joursAvantRupture,
    quantite_recommandee: quantiteRecommandee,
    scenarios: { pessimiste: prevBasse, probable: prevTotal, optimiste: prevHaute },
  };
}

// =========================================================
// CLASSIFICATION ABC
// =========================================================
function classificationABC(periodeJours = 90, offsetJours = 0, activiteId = null) {
  const fin = new Date(Date.now() - offsetJours * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const debut = new Date(Date.now() - (offsetJours + periodeJours) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const filtreAct = activiteId ? 'AND v.activite_id = ?' : '';
  const params = activiteId ? [debut, fin, activiteId] : [debut, fin];
  const rows = db.prepare(`SELECT lv.produit_id, SUM(lv.quantite * lv.prix_unitaire) AS ca
                           FROM ligne_vente lv JOIN vente v ON v.id = lv.vente_id
                           WHERE v.date_vente >= ? AND v.date_vente < ? ${filtreAct}
                           GROUP BY lv.produit_id
                           ORDER BY ca DESC`).all(...params);
  if (!rows.length) return [];
  const produits = new Map();
  const ids = rows.map(r => r.produit_id);
  const placeholders = ids.map(() => '?').join(',');
  const prods = db.prepare(`SELECT p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom, f.id AS fournisseur_id
                            FROM produit p LEFT JOIN categorie c ON c.id = p.categorie_id
                            LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                            WHERE p.id IN (${placeholders})`).all(...ids);
  prods.forEach(p => produits.set(p.id, p));
  const total = rows.reduce((s, r) => s + Number(r.ca || 0), 0) || 1;
  const resultats = [];
  let cumul = 0;
  for (const row of rows) {
    const ca = Number(row.ca || 0);
    const part = (ca / total) * 100;
    cumul += part;
    let classe;
    if (cumul <= 80) classe = 'A';
    else if (cumul <= 95) classe = 'B';
    else classe = 'C';
    const p = produits.get(row.produit_id);
    if (p) resultats.push({ produit: p, ca_total: ca, part_pct: +part.toFixed(2), cumul_pct: +cumul.toFixed(2), classe });
  }
  return resultats;
}

// =========================================================
// POINT DE COMMANDE + RECOMMANDATIONS
// =========================================================
function pointCommande(consommationJournaliere, delaiJours, stockSecurite = 5) {
  return Math.round(consommationJournaliere * delaiJours + stockSecurite);
}

function recommandationsReapprovisionnement(periodeJours = 60, activiteId = null) {
  const classes = classificationABC(periodeJours, 0, activiteId);
  const classesMap = new Map(classes.map(c => [c.produit.id, c.classe]));
  const debut = new Date(Date.now() - periodeJours * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  const filtreAct = activiteId ? 'AND p.activite_id = ?' : '';
  const paramsProd = activiteId ? [activiteId] : [];
  const produits = db.prepare(`SELECT p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom,
                                      f.delai_livraison_jours, f.id AS fournisseur_id
                               FROM produit p LEFT JOIN categorie c ON c.id = p.categorie_id
                               LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                               WHERE p.actif = 1 ${filtreAct}`).all(...paramsProd);

  const recos = [];
  for (const p of produits) {
    const row = db.prepare(`SELECT COALESCE(SUM(l.quantite),0) AS n FROM ligne_vente l JOIN vente v ON v.id = l.vente_id
                            WHERE l.produit_id = ? AND v.date_vente >= ?`).get(p.id, debut);
    const consommation = row.n / Math.max(periodeJours, 1);
    const delai = p.delai_livraison_jours || 7;
    const pc = pointCommande(consommation, delai);
    const enAlerte = p.stock_actuel <= p.stock_minimum;
    if (p.stock_actuel > pc && !enAlerte) continue;
    const enRupture = p.stock_actuel <= 0;
    const classe = classesMap.get(p.id) || 'C';
    let urgence = 'basse';
    if (enRupture) urgence = 'haute';
    else if (enAlerte) urgence = classe === 'A' ? 'haute' : 'moyenne';
    recos.push({
      produit: p,
      classe_abc: classe,
      stock_actuel: p.stock_actuel,
      consommation_journaliere: +consommation.toFixed(2),
      delai_livraison: delai,
      point_commande: pc,
      quantite_a_commander: Math.max(p.stock_maximum - p.stock_actuel, 0),
      urgence,
    });
  }
  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  recos.sort((a, b) => ordre[a.urgence] - ordre[b.urgence] || a.classe_abc.localeCompare(b.classe_abc));
  return recos;
}

module.exports = { serieTemporelleProduit, prevoirVentes, classificationABC, pointCommande, recommandationsReapprovisionnement, JOURS_FR };
