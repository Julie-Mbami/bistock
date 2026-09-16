const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

function requirePerm(feature) {
  return function(req, res, next) {
    if (!req.user) return res.redirect('/comptes/connexion');
    if (!h.utilisateurPeut(db, req.user, feature)) {
      req.flash('error', "Vous n'avez pas la permission requise (" + feature + ").");
      return res.redirect('/tableau-de-bord/');
    }
    next();
  };
}

// =========================================================
// LISTE DES ACHATS
// =========================================================
router.get('/', requirePerm('achats.consulter'), (req, res) => {
  const statut = req.query.statut || '';
  const q = (req.query.q || '').trim();
  const periode = h.resoudrePeriode(req.query);
  const filtres = [];
  const params = [];
  if (statut) { filtres.push('a.statut = ?'); params.push(statut); }
  if (q) { filtres.push('(a.numero LIKE ? OR f.raison_sociale LIKE ? OR a.fournisseur_libre LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (periode.debut) { filtres.push('date(a.date_achat) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(a.date_achat) <= date(?)'); params.push(periode.fin); }
  const where = filtres.length ? 'WHERE ' + filtres.join(' AND ') : '';
  const p = h.pagination(req);
  const totalAchats = db.prepare(`SELECT COUNT(*) AS n FROM achat a LEFT JOIN fournisseur f ON f.id = a.fournisseur_id ${where}`).get(...params).n;
  const achats = db.prepare(`SELECT a.*,
      COALESCE(f.raison_sociale, a.fournisseur_libre) AS fournisseur_affichage,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      (SELECT COUNT(*) FROM ligne_achat WHERE achat_id = a.id) AS nb_lignes,
      (SELECT COALESCE(SUM(quantite), 0) FROM ligne_achat WHERE achat_id = a.id) AS qte_totale,
      (SELECT COALESCE(SUM(quantite_distribuee), 0) FROM ligne_achat WHERE achat_id = a.id) AS qte_distribuee
    FROM achat a
    LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
    LEFT JOIN utilisateur u ON u.id = a.cree_par_id
    ${where}
    ORDER BY a.date_achat DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  const stats = {
    saisi:       db.prepare("SELECT COUNT(*) AS n FROM achat WHERE statut = 'SAISI'").get().n,
    receptionne: db.prepare("SELECT COUNT(*) AS n FROM achat WHERE statut = 'RECEPTIONNE'").get().n,
    distribue:   db.prepare("SELECT COUNT(*) AS n FROM achat WHERE statut = 'DISTRIBUE'").get().n,
    cloture:     db.prepare("SELECT COUNT(*) AS n FROM achat WHERE statut = 'CLOTURE'").get().n,
  };
  res.render('achats/liste', {
    title: 'Achats', page_title: 'Achats et distribution',
    achats, statut, q, stats, periode,
    peut_saisir: h.utilisateurPeut(db, req.user, 'achats.saisir'),
    pagination: h.paginationInfo(p, totalAchats, req),
  });
});

// =========================================================
// NOUVEL ACHAT
// =========================================================
router.get('/nouveau', requirePerm('achats.saisir'), (req, res) => {
  // Fournisseurs de toutes les activités (Mme Sandra peut acheter n'importe où)
  const fournisseurs = db.prepare(`SELECT f.*, a.nom AS activite_nom FROM fournisseur f
                                   LEFT JOIN activite a ON a.id = f.activite_id
                                   WHERE f.actif = 1 ORDER BY f.raison_sociale`).all();
  const activites = db.prepare('SELECT * FROM activite WHERE actif = 1 ORDER BY id').all();
  // Tous les produits actifs de toutes les activités pour autocomplete de la désignation
  const produitsAutocomplete = db.prepare(`SELECT p.id, p.designation, p.reference, p.unite, p.prix_achat, p.activite_id,
                                           a.nom AS activite_nom, a.code AS activite_code
                                           FROM produit p JOIN activite a ON a.id = p.activite_id
                                           WHERE p.actif = 1 ORDER BY p.designation`).all();
  res.render('achats/form', {
    title: 'Nouvel achat', page_title: 'Nouvel achat',
    achat: null, lignes: [], fournisseurs, activites, produitsAutocomplete, mode: 'creer',
  });
});

router.post('/nouveau', requirePerm('achats.saisir'), (req, res) => {
  const { notes = '', lignes = '[]' } = req.body;
  const parsedLignes = JSON.parse(lignes);
  if (!parsedLignes.length) { req.flash('error', 'Ajoutez au moins une ligne.'); return res.redirect('/achats/nouveau'); }
  // Validation : chaque ligne doit avoir fournisseur + n° facture + désignation + quantité
  for (const l of parsedLignes) {
    if (!l.fournisseur_id) { req.flash('error', 'Chaque ligne doit avoir un fournisseur.'); return res.redirect('/achats/nouveau'); }
    if (!l.numero_facture_fournisseur || !String(l.numero_facture_fournisseur).trim()) {
      req.flash('error', 'Chaque ligne doit avoir un n° de facture fournisseur.'); return res.redirect('/achats/nouveau');
    }
    if (!l.designation) { req.flash('error', 'Chaque ligne doit avoir une désignation.'); return res.redirect('/achats/nouveau'); }
    if (Number(l.quantite || 0) <= 0) { req.flash('error', 'Chaque ligne doit avoir une quantité > 0.'); return res.redirect('/achats/nouveau'); }
  }

  const numero = h.prochainNumeroAchat(db);
  const fournPrincipal = parsedLignes[0].fournisseur_id;
  const facturePrincipale = parsedLignes[0].numero_facture_fournisseur;

  const result = db.transaction(() => {
    // 1. Créer l'achat + ses lignes
    const info = db.prepare(`INSERT INTO achat (numero, fournisseur_id, fournisseur_libre, numero_facture_fournisseur, cree_par_id, notes)
                             VALUES (?, ?, ?, ?, ?, ?)`)
      .run(numero, fournPrincipal, '', facturePrincipale, req.user.id, notes);
    const achatId = Number(info.lastInsertRowid);
    let total = 0;
    const insLigne = db.prepare(`INSERT INTO ligne_achat
      (achat_id, fournisseur_id, numero_facture_fournisseur, designation, unite, quantite, prix_unitaire, activite_pressentie_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const lignesCrees = [];
    for (const l of parsedLignes) {
      const linfo = insLigne.run(achatId, l.fournisseur_id, String(l.numero_facture_fournisseur).trim(),
                   l.designation, l.unite || 'unité', Number(l.quantite || 0), Number(l.prix_unitaire || 0),
                   l.activite_pressentie_id || null, l.notes || '');
      lignesCrees.push({ id: Number(linfo.lastInsertRowid), ...l });
      total += Number(l.quantite || 0) * Number(l.prix_unitaire || 0);
    }
    db.prepare('UPDATE achat SET montant_total = ? WHERE id = ?').run(total, achatId);

    // 2. AUTO-DISTRIBUTION : pour les lignes pré-affectées à une activité,
    //    créer directement une distribution en statut REMISE (bypass Nestor)
    const lignesAffectees = lignesCrees.filter(l => l.activite_pressentie_id);
    if (lignesAffectees.length) {
      const parActivite = new Map();
      for (const l of lignesAffectees) {
        const k = Number(l.activite_pressentie_id);
        if (!parActivite.has(k)) parActivite.set(k, []);
        parActivite.get(k).push(l);
      }

      for (const [activiteId, lignes] of parActivite) {
        const numDist = h.prochainNumeroDistribution(db);
        const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
        // Statut REMISE direct : Mme Sandra affecte, le gestionnaire reçoit tout de suite
        const dinfo = db.prepare(`INSERT INTO distribution
          (numero, activite_id, cree_par_id, remise_par_id, date_remise, statut, notes)
          VALUES (?, ?, ?, ?, ?, 'REMISE', ?)`)
          .run(numDist, activiteId, req.user.id, req.user.id, nowIso,
               `Affectation directe par la Direction depuis l'achat ${numero}`);
        const distId = Number(dinfo.lastInsertRowid);

        const insLd = db.prepare(`INSERT INTO ligne_distribution (distribution_id, ligne_achat_id, produit_id, quantite_annoncee)
                                  VALUES (?, ?, ?, ?)`);
        const updDist = db.prepare('UPDATE ligne_achat SET quantite_distribuee = quantite_distribuee + ? WHERE id = ?');

        for (const l of lignes) {
          // Trouver / créer le produit destination dans le catalogue de l'activité
          let produit = db.prepare('SELECT * FROM produit WHERE activite_id = ? AND LOWER(designation) = LOWER(?)').get(activiteId, l.designation);
          if (!produit) {
            let cat = db.prepare("SELECT * FROM categorie WHERE activite_id = ? AND nom = 'Non classé'").get(activiteId);
            if (!cat) {
              const cinfo = db.prepare("INSERT INTO categorie (activite_id, nom, description) VALUES (?, 'Non classé', 'Produits ajoutés automatiquement par distribution')").run(activiteId);
              cat = { id: Number(cinfo.lastInsertRowid) };
            }
            const ref = h.prochaineReferenceProduit(db, activiteId);
            const pinfo = db.prepare(`INSERT INTO produit (activite_id, reference, designation, categorie_id, fournisseur_id, unite, prix_achat, stock_actuel, stock_minimum, stock_maximum, actif)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 5, 100, 1)`)
              .run(activiteId, ref, l.designation, cat.id, null, l.unite || 'unité', Number(l.prix_unitaire || 0));
            produit = { id: Number(pinfo.lastInsertRowid) };
          }
          insLd.run(distId, l.id, produit.id, Number(l.quantite || 0));
          updDist.run(Number(l.quantite || 0), l.id);
        }
      }

      // Mettre à jour le statut de l'achat
      const restant = db.prepare(`SELECT COALESCE(SUM(quantite - quantite_distribuee), 0) AS r FROM ligne_achat WHERE achat_id = ?`).get(achatId).r;
      if (restant <= 0.001) {
        db.prepare("UPDATE achat SET statut = 'DISTRIBUE', receptionne_par_id = ?, date_reception = datetime('now') WHERE id = ?").run(req.user.id, achatId);
      }
      // Sinon : achat reste SAISI (Nestor doit traiter les lignes sans activité pressentie)
    }

    // 3. JOURNALISATION COMPTABLE — enregistrement de l'achat auprès du fournisseur
    // Débit 604 Achats matières premières (HT) · Débit 445 TVA déductible · Crédit 401 Fournisseurs
    // Note : on considère que le montant saisi est TTC (avec TVA incluse). Ajustable dans le futur si prix HT séparés.
    const ttc = total;
    const decompo = h.decomposerTTC(ttc);
    const lignesAchatEcr = [
      { compte: '604', debit: decompo.ht, credit: 0 },
      { compte: '445', debit: decompo.tva, credit: 0 },
      { compte: '401', debit: 0, credit: ttc },
    ];
    // Vérifier balance à cause des arrondis (débit = crédit)
    const totalD = decompo.ht + decompo.tva;
    if (Math.abs(totalD - ttc) > 0.01) {
      // Ajuster la ligne 604 (HT) pour équilibrer parfaitement
      lignesAchatEcr[0].debit = ttc - decompo.tva;
    }
    h.enregistrerEcriture(db, {
      journal: 'AC',
      libelle: `Achat ${numero} — facture ${facturePrincipale}`,
      lignes: lignesAchatEcr,
      referenceMetier: `ACHAT#${achatId}`,
      activiteId: null,
      utilisateurId: req.user.id,
    });

    return { achatId, nbAutoDistribuees: lignesAffectees.length };
  })();

  if (result.nbAutoDistribuees > 0) {
    req.flash('success', `Achat ${numero} enregistré · ${result.nbAutoDistribuees} ligne(s) affectée(s) sont directement remises aux gestionnaires concernés.`);
  } else {
    req.flash('success', `Achat ${numero} enregistré. Nestor doit maintenant réceptionner et distribuer.`);
  }
  res.redirect('/achats/' + result.achatId);
});

// =========================================================
// DÉTAIL D'UN ACHAT
// =========================================================
router.get('/:id(\\d+)', requirePerm('achats.consulter'), (req, res) => {
  const achat = db.prepare(`SELECT a.*, f.raison_sociale AS fournisseur_nom, f.telephone AS fournisseur_tel,
      COALESCE(f.raison_sociale, a.fournisseur_libre) AS fournisseur_affichage,
      u.first_name || ' ' || u.last_name AS cree_par_nom,
      u2.first_name || ' ' || u2.last_name AS receptionne_par_nom
    FROM achat a
    LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
    LEFT JOIN utilisateur u ON u.id = a.cree_par_id
    LEFT JOIN utilisateur u2 ON u2.id = a.receptionne_par_id
    WHERE a.id = ?`).get(req.params.id);
  if (!achat) return res.redirect('/achats/');

  const lignes = db.prepare(`SELECT la.*, act.nom AS activite_pressentie_nom,
      f.raison_sociale AS fournisseur_ligne_nom,
      (SELECT COALESCE(SUM(ld.quantite_annoncee), 0) FROM ligne_distribution ld WHERE ld.ligne_achat_id = la.id) AS qte_dist_annoncee,
      (SELECT COALESCE(SUM(ld.quantite_recue), 0) FROM ligne_distribution ld WHERE ld.ligne_achat_id = la.id AND ld.quantite_recue IS NOT NULL) AS qte_dist_recue
    FROM ligne_achat la
    LEFT JOIN activite act ON act.id = la.activite_pressentie_id
    LEFT JOIN fournisseur f ON f.id = la.fournisseur_id
    WHERE la.achat_id = ?
    ORDER BY la.fournisseur_id, la.id`).all(req.params.id);

  // Distributions liées
  const distributions = db.prepare(`SELECT d.*, act.nom AS activite_nom, act.code AS activite_code, act.couleur AS activite_couleur,
      u.first_name || ' ' || u.last_name AS cree_par_nom
    FROM distribution d
    JOIN activite act ON act.id = d.activite_id
    LEFT JOIN utilisateur u ON u.id = d.cree_par_id
    WHERE d.id IN (SELECT DISTINCT distribution_id FROM ligne_distribution WHERE ligne_achat_id IN (SELECT id FROM ligne_achat WHERE achat_id = ?))
    ORDER BY d.date_creation DESC`).all(req.params.id);

  res.render('achats/detail', {
    title: 'Achat ' + achat.numero, page_title: 'Achat ' + achat.numero,
    achat, lignes, distributions,
    peut_saisir: h.utilisateurPeut(db, req.user, 'achats.saisir'),
    peut_receptionner: h.utilisateurPeut(db, req.user, 'achats.receptionner'),
    peut_distribuer: h.utilisateurPeut(db, req.user, 'distribution.creer'),
    peut_annuler: h.utilisateurPeut(db, req.user, 'achats.annuler'),
  });
});

// =========================================================
// MARQUER COMME RÉCEPTIONNÉ (bouton Nestor)
// =========================================================
router.post('/:id(\\d+)/receptionner', requirePerm('achats.receptionner'), (req, res) => {
  db.prepare(`UPDATE achat SET statut = 'RECEPTIONNE', receptionne_par_id = ?, date_reception = datetime('now')
              WHERE id = ? AND statut = 'SAISI'`)
    .run(req.user.id, req.params.id);
  req.flash('success', 'Achat marqué comme réceptionné. Vous pouvez maintenant créer des distributions.');
  res.redirect('/achats/' + req.params.id);
});

// =========================================================
// ANNULER
// =========================================================
router.post('/:id(\\d+)/annuler', requirePerm('achats.annuler'), (req, res) => {
  const achat = db.prepare('SELECT * FROM achat WHERE id = ?').get(req.params.id);
  if (!achat) return res.redirect('/achats/');
  if (achat.statut === 'CLOTURE') { req.flash('warning', 'Achat cloturé, annulation impossible.'); return res.redirect('/achats/' + req.params.id); }
  db.prepare(`UPDATE achat SET statut = 'ANNULE' WHERE id = ?`).run(req.params.id);
  req.flash('info', 'Achat annulé.');
  res.redirect('/achats/');
});

module.exports = router;
