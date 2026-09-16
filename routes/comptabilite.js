// Module comptabilité — écritures OHADA, journaux, TVA, trésorerie
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// Enforcement granulaire via FEATURES (voir helpers.js) :
//   compta.consulter      → dashboard, journaux, grand livre
//   compta.tva            → déclaration TVA
//   compta.plan_comptable → plan comptable OHADA
//   compta.exports        → tous les endpoints /exports/*
const permCompta      = h.permissionRequise(db, 'compta.consulter');
const permComptaTva   = h.permissionRequise(db, 'compta.tva');
const permComptaPlan  = h.permissionRequise(db, 'compta.plan_comptable');
const permComptaExp   = h.permissionRequise(db, 'compta.exports');

// =========================================================
// TABLEAU DE BORD FINANCIER
// =========================================================
router.get('/', permCompta, (req, res) => {
  const debutMois = new Date().toISOString().slice(0, 7) + '-01';
  const debutAnnee = new Date().toISOString().slice(0, 4) + '-01-01';

  // Trésorerie : solde caisses + banque
  const tresorerie = { total: 0, caisses: [], banque: 0 };
  const activites = db.prepare("SELECT id, nom, code FROM activite WHERE actif = 1 ORDER BY id").all();
  for (const a of activites) {
    const compte = h.compteCaisseActivite(db, a.code);
    const s = h.soldeCompte(db, compte);
    tresorerie.caisses.push({ activite: a.nom, code: a.code, compte, solde: s.solde });
    tresorerie.total += s.solde;
  }
  tresorerie.banque = h.soldeCompte(db, '521').solde;
  tresorerie.total += tresorerie.banque;

  // CA du mois (produits 7xx)
  const caMois = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS ca
                             FROM ecriture_comptable
                             WHERE compte LIKE '70%' AND date(date_ecriture) >= date(?)`).get(debutMois).ca;
  const caMoisPrec = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS ca
                                 FROM ecriture_comptable
                                 WHERE compte LIKE '70%' AND date(date_ecriture) >= date(?, '-1 month')
                                   AND date(date_ecriture) < date(?)`).get(debutMois, debutMois).ca;

  // Achats du mois (charges 60x)
  const achatsMois = db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS montant
                                 FROM ecriture_comptable
                                 WHERE compte LIKE '60%' AND date(date_ecriture) >= date(?)`).get(debutMois).montant;

  // Clients à encaisser (compte 411)
  const aEncaisser = db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS montant
                                 FROM ecriture_comptable WHERE compte = '411'`).get().montant;

  // Fournisseurs à payer (compte 401)
  const aPayer = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS montant
                             FROM ecriture_comptable WHERE compte = '401'`).get().montant;

  // TVA du mois
  const tvaCollectee = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS m
                                   FROM ecriture_comptable
                                   WHERE compte = '443' AND date(date_ecriture) >= date(?)`).get(debutMois).m;
  const tvaDeductible = db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS m
                                    FROM ecriture_comptable
                                    WHERE compte = '445' AND date(date_ecriture) >= date(?)`).get(debutMois).m;
  const tvaNette = tvaCollectee - tvaDeductible;

  // Dernières écritures
  const dernieresEcritures = db.prepare(`SELECT id, date_ecriture, journal, numero_piece, libelle,
                                                SUM(debit) AS d, SUM(credit) AS c,
                                                MIN(reference_metier) AS reference
                                         FROM ecriture_comptable
                                         GROUP BY numero_piece
                                         ORDER BY date_ecriture DESC, id DESC LIMIT 15`).all();

  // Répartition CA par activité (mois en cours)
  const caParActivite = db.prepare(`SELECT a.nom, a.code, a.couleur,
                                           COALESCE(SUM(e.credit - e.debit), 0) AS ca
                                    FROM activite a
                                    LEFT JOIN ecriture_comptable e ON e.activite_id = a.id
                                      AND e.compte LIKE '70%' AND date(e.date_ecriture) >= date(?)
                                    WHERE a.actif = 1
                                    GROUP BY a.id ORDER BY ca DESC`).all(debutMois);

  res.render('comptabilite/dashboard', {
    title: 'Comptabilité — Situation financière',
    page_title: 'Situation financière',
    tresorerie, caMois, caMoisPrec, achatsMois, aEncaisser, aPayer,
    tvaCollectee, tvaDeductible, tvaNette,
    dernieresEcritures, caParActivite,
    debutMois, debutAnnee,
  });
});

// =========================================================
// JOURNAUX (liste + détail par code)
// =========================================================
router.get('/journaux/', permCompta, (req, res) => {
  const journaux = db.prepare(`SELECT j.*, COUNT(e.id) AS nb_ecritures, MAX(e.date_ecriture) AS derniere
                               FROM journal_comptable j
                               LEFT JOIN ecriture_comptable e ON e.journal = j.code
                               GROUP BY j.code ORDER BY j.code`).all();
  res.render('comptabilite/journaux', {
    title: 'Journaux comptables', page_title: 'Journaux comptables',
    journaux,
  });
});

router.get('/journaux/:code', permCompta, (req, res) => {
  const code = req.params.code.toUpperCase();
  const journal = db.prepare('SELECT * FROM journal_comptable WHERE code = ?').get(code);
  if (!journal) { req.flash('warning', 'Journal introuvable.'); return res.redirect('/comptabilite/journaux/'); }
  const periode = h.resoudrePeriode(req.query);

  const filtres = ['journal = ?'];
  const params = [code];
  if (periode.debut) { filtres.push('date(date_ecriture) >= date(?)'); params.push(periode.debut); }
  if (periode.fin)   { filtres.push('date(date_ecriture) <= date(?)'); params.push(periode.fin); }

  const p = h.pagination(req);
  // Compter les pièces distinctes
  const nbTotal = db.prepare(`SELECT COUNT(DISTINCT numero_piece) AS n FROM ecriture_comptable WHERE ${filtres.join(' AND ')}`).get(...params).n;

  // Récupérer les pièces (regroupées par numero_piece)
  const piecesRows = db.prepare(`SELECT numero_piece, date_ecriture, libelle, reference_metier,
                                         SUM(debit) AS total_debit, SUM(credit) AS total_credit
                                  FROM ecriture_comptable
                                  WHERE ${filtres.join(' AND ')}
                                  GROUP BY numero_piece
                                  ORDER BY date_ecriture DESC, numero_piece DESC
                                  LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);

  // Pour chaque pièce, charger les lignes
  const piecesEnrichies = piecesRows.map(p => {
    const lignes = db.prepare(`SELECT e.compte, e.debit, e.credit, cc.libelle AS compte_libelle
                                FROM ecriture_comptable e
                                LEFT JOIN compte_comptable cc ON cc.numero = e.compte
                                WHERE e.numero_piece = ?
                                ORDER BY e.id`).all(p.numero_piece);
    return { ...p, lignes };
  });

  // Total période
  const totaux = db.prepare(`SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
                              FROM ecriture_comptable WHERE ${filtres.join(' AND ')}`).get(...params);

  res.render('comptabilite/journal_detail', {
    title: `Journal ${code}`, page_title: `${journal.libelle} (${code})`,
    journal, pieces: piecesEnrichies, totaux, periode,
    pagination: h.paginationInfo(p, nbTotal, req),
  });
});

// =========================================================
// GRAND LIVRE (mouvements d'un compte)
// =========================================================
router.get('/grand-livre/', permCompta, (req, res) => {
  const compteFiltre = req.query.compte || '';
  const comptes = db.prepare(`SELECT c.*, COUNT(e.id) AS nb_mouvements,
                                     COALESCE(SUM(e.debit), 0) AS total_d, COALESCE(SUM(e.credit), 0) AS total_c
                              FROM compte_comptable c
                              LEFT JOIN ecriture_comptable e ON e.compte = c.numero
                              WHERE c.actif = 1
                              GROUP BY c.numero ORDER BY c.numero`).all();
  const comptesAvecMvt = comptes.filter(c => c.nb_mouvements > 0);
  let mouvements = null;
  let compteSelectionne = null;
  let paginationGL = null;
  if (compteFiltre) {
    compteSelectionne = comptes.find(c => c.numero === compteFiltre);
    if (compteSelectionne) {
      const p = h.pagination(req, 50);
      const totalMvt = db.prepare('SELECT COUNT(*) AS n FROM ecriture_comptable WHERE compte = ?').get(compteFiltre).n;
      mouvements = db.prepare(`SELECT e.*, j.libelle AS journal_libelle
                               FROM ecriture_comptable e
                               LEFT JOIN journal_comptable j ON j.code = e.journal
                               WHERE e.compte = ? ORDER BY e.date_ecriture, e.id LIMIT ? OFFSET ?`).all(compteFiltre, p.taille, p.offset);
      paginationGL = h.paginationInfo(p, totalMvt, req);
    }
  }
  res.render('comptabilite/grand_livre', {
    title: 'Grand livre', page_title: 'Grand livre',
    comptes, comptesAvecMvt, compteFiltre, compteSelectionne, mouvements,
    pagination: paginationGL,
  });
});

// =========================================================
// ÉTAT TVA (à décaisser mensuel)
// =========================================================
router.get('/tva/', permComptaTva, (req, res) => {
  const moisFiltre = req.query.mois || new Date().toISOString().slice(0, 7);
  const debut = moisFiltre + '-01';
  const fin = new Date(new Date(debut).setMonth(new Date(debut).getMonth() + 1)).toISOString().slice(0, 10);

  // TVA collectée sur ventes (compte 443)
  const collectee = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS m,
                                        COUNT(DISTINCT numero_piece) AS nb
                                FROM ecriture_comptable
                                WHERE compte = '443' AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)`).get(debut, fin);
  // TVA déductible sur achats (compte 445)
  const deductible = db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS m,
                                        COUNT(DISTINCT numero_piece) AS nb
                                FROM ecriture_comptable
                                WHERE compte = '445' AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)`).get(debut, fin);
  const nette = (collectee.m || 0) - (deductible.m || 0);

  // Détail des écritures TVA collectée
  const detailCollectee = db.prepare(`SELECT date_ecriture, numero_piece, libelle, reference_metier, credit AS montant
                                       FROM ecriture_comptable
                                       WHERE compte = '443' AND credit > 0
                                         AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)
                                       ORDER BY date_ecriture DESC LIMIT 100`).all(debut, fin);
  const detailDeductible = db.prepare(`SELECT date_ecriture, numero_piece, libelle, reference_metier, debit AS montant
                                        FROM ecriture_comptable
                                        WHERE compte = '445' AND debit > 0
                                          AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)
                                        ORDER BY date_ecriture DESC LIMIT 100`).all(debut, fin);

  // Base HT (montants sans TVA) — approximatif : total ventes HT = compte 7xx
  const baseVentes = db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) AS m
                                 FROM ecriture_comptable
                                 WHERE compte LIKE '70%' AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)`).get(debut, fin).m;
  const baseAchats = db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS m
                                 FROM ecriture_comptable
                                 WHERE compte LIKE '60%' AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)`).get(debut, fin).m;

  res.render('comptabilite/tva', {
    title: 'État TVA', page_title: `État TVA — ${moisFiltre}`,
    moisFiltre, collectee, deductible, nette, baseVentes, baseAchats,
    detailCollectee, detailDeductible, tvaTaux: h.TVA_TAUX,
  });
});

// =========================================================
// PLAN COMPTABLE
// =========================================================
router.get('/plan-comptable/', permComptaPlan, (req, res) => {
  const comptes = db.prepare(`SELECT c.*, COUNT(e.id) AS nb_mouvements
                              FROM compte_comptable c
                              LEFT JOIN ecriture_comptable e ON e.compte = c.numero
                              GROUP BY c.numero ORDER BY c.numero`).all();
  res.render('comptabilite/plan_comptable', {
    title: 'Plan comptable OHADA', page_title: 'Plan comptable OHADA',
    comptes,
  });
});

// =========================================================
// EXPORTS EXCEL — livrables pour le cabinet comptable
// =========================================================

// Utilitaire : mise en forme d'un workbook standard
function nouveauClasseur(titre) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Le Traiteur du Bistrot';
  wb.created = new Date();
  wb.subject = titre;
  return wb;
}
function styleEnTete(ws) {
  const row = ws.getRow(1);
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFCA8A04' } } };
  });
}
function styleMontant(cell, negatif = false) {
  cell.numFmt = '#,##0';
  cell.alignment = { horizontal: 'right' };
  if (negatif) cell.font = { color: { argb: 'FFDC2626' } };
}

// Page d'index des exports
router.get('/exports/', permComptaExp, (req, res) => {
  const moisFiltre = req.query.mois || new Date().toISOString().slice(0, 7);
  res.render('comptabilite/exports', { title: 'Exports comptables', page_title: 'Exports pour le cabinet', moisFiltre });
});

// Fonction utilitaire : construire dates début/fin d'un mois YYYY-MM
function bornesDuMois(moisIso) {
  const debut = moisIso + '-01';
  const d = new Date(debut);
  const finDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const fin = finDate.toISOString().slice(0, 10);
  return { debut, fin, finExclusif: new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10) };
}

// ---- Journal des ventes B2B (factures) ----
router.get('/exports/ventes/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const rows = db.prepare(`SELECT c.numero_facture, c.date_commande, c.date_echeance,
                                  cl.nom AS client, cl.type_client, cl.niu,
                                  c.montant_total, c.montant_tva, c.montant_paye,
                                  a.nom AS activite,
                                  c.mode_paiement
                           FROM commande c
                           JOIN client cl ON cl.id = c.client_id
                           JOIN activite a ON a.id = c.activite_id
                           WHERE c.numero_facture IS NOT NULL AND c.numero_facture != ''
                             AND date(c.date_commande) >= date(?) AND date(c.date_commande) < date(?)
                             AND c.statut != 'ANNULEE'
                           ORDER BY c.date_commande, c.numero_facture`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Journal ventes B2B ${mois}`);
  const ws = wb.addWorksheet('Journal ventes', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'N° Facture', key: 'facture', width: 18 },
    { header: 'Date facture', key: 'date', width: 14 },
    { header: 'Échéance', key: 'echeance', width: 14 },
    { header: 'Client', key: 'client', width: 32 },
    { header: 'NIU', key: 'ninea', width: 18 },
    { header: 'Activité', key: 'activite', width: 18 },
    { header: 'Total HT', key: 'ht', width: 14 },
    { header: 'TVA (19,25%)', key: 'tva', width: 14 },
    { header: 'Total TTC', key: 'ttc', width: 14 },
    { header: 'Encaissé', key: 'encaisse', width: 14 },
    { header: 'Reste dû', key: 'reste', width: 14 },
    { header: 'Mode paiement', key: 'mode', width: 16 },
  ];
  styleEnTete(ws);
  let sHt = 0, sTva = 0, sTtc = 0, sEnc = 0;
  for (const r of rows) {
    const ttc = Number(r.montant_total || 0);
    const tva = Number(r.montant_tva || 0);
    const ht = ttc - tva;
    const enc = Number(r.montant_paye || 0);
    const reste = ttc - enc;
    const row = ws.addRow({ facture: r.numero_facture, date: r.date_commande, echeance: r.date_echeance || '',
      client: r.client, ninea: r.niu || '', activite: r.activite,
      ht, tva, ttc, encaisse: enc, reste, mode: r.mode_paiement || '' });
    ['ht', 'tva', 'ttc', 'encaisse', 'reste'].forEach(k => styleMontant(row.getCell(k)));
    sHt += ht; sTva += tva; sTtc += ttc; sEnc += enc;
  }
  const totalRow = ws.addRow({ facture: 'TOTAL', client: `${rows.length} facture(s)`,
    ht: sHt, tva: sTva, ttc: sTtc, encaisse: sEnc, reste: sTtc - sEnc });
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  ['ht', 'tva', 'ttc', 'encaisse', 'reste'].forEach(k => styleMontant(totalRow.getCell(k)));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="journal_ventes_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- Journal des ventes B2C (caisse consolidée) ----
router.get('/exports/ventes-b2c/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const rows = db.prepare(`SELECT v.numero, v.date_vente, v.montant_total, v.montant_tva, v.montant_remise,
                                  v.mode_paiement, v.origine, a.nom AS activite,
                                  cl.nom AS client_nom, cl.type_client
                           FROM vente v
                           JOIN activite a ON a.id = v.activite_id
                           LEFT JOIN client cl ON cl.id = v.client_id
                           WHERE date(v.date_vente) >= date(?) AND date(v.date_vente) < date(?)
                           ORDER BY v.date_vente, v.numero`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Journal ventes B2C ${mois}`);
  const ws = wb.addWorksheet('Ventes caisse', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'N° vente', key: 'numero', width: 18 },
    { header: 'Date', key: 'date', width: 18 },
    { header: 'Activité', key: 'activite', width: 20 },
    { header: 'Origine', key: 'origine', width: 12 },
    { header: 'Client', key: 'client', width: 24 },
    { header: 'Mode', key: 'mode', width: 12 },
    { header: 'Total HT', key: 'ht', width: 14 },
    { header: 'TVA', key: 'tva', width: 14 },
    { header: 'Remise', key: 'remise', width: 12 },
    { header: 'Total TTC', key: 'ttc', width: 14 },
  ];
  styleEnTete(ws);
  let sHt = 0, sTva = 0, sTtc = 0;
  for (const r of rows) {
    const ttc = Number(r.montant_total || 0);
    const tva = Number(r.montant_tva || 0);
    const row = ws.addRow({ numero: r.numero, date: r.date_vente, activite: r.activite,
      origine: r.origine || 'CAISSE', client: r.client_nom || 'Comptoir',
      mode: r.mode_paiement, ht: ttc - tva, tva, remise: r.montant_remise || 0, ttc });
    ['ht', 'tva', 'remise', 'ttc'].forEach(k => styleMontant(row.getCell(k)));
    sHt += (ttc - tva); sTva += tva; sTtc += ttc;
  }
  const tot = ws.addRow({ numero: 'TOTAL', client: `${rows.length} vente(s)`, ht: sHt, tva: sTva, ttc: sTtc });
  tot.font = { bold: true }; tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  ['ht', 'tva', 'ttc'].forEach(k => styleMontant(tot.getCell(k)));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="journal_ventes_caisse_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- Journal des achats ----
router.get('/exports/achats/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const rows = db.prepare(`SELECT a.numero, a.date_achat, a.numero_facture_fournisseur, a.montant_total,
                                  f.raison_sociale AS fournisseur, f.telephone,
                                  a.statut
                           FROM achat a
                           LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
                           WHERE date(a.date_achat) >= date(?) AND date(a.date_achat) < date(?)
                             AND a.statut != 'ANNULE'
                           ORDER BY a.date_achat, a.numero`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Journal achats ${mois}`);
  const ws = wb.addWorksheet('Achats', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'N° bon achat', key: 'numero', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Fournisseur', key: 'fournisseur', width: 32 },
    { header: 'Téléphone', key: 'tel', width: 16 },
    { header: 'N° Facture Frn.', key: 'facture_frn', width: 18 },
    { header: 'HT', key: 'ht', width: 14 },
    { header: 'TVA (19,25%)', key: 'tva', width: 14 },
    { header: 'TTC', key: 'ttc', width: 14 },
    { header: 'Statut', key: 'statut', width: 14 },
  ];
  styleEnTete(ws);
  let sHt = 0, sTva = 0, sTtc = 0;
  for (const r of rows) {
    const ttc = Number(r.montant_total || 0);
    const decomp = h.decomposerTTC(ttc);
    const row = ws.addRow({ numero: r.numero, date: r.date_achat, fournisseur: r.fournisseur || 'Divers',
      tel: r.telephone || '', facture_frn: r.numero_facture_fournisseur || '',
      ht: decomp.ht, tva: decomp.tva, ttc, statut: r.statut });
    ['ht', 'tva', 'ttc'].forEach(k => styleMontant(row.getCell(k)));
    sHt += decomp.ht; sTva += decomp.tva; sTtc += ttc;
  }
  const tot = ws.addRow({ numero: 'TOTAL', fournisseur: `${rows.length} achat(s)`, ht: sHt, tva: sTva, ttc: sTtc });
  tot.font = { bold: true }; tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  ['ht', 'tva', 'ttc'].forEach(k => styleMontant(tot.getCell(k)));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="journal_achats_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- Journal des règlements clients (paiements reçus) ----
router.get('/exports/reglements/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const rows = db.prepare(`SELECT p.numero_recu, p.date_paiement, p.montant, p.mode_paiement, p.reference_transaction,
                                  c.numero AS numero_commande, c.numero_facture,
                                  cl.nom AS client, cl.niu,
                                  a.nom AS activite
                           FROM paiement p
                           JOIN commande c ON c.id = p.commande_id
                           JOIN client cl ON cl.id = c.client_id
                           JOIN activite a ON a.id = p.activite_id
                           WHERE date(p.date_paiement) >= date(?) AND date(p.date_paiement) < date(?)
                           ORDER BY p.date_paiement, p.numero_recu`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Règlements clients ${mois}`);
  const ws = wb.addWorksheet('Règlements', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'N° Reçu', key: 'recu', width: 18 },
    { header: 'Date', key: 'date', width: 18 },
    { header: 'Client', key: 'client', width: 32 },
    { header: 'NIU', key: 'ninea', width: 18 },
    { header: 'Facture', key: 'facture', width: 18 },
    { header: 'Mode paiement', key: 'mode', width: 16 },
    { header: 'Référence', key: 'ref', width: 22 },
    { header: 'Montant', key: 'montant', width: 14 },
    { header: 'Activité', key: 'activite', width: 20 },
  ];
  styleEnTete(ws);
  let s = 0;
  for (const r of rows) {
    const m = Number(r.montant || 0);
    const row = ws.addRow({ recu: r.numero_recu, date: r.date_paiement, client: r.client, ninea: r.niu || '',
      facture: r.numero_facture || r.numero_commande, mode: r.mode_paiement, ref: r.reference_transaction || '',
      montant: m, activite: r.activite });
    styleMontant(row.getCell('montant'));
    s += m;
  }
  const tot = ws.addRow({ recu: 'TOTAL', client: `${rows.length} règlement(s)`, montant: s });
  tot.font = { bold: true }; tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  styleMontant(tot.getCell('montant'));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="journal_reglements_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- État TVA en Excel ----
router.get('/exports/tva/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const collectee = db.prepare(`SELECT date_ecriture, numero_piece, libelle, reference_metier, credit AS montant
                                 FROM ecriture_comptable WHERE compte = '443' AND credit > 0
                                   AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)
                                 ORDER BY date_ecriture`).all(debut, finExclusif);
  const deductible = db.prepare(`SELECT date_ecriture, numero_piece, libelle, reference_metier, debit AS montant
                                  FROM ecriture_comptable WHERE compte = '445' AND debit > 0
                                    AND date(date_ecriture) >= date(?) AND date(date_ecriture) < date(?)
                                  ORDER BY date_ecriture`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Etat TVA ${mois}`);
  const wsC = wb.addWorksheet('TVA collectée', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsC.columns = [
    { header: 'Date', key: 'date', width: 18 },
    { header: 'Pièce', key: 'piece', width: 20 },
    { header: 'Libellé', key: 'libelle', width: 50 },
    { header: 'Référence métier', key: 'ref', width: 20 },
    { header: 'TVA collectée', key: 'montant', width: 16 },
  ];
  styleEnTete(wsC);
  let sc = 0;
  for (const r of collectee) {
    const row = wsC.addRow({ date: r.date_ecriture, piece: r.numero_piece, libelle: r.libelle, ref: r.reference_metier || '', montant: Number(r.montant) });
    styleMontant(row.getCell('montant'));
    sc += Number(r.montant);
  }
  const totC = wsC.addRow({ piece: 'TOTAL', montant: sc });
  totC.font = { bold: true }; totC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
  styleMontant(totC.getCell('montant'));

  const wsD = wb.addWorksheet('TVA déductible', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsD.columns = wsC.columns;
  styleEnTete(wsD);
  let sd = 0;
  for (const r of deductible) {
    const row = wsD.addRow({ date: r.date_ecriture, piece: r.numero_piece, libelle: r.libelle, ref: r.reference_metier || '', montant: Number(r.montant) });
    styleMontant(row.getCell('montant'));
    sd += Number(r.montant);
  }
  const totD = wsD.addRow({ piece: 'TOTAL', montant: sd });
  totD.font = { bold: true }; totD.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  styleMontant(totD.getCell('montant'));

  // Feuille synthèse
  const wsS = wb.addWorksheet('Synthèse');
  wsS.addRow(['ÉTAT TVA — Mois de ' + mois]);
  wsS.getRow(1).font = { bold: true, size: 14 };
  wsS.addRow([]);
  wsS.addRow(['TVA collectée (sur ventes)', sc]);
  wsS.addRow(['TVA déductible (sur achats)', sd]);
  const netR = wsS.addRow(['TVA nette à décaisser', sc - sd]);
  netR.font = { bold: true, size: 12 };
  netR.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } });
  wsS.addRow([]);
  wsS.addRow(['Nombre de pièces (collecté)', collectee.length]);
  wsS.addRow(['Nombre de pièces (déductible)', deductible.length]);
  wsS.addRow([]);
  wsS.addRow(['Taux TVA appliqué', (h.TVA_TAUX * 100).toFixed(2) + '%']);
  wsS.getColumn(1).width = 32;
  wsS.getColumn(2).width = 16;
  ['B3', 'B4', 'B5'].forEach(c => styleMontant(wsS.getCell(c)));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="etat_tva_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- Grand livre complet (toutes écritures d'une période) ----
router.get('/exports/grand-livre/:mois', permComptaExp, async (req, res) => {
  const mois = req.params.mois;
  const { debut, finExclusif } = bornesDuMois(mois);
  const rows = db.prepare(`SELECT e.date_ecriture, e.journal, e.numero_piece, e.libelle,
                                  e.compte, cc.libelle AS compte_libelle,
                                  e.debit, e.credit, e.reference_metier
                           FROM ecriture_comptable e
                           LEFT JOIN compte_comptable cc ON cc.numero = e.compte
                           WHERE date(e.date_ecriture) >= date(?) AND date(e.date_ecriture) < date(?)
                           ORDER BY e.date_ecriture, e.numero_piece, e.id`).all(debut, finExclusif);
  const wb = nouveauClasseur(`Grand livre ${mois}`);
  const ws = wb.addWorksheet('Écritures', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Date', key: 'date', width: 18 },
    { header: 'Journal', key: 'journal', width: 10 },
    { header: 'Pièce', key: 'piece', width: 20 },
    { header: 'Compte', key: 'compte', width: 10 },
    { header: 'Libellé compte', key: 'compte_lib', width: 40 },
    { header: 'Libellé écriture', key: 'libelle', width: 50 },
    { header: 'Référence métier', key: 'ref', width: 20 },
    { header: 'Débit', key: 'debit', width: 14 },
    { header: 'Crédit', key: 'credit', width: 14 },
  ];
  styleEnTete(ws);
  let sD = 0, sC = 0;
  for (const r of rows) {
    const row = ws.addRow({ date: r.date_ecriture, journal: r.journal, piece: r.numero_piece,
      compte: r.compte, compte_lib: r.compte_libelle || '', libelle: r.libelle, ref: r.reference_metier || '',
      debit: Number(r.debit || 0), credit: Number(r.credit || 0) });
    styleMontant(row.getCell('debit'));
    styleMontant(row.getCell('credit'));
    sD += Number(r.debit || 0); sC += Number(r.credit || 0);
  }
  const tot = ws.addRow({ date: 'TOTAL', piece: `${rows.length} lignes`, debit: sD, credit: sC });
  tot.font = { bold: true }; tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
  styleMontant(tot.getCell('debit'));
  styleMontant(tot.getCell('credit'));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="grand_livre_${mois}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- Clients avec soldes (à date) ----
router.get('/exports/clients-soldes', permComptaExp, async (req, res) => {
  const rows = db.prepare(`SELECT cl.nom, cl.type_client, cl.niu, cl.telephone, cl.email,
                                  c.numero, c.numero_facture, c.date_commande, c.date_echeance,
                                  c.montant_total, c.montant_paye,
                                  a.nom AS activite
                           FROM commande c
                           JOIN client cl ON cl.id = c.client_id
                           JOIN activite a ON a.id = c.activite_id
                           WHERE c.numero_facture IS NOT NULL AND c.numero_facture != ''
                             AND c.statut IN ('FACTUREE', 'LIVREE')
                             AND c.montant_paye + 0.01 < c.montant_total
                           ORDER BY c.date_echeance, cl.nom`).all();
  const wb = nouveauClasseur('Clients avec solde ouvert');
  const ws = wb.addWorksheet('Créances clients', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Client', key: 'client', width: 32 },
    { header: 'NIU', key: 'ninea', width: 18 },
    { header: 'Téléphone', key: 'tel', width: 16 },
    { header: 'Activité', key: 'activite', width: 18 },
    { header: 'N° Facture', key: 'facture', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Échéance', key: 'echeance', width: 14 },
    { header: 'Total', key: 'total', width: 14 },
    { header: 'Encaissé', key: 'encaisse', width: 14 },
    { header: 'Reste dû', key: 'reste', width: 14 },
    { header: 'Retard (j)', key: 'retard', width: 12 },
  ];
  styleEnTete(ws);
  const auj = new Date();
  let sT = 0, sE = 0, sR = 0;
  for (const r of rows) {
    const ttc = Number(r.montant_total || 0);
    const enc = Number(r.montant_paye || 0);
    const reste = ttc - enc;
    let retard = '';
    if (r.date_echeance) {
      const jRet = Math.floor((auj - new Date(r.date_echeance)) / 86400000);
      if (jRet > 0) retard = jRet;
    }
    const row = ws.addRow({ client: r.nom, ninea: r.niu || '', tel: r.telephone || '', activite: r.activite,
      facture: r.numero_facture || r.numero, date: r.date_commande, echeance: r.date_echeance || '',
      total: ttc, encaisse: enc, reste, retard });
    ['total', 'encaisse', 'reste'].forEach(k => styleMontant(row.getCell(k)));
    if (retard) row.getCell('retard').font = { color: { argb: 'FFDC2626' }, bold: true };
    sT += ttc; sE += enc; sR += reste;
  }
  const tot = ws.addRow({ client: 'TOTAL', activite: `${rows.length} facture(s)`, total: sT, encaisse: sE, reste: sR });
  tot.font = { bold: true }; tot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
  ['total', 'encaisse', 'reste'].forEach(k => styleMontant(tot.getCell(k)));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="creances_clients_${new Date().toISOString().slice(0,10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
