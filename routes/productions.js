// Ordres de production (bons de fabrication)
// Convertit X ingrédients → Y produits finis au stock, en s'appuyant sur les fiches techniques
const express = require('express');
const PDFDocument = require('pdfkit');

const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
// Enforcement basé sur permissions cuisine.
// `requireEcriture` autorise si l'utilisateur peut créer OU terminer une production (cuisinier / gestionnaire).
function requireEcriture(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'cuisine.production.creer', req.activiteId) ||
      h.utilisateurPeut(db, req.user, 'cuisine.production.terminer', req.activiteId) ||
      h.utilisateurPeut(db, req.user, 'cuisine.production.valider', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas de permission d'écriture sur les productions de cette activité.");
  return res.redirect('/tableau-de-bord/');
}
// Validation de la sortie ingrédients → permission dédiée
function requireGestionnaireStock(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'cuisine.production.valider', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission « Valider la sortie d'ingrédients ».");
  return res.redirect('/productions/');
}
// Lecture requise pour tout le module
router.use(requireActivite, h.permissionRequise(db, 'cuisine.recettes.lire'));

// =========================================================
// LISTE
// =========================================================
router.get('/', (req, res) => {
  const periode = h.resoudrePeriode(req.query);
  const statutFiltre = String(req.query.statut || '').toUpperCase();
  const filtres = ['p.activite_id = ?'];
  const params = [req.activiteId];
  if (periode.debut) { filtres.push('date(p.date_production) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(p.date_production) <= date(?)'); params.push(periode.fin); }
  // Clause SQL identifiant les productions avec perte réelle
  const CLAUSE_PERTES = `((COALESCE(p.statut,'TERMINEE') = 'TERMINEE' AND p.motif_annulation LIKE 'Perte cuisson%')
                          OR (p.statut = 'ANNULEE' AND p.motif_annulation LIKE 'Annulation perte totale%'))`;
  if (['BROUILLON', 'EN_COURS', 'TERMINEE', 'ANNULEE'].includes(statutFiltre)) {
    filtres.push('COALESCE(p.statut, ?) = ?');
    params.push('TERMINEE', statutFiltre);
  } else if (statutFiltre === 'PERTES') {
    filtres.push(CLAUSE_PERTES);
  }
  const pgn = h.pagination(req);
  const totalProd = db.prepare(`SELECT COUNT(*) AS n FROM production p WHERE ${filtres.join(' AND ')}`).get(...params).n;
  const productions = db.prepare(`SELECT p.*, prod.designation AS produit_nom, prod.unite AS produit_unite, prod.reference AS produit_ref,
                                         u.first_name AS auteur_prenom, u.username AS auteur_username,
                                         cw.code_suivi AS web_code, cw.client_nom AS web_client
                                  FROM production p
                                  JOIN produit prod ON prod.id = p.produit_id
                                  LEFT JOIN utilisateur u ON u.id = p.produit_par_id
                                  LEFT JOIN commande_client_web cw ON cw.id = p.commande_web_id
                                  WHERE ${filtres.join(' AND ')}
                                  ORDER BY CASE COALESCE(p.statut,'TERMINEE') WHEN 'BROUILLON' THEN 0 WHEN 'EN_COURS' THEN 1 WHEN 'TERMINEE' THEN 2 ELSE 3 END,
                                           p.date_production DESC LIMIT ? OFFSET ?`).all(...params, pgn.taille, pgn.offset);
  // KPIs par statut
  const statsRows = db.prepare(`SELECT COALESCE(statut, 'TERMINEE') AS s, COUNT(*) AS n
                                FROM production WHERE activite_id = ? GROUP BY COALESCE(statut, 'TERMINEE')`).all(req.activiteId);
  const stats = { BROUILLON: 0, EN_COURS: 0, TERMINEE: 0, ANNULEE: 0 };
  for (const r of statsRows) { if (stats[r.s] !== undefined) stats[r.s] = r.n; }
  // Compteur des productions ratées (toutes périodes) et coût des pertes sur 30j
  const nbPertes = db.prepare(`SELECT COUNT(*) AS n FROM production p
                               WHERE p.activite_id = ? AND ${CLAUSE_PERTES}`).get(req.activiteId).n;
  stats.PERTES = nbPertes;
  const pertes30j = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(p.cout_matiere), 0) AS cout
                                FROM production p WHERE p.activite_id = ? AND ${CLAUSE_PERTES}
                                  AND date(COALESCE(p.date_fin, p.date_production)) >= date('now','-30 day')`).get(req.activiteId);
  const kpi = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(quantite_produite), 0) AS qte, COALESCE(SUM(cout_matiere), 0) AS cout
                          FROM production WHERE activite_id = ? AND COALESCE(statut,'TERMINEE')='TERMINEE' AND date(date_production) >= date('now', '-30 day')`).get(req.activiteId);
  // Notifications cuisinier : ses productions récemment validées ou refusées non encore consultées
  let notifsCuisinier = [];
  if (h.isCuisinier(req.user)) {
    notifsCuisinier = db.prepare(`SELECT p.id, p.numero, p.statut, p.motif_annulation, p.date_validation, p.date_fin,
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
                                  ORDER BY COALESCE(p.date_validation, p.date_fin) DESC LIMIT 10`).all(req.activiteId, req.user.id);
  }
  res.render('productions/liste', {
    title: 'Ordres de production', page_title: `Production — ${req.activite.nom}`,
    productions, kpi, stats, pertes_30j: pertes30j, statut_filtre: statutFiltre, periode, notifs_cuisinier: notifsCuisinier,
    pagination: h.paginationInfo(pgn, totalProd, req),
  });
});

// =========================================================
// NOUVEAU BON DE FABRICATION
// =========================================================
router.get('/nouveau', requireEcriture, (req, res) => {
  // Produits finis ayant une fiche technique active
  const produitsFabricables = db.prepare(`SELECT p.id, p.designation, p.reference, p.unite, p.stock_actuel, p.prix_vente,
                                                 ft.id AS fiche_id, ft.rendement
                                          FROM produit p
                                          JOIN fiche_technique ft ON ft.produit_id = p.id
                                          WHERE p.activite_id = ? AND p.actif = 1 AND ft.actif = 1
                                          ORDER BY p.designation`).all(req.activiteId);
  // Pré-sélection si ?produit_id=... est fourni (venant de la page Recettes)
  const preSelectId = Number(req.query.produit_id || 0);
  const preSelectQte = Number(req.query.quantite || 1) || 1;
  const preSelect = preSelectId && produitsFabricables.some(p => p.id === preSelectId)
    ? { produit_id: preSelectId, quantite: preSelectQte }
    : null;
  res.render('productions/nouveau', {
    title: 'Nouvel ordre de production', page_title: 'Nouvel ordre de production',
    produitsFabricables, preSelect,
  });
});

// AJAX : alerter le gestionnaire de stock des ingrédients manquants pour une production souhaitée
router.post('/api/alerter-manquants', express.json(), (req, res) => {
  const produitId = Number(req.body.produit_id || 0);
  const quantite = Number(String(req.body.quantite || '0').replace(',', '.'));
  const notes = String(req.body.notes || '').trim();
  if (!produitId || quantite <= 0) return res.status(400).json({ erreur: 'Paramètres invalides' });
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(produitId, req.activiteId);
  if (!produit) return res.status(404).json({ erreur: 'Produit introuvable' });
  const fiche = db.prepare(`SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1`).get(produit.id);
  if (!fiche) return res.status(400).json({ erreur: 'Aucune fiche technique active' });
  const composition = db.prepare(`SELECT cf.*, p.designation, p.unite, p.stock_actuel, p.stock_minimum
                                  FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                  WHERE cf.fiche_id = ?`).all(fiche.id);
  const rendement = Math.max(1, Number(fiche.rendement) || 1);
  const manquants = [];
  const insertAlerte = db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, source, message, contexte_json, vue, creee_le)
                                   VALUES (?, ?, 'CRITIQUE', 'CUISINE', ?, ?, 0, datetime('now'))`);
  for (const c of composition) {
    const qteNecessaire = Number(c.quantite) * quantite / rendement;
    if (Number(c.stock_actuel) < qteNecessaire) {
      const manque = qteNecessaire - Number(c.stock_actuel);
      const message = `Réappro urgent : ${h.formatDecimal(manque, 2)} ${c.unite} de « ${c.designation} » pour production ${quantite} × ${produit.designation}`;
      const contexte = JSON.stringify({
        produit_fini_id: produit.id,
        produit_fini_nom: produit.designation,
        produit_fini_ref: produit.reference,
        quantite_voulue: quantite,
        ingredient_id: c.ingredient_id,
        ingredient_nom: c.designation,
        ingredient_unite: c.unite,
        quantite_necessaire: qteNecessaire,
        stock_actuel: Number(c.stock_actuel),
        manque: manque,
        demandeur: req.user ? { id: req.user.id, nom: `${req.user.titre || ''} ${req.user.first_name || req.user.username}`.trim() } : null,
        notes: notes || null,
        date_demande: new Date().toISOString(),
      });
      insertAlerte.run(req.activiteId, c.ingredient_id, message, contexte);
      manquants.push({ ingredient: c.designation, manque: manque, unite: c.unite });
    }
  }
  // Trace journal audit
  h.journaliser(db, {
    user: req.user, activiteId: req.activiteId, action: 'RECEPTION_ECART',
    entite: 'production', entite_id: produit.id,
    details: `Alerte réappro : ${manquants.length} ingrédient(s) manquant(s) pour fabriquer ${quantite} × ${produit.designation}`,
  });
  res.json({ ok: true, nb_alertes: manquants.length, manquants });
});

// AJAX : renvoie les besoins ingrédients pour un produit fini + quantité
router.get('/api/besoins', (req, res) => {
  const produitId = Number(req.query.produit_id || 0);
  const qteVoulue = Number(String(req.query.quantite || '0').replace(',', '.'));
  if (!produitId || qteVoulue <= 0) return res.json({ erreur: 'Paramètres invalides' });
  const fiche = db.prepare(`SELECT ft.* FROM fiche_technique ft
                            JOIN produit p ON p.id = ft.produit_id
                            WHERE ft.produit_id = ? AND ft.actif = 1 AND p.activite_id = ?`).get(produitId, req.activiteId);
  if (!fiche) return res.json({ erreur: 'Aucune fiche technique active pour ce produit' });
  const rendement = Math.max(1, Number(fiche.rendement) || 1);
  const composition = db.prepare(`SELECT cf.*, p.designation, p.reference, p.unite, p.stock_actuel, p.prix_achat
                                  FROM composition_fiche cf
                                  JOIN produit p ON p.id = cf.ingredient_id
                                  WHERE cf.fiche_id = ? ORDER BY p.designation`).all(fiche.id);
  const besoins = composition.map(c => {
    const qteNecessaire = Number(c.quantite) * qteVoulue / rendement;
    const dispo = Number(c.stock_actuel);
    const suffisant = dispo >= qteNecessaire;
    return {
      ingredient_id: c.ingredient_id,
      designation: c.designation,
      reference: c.reference,
      unite: c.unite,
      quantite_necessaire: qteNecessaire,
      stock_actuel: dispo,
      suffisant,
      manque: suffisant ? 0 : (qteNecessaire - dispo),
      prix_achat: Number(c.prix_achat || 0),
      cout: qteNecessaire * Number(c.prix_achat || 0),
    };
  });
  const coutTotal = besoins.reduce((s, b) => s + b.cout, 0);
  const tousDisponibles = besoins.every(b => b.suffisant);
  res.json({ besoins, cout_total: coutTotal, tous_disponibles: tousDisponibles });
});

router.post('/nouveau', requireEcriture, (req, res) => {
  const produitId = Number(req.body.produit_id || 0);
  const quantite = Number(String(req.body.quantite || '0').replace(',', '.'));
  const notes = req.body.notes || '';
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(produitId, req.activiteId);
  if (!produit) { req.flash('error', 'Produit introuvable.'); return res.redirect('/productions/nouveau'); }
  if (quantite <= 0) { req.flash('error', 'Quantité doit être > 0.'); return res.redirect('/productions/nouveau'); }
  const fiche = db.prepare(`SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1`).get(produit.id);
  if (!fiche) { req.flash('error', 'Ce produit n\'a pas de fiche technique active.'); return res.redirect('/productions/nouveau'); }
  const composition = db.prepare(`SELECT cf.*, p.designation, p.stock_actuel, p.prix_achat
                                  FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                  WHERE cf.fiche_id = ?`).all(fiche.id);
  if (!composition.length) { req.flash('error', 'La fiche technique est vide.'); return res.redirect('/productions/nouveau'); }
  const rendement = Math.max(1, Number(fiche.rendement) || 1);

  // Coût matière estimé (utile pour info mais pas bloquant)
  let coutMatiere = 0;
  for (const c of composition) {
    const qteNecessaire = Number(c.quantite) * quantite / rendement;
    coutMatiere += qteNecessaire * Number(c.prix_achat || 0);
  }

  const numero = h.prochainNumeroProduction(db, req.activite.code);
  let productionId;
  db.transaction(() => {
    const info = db.prepare(`INSERT INTO production (activite_id, numero, produit_id, quantite_produite, produit_par_id, cout_matiere, notes, statut)
                             VALUES (?, ?, ?, ?, ?, ?, ?, 'BROUILLON')`)
      .run(req.activiteId, numero, produit.id, quantite, req.user.id, Math.round(coutMatiere), notes);
    productionId = Number(info.lastInsertRowid);
  })();
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_DEMANDEE',
    entite: 'production', entite_id: productionId,
    details: `Demande ${numero} : ${quantite} × ${produit.designation} — coût matière estimé ${h.formatNombre(coutMatiere)}` });
  req.flash('success', `Demande de production ${numero} envoyée au gestionnaire de stock pour validation. Aucun stock n'a été modifié.`);
  res.redirect('/productions/' + productionId);
});

// =========================================================
// VALIDATION INGRÉDIENTS PAR LE GESTIONNAIRE
// Étape 2 : le gestionnaire confirme la sortie physique + peut ajuster les quantités
// =========================================================
router.post('/:id(\\d+)/valider-ingredients', requireGestionnaireStock, (req, res) => {
  const prod = db.prepare('SELECT * FROM production WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!prod) { req.flash('error', 'Production introuvable.'); return res.redirect('/productions/'); }
  if (prod.statut !== 'BROUILLON') {
    req.flash('warning', 'Cette production n\'est plus en attente de validation.');
    return res.redirect('/productions/' + prod.id);
  }
  const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(prod.produit_id);
  const fiche = db.prepare(`SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1`).get(prod.produit_id);
  if (!fiche) { req.flash('error', 'Fiche technique introuvable.'); return res.redirect('/productions/' + prod.id); }
  const rendement = Math.max(1, Number(fiche.rendement) || 1);
  const composition = db.prepare(`SELECT cf.*, p.designation, p.stock_actuel, p.prix_achat
                                  FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                  WHERE cf.fiche_id = ?`).all(fiche.id);

  // Le formulaire envoie ingredient_id[] + quantite_reelle[] pour permettre d'ajuster ligne par ligne
  const ingredientIds = [].concat(req.body.ingredient_id || []);
  const quantitesReelles = [].concat(req.body.quantite_reelle || []);
  const ajustements = new Map();
  for (let i = 0; i < ingredientIds.length; i++) {
    const iid = Number(ingredientIds[i]);
    const q = Number(String(quantitesReelles[i] || '0').replace(',', '.'));
    if (iid && q >= 0) ajustements.set(iid, q);
  }

  // Vérifier disponibilité avec les quantités ajustées
  const manques = [];
  let coutReel = 0;
  for (const c of composition) {
    const qteTheo = Number(c.quantite) * prod.quantite_produite / rendement;
    const qteReelle = ajustements.has(c.ingredient_id) ? ajustements.get(c.ingredient_id) : qteTheo;
    if (Number(c.stock_actuel) < qteReelle) {
      manques.push(`${c.designation} : besoin ${h.formatDecimal(qteReelle, 2)}, dispo ${h.formatDecimal(c.stock_actuel, 2)}`);
    }
    coutReel += qteReelle * Number(c.prix_achat || 0);
  }
  if (manques.length && String(req.body.forcer || '') !== '1') {
    req.flash('error', `Stock insuffisant : ${manques.join(' ; ')}. Ajustez les quantités ou cochez "Forcer" pour créer des stocks négatifs.`);
    return res.redirect('/productions/' + prod.id);
  }

  const insMouv = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, utilisateur_id, motif, reference_doc)
                              VALUES (?, ?, 'SORTIE', ?, ?, ?, ?)`);
  const updProd = db.prepare('UPDATE produit SET stock_actuel = stock_actuel - ? WHERE id = ?');
  db.transaction(() => {
    for (const c of composition) {
      const qteTheo = Number(c.quantite) * prod.quantite_produite / rendement;
      const qteReelle = ajustements.has(c.ingredient_id) ? ajustements.get(c.ingredient_id) : qteTheo;
      if (qteReelle > 0) {
        const noteEcart = Math.abs(qteReelle - qteTheo) > 0.001 ? ` (théorique ${h.formatDecimal(qteTheo, 2)}, sorti ${h.formatDecimal(qteReelle, 2)})` : '';
        insMouv.run(req.activiteId, c.ingredient_id, qteReelle, req.user.id,
                    `Production ${prod.numero} · ${prod.quantite_produite} × ${produit.designation}${noteEcart}`, prod.numero);
        updProd.run(qteReelle, c.ingredient_id);
      }
    }
    db.prepare(`UPDATE production SET statut = 'EN_COURS', valide_par_id = ?, date_validation = datetime('now'), cout_matiere = ? WHERE id = ?`)
      .run(req.user.id, Math.round(coutReel), prod.id);
  })();
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_VALIDEE',
    entite: 'production', entite_id: prod.id,
    details: `${prod.numero} · ingrédients sortis · coût réel ${h.formatNombre(coutReel)}` });
  req.flash('success', `Ingrédients sortis. La cuisine peut commencer la production ${prod.numero}.`);
  res.redirect('/productions/' + prod.id);
});

// =========================================================
// TERMINER LA PRODUCTION (par le cuisinier)
// Étape 3 : le cuisinier confirme la fin de fabrication, produit fini entre en stock
// =========================================================
router.post('/:id(\\d+)/terminer', requireEcriture, (req, res) => {
  const prod = db.prepare('SELECT * FROM production WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!prod) { req.flash('error', 'Production introuvable.'); return res.redirect('/productions/'); }
  if (prod.statut !== 'EN_COURS') {
    req.flash('warning', 'Cette production n\'est pas en cours de fabrication.');
    return res.redirect('/productions/' + prod.id);
  }
  const quantiteFinale = Number(String(req.body.quantite_finale || prod.quantite_produite).replace(',', '.'));
  if (quantiteFinale <= 0) {
    req.flash('error', 'La quantité produite doit être supérieure à 0. Utilisez « Annuler la production » si rien n\'est récupérable.');
    return res.redirect('/productions/' + prod.id);
  }
  const qtePrevue = Number(prod.quantite_produite);
  const ecart = quantiteFinale - qtePrevue;
  const motifPerte = String(req.body.motif_perte || '').trim();
  const noteExcedent = String(req.body.note_excedent || '').trim();

  // Écart négatif : motif obligatoire (traçabilité de la perte)
  if (ecart < -0.001 && motifPerte.length < 3) {
    req.flash('error', `Vous produisez ${h.formatDecimal(quantiteFinale, 2)} au lieu de ${h.formatDecimal(qtePrevue, 2)}. Un motif est obligatoire pour tracer la perte.`);
    return res.redirect('/productions/' + prod.id);
  }

  const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(prod.produit_id);
  const seuilExcedentAlerte = 0.20; // 20% d'excédent déclenche une alerte gestionnaire
  const ratioExcedent = qtePrevue > 0 ? ecart / qtePrevue : 0;

  db.transaction(() => {
    let noteMouv = `Production ${prod.numero} terminée`;
    if (ecart < -0.001) {
      noteMouv += ` — PERTE ${h.formatDecimal(-ecart, 2)} ${produit.unite} (prévu ${h.formatDecimal(qtePrevue, 2)}, produit ${h.formatDecimal(quantiteFinale, 2)}) · Motif : ${motifPerte}`;
    } else if (ecart > 0.001) {
      noteMouv += ` — EXCÉDENT +${h.formatDecimal(ecart, 2)} ${produit.unite} (prévu ${h.formatDecimal(qtePrevue, 2)}, produit ${h.formatDecimal(quantiteFinale, 2)})`;
      if (noteExcedent) noteMouv += ` · Note : ${noteExcedent}`;
    }
    db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, utilisateur_id, motif, reference_doc)
                VALUES (?, ?, 'ENTREE', ?, ?, ?, ?)`)
      .run(req.activiteId, produit.id, quantiteFinale, req.user.id, noteMouv, prod.numero);
    db.prepare('UPDATE produit SET stock_actuel = stock_actuel + ? WHERE id = ?').run(quantiteFinale, produit.id);
    // Le motif_annulation sert aussi à consigner la perte (préfixé pour distinguer d'un refus)
    const motifStock = ecart < -0.001 ? `Perte cuisson : ${motifPerte}` : (ecart > 0.001 && noteExcedent ? `Excédent : ${noteExcedent}` : '');
    db.prepare(`UPDATE production SET statut = 'TERMINEE', quantite_produite = ?, date_fin = datetime('now'), motif_annulation = ? WHERE id = ?`)
      .run(quantiteFinale, motifStock, prod.id);

    // Journalisation comptable — Production terminée
    // Débit 355 Produits finis (valeur = coût matière) · Crédit 322 Matières premières
    // Note : les sorties matières ont déjà été comptabilisées lors de valider-ingredients ? Non — on regroupe ici.
    // Pour simplifier : mouvement stock ↔ écriture directe sans double emploi (le journal ST reflète le net).
    const coutValorise = Math.round(Number(prod.cout_matiere) || 0);
    if (coutValorise > 0 && ecart >= -0.001) {
      // Production sans perte : matière entièrement transformée en produit fini
      h.enregistrerEcriture(db, {
        journal: 'ST',
        libelle: `Production ${prod.numero} — ${h.formatDecimal(quantiteFinale, 2)} × ${produit.designation}`,
        lignes: [
          { compte: '355', debit: coutValorise, credit: 0 },
          { compte: '322', debit: 0, credit: coutValorise },
        ],
        referenceMetier: `PRODUCTION#${prod.id}`,
        activiteId: req.activiteId, utilisateurId: req.user.id,
      });
    } else if (coutValorise > 0 && ecart < -0.001) {
      // Production avec perte cuisson : part valorisée en produits finis, part perdue
      const ratioRealisee = qtePrevue > 0 ? quantiteFinale / qtePrevue : 0;
      const partProduits = Math.round(coutValorise * ratioRealisee);
      const partPerte = coutValorise - partProduits;
      const lignesPerte = [];
      if (partProduits > 0) lignesPerte.push({ compte: '355', debit: partProduits, credit: 0 });
      if (partPerte > 0) lignesPerte.push({ compte: '654', debit: partPerte, credit: 0 });
      lignesPerte.push({ compte: '322', debit: 0, credit: coutValorise });
      h.enregistrerEcriture(db, {
        journal: 'ST',
        libelle: `Production ${prod.numero} — PERTE cuisson (${motifPerte})`,
        lignes: lignesPerte,
        referenceMetier: `PRODUCTION#${prod.id}`,
        activiteId: req.activiteId, utilisateurId: req.user.id,
      });
    }

    // Alerte automatique au gestionnaire si excédent > 20%
    if (ratioExcedent > seuilExcedentAlerte) {
      const msg = `Excédent important sur ${prod.numero} : produit ${h.formatDecimal(quantiteFinale, 2)} au lieu de ${h.formatDecimal(qtePrevue, 2)} (+${Math.round(ratioExcedent * 100)}%). Vérifiez le rendement de la fiche technique.`;
      const contexte = JSON.stringify({ production_id: prod.id, numero: prod.numero, produit_fini_id: produit.id, qte_prevue: qtePrevue, qte_reelle: quantiteFinale, ecart, ratio_pct: Math.round(ratioExcedent * 100), note: noteExcedent });
      db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, source, message, contexte_json, vue, creee_le)
                  VALUES (?, ?, 'ALERTE', 'PRODUCTION', ?, ?, 0, datetime('now'))`)
        .run(req.activiteId, produit.id, msg, contexte);
    }
  })();

  const detailAudit = ecart < -0.001
    ? `${prod.numero} · ${quantiteFinale} × ${produit.designation} — PERTE ${h.formatDecimal(-ecart, 2)} · ${motifPerte}`
    : ecart > 0.001
      ? `${prod.numero} · ${quantiteFinale} × ${produit.designation} — EXCÉDENT +${h.formatDecimal(ecart, 2)}`
      : `${prod.numero} · ${quantiteFinale} × ${produit.designation} produits`;
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_TERMINEE',
    entite: 'production', entite_id: prod.id, details: detailAudit });

  let flashMsg = `Production ${prod.numero} terminée. ${h.formatDecimal(quantiteFinale, 2)} ${produit.unite} ajouté(s) au stock`;
  if (ecart < -0.001) flashMsg += ` (perte tracée : ${h.formatDecimal(-ecart, 2)} ${produit.unite})`;
  else if (ratioExcedent > seuilExcedentAlerte) flashMsg += ` — excédent de ${Math.round(ratioExcedent * 100)}% signalé au gestionnaire`;
  req.flash('success', flashMsg + '.');
  res.redirect('/productions/' + prod.id);
});

// =========================================================
// ANNULATION D'UNE PRODUCTION EN COURS (fabrication ratée)
// Étape 3-bis : rien n'est utilisable → perte totale ou retour des ingrédients
// =========================================================
router.post('/:id(\\d+)/annuler-en-cours', requireEcriture, (req, res) => {
  const prod = db.prepare('SELECT * FROM production WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!prod) { req.flash('error', 'Production introuvable.'); return res.redirect('/productions/'); }
  if (prod.statut !== 'EN_COURS') {
    req.flash('warning', 'Seule une production en cours peut être annulée par ce geste.');
    return res.redirect('/productions/' + prod.id);
  }
  // Le formulaire "Terminer" peut poster ici quand qte=0 : accepter aussi motif_perte
  const motif = String(req.body.motif || req.body.motif_perte || '').trim();
  if (motif.length < 3) {
    req.flash('error', 'Un motif d\'annulation est obligatoire (min 3 caractères).');
    return res.redirect('/productions/' + prod.id);
  }
  const mode = String(req.body.mode || 'perdus') === 'retour_stock' ? 'retour_stock' : 'perdus';
  const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(prod.produit_id);

  db.transaction(() => {
    let notePerte;
    if (mode === 'retour_stock') {
      // Rollback : rechercher les SORTIE liées à ce numéro et générer des ENTREE compensatoires
      const sorties = db.prepare(`SELECT produit_id, quantite FROM mouvement_stock
                                  WHERE reference_doc = ? AND activite_id = ? AND type = 'SORTIE'`).all(prod.numero, req.activiteId);
      const insEntree = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, utilisateur_id, motif, reference_doc)
                                    VALUES (?, ?, 'ENTREE', ?, ?, ?, ?)`);
      const updProd = db.prepare('UPDATE produit SET stock_actuel = stock_actuel + ? WHERE id = ?');
      for (const s of sorties) {
        insEntree.run(req.activiteId, s.produit_id, s.quantite, req.user.id,
                      `Annulation ${prod.numero} — retour ingrédients au magasin · ${motif}`, prod.numero);
        updProd.run(s.quantite, s.produit_id);
      }
      notePerte = `Annulation avec retour ingrédients : ${motif}`;
    } else {
      notePerte = `Annulation perte totale (ingrédients non récupérables) : ${motif}`;
    }
    db.prepare(`UPDATE production SET statut = 'ANNULEE', motif_annulation = ?, date_fin = datetime('now') WHERE id = ?`)
      .run(notePerte, prod.id);

    // Journalisation comptable
    const coutValorise = Math.round(Number(prod.cout_matiere) || 0);
    if (coutValorise > 0) {
      if (mode === 'retour_stock') {
        // Ingrédients récupérés — pas d'écriture (les mouvements stock rollbackés annulent les sorties)
        // Rien à faire côté compta puisque l'achat initial est déjà passé au 322
      } else {
        // Perte totale : matières définitivement perdues → 654 Pertes / 322 Matières
        h.enregistrerEcriture(db, {
          journal: 'ST',
          libelle: `PERTE totale production ${prod.numero} — ${motif}`,
          lignes: [
            { compte: '654', debit: coutValorise, credit: 0 },
            { compte: '322', debit: 0, credit: coutValorise },
          ],
          referenceMetier: `PRODUCTION#${prod.id}`,
          activiteId: req.activiteId, utilisateurId: req.user.id,
        });
      }
    }

    // Toujours notifier le gestionnaire d'une annulation en cours (perte matière ou anomalie)
    const msg = mode === 'retour_stock'
      ? `Production ${prod.numero} annulée avec retour ingrédients. Motif : ${motif}`
      : `Production ${prod.numero} annulée — ingrédients perdus. Motif : ${motif}`;
    const contexte = JSON.stringify({ production_id: prod.id, numero: prod.numero, produit_fini_id: produit.id, qte_prevue: prod.quantite_produite, mode, motif });
    db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, source, message, contexte_json, vue, creee_le)
                VALUES (?, ?, 'ALERTE', 'PRODUCTION', ?, ?, 0, datetime('now'))`)
      .run(req.activiteId, produit.id, msg, contexte);
  })();

  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_ANNULEE',
    entite: 'production', entite_id: prod.id,
    details: `${prod.numero} ANNULÉE en cours (mode: ${mode}) · ${motif}` });

  const flashMsg = mode === 'retour_stock'
    ? `Production ${prod.numero} annulée. Ingrédients remis en stock.`
    : `Production ${prod.numero} annulée. Perte matière signalée au gestionnaire.`;
  req.flash('warning', flashMsg);
  res.redirect('/productions/' + prod.id);
});

// =========================================================
// ANNULER / REFUSER LA PRODUCTION
// =========================================================
router.post('/:id(\\d+)/annuler', requireEcriture, (req, res) => {
  const prod = db.prepare('SELECT * FROM production WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!prod) { req.flash('error', 'Production introuvable.'); return res.redirect('/productions/'); }
  const motif = String(req.body.motif || '').trim();
  if (!motif || motif.length < 3) {
    req.flash('error', 'Un motif d\'annulation est obligatoire (min 3 caractères).');
    return res.redirect('/productions/' + prod.id);
  }
  // Seule une DEMANDE (BROUILLON) peut être annulée par le cuisinier — les EN_COURS nécessitent un refus/rollback complexe
  if (prod.statut !== 'BROUILLON') {
    req.flash('warning', 'Seule une demande non encore validée peut être annulée. Les productions en cours doivent être terminées avec la quantité 0 si aucun produit n\'est sorti.');
    return res.redirect('/productions/' + prod.id);
  }
  db.prepare(`UPDATE production SET statut = 'ANNULEE', motif_annulation = ?, date_fin = datetime('now') WHERE id = ?`)
    .run(motif, prod.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_ANNULEE',
    entite: 'production', entite_id: prod.id, details: `${prod.numero} · motif : ${motif}` });
  req.flash('info', `Demande de production ${prod.numero} annulée.`);
  res.redirect('/productions/' + prod.id);
});

// Refus par le gestionnaire (motif obligatoire) — équivalent à une annulation avec traçabilité
router.post('/:id(\\d+)/refuser', requireGestionnaireStock, (req, res) => {
  const prod = db.prepare('SELECT * FROM production WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!prod) { req.flash('error', 'Production introuvable.'); return res.redirect('/productions/'); }
  if (prod.statut !== 'BROUILLON') {
    req.flash('warning', 'Seule une demande en attente peut être refusée.');
    return res.redirect('/productions/' + prod.id);
  }
  const motif = String(req.body.motif || '').trim();
  if (!motif || motif.length < 3) {
    req.flash('error', 'Un motif de refus est obligatoire (min 3 caractères).');
    return res.redirect('/productions/' + prod.id);
  }
  db.prepare(`UPDATE production SET statut = 'ANNULEE', motif_annulation = ?, valide_par_id = ?, date_fin = datetime('now') WHERE id = ?`)
    .run('Refus gestionnaire : ' + motif, req.user.id, prod.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUCTION_REFUSEE',
    entite: 'production', entite_id: prod.id, details: `${prod.numero} · motif : ${motif}` });
  req.flash('warning', `Demande de production ${prod.numero} refusée. Le cuisinier en sera informé.`);
  res.redirect('/productions/' + prod.id);
});

// =========================================================
// DÉTAIL
// =========================================================
router.get('/:id(\\d+)', (req, res) => {
  const production = db.prepare(`SELECT p.*, prod.designation AS produit_nom, prod.unite AS produit_unite, prod.reference AS produit_ref,
                                        u.first_name AS auteur_prenom, u.username AS auteur_username, u.last_name AS auteur_nom,
                                        v.first_name AS valide_par_prenom, v.username AS valide_par_username
                                 FROM production p
                                 JOIN produit prod ON prod.id = p.produit_id
                                 LEFT JOIN utilisateur u ON u.id = p.produit_par_id
                                 LEFT JOIN utilisateur v ON v.id = p.valide_par_id
                                 WHERE p.id = ? AND p.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!production) { req.flash('warning', 'Ordre introuvable.'); return res.redirect('/productions/'); }
  // Marquer vue pour le cuisinier créateur (efface le badge de notif)
  if (h.isCuisinier(req.user) && production.produit_par_id === req.user.id) {
    db.prepare(`UPDATE production SET vue_par_cuisinier_le = datetime('now') WHERE id = ?`).run(production.id);
  }
  // Charger la fiche technique + composition pour affichage et validation
  const fiche = db.prepare('SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1').get(production.produit_id);
  const composition = fiche ? db.prepare(`SELECT cf.*, p.designation, p.unite, p.stock_actuel, p.prix_achat, p.reference
                                          FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                          WHERE cf.fiche_id = ? ORDER BY p.designation`).all(fiche.id) : [];
  const rendement = fiche ? Math.max(1, Number(fiche.rendement) || 1) : 1;
  // Enrichir chaque ingrédient avec la quantité théorique nécessaire
  const compositionEnrichie = composition.map(c => ({
    ...c,
    qte_theorique: Number(c.quantite) * Number(production.quantite_produite) / rendement,
  }));
  // Mouvements liés
  const mouvements = db.prepare(`SELECT m.*, p.designation AS produit_nom, p.unite AS produit_unite
                                 FROM mouvement_stock m JOIN produit p ON p.id = m.produit_id
                                 WHERE m.reference_doc = ? AND m.activite_id = ?
                                 ORDER BY m.type, p.designation`).all(production.numero, req.activiteId);
  res.render('productions/detail', {
    title: production.numero, page_title: `Production ${production.numero}`,
    production, mouvements, fiche, composition: compositionEnrichie, rendement,
    peut_valider_ingredients: h.isDG(req.user) || h.isGestionnaire(req.user) || h.isDistribution(req.user),
    peut_terminer: h.isCuisinier(req.user) || h.isDG(req.user),
  });
});

// =========================================================
// PDF bon de fabrication
// =========================================================
router.get('/:id(\\d+)/pdf', (req, res) => {
  const production = db.prepare(`SELECT p.*, prod.designation AS produit_nom, prod.unite AS produit_unite,
                                        u.first_name AS auteur_prenom, u.last_name AS auteur_nom
                                 FROM production p
                                 JOIN produit prod ON prod.id = p.produit_id
                                 LEFT JOIN utilisateur u ON u.id = p.produit_par_id
                                 WHERE p.id = ? AND p.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!production) return res.redirect('/productions/');
  const params = req.parametres || {};
  const devise = params.devise || 'FCFA';
  const mouvements = db.prepare(`SELECT m.*, p.designation, p.unite
                                 FROM mouvement_stock m JOIN produit p ON p.id = m.produit_id
                                 WHERE m.reference_doc = ? AND m.activite_id = ? AND m.type = 'SORTIE'
                                 ORDER BY p.designation`).all(production.numero, req.activiteId);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="fabrication_${production.numero}.pdf"`);
  doc.pipe(res);

  const NAVY = '#1e3a8a', GOLD = '#CA8A04';
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(params.entreprise_nom || 'Le Traiteur du Bistrot', 40, 40);
  doc.font('Helvetica').fontSize(10).fillColor('#000').text(req.activite.nom + ' — Bon de fabrication', 40, 62);
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#000').text('PRODUCTION ' + production.numero, 40, 90);
  doc.moveTo(40, 118).lineTo(555, 118).strokeColor(GOLD).lineWidth(1.5).stroke();

  let y = 140;
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text('Date : ' + h.formatDate(production.date_production, true), 40, y);
  doc.text('Produit par : ' + ((production.auteur_prenom || '') + ' ' + (production.auteur_nom || '')).trim(), 300, y);
  y += 22;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY);
  doc.text(`${production.quantite_produite} × ${production.produit_nom}`, 40, y);
  y += 28;

  // Tableau ingrédients consommés
  doc.rect(40, y, 515, 22).fill(NAVY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
  doc.text('Ingrédient', 50, y + 7, { width: 300 });
  doc.text('Quantité sortie', 355, y + 7, { width: 200, align: 'right' });
  y += 22;
  doc.fillColor('#000').font('Helvetica').fontSize(10);
  for (const m of mouvements) {
    doc.rect(40, y, 515, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    doc.text(m.designation, 50, y + 6, { width: 300 });
    doc.text(h.formatDecimal(m.quantite, 2) + ' ' + m.unite, 355, y + 6, { width: 200, align: 'right' });
    y += 20;
  }
  y += 12;
  doc.rect(40, y, 515, 22).fill(GOLD);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(11);
  doc.text('COÛT MATIÈRE TOTAL', 50, y + 6);
  doc.text(h.formatNombre(production.cout_matiere) + ' ' + devise, 355, y + 6, { width: 200, align: 'right' });
  y += 34;

  if (production.notes) {
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    doc.text('Notes : ' + production.notes, 40, y, { width: 515 });
    y = doc.y + 20;
  }

  // Signatures
  y = Math.max(y, 700);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('CHEF DE PRODUCTION', 60, y, { align: 'center', width: 200 });
  doc.rect(60, y + 15, 200, 55).lineWidth(0.5).strokeColor('#000').stroke();
  doc.text('CONTRÔLE STOCK', 335, y, { align: 'center', width: 200 });
  doc.rect(335, y + 15, 200, 55).lineWidth(0.5).strokeColor('#000').stroke();

  doc.end();
});

// =========================================================
// LISTE DES RECETTES (fiches techniques) — vue dédiée cuisine
// =========================================================
router.get('/recettes/', (req, res) => {
  const fiches = db.prepare(`SELECT ft.*, p.designation, p.reference, p.unite, p.prix_vente, p.prix_achat,
                                    (SELECT COUNT(*) FROM composition_fiche cf WHERE cf.fiche_id = ft.id) AS nb_ingredients,
                                    (SELECT COALESCE(SUM(cf.quantite * pi.prix_achat), 0)
                                       FROM composition_fiche cf JOIN produit pi ON pi.id = cf.ingredient_id
                                       WHERE cf.fiche_id = ft.id) AS cout_matiere,
                                    (SELECT COUNT(*) FROM production pr WHERE pr.produit_id = p.id) AS nb_productions
                             FROM fiche_technique ft
                             JOIN produit p ON p.id = ft.produit_id
                             WHERE p.activite_id = ?
                             ORDER BY ft.actif DESC, p.designation`).all(req.activiteId);
  // Enrichir : produits candidats à avoir une fiche (produits qui n'en ont pas encore)
  const candidats = db.prepare(`SELECT p.id, p.designation, p.reference, p.prix_vente
                                FROM produit p
                                WHERE p.activite_id = ? AND p.actif = 1 AND p.prix_vente > 0
                                  AND NOT EXISTS (SELECT 1 FROM fiche_technique ft WHERE ft.produit_id = p.id)
                                ORDER BY p.designation`).all(req.activiteId);
  const totalActives = fiches.filter(f => f.actif).length;
  const totalInactives = fiches.length - totalActives;
  const margeMoyenne = fiches.filter(f => f.prix_vente > 0)
                             .reduce((s, f) => s + ((f.prix_vente - f.cout_matiere) / f.prix_vente * 100), 0) /
                       Math.max(1, fiches.filter(f => f.prix_vente > 0).length);
  res.render('productions/recettes', {
    title: 'Recettes cuisine', page_title: `Recettes — ${req.activite.nom}`,
    fiches, candidats,
    kpi: { total: fiches.length, actives: totalActives, inactives: totalInactives, marge_moyenne: Math.round(margeMoyenne) },
  });
});

module.exports = router;
