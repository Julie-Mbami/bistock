const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// =========================================================
// DISPATCH SELON RÔLE — avec enforcement des permissions dashboard
// =========================================================
router.get('/', (req, res) => {
  // Vérifier au moins une des deux permissions dashboard
  const peutActivite  = h.utilisateurPeut(db, req.user, 'dashboard.activite',  req.activiteId);
  const peutConsolide = h.utilisateurPeut(db, req.user, 'dashboard.consolide', null);
  if (!peutActivite && !peutConsolide) {
    // Redirection silencieuse vers l'espace de travail du rôle (pas de flash : c'est le comportement par défaut)
    if (h.isCaissier(req.user))     return res.redirect('/ventes/caisse/');
    if (h.isCuisinier(req.user))    return res.redirect('/productions/');
    if (h.isDistribution(req.user)) return res.redirect('/magasin-nestor/');
    if (h.isGestionnaire(req.user)) return res.redirect('/stocks/mouvements/');
    if (h.isSecretariat(req.user))  return res.redirect('/commandes/');
    return res.redirect('/comptes/profil');
  }
  if (h.isDG(req.user))          return dashboardDG(req, res);
  if (h.isDistribution(req.user))return dashboardNestor(req, res);
  if (h.isSecretariat(req.user)) return dashboardSecretariat(req, res);
  if (h.isCaissier(req.user))    return dashboardCaissier(req, res);
  if (h.isCuisinier(req.user))   return dashboardCuisinier(req, res);
  if (req.user.role === 'GESTIONNAIRE') return dashboardGestionnaire(req, res);
  // Fallback : DG
  return dashboardDG(req, res);
});

// =========================================================
// DASHBOARD CUISINIER — Chef Cuisinier / Chef Pâtissier
// KPI orientés cuisine : productions, ingrédients, coût matière (pas de CA)
// =========================================================
function dashboardCuisinier(req, res) {
  const activiteId = req.activiteId;
  if (!activiteId) return res.render('analytics/dashboard_vide', { title: 'Tableau de bord', page_title: 'Aucune activité' });

  const debut30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const debutMois = new Date().toISOString().slice(0, 7) + '-01';

  // 1. KPIs du haut
  const nb_en_cours = db.prepare(`SELECT COUNT(*) AS n FROM production
                                   WHERE activite_id = ? AND produit_par_id = ? AND statut = 'EN_COURS'`).get(activiteId, req.user.id).n;
  const nb_en_attente = db.prepare(`SELECT COUNT(*) AS n FROM production
                                     WHERE activite_id = ? AND produit_par_id = ? AND statut = 'BROUILLON'`).get(activiteId, req.user.id).n;
  const nb_notifs = db.prepare(`SELECT COUNT(*) AS n FROM production
                                 WHERE activite_id = ? AND produit_par_id = ?
                                   AND (
                                     (statut = 'EN_COURS' AND (vue_par_cuisinier_le IS NULL OR vue_par_cuisinier_le < date_validation))
                                     OR
                                     (statut = 'ANNULEE' AND motif_annulation LIKE 'Refus gestionnaire%'
                                      AND (vue_par_cuisinier_le IS NULL OR vue_par_cuisinier_le < date_fin))
                                   )`).get(activiteId, req.user.id).n;
  const kpi_mois = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(quantite_produite),0) AS qte, COALESCE(SUM(cout_matiere),0) AS cout
                                FROM production WHERE activite_id = ? AND produit_par_id = ?
                                  AND statut = 'TERMINEE' AND date(date_production) >= date(?)`).get(activiteId, req.user.id, debutMois);

  // 2. Alertes ingrédients : produits utilisés dans SES fiches techniques qui sont en alerte ou rupture
  const alertes_ingredients = db.prepare(`SELECT DISTINCT p.id, p.designation, p.reference, p.unite, p.stock_actuel, p.stock_minimum,
                                                  CASE WHEN p.stock_actuel <= 0 THEN 'RUPTURE' ELSE 'ALERTE' END AS niveau
                                           FROM produit p
                                           JOIN composition_fiche cf ON cf.ingredient_id = p.id
                                           JOIN fiche_technique ft ON ft.id = cf.fiche_id AND ft.actif = 1
                                           JOIN produit prod_fini ON prod_fini.id = ft.produit_id
                                           WHERE prod_fini.activite_id = ?
                                             AND p.actif = 1 AND p.stock_maximum > 0
                                             AND (p.stock_actuel <= 0 OR p.stock_actuel <= p.stock_minimum)
                                           ORDER BY CASE WHEN p.stock_actuel <= 0 THEN 0 ELSE 1 END, p.designation
                                           LIMIT 12`).all(activiteId);

  // 3. Productions récentes (5 dernières, tous statuts)
  const productions_recentes = db.prepare(`SELECT p.id, p.numero, p.statut, p.quantite_produite, p.date_production,
                                                  p.date_validation, p.date_fin,
                                                  prod.designation AS produit_nom, prod.unite AS produit_unite
                                           FROM production p JOIN produit prod ON prod.id = p.produit_id
                                           WHERE p.activite_id = ? AND p.produit_par_id = ?
                                           ORDER BY p.date_production DESC LIMIT 5`).all(activiteId, req.user.id);

  // 4. Top 5 produits fabriqués sur 30j (par lui)
  const top_fabriques = db.prepare(`SELECT prod.designation, prod.reference, prod.unite,
                                           COUNT(p.id) AS nb_ordres, SUM(p.quantite_produite) AS qte_totale
                                    FROM production p JOIN produit prod ON prod.id = p.produit_id
                                    WHERE p.activite_id = ? AND p.produit_par_id = ?
                                      AND p.statut = 'TERMINEE' AND date(p.date_production) >= ?
                                    GROUP BY prod.id ORDER BY qte_totale DESC LIMIT 5`).all(activiteId, req.user.id, debut30j);

  // 5. Notifications récentes détaillées (mêmes que le bandeau de la liste, limité à 5)
  const notifs_recentes = db.prepare(`SELECT p.id, p.numero, p.statut, p.motif_annulation, p.date_validation, p.date_fin,
                                             prod.designation AS produit_nom,
                                             v.first_name AS valide_par_prenom, v.username AS valide_par_username
                                      FROM production p
                                      JOIN produit prod ON prod.id = p.produit_id
                                      LEFT JOIN utilisateur v ON v.id = p.valide_par_id
                                      WHERE p.activite_id = ? AND p.produit_par_id = ?
                                        AND (
                                          (p.statut = 'EN_COURS' AND (p.vue_par_cuisinier_le IS NULL OR p.vue_par_cuisinier_le < p.date_validation))
                                          OR
                                          (p.statut = 'ANNULEE' AND p.motif_annulation LIKE 'Refus gestionnaire%'
                                           AND (p.vue_par_cuisinier_le IS NULL OR p.vue_par_cuisinier_le < p.date_fin))
                                        )
                                      ORDER BY COALESCE(p.date_validation, p.date_fin) DESC LIMIT 5`).all(activiteId, req.user.id);

  res.render('analytics/dashboard_cuisinier', {
    title: 'Tableau de bord', page_title: `Cuisine — ${req.activite.nom}`,
    nb_en_cours, nb_en_attente, nb_notifs, kpi_mois,
    alertes_ingredients, productions_recentes, top_fabriques, notifs_recentes,
  });
}

// =========================================================
// DASHBOARD GESTIONNAIRE — Mario, Mariano, Floriane, Nikolas
// KPI orientés stock, réceptions, alertes (pas de CA)
// =========================================================
function dashboardGestionnaire(req, res) {
  const activiteId = req.activiteId;
  if (!activiteId) return res.render('analytics/dashboard_vide', { title: 'Tableau de bord', page_title: 'Aucune activité' });

  const today = new Date().toISOString().slice(0, 10);
  const debut30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // 1. Réceptions à traiter
  const nb_receptions_a_traiter = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'REMISE'`).get(activiteId).n;
  const nb_receptions_preparees = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'PREPAREE'`).get(activiteId).n;

  // 2. Stock : valeur + états
  const valeur_stock = db.prepare(`SELECT COALESCE(SUM(prix_achat * stock_actuel), 0) AS v FROM produit WHERE activite_id = ? AND actif = 1`).get(activiteId).v;
  const nb_produits_actifs = db.prepare(`SELECT COUNT(*) AS n FROM produit WHERE activite_id = ? AND actif = 1`).get(activiteId).n;
  const nb_rupture = db.prepare(`SELECT COUNT(*) AS n FROM produit WHERE activite_id = ? AND actif = 1 AND stock_maximum > 0 AND stock_actuel <= 0`).get(activiteId).n;
  const nb_alerte = db.prepare(`SELECT COUNT(*) AS n FROM produit WHERE activite_id = ? AND actif = 1 AND stock_maximum > 0 AND stock_actuel > 0 AND stock_actuel <= stock_minimum`).get(activiteId).n;
  const nb_alertes_non_lues = db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id = ? AND vue = 0`).get(activiteId).n;

  // 3. Mouvements du jour
  const mvts_jour = db.prepare(`SELECT
      SUM(CASE WHEN type = 'ENTREE' THEN quantite ELSE 0 END) AS entrees,
      SUM(CASE WHEN type = 'SORTIE' THEN quantite ELSE 0 END) AS sorties,
      SUM(CASE WHEN type IN ('AJUST_P','AJUST_M') THEN 1 ELSE 0 END) AS ajust,
      COUNT(*) AS total
    FROM mouvement_stock WHERE activite_id = ? AND date(date_mouvement) = ?`).get(activiteId, today);

  // 4. Top 5 produits consommés sur 30j (par sorties)
  const top_conso = db.prepare(`SELECT p.designation, p.reference, SUM(m.quantite) AS qte
    FROM mouvement_stock m JOIN produit p ON p.id = m.produit_id
    WHERE m.activite_id = ? AND m.type = 'SORTIE' AND date(m.date_mouvement) >= ?
    GROUP BY p.id ORDER BY qte DESC LIMIT 5`).all(activiteId, debut30j);

  // 5. Prévision rupture (produits qui vont manquer dans les 7 prochains jours)
  const previsions_rupture = db.prepare(`SELECT p.designation, p.reference, p.stock_actuel, p.unite,
      (SELECT COALESCE(SUM(quantite), 0) FROM mouvement_stock WHERE produit_id = p.id AND type = 'SORTIE' AND date(date_mouvement) >= ?) AS conso_30j
    FROM produit p WHERE p.activite_id = ? AND p.actif = 1 AND p.stock_actuel > 0 AND p.stock_maximum > 0
    ORDER BY conso_30j DESC LIMIT 20`).all(debut30j, activiteId)
    .map(p => {
      const consoJour = p.conso_30j / 30;
      const joursRestants = consoJour > 0 ? Math.floor(p.stock_actuel / consoJour) : null;
      return { ...p, conso_jour: +(consoJour).toFixed(2), jours_restants: joursRestants };
    })
    .filter(p => p.jours_restants !== null && p.jours_restants < 7)
    .sort((a, b) => a.jours_restants - b.jours_restants);

  // 6. Dernier inventaire
  const dernier_inv = db.prepare(`SELECT reference, date_creation, date_validation, statut,
      (SELECT COUNT(*) FROM ligne_inventaire WHERE inventaire_id = i.id AND stock_physique IS NOT NULL AND stock_physique != stock_theorique) AS nb_ecarts
    FROM inventaire i WHERE activite_id = ? ORDER BY date_creation DESC LIMIT 1`).get(activiteId);

  // 7. Graphique : mouvements 30 derniers jours (entrées vs sorties)
  const mouvements_30j = db.prepare(`SELECT date(date_mouvement) AS jour,
      SUM(CASE WHEN type = 'ENTREE' THEN quantite ELSE 0 END) AS entrees,
      SUM(CASE WHEN type = 'SORTIE' THEN quantite ELSE 0 END) AS sorties
    FROM mouvement_stock WHERE activite_id = ? AND date(date_mouvement) >= ?
    GROUP BY jour ORDER BY jour`).all(activiteId, debut30j);
  const jours_labels = [], data_entrees = [], data_sorties = [];
  const map = new Map(mouvements_30j.map(m => [m.jour, m]));
  for (let i = 30; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    jours_labels.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    const item = map.get(iso);
    data_entrees.push(item ? Number(item.entrees || 0) : 0);
    data_sorties.push(item ? Number(item.sorties || 0) : 0);
  }

  res.render('analytics/dashboard_gestionnaire', {
    title: 'Tableau de bord', page_title: `${req.activite.nom}`,
    nb_receptions_a_traiter, nb_receptions_preparees,
    valeur_stock, nb_produits_actifs, nb_rupture, nb_alerte, nb_alertes_non_lues,
    mvts_jour, top_conso, previsions_rupture, dernier_inv,
    jours_labels: JSON.stringify(jours_labels),
    data_entrees: JSON.stringify(data_entrees),
    data_sorties: JSON.stringify(data_sorties),
  });
}

// =========================================================
// DASHBOARD CAISSIER — Pâtisserie / Bona Burger
// KPI orientés caisse du jour
// =========================================================
function dashboardCaissier(req, res) {
  const activiteId = req.activiteId;
  if (!activiteId) return res.render('analytics/dashboard_vide', { title: 'Tableau de bord', page_title: 'Aucune activité' });

  const today = new Date().toISOString().slice(0, 10);
  const debut30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // KPI du jour
  const ventes_jour = db.prepare(`SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS ca
    FROM vente WHERE activite_id = ? AND date(date_vente) = ?`).get(activiteId, today);
  const ca_jour = ventes_jour.ca;
  const nb_ventes_jour = ventes_jour.nb;
  const ticket_moyen = nb_ventes_jour ? Math.round(ca_jour / nb_ventes_jour) : 0;

  // Par mode de paiement (jour)
  const par_mode = db.prepare(`SELECT mode_paiement, COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS ca
    FROM vente WHERE activite_id = ? AND date(date_vente) = ?
    GROUP BY mode_paiement`).all(activiteId, today);

  // Top produits vendus aujourd'hui
  const top_produits_jour = db.prepare(`SELECT p.designation, p.reference, SUM(lv.quantite) AS qte, SUM(lv.quantite * lv.prix_unitaire) AS ca
    FROM ligne_vente lv JOIN vente v ON v.id = lv.vente_id JOIN produit p ON p.id = lv.produit_id
    WHERE v.activite_id = ? AND date(v.date_vente) = ?
    GROUP BY p.id ORDER BY qte DESC LIMIT 5`).all(activiteId, today);

  // Évolution 30j
  const ventes_30j = db.prepare(`SELECT date(date_vente) AS jour, COALESCE(SUM(montant_total), 0) AS total, COUNT(*) AS nb
    FROM vente WHERE activite_id = ? AND date(date_vente) >= ? GROUP BY jour`).all(activiteId, debut30j);
  const jours_labels = [], ca_data = [], nb_ventes_data = [];
  const map = new Map(ventes_30j.map(v => [v.jour, v]));
  for (let i = 30; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    jours_labels.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    const item = map.get(iso);
    ca_data.push(item ? Number(item.total || 0) : 0);
    nb_ventes_data.push(item ? item.nb : 0);
  }

  // Clôture en cours ?
  const cloture_ouverte = db.prepare(`SELECT * FROM cloture_caisse WHERE activite_id = ? AND statut = 'OUVERTE' ORDER BY date_ouverture DESC LIMIT 1`).get(activiteId);

  res.render('analytics/dashboard_caissier', {
    title: 'Tableau de bord', page_title: `Caisse — ${req.activite.nom}`,
    ca_jour, nb_ventes_jour, ticket_moyen, par_mode, top_produits_jour, cloture_ouverte,
    jours_labels: JSON.stringify(jours_labels),
    ca_data: JSON.stringify(ca_data),
    nb_ventes_data: JSON.stringify(nb_ventes_data),
  });
}

// =========================================================
// DASHBOARD DG (Mme Sandra) — vue consolidée
// =========================================================
function dashboardDG(req, res) {
  // Filtre de période — presets ou dates personnalisées via query params
  const preset = (req.query.preset || 'mois').toLowerCase();
  let dateDebut, dateFin;
  const now = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (req.query.debut && req.query.fin) {
    dateDebut = req.query.debut;
    dateFin = req.query.fin;
  } else if (preset === 'aujourdhui') {
    dateDebut = iso(now); dateFin = iso(now);
  } else if (preset === '7j') {
    dateDebut = iso(new Date(Date.now() - 6 * 86400000)); dateFin = iso(now);
  } else if (preset === '30j') {
    dateDebut = iso(new Date(Date.now() - 29 * 86400000)); dateFin = iso(now);
  } else if (preset === 'mois_precedent') {
    const debM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const finM = new Date(now.getFullYear(), now.getMonth(), 0);
    dateDebut = iso(debM); dateFin = iso(finM);
  } else if (preset === 'annee') {
    dateDebut = `${now.getFullYear()}-01-01`; dateFin = iso(now);
  } else {
    // Défaut : mois courant
    const debM = new Date(now.getFullYear(), now.getMonth(), 1);
    dateDebut = iso(debM); dateFin = iso(now);
  }
  const today = iso(now);
  const debut30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const activites = db.prepare(`SELECT * FROM activite WHERE actif = 1 ORDER BY id`).all();

  // Stats par activité — B2C (vente) ou B2B (paiements réels encaissés) — filtrées sur la période
  const stats_activites = activites.map(a => {
    let caJour, caPeriode;
    let enAttente = 0;
    if (a.type === 'B2C_CAISSE') {
      caJour = db.prepare(`SELECT COALESCE(SUM(montant_total), 0) AS ca, COUNT(*) AS nb
                           FROM vente WHERE activite_id = ? AND date(date_vente) = ?`).get(a.id, today);
      caPeriode = db.prepare(`SELECT COALESCE(SUM(montant_total), 0) AS ca
                              FROM vente WHERE activite_id = ? AND date(date_vente) BETWEEN ? AND ?`).get(a.id, dateDebut, dateFin);
    } else {
      caJour = db.prepare(`SELECT COALESCE(SUM(montant), 0) AS ca, COUNT(*) AS nb
                           FROM paiement WHERE activite_id = ? AND commande_id IS NOT NULL AND date(date_paiement) = ?`).get(a.id, today);
      caPeriode = db.prepare(`SELECT COALESCE(SUM(montant), 0) AS ca
                              FROM paiement WHERE activite_id = ? AND commande_id IS NOT NULL AND date(date_paiement) BETWEEN ? AND ?`).get(a.id, dateDebut, dateFin);
      const att = db.prepare(`SELECT COALESCE(SUM(montant_total - montant_paye), 0) AS mt
                              FROM commande WHERE activite_id = ? AND statut = 'FACTUREE'
                                AND montant_paye + 1 < montant_total`).get(a.id);
      enAttente = att.mt;
    }
    const valeurStock = db.prepare(`SELECT COALESCE(SUM(prix_achat * stock_actuel), 0) AS v FROM produit WHERE activite_id = ?`).get(a.id).v;
    const nbAlertes = db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id = ? AND vue = 0`).get(a.id).n;
    // CA livraison
    //  - B2B : colonne commande.frais_livraison
    //  - B2C : ligne de vente avec le produit spécial 'FRAIS-LIV' (créé automatiquement par le canal en ligne)
    let caLivraisonJour = 0;
    let caLivraisonPeriode = 0;
    if (a.type === 'B2B_COMMANDE') {
      const lrJour = db.prepare(`SELECT COALESCE(SUM(frais_livraison), 0) AS ca
                                  FROM commande WHERE activite_id = ? AND statut = 'PAYEE'
                                    AND date(date_commande) = ?`).get(a.id, today);
      const lrPer = db.prepare(`SELECT COALESCE(SUM(frais_livraison), 0) AS ca
                                 FROM commande WHERE activite_id = ? AND statut = 'PAYEE'
                                   AND date(date_commande) BETWEEN ? AND ?`).get(a.id, dateDebut, dateFin);
      caLivraisonJour = lrJour.ca;
      caLivraisonPeriode = lrPer.ca;
    } else if (a.type === 'B2C_CAISSE') {
      // Frais de livraison encaissés via le canal web (produit FRAIS-LIV)
      const lrJour = db.prepare(`SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0) AS ca
                                  FROM ligne_vente l
                                  JOIN vente v ON v.id = l.vente_id
                                  JOIN produit p ON p.id = l.produit_id
                                  WHERE v.activite_id = ? AND p.reference = 'FRAIS-LIV'
                                    AND date(v.date_vente) = ?`).get(a.id, today);
      const lrPer = db.prepare(`SELECT COALESCE(SUM(l.quantite * l.prix_unitaire), 0) AS ca
                                 FROM ligne_vente l
                                 JOIN vente v ON v.id = l.vente_id
                                 JOIN produit p ON p.id = l.produit_id
                                 WHERE v.activite_id = ? AND p.reference = 'FRAIS-LIV'
                                   AND date(v.date_vente) BETWEEN ? AND ?`).get(a.id, dateDebut, dateFin);
      caLivraisonJour = lrJour.ca;
      caLivraisonPeriode = lrPer.ca;
    }
    // CA produits = CA total - CA livraison (permet d'analyser les ventes réelles)
    const caProduitsJour = Math.max(0, Number(caJour.ca) - caLivraisonJour);
    const caProduitsPeriode = Math.max(0, Number(caPeriode.ca) - caLivraisonPeriode);
    return {
      ...a,
      ca_jour: caJour.ca, nb_ventes_jour: caJour.nb || 0,
      ca_mois: caPeriode.ca, valeur_stock: valeurStock, nb_alertes: nbAlertes,
      en_attente: enAttente,
      ca_livraison: caLivraisonPeriode,
      ca_livraison_jour: caLivraisonJour,
      ca_produits: caProduitsPeriode,
      ca_produits_jour: caProduitsJour,
    };
  });

  const ca_total_jour = stats_activites.reduce((s, a) => s + Number(a.ca_jour || 0), 0);
  const ca_total_mois = stats_activites.reduce((s, a) => s + Number(a.ca_mois || 0), 0);
  const ca_total_livraison = stats_activites.reduce((s, a) => s + Number(a.ca_livraison || 0), 0);
  const ca_total_produits_mois = stats_activites.reduce((s, a) => s + Number(a.ca_produits || 0), 0);
  const ca_total_produits_jour = stats_activites.reduce((s, a) => s + Number(a.ca_produits_jour || 0), 0);
  const ca_total_livraison_jour = stats_activites.reduce((s, a) => s + Number(a.ca_livraison_jour || 0), 0);
  const valeur_stock_totale = stats_activites.reduce((s, a) => s + Number(a.valeur_stock || 0), 0);
  const nb_alertes_totales = stats_activites.reduce((s, a) => s + Number(a.nb_alertes || 0), 0);
  const en_attente_total = stats_activites.reduce((s, a) => s + Number(a.en_attente || 0), 0);

  // Achats en cours
  const nb_achats_saisis = db.prepare(`SELECT COUNT(*) AS n FROM achat WHERE statut = 'SAISI'`).get().n;
  const nb_achats_receptionnes = db.prepare(`SELECT COUNT(*) AS n FROM achat WHERE statut = 'RECEPTIONNE'`).get().n;

  // Évolution CA encaissé sur la période — B2C via vente, B2B via paiement
  const ventes_periode = db.prepare(`SELECT date(date_vente) AS jour, activite_id, COALESCE(SUM(montant_total), 0) AS total
    FROM vente WHERE date(date_vente) BETWEEN ? AND ? GROUP BY jour, activite_id`).all(dateDebut, dateFin);
  const paiements_periode = db.prepare(`SELECT date(date_paiement) AS jour, activite_id, COALESCE(SUM(montant), 0) AS total
    FROM paiement WHERE date(date_paiement) BETWEEN ? AND ? AND commande_id IS NOT NULL GROUP BY jour, activite_id`).all(dateDebut, dateFin);
  const indexerParJour = (rows) => {
    const map = new Map();
    for (const r of rows) map.set(`${r.jour}_${Number(r.activite_id)}`, Number(r.total || 0));
    return map;
  };
  const idxVentes = indexerParJour(ventes_periode);
  const idxPaiements = indexerParJour(paiements_periode);

  // Générer la liste des jours de la période (bornes incluses)
  const debutD = new Date(dateDebut + 'T00:00:00');
  const finD = new Date(dateFin + 'T00:00:00');
  const nbJours = Math.min(365, Math.max(1, Math.round((finD - debutD) / 86400000) + 1));
  const jours_labels = [];
  const jours_iso = [];
  for (let i = 0; i < nbJours; i++) {
    const d = new Date(debutD.getTime() + i * 86400000);
    jours_labels.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`);
    jours_iso.push(d.toISOString().slice(0, 10));
  }
  const datasets = activites.map(a => {
    const data = [];
    const idx = a.type === 'B2B_COMMANDE' ? idxPaiements : idxVentes;
    for (const iso of jours_iso) {
      data.push(idx.get(`${iso}_${Number(a.id)}`) || 0);
    }
    return { label: a.nom, data, borderColor: a.couleur, backgroundColor: a.couleur + '20' };
  });

  res.render('analytics/dashboard_dg', {
    title: 'Tableau de bord DG', page_title: 'Vue consolidée — Direction Générale',
    stats_activites, ca_total_jour, ca_total_mois, ca_total_livraison,
    ca_total_produits_mois, ca_total_produits_jour, ca_total_livraison_jour,
    valeur_stock_totale, nb_alertes_totales,
    en_attente_total,
    nb_achats_saisis, nb_achats_receptionnes,
    jours_labels: JSON.stringify(jours_labels),
    ca_datasets: JSON.stringify(datasets),
    periode: { preset, debut: dateDebut, fin: dateFin },
  });
}

// =========================================================
// DASHBOARD NESTOR — logistique
// =========================================================
function dashboardNestor(req, res) {
  const activites = db.prepare(`SELECT * FROM activite WHERE actif = 1 ORDER BY id`).all();

  // Achats à traiter
  const achats_saisis = db.prepare(`SELECT a.*, COALESCE(f.raison_sociale, a.fournisseur_libre) AS fournisseur
    FROM achat a LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
    WHERE a.statut = 'SAISI' ORDER BY a.date_achat DESC LIMIT 10`).all();
  const nb_achats_saisis = achats_saisis.length;
  const achats_a_distribuer = db.prepare(`SELECT COUNT(*) AS n FROM achat WHERE statut = 'RECEPTIONNE'`).get().n;

  // Distributions en cours
  const distributions_remises = db.prepare(`SELECT d.*, a.nom AS activite_nom, a.code AS activite_code, a.couleur AS activite_couleur,
      (SELECT COUNT(*) FROM ligne_distribution WHERE distribution_id = d.id) AS nb_lignes
    FROM distribution d JOIN activite a ON a.id = d.activite_id
    WHERE d.statut = 'REMISE' ORDER BY d.date_remise DESC LIMIT 10`).all();
  const nb_distributions_preparees = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE statut = 'PREPAREE'`).get().n;
  const nb_distributions_remises = distributions_remises.length;

  // Alertes par activité
  const alertes_par_activite = activites.map(a => {
    const alertes = db.prepare(`SELECT
        SUM(CASE WHEN niveau = 'CRITIQUE' THEN 1 ELSE 0 END) AS critiques,
        SUM(CASE WHEN niveau = 'ALERTE' THEN 1 ELSE 0 END) AS alertes,
        COUNT(*) AS total
      FROM alerte WHERE activite_id = ? AND vue = 0`).get(a.id);
    const valeurStock = db.prepare(`SELECT COALESCE(SUM(prix_achat * stock_actuel), 0) AS v FROM produit WHERE activite_id = ?`).get(a.id).v;
    return { ...a, ...alertes, valeur_stock: valeurStock };
  });

  // Écarts distribution vs réception (audit)
  const ecarts = db.prepare(`SELECT ld.*, d.numero AS dist_numero, d.date_reception, a.nom AS activite_nom,
      p.designation, u.first_name || ' ' || u.last_name AS receptionne_par_nom
    FROM ligne_distribution ld
    JOIN distribution d ON d.id = ld.distribution_id
    JOIN activite a ON a.id = d.activite_id
    JOIN produit p ON p.id = ld.produit_id
    LEFT JOIN utilisateur u ON u.id = d.receptionne_par_id
    WHERE ld.quantite_recue IS NOT NULL AND ABS(ld.quantite_recue - ld.quantite_annoncee) > 0.01
    ORDER BY d.date_reception DESC LIMIT 10`).all();

  res.render('analytics/dashboard_nestor', {
    title: 'Tableau de bord Distribution', page_title: 'Distribution — Logistique',
    achats_saisis, nb_achats_saisis, achats_a_distribuer,
    distributions_remises, nb_distributions_preparees, nb_distributions_remises,
    alertes_par_activite, ecarts,
  });
}

// =========================================================
// DASHBOARD SECRÉTARIAT (Sandra) — commercial B2B
// =========================================================
function dashboardSecretariat(req, res) {
  const activites = h.activitesAccessibles(db, req.user);
  const activitesB2B = db.prepare(`SELECT * FROM activite WHERE id IN (${activites.map(() => '?').join(',') || 'NULL'}) AND type = 'B2B_COMMANDE' ORDER BY id`).all(...activites);
  const idsB2B = activitesB2B.map(a => a.id);

  // KPIs par activité B2B
  const kpisParActivite = [];
  const factures_a_relancer = [];
  let total_du = 0, nb_relances_prioritaires = 0, nb_relances_J30 = 0;

  for (const act of activitesB2B) {
    const kpi = { activite: act, nb_proforma: 0, nb_valide: 0, nb_livree: 0, nb_facturee: 0, nb_payee: 0, ca_mois: 0, impaye: 0 };
    const rows = db.prepare(`SELECT statut, COUNT(*) AS n, COALESCE(SUM(montant_total),0) AS mt, COALESCE(SUM(montant_paye),0) AS mp
                             FROM commande WHERE activite_id = ? GROUP BY statut`).all(act.id);
    for (const r of rows) {
      if (r.statut === 'PROFORMA') kpi.nb_proforma = r.n;
      else if (r.statut === 'VALIDE' || r.statut === 'EN_PRODUCTION') kpi.nb_valide += r.n;
      else if (r.statut === 'LIVREE') kpi.nb_livree = r.n;
      else if (r.statut === 'FACTUREE') { kpi.nb_facturee = r.n; kpi.impaye += (r.mt - r.mp); }
      else if (r.statut === 'PAYEE') kpi.nb_payee = r.n;
    }
    // CA du mois (commandes PAYEE) — SQL natif pour éviter les décalages ISO/SQLite
    const caRow = db.prepare(`SELECT COALESCE(SUM(montant_total),0) AS ca,
                                     COALESCE(SUM(frais_livraison),0) AS ca_livraison
                              FROM commande WHERE activite_id = ? AND statut = 'PAYEE'
                                AND date(date_commande) >= date('now', 'start of month')`).get(act.id);
    kpi.ca_mois = caRow.ca;
    kpi.ca_livraison_mois = caRow.ca_livraison;
    kpisParActivite.push(kpi);

    // Factures à relancer pour cette activité
    const impayees = db.prepare(`SELECT c.*, cl.nom AS client_nom, cl.telephone AS client_tel, cl.contact_personne AS client_contact
                                 FROM commande c JOIN client cl ON cl.id = c.client_id
                                 WHERE c.activite_id = ? AND c.statut = 'FACTUREE'
                                   AND c.montant_paye + 0.01 < c.montant_total`).all(act.id);
    for (const f of impayees) {
      const relances = db.prepare('SELECT niveau FROM relance WHERE commande_id = ?').all(f.id);
      const a = h.analyseRelance(f, relances);
      if (a.prochain_niveau) {
        f.analyse = a;
        f.activite_nom = act.nom;
        f.activite_couleur = act.couleur;
        f.montant_restant = f.montant_total - f.montant_paye;
        total_du += f.montant_restant;
        nb_relances_prioritaires++;
        if (a.prochain_niveau === 'J30') nb_relances_J30++;
        factures_a_relancer.push(f);
      }
    }
  }
  factures_a_relancer.sort((a, b) => b.analyse.jours_retard - a.analyse.jours_retard);

  // 5 dernières commandes créées (toutes activités B2B)
  const dernieres_commandes = idsB2B.length ? db.prepare(`SELECT c.*, cl.nom AS client_nom, a.nom AS activite_nom, a.couleur AS activite_couleur
    FROM commande c JOIN client cl ON cl.id = c.client_id JOIN activite a ON a.id = c.activite_id
    WHERE c.activite_id IN (${idsB2B.map(() => '?').join(',')})
    ORDER BY c.date_commande DESC LIMIT 8`).all(...idsB2B) : [];

  res.render('analytics/dashboard_secretariat', {
    title: 'Tableau de bord Secrétariat', page_title: 'Secrétariat — Commandes et facturation B2B',
    kpisParActivite, factures_a_relancer, total_du, nb_relances_prioritaires, nb_relances_J30,
    dernieres_commandes, statuts_label: h.STATUT_COMMANDE_LABEL, statuts_badge: h.STATUT_COMMANDE_BADGE,
    niveau_label: h.NIVEAU_RELANCE_LABEL, niveau_couleur: h.NIVEAU_RELANCE_COULEUR,
  });
}

// =========================================================
// EXPORTS (inchangés)
// =========================================================
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

router.get('/export/ventes.csv', h.permissionRequise(db, 'analytics.exporter'), (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  if (!ids.length) return res.status(403).send('Aucune activité');
  const placeholders = ids.map(() => '?').join(',');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ventes_export.csv"');
  res.write('﻿');
  const header = ['activite', 'numero_vente', 'date_vente', 'caissier', 'client', 'mode_paiement',
    'reference_produit', 'designation', 'categorie', 'quantite', 'prix_unitaire', 'remise_ligne', 'sous_total'];
  res.write(header.join(',') + '\n');
  const rows = db.prepare(`SELECT a.nom AS activite, lv.quantite, lv.prix_unitaire, lv.remise,
                                  v.numero, v.date_vente, v.mode_paiement,
                                  u.username AS caissier, c.nom AS client,
                                  p.reference, p.designation,
                                  cat.nom AS categorie_nom
                           FROM ligne_vente lv
                           JOIN vente v ON v.id = lv.vente_id
                           JOIN activite a ON a.id = v.activite_id
                           LEFT JOIN utilisateur u ON u.id = v.caissier_id
                           LEFT JOIN client c ON c.id = v.client_id
                           JOIN produit p ON p.id = lv.produit_id
                           LEFT JOIN categorie cat ON cat.id = p.categorie_id
                           WHERE v.activite_id IN (${placeholders})
                           ORDER BY v.date_vente DESC`).all(...ids);
  for (const r of rows) {
    const sousTotal = r.prix_unitaire * r.quantite - r.remise;
    res.write([r.activite, r.numero, r.date_vente, r.caissier || '', r.client || '',
      h.MODE_PAIEMENT_STYLES[r.mode_paiement]?.label || r.mode_paiement,
      r.reference, r.designation, r.categorie_nom || '',
      r.quantite, r.prix_unitaire, r.remise, sousTotal].map(csvEscape).join(',') + '\n');
  }
  res.end();
});

router.get('/export/stocks.csv', h.permissionRequise(db, 'analytics.exporter'), (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const placeholders = ids.map(() => '?').join(',');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="stocks_export.csv"');
  res.write('﻿');
  const header = ['activite', 'reference', 'designation', 'categorie', 'fournisseur',
    'prix_achat', 'prix_vente', 'stock_actuel', 'stock_minimum', 'stock_maximum', 'valeur_stock', 'etat'];
  res.write(header.join(',') + '\n');
  const rows = db.prepare(`SELECT a.nom AS activite, p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom
                           FROM produit p JOIN activite a ON a.id = p.activite_id
                           LEFT JOIN categorie c ON c.id = p.categorie_id
                           LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                           WHERE p.activite_id IN (${placeholders}) AND p.actif = 1`).all(...ids);
  for (const p of rows) {
    const enr = h.enrichirProduit(p);
    res.write([p.activite, p.reference, p.designation, p.categorie_nom || '', p.fournisseur_nom || '',
      p.prix_achat, p.prix_vente, p.stock_actuel, p.stock_minimum, p.stock_maximum, enr.valeur_stock, enr.niveau_stock,
    ].map(csvEscape).join(',') + '\n');
  }
  res.end();
});

module.exports = router;
