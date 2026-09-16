// Clôture de caisse quotidienne (Pâtisserie + Bona Burger)
// Chaque caissier ouvre sa session avec un fond, encaisse la journée, puis clôture avec décompte physique
const express = require('express');
const PDFDocument = require('pdfkit');

const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// Middlewares structurels : activité sélectionnée + type B2C
function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
function requireB2C(req, res, next) {
  if (!req.activite || req.activite.type !== 'B2C_CAISSE') {
    req.flash('warning', 'La caisse n\'est disponible que pour les activités B2C (Pâtisserie, Bona Burger).');
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
router.use(requireActivite, requireB2C);

// Helper : trouver la clôture ouverte du caissier courant sur l'activité courante
function clotureOuvertePour(activiteId, caissierId) {
  return db.prepare(`SELECT * FROM cloture_caisse WHERE activite_id = ? AND ouvert_par_id = ? AND statut = 'OUVERTE'
                     ORDER BY date_ouverture DESC LIMIT 1`).get(activiteId, caissierId);
}

// Calculer les totaux théoriques pour une clôture
function calculerTheorique(cloture) {
  const debut = cloture.date_ouverture;
  const fin = cloture.date_cloture || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const rows = db.prepare(`SELECT mode_paiement, COALESCE(SUM(montant_total - montant_remise + montant_tva), 0) AS mt, COUNT(*) AS nb
                           FROM vente
                           WHERE activite_id = ? AND caissier_id = ?
                             AND date_vente >= ? AND date_vente <= ?
                           GROUP BY mode_paiement`).all(cloture.activite_id, cloture.ouvert_par_id, debut, fin);
  const totaux = { ESPECES: 0, CARTE_CREDIT: 0, ORANGE: 0, MTN: 0, nb_ventes: 0, ca_total: 0 };
  for (const r of rows) {
    if (r.mode_paiement in totaux) totaux[r.mode_paiement] = Number(r.mt);
    totaux.nb_ventes += Number(r.nb);
    totaux.ca_total += Number(r.mt);
  }
  // Espèces théoriques attendues en caisse = fond ouverture + ventes espèces
  totaux.especes_theorique = Number(cloture.fond_ouverture || 0) + totaux.ESPECES;
  return totaux;
}

// =========================================================
// LISTE / HISTORIQUE — tableau de bord des états de caisse
// =========================================================
router.get('/', h.permissionRequise(db, 'caisse.etat.lire'), (req, res) => {
  const ouverte = clotureOuvertePour(req.activiteId, req.user.id);
  const periode = h.resoudrePeriode(req.query);
  const filtres = ['c.activite_id = ?'];
  const params = [req.activiteId];
  if (!h.isDG(req.user)) { filtres.push('c.ouvert_par_id = ?'); params.push(req.user.id); }
  if (periode.debut) { filtres.push('date(c.date_ouverture) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(c.date_ouverture) <= date(?)'); params.push(periode.fin); }
  const whereClause = filtres.join(' AND ');
  const p = h.pagination(req);
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM cloture_caisse c WHERE ${whereClause}`).get(...params);
  const clotures = db.prepare(`SELECT c.*, u.first_name AS ouvert_par_prenom, u.username AS ouvert_par_username,
                                      u2.first_name AS cloture_par_prenom
                               FROM cloture_caisse c
                               LEFT JOIN utilisateur u ON u.id = c.ouvert_par_id
                               LEFT JOIN utilisateur u2 ON u2.id = c.cloture_par_id
                               WHERE ${whereClause}
                               ORDER BY c.date_ouverture DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  let theoriqueEnCours = null;
  if (ouverte) theoriqueEnCours = calculerTheorique(ouverte);
  res.render('caisses/liste', {
    title: 'États de caisse', page_title: `Caisse — ${req.activite.nom}`,
    clotures, ouverte, theorique_en_cours: theoriqueEnCours, periode,
    pagination: h.paginationInfo(p, totalRow.n, req),
  });
});

// =========================================================
// OUVRIR UNE CAISSE (fond initial)
// =========================================================
router.get('/ouvrir', h.permissionRequise(db, 'caisse.ouvrir'), (req, res) => {
  const ouverte = clotureOuvertePour(req.activiteId, req.user.id);
  if (ouverte) { req.flash('warning', 'Vous avez déjà une caisse ouverte. Clôturez-la d\'abord.'); return res.redirect('/caisses/'); }
  res.render('caisses/ouvrir', {
    title: 'Ouvrir la caisse', page_title: 'Ouvrir une nouvelle session',
    fond_suggere: 10000, // fond suggéré par défaut
  });
});

router.post('/ouvrir', h.permissionRequise(db, 'caisse.ouvrir'), (req, res) => {
  const ouverte = clotureOuvertePour(req.activiteId, req.user.id);
  if (ouverte) { req.flash('warning', 'Une caisse est déjà ouverte.'); return res.redirect('/caisses/'); }
  const fond = Math.round(Number(String(req.body.fond_ouverture || '0').replace(',', '.')));
  if (fond < 0) { req.flash('error', 'Fond d\'ouverture invalide.'); return res.redirect('/caisses/ouvrir'); }
  const numero = h.prochainNumeroCloture(db, req.activite.code);
  const info = db.prepare(`INSERT INTO cloture_caisse (activite_id, numero, fond_ouverture, ouvert_par_id, statut)
              VALUES (?, ?, ?, ?, 'OUVERTE')`).run(req.activiteId, numero, fond, req.user.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'CAISSE_OUVERTE',
    entite: 'cloture_caisse', entite_id: Number(info.lastInsertRowid),
    details: `${numero} — fond ${h.formatNombre(fond)} FCFA` });
  req.flash('success', `Caisse ${numero} ouverte avec ${h.formatNombre(fond)} FCFA de fond.`);
  res.redirect('/caisses/');
});

// =========================================================
// CLÔTURER LA CAISSE OUVERTE
// =========================================================
router.get('/cloturer', h.permissionRequise(db, 'caisse.cloturer'), (req, res) => {
  const ouverte = clotureOuvertePour(req.activiteId, req.user.id);
  if (!ouverte) { req.flash('warning', 'Aucune caisse ouverte à clôturer.'); return res.redirect('/caisses/'); }
  const theorique = calculerTheorique(ouverte);
  res.render('caisses/cloturer', {
    title: 'Clôturer la caisse', page_title: `Clôturer ${ouverte.numero}`,
    cloture: ouverte, theorique,
  });
});

router.post('/cloturer', h.permissionRequise(db, 'caisse.cloturer'), (req, res) => {
  const ouverte = clotureOuvertePour(req.activiteId, req.user.id);
  if (!ouverte) { req.flash('warning', 'Aucune caisse ouverte.'); return res.redirect('/caisses/'); }
  const b = req.body;
  const compteEsp = Math.round(Number(String(b.total_compte_especes || '0').replace(',', '.')));
  const carteCredit = Math.round(Number(String(b.total_carte_credit || '0').replace(',', '.')));
  const orange = Math.round(Number(String(b.total_orange || '0').replace(',', '.')));
  const mtn = Math.round(Number(String(b.total_mtn || '0').replace(',', '.')));
  const notes = b.notes || '';
  const theorique = calculerTheorique(ouverte);
  const ecart = compteEsp - theorique.especes_theorique;
  db.prepare(`UPDATE cloture_caisse SET
                date_cloture = datetime('now'),
                total_theorique_especes = ?,
                total_compte_especes = ?,
                total_carte_credit = ?,
                total_orange = ?,
                total_mtn = ?,
                ecart = ?,
                statut = 'CLOTUREE',
                cloture_par_id = ?,
                notes = ?
              WHERE id = ?`)
    .run(theorique.especes_theorique, compteEsp, carteCredit, orange, mtn, ecart, req.user.id, notes, ouverte.id);
  // Lier toutes les ventes non liées de cette session à la clôture
  db.prepare(`UPDATE vente SET cloture_id = ?
              WHERE activite_id = ? AND caissier_id = ?
                AND date_vente >= ? AND (cloture_id IS NULL OR cloture_id = 0)`)
    .run(ouverte.id, req.activiteId, req.user.id, ouverte.date_ouverture);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'CAISSE_CLOTUREE',
    entite: 'cloture_caisse', entite_id: ouverte.id,
    details: `${ouverte.numero} — compté ${h.formatNombre(compteEsp)} / théorique ${h.formatNombre(theorique.especes_theorique)} — écart ${h.formatNombre(ecart)}` });
  // Alerte séparée si écart significatif
  if (Math.abs(ecart) > 500) {
    h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'CAISSE_ECART',
      entite: 'cloture_caisse', entite_id: ouverte.id,
      details: `Écart significatif : ${h.formatNombre(ecart)} FCFA sur clôture ${ouverte.numero}${notes ? ' — motif : ' + String(notes).slice(0, 200) : ''}` });
  }
  req.flash('success', `Caisse ${ouverte.numero} clôturée. Écart : ${h.formatNombre(ecart)} FCFA.`);
  res.redirect('/caisses/' + ouverte.id);
});

// =========================================================
// DÉTAIL D'UNE CLÔTURE
// =========================================================
router.get('/:id(\\d+)', h.permissionRequise(db, 'caisse.etat.detail'), (req, res) => {
  const cloture = db.prepare(`SELECT c.*,
                                     u.first_name AS ouvert_par_prenom, u.username AS ouvert_par_username,
                                     u2.first_name AS cloture_par_prenom, u2.username AS cloture_par_username
                              FROM cloture_caisse c
                              LEFT JOIN utilisateur u ON u.id = c.ouvert_par_id
                              LEFT JOIN utilisateur u2 ON u2.id = c.cloture_par_id
                              WHERE c.id = ? AND c.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!cloture) { req.flash('warning', 'Clôture introuvable.'); return res.redirect('/caisses/'); }
  // Restriction : caissier ne voit que ses propres clôtures
  if (!h.isDG(req.user) && cloture.ouvert_par_id !== req.user.id) {
    req.flash('error', 'Accès refusé à cette clôture.'); return res.redirect('/caisses/');
  }
  const theorique = calculerTheorique(cloture);
  const ventes = db.prepare(`SELECT v.*, c.nom AS client_nom
                             FROM vente v LEFT JOIN client c ON c.id = v.client_id
                             WHERE v.activite_id = ? AND v.caissier_id = ?
                               AND v.date_vente >= ? AND v.date_vente <= COALESCE(?, datetime('now'))
                             ORDER BY v.date_vente`).all(
    cloture.activite_id, cloture.ouvert_par_id, cloture.date_ouverture, cloture.date_cloture);
  res.render('caisses/detail', {
    title: 'État de caisse ' + cloture.numero, page_title: cloture.numero,
    cloture, theorique, ventes,
  });
});

// =========================================================
// PDF RAPPORT DE CLÔTURE
// =========================================================
router.get('/:id(\\d+)/pdf', h.permissionRequise(db, 'caisse.etat.pdf'), (req, res) => {
  const cloture = db.prepare(`SELECT c.*,
                                     u.first_name AS ouvert_par_prenom, u.last_name AS ouvert_par_nom,
                                     u2.first_name AS cloture_par_prenom, u2.last_name AS cloture_par_nom
                              FROM cloture_caisse c
                              LEFT JOIN utilisateur u ON u.id = c.ouvert_par_id
                              LEFT JOIN utilisateur u2 ON u2.id = c.cloture_par_id
                              WHERE c.id = ? AND c.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!cloture) return res.redirect('/caisses/');
  const p = {
    entreprise_nom: req.parametres?.entreprise_nom || 'Le Traiteur du Bistrot',
    entreprise_adresse: req.parametres?.entreprise_adresse || '',
    entreprise_tel: req.parametres?.entreprise_tel || '',
    devise: req.parametres?.devise || 'FCFA',
  };
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="etat_caisse_${cloture.numero}.pdf"`);
  doc.pipe(res);

  // En-tête
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1e3a8a').text(p.entreprise_nom, 40, 40);
  doc.font('Helvetica').fontSize(10).fillColor('#000').text(`${req.activite.nom} — État de caisse quotidien`, 40, 62);
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#000').text('ÉTAT DE CAISSE ' + cloture.numero, 40, 90);
  doc.moveTo(40, 118).lineTo(555, 118).strokeColor('#CA8A04').lineWidth(1.5).stroke();

  // Bloc infos session
  let y = 135;
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text('Ouvert le : ' + h.formatDate(cloture.date_ouverture, true), 40, y);
  doc.text('Par : ' + ((cloture.ouvert_par_prenom || '') + ' ' + (cloture.ouvert_par_nom || '')).trim(), 300, y);
  y += 16;
  doc.text('Clôturé le : ' + (cloture.date_cloture ? h.formatDate(cloture.date_cloture, true) : '—'), 40, y);
  doc.text('Par : ' + ((cloture.cloture_par_prenom || '') + ' ' + (cloture.cloture_par_nom || '')).trim(), 300, y);
  y += 24;

  // Tableau détail par mode de paiement
  doc.rect(40, y, 515, 22).fill('#1e3a8a');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
  doc.text('MODE DE PAIEMENT', 50, y + 7);
  doc.text('THÉORIQUE', 280, y + 7, { width: 100, align: 'right' });
  doc.text('COMPTÉ', 385, y + 7, { width: 80, align: 'right' });
  doc.text('ÉCART', 470, y + 7, { width: 80, align: 'right' });
  y += 22;

  doc.fillColor('#000').font('Helvetica').fontSize(10);
  const rows = [
    ['Fond d\'ouverture', Number(cloture.fond_ouverture), '', ''],
    ['Espèces (ventes)', Number(cloture.total_theorique_especes) - Number(cloture.fond_ouverture), '', ''],
    ['TOTAL ESPÈCES', Number(cloture.total_theorique_especes), Number(cloture.total_compte_especes), Number(cloture.ecart)],
    ['Carte de crédit', Number(cloture.total_carte_credit || 0), Number(cloture.total_carte_credit || 0), 0],
    ['Orange Money', Number(cloture.total_orange), Number(cloture.total_orange), 0],
    ['MTN Mobile Money', Number(cloture.total_mtn), Number(cloture.total_mtn), 0],
  ];
  for (const [lbl, theo, cpt, ecart] of rows) {
    const isTotal = lbl.startsWith('TOTAL');
    if (isTotal) { doc.rect(40, y, 515, 20).fill('#F1F5F9'); doc.font('Helvetica-Bold'); }
    else { doc.font('Helvetica'); }
    doc.fillColor('#000').fontSize(10);
    doc.text(lbl, 50, y + 5);
    doc.text(h.formatNombre(theo), 280, y + 5, { width: 100, align: 'right' });
    if (cpt !== '') doc.text(h.formatNombre(cpt), 385, y + 5, { width: 80, align: 'right' });
    if (ecart !== '') {
      const c = Number(ecart) < 0 ? '#dc2626' : Number(ecart) > 0 ? '#f59e0b' : '#16a34a';
      doc.fillColor(c);
      doc.text((ecart > 0 ? '+' : '') + h.formatNombre(ecart), 470, y + 5, { width: 80, align: 'right' });
      doc.fillColor('#000');
    }
    y += 20;
  }
  y += 10;

  // Total recettes journée = uniquement les VENTES (pas le fond, qui n'est pas une recette)
  const ventesEspeces = Number(cloture.total_theorique_especes) - Number(cloture.fond_ouverture || 0);
  const totalRecettes = ventesEspeces + Number(cloture.total_carte_credit || 0) + Number(cloture.total_orange) + Number(cloture.total_mtn);
  doc.rect(40, y, 515, 26).fill('#CA8A04');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12);
  doc.text('TOTAL RECETTES JOURNÉE', 50, y + 8);
  doc.text(h.formatNombre(totalRecettes) + ' ' + p.devise, 385, y + 8, { width: 160, align: 'right' });
  y += 34;

  // Écart
  if (Number(cloture.ecart) !== 0) {
    const label = Number(cloture.ecart) < 0 ? 'MANQUANT en caisse' : 'EXCÉDENT en caisse';
    const color = Number(cloture.ecart) < 0 ? '#dc2626' : '#f59e0b';
    doc.fillColor(color).font('Helvetica-Bold').fontSize(11);
    doc.text(`${label} : ${h.formatNombre(Math.abs(cloture.ecart))} ${p.devise}`, 40, y);
    y += 20;
  }

  // Notes
  if (cloture.notes) {
    doc.fillColor('#000').font('Helvetica').fontSize(10);
    doc.text('Observations : ' + cloture.notes, 40, y, { width: 515 });
    y = doc.y + 10;
  }

  // Signatures
  y = Math.max(y + 20, 640);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('CAISSIER', 60, y, { align: 'center', width: 200 });
  doc.rect(60, y + 15, 200, 60).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#64748B').text('Nom & signature', 60, y + 18, { align: 'center', width: 200 });

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('DIRECTION', 335, y, { align: 'center', width: 200 });
  doc.rect(335, y + 15, 200, 60).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#64748B').text('Contrôle & visa', 335, y + 18, { align: 'center', width: 200 });

  doc.end();
});

module.exports = router;
