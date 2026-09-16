const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

function requirePerm(feature) {
  return function(req, res, next) {
    if (!req.user) return res.redirect('/comptes/connexion');
    if (!h.utilisateurPeut(db, req.user, feature)) {
      req.flash('error', "Permission requise (" + feature + ").");
      return res.redirect('/tableau-de-bord/');
    }
    next();
  };
}

// =========================================================
// LISTE DES DISTRIBUTIONS
// =========================================================
router.get('/', requirePerm('distribution.consulter'), (req, res) => {
  const statut = req.query.statut || '';
  const periode = h.resoudrePeriode(req.query);
  const filtres = [];
  const params = [];
  if (statut) { filtres.push('d.statut = ?'); params.push(statut); }
  if (periode.debut) { filtres.push('date(d.date_creation) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(d.date_creation) <= date(?)'); params.push(periode.fin); }
  const where = filtres.length ? 'WHERE ' + filtres.join(' AND ') : '';
  const p = h.pagination(req);
  const totalDist = db.prepare(`SELECT COUNT(*) AS n FROM distribution d ${where}`).get(...params).n;
  const distributions = db.prepare(`SELECT d.*, act.nom AS activite_nom, act.code AS activite_code, act.couleur AS activite_couleur,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      g.first_name || ' ' || g.last_name AS gestionnaire_nom,
      (SELECT COUNT(*) FROM ligne_distribution WHERE distribution_id = d.id) AS nb_lignes
    FROM distribution d
    JOIN activite act ON act.id = d.activite_id
    LEFT JOIN utilisateur u ON u.id = d.cree_par_id
    LEFT JOIN utilisateur g ON g.id = d.gestionnaire_id
    ${where}
    ORDER BY d.date_creation DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  const stats = {
    preparee:      db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'PREPAREE'").get().n,
    remise:        db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'REMISE'").get().n,
    receptionnee:  db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'RECEPTIONNEE'").get().n,
    refusee:       db.prepare("SELECT COUNT(*) AS n FROM distribution WHERE statut = 'REFUSEE'").get().n,
  };
  const achats_a_distribuer = db.prepare(`SELECT COUNT(*) AS n FROM achat WHERE statut = 'RECEPTIONNE'`).get().n;
  res.render('distributions/liste', {
    title: 'Distributions', page_title: 'Distributions',
    distributions, statut, stats, achats_a_distribuer, periode,
    pagination: h.paginationInfo(p, totalDist, req),
    peut_creer: h.utilisateurPeut(db, req.user, 'distribution.creer'),
    peut_remettre: h.utilisateurPeut(db, req.user, 'distribution.remettre'),
  });
});

// =========================================================
// NOUVELLE DISTRIBUTION — matrice tous les achats non distribués × 4 activités
// =========================================================
router.get('/nouveau', requirePerm('distribution.creer'), (req, res) => {
  // Charger tous les achats non encore complètement distribués
  const achats = db.prepare(`SELECT a.*, u.first_name || ' ' || u.last_name AS cree_par_nom
    FROM achat a
    LEFT JOIN utilisateur u ON u.id = a.cree_par_id
    WHERE a.statut IN ('RECEPTIONNE', 'SAISI', 'DISTRIBUE')
      AND EXISTS (SELECT 1 FROM ligne_achat la WHERE la.achat_id = a.id AND la.quantite - la.quantite_distribuee > 0.001)
    ORDER BY a.date_achat DESC`).all();

  const groupes = [];
  for (const a of achats) {
    const lignes = db.prepare(`SELECT la.*, act.nom AS activite_pressentie_nom, act.code AS activite_pressentie_code,
        f.raison_sociale AS fournisseur_nom
      FROM ligne_achat la
      LEFT JOIN activite act ON act.id = la.activite_pressentie_id
      LEFT JOIN fournisseur f ON f.id = la.fournisseur_id
      WHERE la.achat_id = ? AND la.quantite - la.quantite_distribuee > 0.001
      ORDER BY la.fournisseur_id, la.id`).all(a.id).map(l => ({
        ...l,
        restant: +(l.quantite - l.quantite_distribuee).toFixed(3),
      }));
    if (lignes.length) groupes.push({ achat: a, lignes });
  }

  const activites = db.prepare("SELECT * FROM activite WHERE actif = 1 ORDER BY id").all();
  res.render('distributions/nouveau_matrice', {
    title: 'Nouvelle distribution', page_title: 'Distribuer les achats',
    groupes, activites,
  });
});

router.post('/nouveau', requirePerm('distribution.creer'), (req, res) => {
  // req.body : { affectations: [{ ligne_achat_id, activite_id, quantite }, ...], notes: '', marquer_remise: '1'? }
  let affectations = [];
  try { affectations = JSON.parse(req.body.affectations || '[]'); }
  catch (e) { req.flash('error', 'Données invalides.'); return res.redirect('/distributions/nouveau'); }
  const notes = req.body.notes || '';
  const marquerRemise = req.body.marquer_remise === '1' || req.body.marquer_remise === 'on';
  const affectationsValides = affectations.filter(a => a.ligne_achat_id && a.activite_id && Number(a.quantite) > 0);
  if (!affectationsValides.length) { req.flash('error', 'Renseignez au moins une quantité à distribuer.'); return res.redirect('/distributions/nouveau'); }

  const distributionsCrees = [];
  const trx = db.transaction(() => {
    // Grouper les affectations par activité pour créer une distribution par activité
    const parActivite = new Map();
    for (const aff of affectationsValides) {
      if (!parActivite.has(aff.activite_id)) parActivite.set(aff.activite_id, []);
      parActivite.get(aff.activite_id).push(aff);
    }

    for (const [activiteId, affs] of parActivite) {
      // Créer la distribution pour cette activité
      const numero = h.prochainNumeroDistribution(db);
      const statutInitial = marquerRemise ? 'REMISE' : 'PREPAREE';
      const info = db.prepare(`INSERT INTO distribution
        (numero, activite_id, cree_par_id, notes, statut, remise_par_id, date_remise)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(numero, activiteId, req.user.id, notes, statutInitial,
             marquerRemise ? req.user.id : null,
             marquerRemise ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);
      const distId = Number(info.lastInsertRowid);

      const insL = db.prepare(`INSERT INTO ligne_distribution (distribution_id, ligne_achat_id, produit_id, quantite_annoncee)
                               VALUES (?, ?, ?, ?)`);
      const updateDist = db.prepare('UPDATE ligne_achat SET quantite_distribuee = quantite_distribuee + ? WHERE id = ?');

      for (const aff of affs) {
        const ligneAchat = db.prepare('SELECT * FROM ligne_achat WHERE id = ?').get(aff.ligne_achat_id);
        // Trouver ou créer le produit dans le catalogue de l'activité destinataire
        let produit = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND LOWER(designation) = LOWER(?)').get(activiteId, ligneAchat.designation);
        if (!produit) {
          // Auto-création : catégorie « Non classé » (créée si besoin), fournisseur = celui de la ligne
          let cat = db.prepare("SELECT * FROM categorie WHERE activite_id = ? AND nom = 'Non classé'").get(activiteId);
          if (!cat) {
            const info2 = db.prepare("INSERT INTO categorie (activite_id, nom, description) VALUES (?, 'Non classé', 'Produits ajoutés automatiquement par distribution')").run(activiteId);
            cat = { id: Number(info2.lastInsertRowid) };
          }
          const ref = h.prochaineReferenceProduit(db, activiteId);
          const insP = db.prepare(`INSERT INTO produit (activite_id, reference, designation, categorie_id, fournisseur_id, unite, prix_achat, stock_actuel, stock_minimum, stock_maximum, actif)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, 0, 5, 100, 1)`)
            .run(activiteId, ref, ligneAchat.designation, cat.id, null, ligneAchat.unite, ligneAchat.prix_unitaire);
          produit = { id: Number(insP.lastInsertRowid), designation: ligneAchat.designation };
        }
        insL.run(distId, ligneAchat.id, produit.id, Number(aff.quantite));
        updateDist.run(Number(aff.quantite), ligneAchat.id);
      }
      distributionsCrees.push({ id: distId, numero });
    }

    // Mettre à jour le statut des achats qui sont entièrement distribués
    const achatsAffectes = [...new Set(affectationsValides.map(a => {
      const l = db.prepare('SELECT achat_id FROM ligne_achat WHERE id = ?').get(a.ligne_achat_id);
      return l ? l.achat_id : null;
    }).filter(Boolean))];
    for (const aid of achatsAffectes) {
      const restant = db.prepare('SELECT COALESCE(SUM(quantite - quantite_distribuee), 0) AS r FROM ligne_achat WHERE achat_id = ?').get(aid).r;
      if (restant <= 0.001) db.prepare("UPDATE achat SET statut = 'DISTRIBUE' WHERE id = ?").run(aid);
    }
  });
  trx();
  req.flash('success', `${distributionsCrees.length} distribution(s) créée(s) — cliquez sur chacune pour marquer comme "Remise" quand vous les apportez aux gestionnaires.`);
  res.redirect('/distributions/');
});

// Redirection : ancienne route "creer depuis un achat" → nouvelle page matrice
router.get('/creer/:achatId(\\d+)', requirePerm('distribution.creer'), (req, res) => {
  res.redirect('/distributions/nouveau');
});

// =========================================================
// DÉTAIL D'UNE DISTRIBUTION
// =========================================================
router.get('/:id(\\d+)', requirePerm('distribution.consulter'), (req, res) => {
  const distribution = db.prepare(`SELECT d.*, act.nom AS activite_nom, act.code AS activite_code, act.couleur AS activite_couleur,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      g.first_name || ' ' || g.last_name AS gestionnaire_nom,
      r.first_name || ' ' || r.last_name AS receptionne_par_nom,
      rem.first_name || ' ' || rem.last_name AS remise_par_nom
    FROM distribution d
    JOIN activite act ON act.id = d.activite_id
    LEFT JOIN utilisateur u ON u.id = d.cree_par_id
    LEFT JOIN utilisateur g ON g.id = d.gestionnaire_id
    LEFT JOIN utilisateur r ON r.id = d.receptionne_par_id
    LEFT JOIN utilisateur rem ON rem.id = d.remise_par_id
    WHERE d.id = ?`).get(req.params.id);
  if (!distribution) return res.redirect('/distributions/');
  const lignes = db.prepare(`SELECT ld.*, p.designation, p.reference, p.unite,
      la.designation AS achat_designation, a.numero AS achat_numero
    FROM ligne_distribution ld
    JOIN produit p ON p.id = ld.produit_id
    LEFT JOIN ligne_achat la ON la.id = ld.ligne_achat_id
    LEFT JOIN achat a ON a.id = la.achat_id
    WHERE ld.distribution_id = ? ORDER BY ld.id`).all(req.params.id);
  res.render('distributions/detail', {
    title: 'Distribution ' + distribution.numero, page_title: 'Distribution ' + distribution.numero,
    distribution, lignes,
    peut_remettre: h.utilisateurPeut(db, req.user, 'distribution.remettre'),
    peut_annuler: h.utilisateurPeut(db, req.user, 'distribution.annuler'),
  });
});

// =========================================================
// MARQUER COMME REMISE (Nestor a donné physiquement)
// =========================================================
router.post('/:id(\\d+)/remettre', requirePerm('distribution.remettre'), (req, res) => {
  db.prepare(`UPDATE distribution SET statut = 'REMISE', remise_par_id = ?, date_remise = datetime('now')
              WHERE id = ? AND statut = 'PREPAREE'`)
    .run(req.user.id, req.params.id);
  req.flash('success', 'Distribution marquée comme remise. Le gestionnaire va être notifié pour confirmer la réception.');
  // Si l'action vient de la liste, on y retourne pour enchaîner sans clic supplémentaire
  if (req.body.retour === 'liste') return res.redirect('/distributions/');
  res.redirect('/distributions/' + req.params.id);
});

// =========================================================
// ANNULER
// =========================================================
router.post('/:id(\\d+)/annuler', requirePerm('distribution.annuler'), (req, res) => {
  const dist = db.prepare('SELECT * FROM distribution WHERE id = ?').get(req.params.id);
  if (!dist) return res.redirect('/distributions/');
  if (dist.statut === 'RECEPTIONNEE') { req.flash('warning', 'Impossible d\'annuler une distribution réceptionnée.'); return res.redirect('/distributions/' + dist.id); }
  db.transaction(() => {
    // Rembourser les quantites sur ligne_achat
    const lignes = db.prepare('SELECT ligne_achat_id, quantite_annoncee FROM ligne_distribution WHERE distribution_id = ?').all(req.params.id);
    for (const l of lignes) {
      if (l.ligne_achat_id) db.prepare('UPDATE ligne_achat SET quantite_distribuee = quantite_distribuee - ? WHERE id = ?').run(l.quantite_annoncee, l.ligne_achat_id);
    }
    db.prepare(`UPDATE distribution SET statut = 'ANNULEE' WHERE id = ?`).run(req.params.id);
  })();
  req.flash('info', 'Distribution annulée.');
  res.redirect('/distributions/');
});

module.exports = router;
