const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
// Enforcement basé sur permissions : `stock.mouvements` couvre entrées/sorties/ajustements.
function requireEcriture(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'stock.mouvements', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission de modifier le stock de cette activité.");
  return res.redirect('/stocks/etat/');
}

// Lecture requise pour accéder au module stocks
router.use(requireActivite, h.permissionRequise(db, 'stock.lire'));

// =========================================================
// RÉCEPTIONS À TRAITER — pour les gestionnaires
// =========================================================
router.get('/receptions/', requireEcriture, (req, res) => {
  const statut = req.query.statut || 'REMISE';
  const p = h.pagination(req);
  const totalRec = db.prepare(`SELECT COUNT(*) AS n FROM distribution d WHERE d.activite_id = ? AND d.statut = ?`).get(req.activiteId, statut).n;
  const distributions = db.prepare(`SELECT d.*, act.nom AS activite_nom,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      (SELECT COUNT(*) FROM ligne_distribution WHERE distribution_id = d.id) AS nb_lignes
    FROM distribution d
    JOIN activite act ON act.id = d.activite_id
    LEFT JOIN utilisateur u ON u.id = d.cree_par_id
    WHERE d.activite_id = ? AND d.statut = ?
    ORDER BY d.date_remise DESC, d.date_creation DESC LIMIT ? OFFSET ?`).all(req.activiteId, statut, p.taille, p.offset);
  const nb_preparees = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'PREPAREE'`).get(req.activiteId).n;
  const nb_a_traiter = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'REMISE'`).get(req.activiteId).n;
  const nb_traitees = db.prepare(`SELECT COUNT(*) AS n FROM distribution WHERE activite_id = ? AND statut = 'RECEPTIONNEE'`).get(req.activiteId).n;
  res.render('stocks/receptions', {
    title: 'Réceptions', page_title: `Réceptions — ${req.activite.nom}`,
    distributions, statut, nb_preparees, nb_a_traiter, nb_traitees,
    pagination: h.paginationInfo(p, totalRec, req),
  });
});

router.get('/receptions/:id(\\d+)', requireEcriture, (req, res) => {
  const distribution = db.prepare(`SELECT d.*, act.nom AS activite_nom, act.code AS activite_code,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      rem.first_name || ' ' || rem.last_name AS remise_par_nom
    FROM distribution d
    JOIN activite act ON act.id = d.activite_id
    LEFT JOIN utilisateur u ON u.id = d.cree_par_id
    LEFT JOIN utilisateur rem ON rem.id = d.remise_par_id
    WHERE d.id = ? AND d.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!distribution) return res.redirect('/stocks/receptions/');
  const lignes = db.prepare(`SELECT ld.*, p.designation, p.reference, p.unite, p.stock_actuel,
      la.designation AS achat_designation,
      a.numero AS achat_numero,
      f.raison_sociale AS fournisseur_nom
    FROM ligne_distribution ld
    JOIN produit p ON p.id = ld.produit_id
    LEFT JOIN ligne_achat la ON la.id = ld.ligne_achat_id
    LEFT JOIN achat a ON a.id = la.achat_id
    LEFT JOIN fournisseur f ON f.id = la.fournisseur_id
    WHERE ld.distribution_id = ? ORDER BY ld.id`).all(req.params.id);
  res.render('stocks/reception_detail', {
    title: 'Réception ' + distribution.numero, page_title: 'Réception ' + distribution.numero,
    distribution, lignes,
  });
});

// Confirmer la réception : crée les mouvements ENTREE
router.post('/receptions/:id(\\d+)/confirmer', requireEcriture, (req, res) => {
  const distribution = db.prepare('SELECT * FROM distribution WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!distribution) return res.redirect('/stocks/receptions/');
  if (distribution.statut !== 'REMISE') { req.flash('warning', 'Cette distribution ne peut plus être confirmée.'); return res.redirect('/stocks/receptions/' + distribution.id); }

  // Nouveau format : arrays parallèles indexés (plus fiable que la notation bracket)
  const ligneIds = Array.isArray(req.body.ligne_id) ? req.body.ligne_id : (req.body.ligne_id ? [req.body.ligne_id] : []);
  const quantites = Array.isArray(req.body.quantite) ? req.body.quantite : (req.body.quantite ? [req.body.quantite] : []);
  const motifsArr = Array.isArray(req.body.motif) ? req.body.motif : (req.body.motif ? [req.body.motif] : []);

  if (!ligneIds.length) {
    req.flash('error', 'Aucune donnée reçue. Rechargez la page et recommencez.');
    return res.redirect('/stocks/receptions/' + req.params.id);
  }

  const lignesRaw = db.prepare(`SELECT ld.*, p.designation, p.reference
                                FROM ligne_distribution ld
                                JOIN produit p ON p.id = ld.produit_id
                                WHERE ld.distribution_id = ?`).all(distribution.id);
  const lignesMap = new Map(lignesRaw.map(l => [Number(l.id), l]));

  // Construire la liste ordonnée avec les valeurs soumises
  const submitted = ligneIds.map((rawId, i) => {
    const id = Number(rawId);
    const l = lignesMap.get(id);
    return { id, ligne: l, qteRaw: quantites[i], motif: (motifsArr[i] || '').trim(), idx: i + 1 };
  });

  // Validation préalable
  const ecartsSansMotif = [];
  const SEUIL_ECART = 0.01;
  for (const s of submitted) {
    if (!s.ligne) throw new Error(`Ligne ${s.idx} introuvable (id ${s.id})`);
    let raw = s.qteRaw;
    if (raw === undefined || raw === null || String(raw).trim() === '') raw = s.ligne.quantite_annoncee;
    const q = Number(String(raw).replace(',', '.'));
    if (Number.isNaN(q)) { req.flash('error', `Quantité invalide ligne ${s.idx} "${s.ligne.designation}".`); return res.redirect('/stocks/receptions/' + req.params.id); }
    s.q = q;
    const ecart = q - s.ligne.quantite_annoncee;
    if (Math.abs(ecart) > SEUIL_ECART && !s.motif) {
      ecartsSansMotif.push(`Ligne ${s.idx} — « ${s.ligne.designation} » : ${s.ligne.quantite_annoncee} annoncé, ${q} reçu — motif obligatoire`);
    }
  }
  if (ecartsSansMotif.length) {
    req.flash('error', 'Écarts sans motif : ' + ecartsSansMotif.join(' ; '));
    return res.redirect('/stocks/receptions/' + req.params.id);
  }

  db.transaction(() => {
    for (const s of submitted) {
      const l = s.ligne;
      db.prepare('UPDATE ligne_distribution SET quantite_recue = ?, motif_ecart = ? WHERE id = ?').run(s.q, s.motif, l.id);
      if (s.q > 0) {
        const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(l.produit_id);
        const stockApres = produit.stock_actuel + s.q;
        db.prepare(`INSERT INTO mouvement_stock
                    (activite_id, produit_id, type, quantite, motif, reference_doc, stock_avant, stock_apres, utilisateur_id, date_mouvement, ligne_distribution_id)
                    VALUES (?, ?, 'ENTREE', ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
          .run(req.activiteId, l.produit_id, s.q,
               `Réception distribution ${distribution.numero}${s.motif ? ' — ' + s.motif : ''}`,
               distribution.numero, produit.stock_actuel, stockApres, req.user.id, l.id);
        db.prepare('UPDATE produit SET stock_actuel = ?, modifie_le = datetime(\'now\') WHERE id = ?').run(stockApres, l.produit_id);
      }
    }
    db.prepare(`UPDATE distribution SET statut = 'RECEPTIONNEE', receptionne_par_id = ?, date_reception = datetime('now') WHERE id = ?`)
      .run(req.user.id, distribution.id);
  })();
  req.flash('success', `Réception confirmée — les stocks ont été mis à jour.`);
  res.redirect('/stocks/receptions/');
});

// Refuser la réception (produit erroné, casse totale, etc.)
router.post('/receptions/:id(\\d+)/refuser', requireEcriture, (req, res) => {
  const { motif = '' } = req.body;
  if (!motif) { req.flash('error', 'Un motif de refus est obligatoire.'); return res.redirect('/stocks/receptions/' + req.params.id); }
  db.prepare(`UPDATE distribution SET statut = 'REFUSEE', motif_refus = ?, receptionne_par_id = ?, date_reception = datetime('now')
              WHERE id = ? AND activite_id = ? AND statut = 'REMISE'`)
    .run(motif, req.user.id, req.params.id, req.activiteId);
  req.flash('warning', 'Réception refusée — Nestor et la Direction en sont informés.');
  res.redirect('/stocks/receptions/');
});

// =========================================================
// MOUVEMENTS (filtrés par activité)
// =========================================================
router.get('/mouvements/', requireEcriture, (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type || '';
  const source = (req.query.source || '').toLowerCase();
  const periode = h.resoudrePeriode(req.query);
  const filtres = ['m.activite_id = ?'];
  const params = [req.activiteId];
  if (q) { filtres.push('(p.designation LIKE ? OR p.reference LIKE ? OR m.motif LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (type) { filtres.push('m.type = ?'); params.push(type); }
  if (periode.debut) { filtres.push('date(m.date_mouvement) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(m.date_mouvement) <= date(?)'); params.push(periode.fin); }
  if (source === 'reception') filtres.push("(m.motif LIKE 'Réception%' OR m.reference_doc LIKE 'DIST-%')");
  else if (source === 'production') filtres.push("(m.motif LIKE 'Production%' OR m.reference_doc LIKE 'FAB-%')");
  else if (source === 'vente') filtres.push("(m.motif LIKE 'Vente%' OR m.motif LIKE 'Livraison%' OR m.reference_doc LIKE 'TIC-%' OR m.reference_doc LIKE 'BL-%')");
  else if (source === 'ajustement') filtres.push("m.type IN ('AJUST_P', 'AJUST_M', 'PERTE', 'RETOUR')");

  const p = h.pagination(req, 50);
  const totalMvt = db.prepare(`SELECT COUNT(*) AS n FROM mouvement_stock m
                                JOIN produit p ON p.id = m.produit_id
                                WHERE ${filtres.join(' AND ')}`).get(...params).n;
  const mouvements = db.prepare(`SELECT m.*, p.designation, p.reference, u.username
                                 FROM mouvement_stock m
                                 JOIN produit p ON p.id = m.produit_id
                                 LEFT JOIN utilisateur u ON u.id = m.utilisateur_id
                                 WHERE ${filtres.join(' AND ')}
                                 ORDER BY m.date_mouvement DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);

  // Catégoriser chaque mouvement par sa source (pour affichage badge)
  const categoriser = (m) => {
    if (m.motif && m.motif.startsWith('Production')) return { code: 'production', label: 'Production', couleur: '#CA8A04', bg: '#FEF3C7', icone: 'bi-fire' };
    if (m.motif && m.motif.startsWith('Réception')) return { code: 'reception', label: 'Réception distribution', couleur: '#2563EB', bg: '#EFF6FF', icone: 'bi-truck' };
    if (m.motif && m.motif.startsWith('Vente')) return { code: 'vente', label: 'Vente B2C', couleur: '#059669', bg: '#ECFDF5', icone: 'bi-cart-check' };
    if (m.motif && m.motif.startsWith('Livraison')) return { code: 'vente', label: 'Livraison B2B', couleur: '#059669', bg: '#ECFDF5', icone: 'bi-truck' };
    if (['AJUST_P', 'AJUST_M', 'PERTE', 'RETOUR'].includes(m.type)) return { code: 'ajustement', label: 'Ajustement', couleur: '#DC2626', bg: '#FEF2F2', icone: 'bi-arrow-repeat' };
    return { code: 'autre', label: 'Autre', couleur: '#64748B', bg: '#F1F5F9', icone: 'bi-dot' };
  };

  const groupes = new Map();
  const now = new Date();
  for (const m of mouvements) {
    const jour = m.date_mouvement.substring(0, 10);
    if (!groupes.has(jour)) {
      const d = new Date(jour);
      const delta = Math.floor((new Date(now.toISOString().slice(0, 10)) - d) / 86400000);
      let label = delta === 0 ? "Aujourd'hui" : delta === 1 ? 'Hier' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      groupes.set(jour, { date: jour, label, mouvements: [], nb_entrees: 0, nb_sorties: 0, nb_ajust: 0, qte_entrees: 0, qte_sorties: 0 });
    }
    const g = groupes.get(jour);
    g.mouvements.push({
      ...m,
      type_label: h.TYPE_MOUVEMENT_LABEL[m.type] || m.type,
      signe: ['ENTREE', 'AJUST_P', 'RETOUR'].includes(m.type) ? 1 : -1,
      source_info: categoriser(m),
    });
    if (m.type === 'ENTREE') { g.nb_entrees++; g.qte_entrees += m.quantite; }
    else if (m.type === 'SORTIE') { g.nb_sorties++; g.qte_sorties += m.quantite; }
    else g.nb_ajust++;
  }
  res.render('stocks/mouvements', {
    title: 'Mouvements', page_title: `Mouvements — ${req.activite.nom}`,
    groupes: Array.from(groupes.values()), types: h.TYPES_MOUVEMENT_CHOICES,
    q, type_filtre: type, source_filtre: source, periode,
    pagination: h.paginationInfo(p, totalMvt, req),
  });
});

router.get('/mouvements/nouveau', requireEcriture, (req, res) => {
  const produits = db.prepare(`SELECT p.*, c.nom AS categorie_nom FROM produit p
                               LEFT JOIN categorie c ON c.id = p.categorie_id
                               WHERE p.activite_id = ? AND p.actif = 1 ORDER BY p.designation`).all(req.activiteId).map(h.enrichirProduit);
  res.render('stocks/mouvement_form', {
    title: 'Nouveau mouvement', page_title: 'Nouveau mouvement de stock',
    produits, types: h.TYPES_MOUVEMENT_CHOICES, mvt: { type: 'ENTREE', quantite: 1 },
  });
});

router.post('/mouvements/nouveau', requireEcriture, (req, res) => {
  const { produit_id, type, quantite, motif = '', reference_doc = '' } = req.body;
  // Vérifier que le produit appartient à l'activité
  const p = db.prepare('SELECT id FROM produit WHERE id = ? AND activite_id = ?').get(produit_id, req.activiteId);
  if (!p) { req.flash('error', 'Produit hors de votre activité.'); return res.redirect('/stocks/mouvements/'); }
  try {
    db.transaction(() => {
      h.appliquerMouvement(db, {
        produit_id: Number(produit_id), type, quantite: Number(quantite),
        motif, reference_doc, utilisateur_id: req.user.id,
      });
    })();
    req.flash('success', 'Mouvement enregistré.');
  } catch (e) { console.error(e); req.flash('error', 'Erreur : ' + e.message); }
  res.redirect('/stocks/mouvements/');
});

router.get('/mouvements/:id(\\d+)', requireEcriture, (req, res) => {
  const mvt = db.prepare(`SELECT m.*, p.designation, p.reference, u.username
                          FROM mouvement_stock m
                          JOIN produit p ON p.id = m.produit_id
                          LEFT JOIN utilisateur u ON u.id = m.utilisateur_id
                          WHERE m.id = ? AND m.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!mvt) return res.redirect('/stocks/mouvements/');
  mvt.type_label = h.TYPE_MOUVEMENT_LABEL[mvt.type] || mvt.type;
  const vente = mvt.reference_doc ? db.prepare('SELECT * FROM vente WHERE numero = ?').get(mvt.reference_doc) : null;
  res.render('stocks/mouvement_detail', { title: 'Mouvement', page_title: 'Détail mouvement', mvt, vente });
});

// =========================================================
// ALERTES (filtrées par périmètre : distribution voit toutes)
// =========================================================
router.get('/alertes/', (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const placeholders = ids.map(() => '?').join(',');
  const etat = req.query.etat || 'non_vues';
  let where = `a.activite_id IN (${placeholders})`;
  const params = [...ids];
  if (etat === 'non_vues') where += ' AND a.vue = 0';
  else if (etat === 'vues') where += ' AND a.vue = 1';
  // Tri : recent (défaut) / ancien / priorite / activite
  const tri = ['recent', 'ancien', 'priorite', 'activite'].includes(req.query.tri) ? req.query.tri : 'recent';
  const orderBy = {
    recent:    'a.creee_le DESC',
    ancien:    'a.creee_le ASC',
    priorite:  `CASE a.niveau WHEN 'CRITIQUE' THEN 0 WHEN 'ALERTE' THEN 1 WHEN 'INFO' THEN 2 ELSE 3 END, a.creee_le DESC`,
    activite:  'act.nom, a.creee_le DESC',
  }[tri];
  const p = h.pagination(req);
  const nbTotal = db.prepare(`SELECT COUNT(*) AS n FROM alerte a WHERE ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT a.*, p.designation, p.reference, p.stock_actuel, p.stock_minimum, p.stock_maximum, p.prix_achat,
                                  c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom, f.delai_livraison_jours,
                                  act.nom AS activite_nom, act.code AS activite_code, act.couleur AS activite_couleur
                           FROM alerte a
                           JOIN produit p ON p.id = a.produit_id
                           JOIN activite act ON act.id = a.activite_id
                           LEFT JOIN categorie c ON c.id = p.categorie_id
                           LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                           WHERE ${where}
                           ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  const pagination = h.paginationInfo(p, nbTotal, req);
  const debut_30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const debut_7j = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const alertes_enrichies = rows.map(a => {
    const v30 = db.prepare(`SELECT COALESCE(SUM(lv.quantite),0) AS n FROM ligne_vente lv JOIN vente v ON v.id=lv.vente_id
      WHERE lv.produit_id = ? AND date(v.date_vente) >= ?`).get(a.produit_id, debut_30j).n;
    const v7 = db.prepare(`SELECT COALESCE(SUM(lv.quantite),0) AS n FROM ligne_vente lv JOIN vente v ON v.id=lv.vente_id
      WHERE lv.produit_id = ? AND date(v.date_vente) >= ?`).get(a.produit_id, debut_7j).n;
    const conso_jour = v30 ? +(v30 / 30).toFixed(2) : 0;
    const jours_avant_rupture = conso_jour > 0 ? Math.max(Math.floor(a.stock_actuel / conso_jour), 0) : null;
    const delai_fournisseur = a.delai_livraison_jours || 7;
    let urgence = a.stock_actuel <= 0 ? 'critique' : 'moyenne';
    if (jours_avant_rupture !== null && jours_avant_rupture < delai_fournisseur) urgence = 'critique';
    else if (jours_avant_rupture !== null && jours_avant_rupture < delai_fournisseur * 2) urgence = 'haute';
    // Parser le contexte JSON si présent (source CUISINE notamment)
    let contexte = null;
    if (a.contexte_json) {
      try { contexte = JSON.parse(a.contexte_json); } catch (e) { contexte = null; }
    }
    return {
      alerte: a,
      produit: h.enrichirProduit({ id: a.produit_id, designation: a.designation, reference: a.reference, stock_actuel: a.stock_actuel, stock_minimum: a.stock_minimum, stock_maximum: a.stock_maximum, prix_achat: a.prix_achat, categorie_nom: a.categorie_nom }),
      activite: { nom: a.activite_nom, code: a.activite_code, couleur: a.activite_couleur },
      fournisseur: a.fournisseur_nom ? { raison_sociale: a.fournisseur_nom } : null,
      conso_jour, sorties_7j: v7, jours_avant_rupture, delai_fournisseur,
      qte_recommandee: Math.max(a.stock_maximum - a.stock_actuel, 1),
      urgence,
      contexte,
    };
  });
  const cnt = (level, vue) => db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id IN (${placeholders}) AND niveau = ? AND vue = ?`).get(...ids, level, vue).n;
  res.render('stocks/alertes', {
    title: 'Alertes', page_title: h.isDistribution(req.user) ? 'Alertes — toutes activités' : `Alertes — ${req.activite.nom}`,
    alertes_enrichies, etat, tri, pagination,
    nb_critiques: cnt('CRITIQUE', 0), nb_alertes: cnt('ALERTE', 0), nb_info: cnt('INFO', 0),
    nb_non_vues: db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id IN (${placeholders}) AND vue = 0`).get(...ids).n,
    nb_vues_total: db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id IN (${placeholders}) AND vue = 1`).get(...ids).n,
    nb_total: db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE activite_id IN (${placeholders})`).get(...ids).n,
  });
});

router.get('/alertes/:id(\\d+)/vue', requireEcriture, (req, res) => {
  db.prepare(`UPDATE alerte SET vue = 1, vue_le = datetime('now'), vue_par_id = ? WHERE id = ? AND vue = 0`)
    .run(req.user.id, req.params.id);
  req.flash('info', 'Alerte marquée comme vue.');
  res.redirect('/stocks/alertes/');
});

// Détail d'une alerte (utile pour alertes CUISINE avec contexte complet)
router.get('/alertes/:id(\\d+)', (req, res) => {
  const a = db.prepare(`SELECT a.*, p.designation, p.reference, p.stock_actuel, p.unite, p.prix_achat,
                              act.nom AS activite_nom, act.couleur AS activite_couleur,
                              u.first_name AS vue_par_prenom, u.username AS vue_par_username
                       FROM alerte a
                       JOIN produit p ON p.id = a.produit_id
                       JOIN activite act ON act.id = a.activite_id
                       LEFT JOIN utilisateur u ON u.id = a.vue_par_id
                       WHERE a.id = ?`).get(req.params.id);
  if (!a) { req.flash('warning', 'Alerte introuvable.'); return res.redirect('/stocks/alertes/'); }
  // Vérifier accès à l'activité
  const ids = h.activitesAccessibles(db, req.user);
  if (!ids.includes(a.activite_id)) { req.flash('error', 'Accès refusé.'); return res.redirect('/stocks/alertes/'); }
  let contexte = null;
  if (a.contexte_json) { try { contexte = JSON.parse(a.contexte_json); } catch (e) {} }
  // Si contexte cuisine : charger la fiche technique complète du produit fini
  let fiche = null;
  if (contexte && contexte.produit_fini_id) {
    fiche = db.prepare('SELECT ft.* FROM fiche_technique ft WHERE ft.produit_id = ?').get(contexte.produit_fini_id);
    if (fiche) {
      fiche.composition = db.prepare(`SELECT cf.*, p.designation, p.unite, p.stock_actuel, p.prix_achat
                                      FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                      WHERE cf.fiche_id = ? ORDER BY p.designation`).all(fiche.id);
    }
  }
  res.render('stocks/alerte_detail', {
    title: 'Détail alerte', page_title: 'Alerte ' + (a.niveau === 'CRITIQUE' ? '🚨' : '⚠️') + ' #' + a.id,
    alerte: a, contexte, fiche,
  });
});

// =========================================================
// ETAT DU STOCK (filtré par périmètre)
// =========================================================
router.get('/etat/', (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const placeholders = ids.map(() => '?').join(',');
  const typeFiltre = (req.query.type || '').toUpperCase();
  const rows = db.prepare(`SELECT p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom, a.nom AS activite_nom, a.code AS activite_code
                           FROM produit p
                           LEFT JOIN categorie c ON c.id = p.categorie_id
                           LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                           JOIN activite a ON a.id = p.activite_id
                           WHERE p.activite_id IN (${placeholders})
                           ORDER BY a.id, p.designation`).all(...ids).map(h.enrichirProduit);
  // Ajout du type de produit (par activité)
  const typesParActivite = new Map();
  for (const aid of ids) typesParActivite.set(aid, h.getTypesProduits(db, aid));
  let produits = rows.map(p => ({ ...p, type_produit: typesParActivite.get(p.activite_id)?.get(p.id) || 'CONSOMMABLE' }));
  const compteursTypes = { PRODUIT_FINI: 0, INGREDIENT: 0, REVENTE: 0, CONSOMMABLE: 0 };
  for (const p of produits) if (compteursTypes[p.type_produit] !== undefined) compteursTypes[p.type_produit]++;
  if (['PRODUIT_FINI', 'INGREDIENT', 'REVENTE', 'CONSOMMABLE'].includes(typeFiltre)) {
    produits = produits.filter(p => p.type_produit === typeFiltre);
  }
  const total_valeur = produits.reduce((s, p) => s + p.valeur_stock, 0);
  const nb_rupture = produits.filter(p => p.en_rupture).length;
  const nb_alerte = produits.filter(p => p.en_alerte && !p.en_rupture).length;
  res.render('stocks/etat_stock', {
    title: 'État du stock', page_title: h.isDistribution(req.user) ? 'État du stock — toutes activités' : `État du stock — ${req.activite.nom}`,
    produits, total_valeur, nb_rupture, nb_alerte,
    types_produit: h.TYPE_PRODUIT, compteurs_types: compteursTypes, type_filtre: typeFiltre,
  });
});

// =========================================================
// INVENTAIRES (par activité)
// =========================================================
router.get('/inventaires/', requireEcriture, (req, res) => {
  const p = h.pagination(req);
  const totalInv = db.prepare('SELECT COUNT(*) AS n FROM inventaire WHERE activite_id = ?').get(req.activiteId).n;
  const inventaires = db.prepare(`SELECT i.*,
      cp.username AS cree_par_username, cp.first_name AS cree_par_prenom, cp.last_name AS cree_par_nom,
      vp.username AS valide_par_username, cat.nom AS categorie_nom,
      (SELECT COUNT(*) FROM ligne_inventaire WHERE inventaire_id = i.id) AS nb_lignes,
      (SELECT COUNT(*) FROM ligne_inventaire WHERE inventaire_id = i.id AND stock_physique IS NOT NULL) AS nb_comptees,
      (SELECT COUNT(*) FROM ligne_inventaire WHERE inventaire_id = i.id AND stock_physique IS NOT NULL AND stock_physique != stock_theorique) AS nb_ecarts
    FROM inventaire i
    LEFT JOIN utilisateur cp ON cp.id = i.cree_par_id
    LEFT JOIN utilisateur vp ON vp.id = i.valide_par_id
    LEFT JOIN categorie cat ON cat.id = i.categorie_id
    WHERE i.activite_id = ?
    ORDER BY i.date_creation DESC LIMIT ? OFFSET ?`).all(req.activiteId, p.taille, p.offset);
  const enrichis = inventaires.map(i => ({
    ...i,
    statut_label: h.STATUT_INVENTAIRE_LABEL[i.statut] || i.statut,
    progression_pct: i.nb_lignes ? Math.round(i.nb_comptees * 100 / i.nb_lignes) : 0,
  }));
  res.render('stocks/inventaire_liste', {
    title: 'Inventaires', page_title: `Inventaires — ${req.activite.nom}`,
    inventaires: enrichis,
    nb_en_cours: enrichis.filter(i => i.statut === 'EN_COURS').length,
    nb_valides: enrichis.filter(i => i.statut === 'VALIDE').length,
    pagination: h.paginationInfo(p, totalInv, req),
  });
});

router.get('/inventaires/nouveau', requireEcriture, (req, res) => {
  const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  res.render('stocks/inventaire_creer', { title: 'Nouvel inventaire', page_title: 'Nouvel inventaire', categories });
});

router.post('/inventaires/nouveau', requireEcriture, (req, res) => {
  const { libelle = '', categorie = '', notes = '' } = req.body;
  const now = new Date();
  const label = libelle || `Inventaire du ${now.toLocaleDateString('fr-FR')}`;
  const codeActivite = req.activite.code;
  const ref = h.prochaineReferenceInventaire(db, codeActivite);
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO inventaire (activite_id, reference, libelle, statut, categorie_id, cree_par_id, notes)
                             VALUES (?, ?, ?, 'EN_COURS', ?, ?, ?)`)
      .run(req.activiteId, ref, label, categorie || null, req.user.id, notes);
    const inventaireId = Number(info.lastInsertRowid);
    // Exclut les produits système (frais de livraison) — pas d'inventaire physique à faire
    const prods = categorie
      ? db.prepare("SELECT * FROM produit WHERE activite_id = ? AND actif = 1 AND categorie_id = ? AND (reference IS NULL OR reference NOT LIKE 'FRAIS-%')").all(req.activiteId, categorie)
      : db.prepare("SELECT * FROM produit WHERE activite_id = ? AND actif = 1 AND (reference IS NULL OR reference NOT LIKE 'FRAIS-%')").all(req.activiteId);
    const insLigne = db.prepare('INSERT INTO ligne_inventaire (inventaire_id, produit_id, stock_theorique) VALUES (?, ?, ?)');
    for (const p of prods) insLigne.run(inventaireId, p.id, p.stock_actuel);
    return inventaireId;
  })();
  req.flash('success', `Inventaire ${ref} démarré.`);
  res.redirect('/stocks/inventaires/' + id);
});

router.get('/inventaires/:id(\\d+)', requireEcriture, (req, res) => {
  const inventaire = db.prepare(`SELECT i.*, cp.username AS cree_par_username, cp.first_name AS cree_par_prenom, cp.last_name AS cree_par_nom,
      vp.username AS valide_par_username, cat.nom AS categorie_nom
    FROM inventaire i
    LEFT JOIN utilisateur cp ON cp.id = i.cree_par_id
    LEFT JOIN utilisateur vp ON vp.id = i.valide_par_id
    LEFT JOIN categorie cat ON cat.id = i.categorie_id
    WHERE i.id = ? AND i.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!inventaire) return res.redirect('/stocks/inventaires/');
  const q = (req.query.q || '').trim();
  const etat_filtre = req.query.etat || '';
  const params = [req.params.id];
  const filtres = ['inventaire_id = ?'];
  if (q) { filtres.push('(p.designation LIKE ? OR p.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (etat_filtre === 'non_compte') filtres.push('li.stock_physique IS NULL');
  else if (etat_filtre === 'ok') filtres.push('li.stock_physique IS NOT NULL AND li.stock_physique = li.stock_theorique');
  else if (etat_filtre === 'ecart') filtres.push('li.stock_physique IS NOT NULL AND li.stock_physique != li.stock_theorique');
  const lignes = db.prepare(`SELECT li.*, p.designation, p.reference, c.nom AS categorie_nom
                             FROM ligne_inventaire li JOIN produit p ON p.id = li.produit_id
                             LEFT JOIN categorie c ON c.id = p.categorie_id
                             WHERE ${filtres.join(' AND ')} ORDER BY p.designation`).all(...params);
  const totalLignes = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ?').get(req.params.id).n;
  const nbComptees = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ? AND stock_physique IS NOT NULL').get(req.params.id).n;
  const nbEcarts = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ? AND stock_physique IS NOT NULL AND stock_physique != stock_theorique').get(req.params.id).n;
  inventaire.statut_label = h.STATUT_INVENTAIRE_LABEL[inventaire.statut];
  inventaire.nb_lignes = totalLignes; inventaire.nb_comptees = nbComptees; inventaire.nb_ecarts = nbEcarts;
  inventaire.progression_pct = totalLignes ? Math.round(nbComptees * 100 / totalLignes) : 0;
  lignes.forEach(l => {
    if (l.stock_physique === null || l.stock_physique === undefined) l.etat = 'NON_COMPTE';
    else if (l.stock_physique === l.stock_theorique) l.etat = 'OK';
    else l.etat = l.stock_physique > l.stock_theorique ? 'ECART_PLUS' : 'ECART_MOINS';
    l.ecart = (l.stock_physique === null || l.stock_physique === undefined) ? 0 : l.stock_physique - l.stock_theorique;
  });
  res.render('stocks/inventaire_detail', {
    title: 'Inventaire ' + inventaire.reference, page_title: 'Inventaire ' + inventaire.reference,
    inventaire, lignes, q, etat_filtre,
  });
});

router.post('/inventaires/:id(\\d+)/saisir', requireEcriture, express.json(), (req, res) => {
  const inv = db.prepare('SELECT * FROM inventaire WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!inv) return res.status(404).json({ erreur: 'Inventaire introuvable' });
  if (inv.statut !== 'EN_COURS') return res.status(400).json({ erreur: 'L\'inventaire n\'est plus en cours' });
  const { ligne_id, stock_physique, motif = '' } = req.body;
  const ligne = db.prepare('SELECT * FROM ligne_inventaire WHERE id = ? AND inventaire_id = ?').get(ligne_id, req.params.id);
  if (!ligne) return res.status(404).json({ erreur: 'Ligne introuvable' });
  if (stock_physique === null || stock_physique === '' || stock_physique === undefined) {
    db.prepare('UPDATE ligne_inventaire SET stock_physique = NULL, motif_ecart = ?, compte_le = NULL, compte_par_id = NULL WHERE id = ?').run('', ligne.id);
  } else {
    const val = Math.max(parseInt(stock_physique, 10), 0);
    if (Number.isNaN(val)) return res.status(400).json({ erreur: 'Quantité invalide' });
    db.prepare(`UPDATE ligne_inventaire SET stock_physique = ?, motif_ecart = ?, compte_le = datetime('now'), compte_par_id = ? WHERE id = ?`)
      .run(val, motif, req.user.id, ligne.id);
  }
  const l2 = db.prepare('SELECT * FROM ligne_inventaire WHERE id = ?').get(ligne.id);
  const totalLignes = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ?').get(req.params.id).n;
  const nbComptees = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ? AND stock_physique IS NOT NULL').get(req.params.id).n;
  const nbEcarts = db.prepare('SELECT COUNT(*) AS n FROM ligne_inventaire WHERE inventaire_id = ? AND stock_physique IS NOT NULL AND stock_physique != stock_theorique').get(req.params.id).n;
  const ecart = (l2.stock_physique === null) ? 0 : l2.stock_physique - l2.stock_theorique;
  let etat = 'NON_COMPTE';
  if (l2.stock_physique !== null && l2.stock_physique !== undefined) etat = l2.stock_physique === l2.stock_theorique ? 'OK' : (l2.stock_physique > l2.stock_theorique ? 'ECART_PLUS' : 'ECART_MOINS');
  res.json({
    id: l2.id, stock_theorique: l2.stock_theorique, stock_physique: l2.stock_physique, ecart, etat,
    nb_comptees: nbComptees, nb_lignes: totalLignes, nb_ecarts: nbEcarts,
    progression: totalLignes ? Math.round(nbComptees * 100 / totalLignes) : 0,
  });
});

router.post('/inventaires/:id(\\d+)/valider', requireEcriture, (req, res) => {
  const inv = db.prepare('SELECT * FROM inventaire WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!inv || inv.statut !== 'EN_COURS') return res.redirect('/stocks/inventaires/' + req.params.id);
  const lignes = db.prepare('SELECT * FROM ligne_inventaire WHERE inventaire_id = ? AND stock_physique IS NOT NULL').all(req.params.id);
  const nbAjust = db.transaction(() => {
    let nb = 0;
    for (const l of lignes) {
      const ecart = l.stock_physique - l.stock_theorique;
      if (ecart === 0) continue;
      h.appliquerMouvement(db, {
        produit_id: l.produit_id, type: ecart > 0 ? 'AJUST_P' : 'AJUST_M', quantite: Math.abs(ecart),
        motif: `Inventaire ${inv.reference} — ${l.motif_ecart || 'écart constaté'}`,
        reference_doc: inv.reference, utilisateur_id: req.user.id,
      });
      nb++;
    }
    db.prepare(`UPDATE inventaire SET statut = 'VALIDE', valide_par_id = ?, date_validation = datetime('now') WHERE id = ?`)
      .run(req.user.id, req.params.id);
    return nb;
  })();
  req.flash('success', `Inventaire ${inv.reference} validé — ${nbAjust} ajustement(s).`);
  res.redirect('/stocks/inventaires/' + req.params.id);
});

router.get('/inventaires/:id(\\d+)/annuler', requireEcriture, (req, res) => {
  db.prepare(`UPDATE inventaire SET statut = 'ANNULE' WHERE id = ? AND activite_id = ? AND statut = 'EN_COURS'`)
    .run(req.params.id, req.activiteId);
  req.flash('info', 'Inventaire annulé.');
  res.redirect('/stocks/inventaires/');
});

router.post('/inventaires/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const inv = db.prepare('SELECT * FROM inventaire WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!inv) return res.redirect('/stocks/inventaires/');
  if (inv.statut === 'VALIDE') { req.flash('warning', 'Un inventaire validé ne peut pas être supprimé.'); return res.redirect('/stocks/inventaires/' + req.params.id); }
  db.prepare('DELETE FROM inventaire WHERE id = ? AND activite_id = ?').run(req.params.id, req.activiteId);
  req.flash('success', `Inventaire ${inv.reference} supprimé.`);
  res.redirect('/stocks/inventaires/');
});

module.exports = router;
