const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const db = require('../src/db');
const h = require('../src/helpers');
const config = require('../src/config');
const xl = require('../src/excel');

const router = express.Router();
const uploadMemoire = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
// Enforcement basé sur permissions : `caisse.utiliser` couvre l'encaissement.
function requireCaissier(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'caisse.utiliser', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission d'utiliser la caisse sur cette activité.");
  return res.redirect('/tableau-de-bord/');
}

router.use(requireActivite);

// =========================================================
// CAISSE (uniquement pour activités B2C : PAT et BUR)
// =========================================================
router.get('/caisse/', requireCaissier, (req, res) => {
  if (req.activite.type !== 'B2C_CAISSE') {
    req.flash('warning', 'La caisse n\'est disponible que pour Pâtisserie et Bona Burger.');
    return res.redirect('/tableau-de-bord/');
  }
  const produits = db.prepare(`SELECT p.*, c.nom AS categorie_nom FROM produit p
                               LEFT JOIN categorie c ON c.id = p.categorie_id
                               WHERE p.activite_id = ? AND p.actif = 1 AND p.prix_vente > 0
                                 AND (p.reference IS NULL OR p.reference NOT LIKE 'FRAIS-%')
                               ORDER BY (p.stock_actuel <= 0 AND p.stock_maximum > 0), p.designation`).all(req.activiteId).map(h.enrichirProduit);
  const clients = db.prepare('SELECT * FROM client WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  res.render('ventes/caisse', {
    title: 'Caisse', page_title: `Caisse — ${req.activite.nom}`,
    produits, clients, modes_paiement: h.MODES_PAIEMENT_B2C,
  });
});

router.post('/enregistrer/', requireCaissier, express.json(), (req, res) => {
  if (req.activite.type !== 'B2C_CAISSE') return res.status(400).json({ erreur: 'Activité non B2C' });
  const { lignes = [], mode_paiement = 'ESPECES', montant_paye = 0, remise = 0, appliquer_tva = false, client_id, notes = '' } = req.body;
  if (!lignes.length) return res.status(400).json({ erreur: 'Panier vide' });
  const numero = h.prochainNumeroVente(db, req.activite.code);
  const taux_tva = appliquer_tva ? config.TAUX_TVA : 0;
  try {
    const result = db.transaction(() => {
      const info = db.prepare(`INSERT INTO vente
        (activite_id, numero, caissier_id, client_id, mode_paiement, montant_paye, montant_remise, taux_tva, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.activiteId, numero, req.user.id, client_id || null, mode_paiement, Number(montant_paye), Number(remise), taux_tva, notes);
      const venteId = Number(info.lastInsertRowid);
      let total = 0;
      for (const item of lignes) {
        const p = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(item.produit_id, req.activiteId);
        if (!p) throw new Error('Produit hors de cette activité');
        const qte = parseInt(item.quantite, 10);
        // Contrôle stock uniquement pour les produits stockés (stock_maximum > 0)
        if (p.stock_maximum > 0 && qte > p.stock_actuel) throw new Error(`Stock insuffisant pour ${p.designation}`);
        const prix = Number(item.prix_unitaire || p.prix_vente);
        const remiseLigne = Number(item.remise || 0);
        db.prepare('INSERT INTO ligne_vente (vente_id, produit_id, quantite, prix_unitaire, remise) VALUES (?, ?, ?, ?, ?)')
          .run(venteId, p.id, qte, prix, remiseLigne);
        total += prix * qte - remiseLigne;
        // Mouvement stock : décrémente le produit fini (les produits finis sont fabriqués en amont via les ordres de production)
        if (p.stock_maximum > 0) {
          h.appliquerMouvement(db, {
            produit_id: p.id, type: 'SORTIE', quantite: qte,
            motif: `Vente ${numero}`, reference_doc: numero, utilisateur_id: req.user.id,
          });
        }
      }
      let tva = 0;
      if (appliquer_tva) tva = +((total - Number(remise)) * taux_tva / 100).toFixed(2);
      db.prepare('UPDATE vente SET montant_total = ?, montant_tva = ? WHERE id = ?').run(total, tva, venteId);

      // Journalisation comptable — Vente caisse B2C
      // Débit 57x Caisse activité · Crédit 707 Ventes marchandises · Crédit 443 TVA collectée
      const ttc = total - Number(remise) + tva;
      const ht = ttc - tva;
      const compteCaisse = h.compteCaisseActivite(db, req.activite.code);
      const journalCaisse = h.journalCaisseActivite(db, req.activite.code);
      const lignesEcriture = [
        { compte: compteCaisse, debit: ttc, credit: 0 },
        { compte: '707', debit: 0, credit: ht },
      ];
      if (tva > 0) lignesEcriture.push({ compte: '443', debit: 0, credit: tva });
      h.enregistrerEcriture(db, {
        journal: journalCaisse,
        libelle: `Vente ${numero} (${mode_paiement})`,
        lignes: lignesEcriture,
        referenceMetier: `VENTE#${venteId}`,
        activiteId: req.activiteId,
        utilisateurId: req.user.id,
      });

      return { id: venteId, numero, total, tva, net: ttc };
    })();
    res.json(result);
  } catch (e) { console.error(e); res.status(400).json({ erreur: e.message }); }
});

// =========================================================
// LISTE VENTES (par périmètre)
// =========================================================
router.get('/', (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const placeholders = ids.map(() => '?').join(',');
  const q = (req.query.q || '').trim();
  const statut = req.query.statut || '';
  const mode = req.query.mode || '';
  const origine = (req.query.origine || '').toUpperCase();
  const periode = h.resoudrePeriode(req.query);
  const filtres = [`v.activite_id IN (${placeholders})`];
  const params = [...ids];
  if (!h.isDG(req.user) && !h.isSecretariat(req.user)) { filtres.push('v.caissier_id = ?'); params.push(req.user.id); }
  if (q) { filtres.push('(v.numero LIKE ? OR c.nom LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (mode) { filtres.push('v.mode_paiement = ?'); params.push(mode); }
  if (['WEB', 'CAISSE'].includes(origine)) { filtres.push('COALESCE(v.origine, ?) = ?'); params.push('CAISSE', origine); }
  if (periode.debut) { filtres.push('date(v.date_vente) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(v.date_vente) <= date(?)'); params.push(periode.fin); }
  const whereClause = filtres.join(' AND ');

  // Compte total (pour la pagination) — inclut aussi le filtre statut appliqué en JS ci-dessous
  // Note : statut est filtré côté JS car il dépend de l'enrichissement (montant_net vs montant_paye).
  // Le total exact tient compte de ça après le SELECT paginé.
  const p = h.pagination(req);
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM vente v
                                LEFT JOIN client c ON c.id = v.client_id
                                WHERE ${whereClause}`).get(...params);
  const rows = db.prepare(`SELECT v.*, a.nom AS activite_nom, a.code AS activite_code,
                                  u.username AS caissier_username, u.first_name AS caissier_prenom, u.last_name AS caissier_nom,
                                  c.nom AS client_nom, c.type_client AS client_type,
                                  cw.code_suivi AS web_code, cw.client_nom AS web_client_nom
                           FROM vente v JOIN activite a ON a.id = v.activite_id
                           LEFT JOIN utilisateur u ON u.id = v.caissier_id
                           LEFT JOIN client c ON c.id = v.client_id
                           LEFT JOIN commande_client_web cw ON cw.id = v.commande_web_id
                           WHERE ${whereClause}
                           ORDER BY v.date_vente DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  let ventes = rows.map(h.enrichirVente);
  if (statut === 'paye') ventes = ventes.filter(v => v.statut_paiement === 'PAYE');
  else if (statut === 'partiel') ventes = ventes.filter(v => v.statut_paiement === 'PARTIEL');
  else if (statut === 'impaye') ventes = ventes.filter(v => v.statut_paiement === 'IMPAYE');
  const impayees = ventes.filter(v => v.reste_a_payer > 0);
  const total_reste = impayees.reduce((s, v) => s + v.reste_a_payer, 0);
  res.render('ventes/liste', {
    title: 'Ventes', page_title: 'Historique des ventes',
    ventes, statut_filtre: statut, mode_filtre: mode, origine_filtre: origine, modes_paiement: h.MODES_PAIEMENT_B2C,
    q, nb_impayees: impayees.length, total_reste, periode,
    pagination: h.paginationInfo(p, totalRow.n, req),
  });
});

function _getVenteComplete(id, activitesIds) {
  const placeholders = activitesIds.map(() => '?').join(',');
  const v = db.prepare(`SELECT v.*, a.nom AS activite_nom, a.code AS activite_code,
                              u.username AS caissier_username, u.first_name AS caissier_prenom, u.last_name AS caissier_nom, u.email AS caissier_email,
                              c.nom AS client_nom, c.type_client AS client_type, c.telephone AS client_tel, c.email AS client_email,
                              c.adresse AS client_adresse, c.niu AS client_niu, c.rccm AS client_rccm, c.contact_personne AS client_contact
                       FROM vente v JOIN activite a ON a.id = v.activite_id
                       LEFT JOIN utilisateur u ON u.id = v.caissier_id
                       LEFT JOIN client c ON c.id = v.client_id
                       WHERE v.id = ? AND v.activite_id IN (${placeholders})`).get(id, ...activitesIds);
  if (!v) return null;
  const lignes = db.prepare(`SELECT l.*, p.designation, p.reference
                             FROM ligne_vente l JOIN produit p ON p.id = l.produit_id
                             WHERE l.vente_id = ?`).all(id).map(l => ({ ...l, sous_total: l.prix_unitaire * l.quantite - l.remise }));
  return { ...h.enrichirVente(v), lignes };
}

router.get('/:id(\\d+)', (req, res, next) => {
  const ids = h.activitesAccessibles(db, req.user);
  const vente = _getVenteComplete(req.params.id, ids);
  if (!vente) return res.redirect('/ventes/');
  res.render('ventes/detail', { title: 'Vente ' + vente.numero, page_title: 'Vente ' + vente.numero, vente });
});

// =========================================================
// TICKET DE CAISSE 80mm — format thermique
// =========================================================
router.get('/:id(\\d+)/ticket.pdf', (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const vente = _getVenteComplete(req.params.id, ids);
  if (!vente) return res.redirect('/ventes/');
  const p = req.parametres || {};
  const nomEnt = p.entreprise_nom || config.ENTREPRISE_NOM || 'Le Traiteur du Bistrot';
  const devise = p.devise || config.DEVISE || 'FCFA';

  // Format 80mm : largeur 226pt (72dpi), hauteur variable selon lignes
  const largeur = 226;
  const hauteurBase = 320;
  const hauteurParLigne = 22;
  const hauteur = hauteurBase + vente.lignes.length * hauteurParLigne;

  const doc = new PDFDocument({ size: [largeur, hauteur], margin: 10 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ticket_${vente.numero}.pdf"`);
  doc.pipe(res);

  const W = largeur - 20; // largeur utile
  const CX = largeur / 2;
  const centre = (txt, opts = {}) => doc.text(txt, 10, doc.y, { width: W, align: 'center', ...opts });
  const gauche = (txt, opts = {}) => doc.text(txt, 10, doc.y, { width: W, align: 'left', ...opts });
  const separateur = (char = '-') => {
    doc.font('Courier').fontSize(8).fillColor('#000');
    centre(char.repeat(38));
  };
  const ligne2col = (g, d) => {
    const y = doc.y;
    doc.text(g, 10, y, { width: W * 0.6, align: 'left', continued: false });
    doc.text(d, 10, y, { width: W, align: 'right', continued: false });
    doc.moveDown(0.1);
  };

  // ============ EN-TÊTE ============
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000');
  centre(nomEnt.toUpperCase());
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(7).fillColor('#333');
  if (p.entreprise_adresse) centre(p.entreprise_adresse);
  if (p.entreprise_tel) centre('Tél : ' + p.entreprise_tel);
  if (p.entreprise_niu) centre('NIU : ' + p.entreprise_niu);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  centre('- ' + vente.activite_nom + ' -');
  doc.moveDown(0.3);
  separateur('=');

  // ============ INFOS TICKET ============
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  centre('TICKET N° ' + vente.numero);
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  centre(h.formatDate(vente.date_vente, true));
  const caissierNom = ((vente.caissier_prenom || '') + ' ' + (vente.caissier_nom || vente.caissier_username || '')).trim();
  if (caissierNom) centre('Caissier : ' + caissierNom);
  if (vente.client_nom) centre('Client : ' + vente.client_nom);
  doc.moveDown(0.3);
  separateur();

  // ============ LIGNES ============
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  for (const l of vente.lignes) {
    // Ligne 1 : désignation
    doc.font('Helvetica-Bold').fontSize(8);
    gauche(l.designation);
    // Ligne 2 : qte x pu = total
    doc.font('Helvetica').fontSize(8);
    ligne2col(
      `  ${l.quantite} × ${h.formatNombre(l.prix_unitaire)}${Number(l.remise) > 0 ? ` (-${h.formatNombre(l.remise)})` : ''}`,
      h.formatNombre(l.sous_total) + ' ' + devise,
    );
    doc.moveDown(0.15);
  }
  separateur();

  // ============ TOTAUX ============
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  ligne2col('Sous-total HT', h.formatNombre(vente.montant_total) + ' ' + devise);
  if (Number(vente.montant_remise) > 0) {
    doc.fillColor('#b91c1c');
    ligne2col('Remise', '- ' + h.formatNombre(vente.montant_remise) + ' ' + devise);
    doc.fillColor('#000');
  }
  if (Number(vente.montant_tva) > 0) {
    ligne2col(`TVA ${vente.taux_tva}%`, h.formatNombre(vente.montant_tva) + ' ' + devise);
  }
  doc.moveDown(0.1);
  separateur();
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000');
  ligne2col('NET À PAYER', h.formatNombre(vente.montant_net) + ' ' + devise);
  doc.moveDown(0.1);
  separateur();

  // ============ PAIEMENT ============
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  ligne2col('Mode', vente.mode_paiement_style ? vente.mode_paiement_style.label : vente.mode_paiement);
  ligne2col('Reçu', h.formatNombre(vente.montant_paye) + ' ' + devise);
  const rendu = Math.max(0, Number(vente.montant_paye) - Number(vente.montant_net));
  if (rendu > 0) {
    doc.font('Helvetica-Bold');
    ligne2col('Monnaie rendue', h.formatNombre(rendu) + ' ' + devise);
    doc.font('Helvetica');
  }
  doc.moveDown(0.3);
  separateur('=');

  // ============ MENTIONS + REMERCIEMENT ============
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#333');
  if (p.entreprise_rccm) centre('RCCM : ' + p.entreprise_rccm);
  centre(`Article ${vente.taux_tva > 0 ? '17 CGI - TVA facturée' : '2 CGI - Prix nets'}`);
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  centre('Merci de votre visite !');
  doc.moveDown(0.15);
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#666');
  centre('À bientôt chez ' + nomEnt);
  doc.moveDown(0.2);
  centre('•  •  •');

  doc.end();
});

// =========================================================
// FACTURE B2C A4 — Style Executive Classic (or + noir avec filigrane activité)
// =========================================================
const OR       = '#C9A227';
const OR_FONCE = '#8B6914';
const OR_CLAIR = '#E9D8A6';
const NOIR     = '#0A0A0A';
const GRIS     = '#666666';

function dessinerFiligraneVente(doc, texte) {
  if (!texte) return;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  doc.save();
  doc.fillColor(OR).fillOpacity(0.08);
  doc.translate(pageW / 2, pageH / 2);
  doc.rotate(-40);
  const t = String(texte).toUpperCase();
  const fontSize = t.length > 18 ? 48 : 68;
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const spacing = 8;
  const textWidth = doc.widthOfString(t, { characterSpacing: spacing });
  doc.text(t, -textWidth / 2, -fontSize / 2, { width: textWidth * 2, lineBreak: false, characterSpacing: spacing });
  doc.restore();
  doc.fillOpacity(1).fillColor(NOIR);
}

router.get('/:id(\\d+)/facture.pdf', (req, res) => {
  const ids = h.activitesAccessibles(db, req.user);
  const vente = _getVenteComplete(req.params.id, ids);
  if (!vente) return res.redirect('/ventes/');
  const p = req.parametres || {};
  const nomEnt   = p.entreprise_nom || config.ENTREPRISE_NOM || 'LE TRAITEUR DU BISTROT SUARL';
  const adresse  = p.entreprise_adresse || config.ENTREPRISE_ADRESSE || '';
  const tel      = p.entreprise_tel || config.ENTREPRISE_TEL || '';
  const email    = p.entreprise_email || '';
  const niu      = p.entreprise_niu || '';
  const rccm     = p.entreprise_rccm || '';
  const devise   = p.devise || config.DEVISE || 'FCFA';

  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="facture_${vente.numero}.pdf"`);
  doc.pipe(res);

  // ---- Filigrane (en premier, sous le contenu) ----
  dessinerFiligraneVente(doc, vente.activite_nom || '');

  // ---- En-tête sobre ----
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NOIR).text(nomEnt.toUpperCase(), 40, 40, { width: 380, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(adresse, 40, 62, { width: 380 });
  if (vente.activite_nom) {
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('ACTIVITÉ', 400, 40, { align: 'right', width: 155, characterSpacing: 2 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR).text(vente.activite_nom.toUpperCase(), 400, 51, { align: 'right', width: 155, characterSpacing: 2 });
  }
  doc.rect(40, 85, 515, 1.2).fill(NOIR);

  // ---- Titre ----
  let y = 110;
  doc.font('Helvetica-Bold').fontSize(26).fillColor(NOIR).text('FACTURE', 40, y, { align: 'center', width: 515, characterSpacing: 6 });
  doc.rect((doc.page.width - 60) / 2, y + 38, 60, 2).fill(OR);

  // ---- N° document + date ----
  y = 162;
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('N° DU DOCUMENT', 40, y, { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(vente.numero || '—', 40, y + 12);
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('DOUALA, LE', 400, y, { align: 'right', width: 155, characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(h.formatDate(vente.date_vente, true), 400, y + 12, { align: 'right', width: 155 });

  // ---- Bloc client ----
  y = 200;
  const clientNom = vente.client_nom || 'Client comptoir';
  const clientAdresse = vente.client_adresse || '';
  const hBloc = clientAdresse ? 46 : 30;
  doc.rect(40, y, 3, hBloc).fill(OR);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(OR_FONCE).text('DOIT', 52, y, { characterSpacing: 3 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NOIR).text(clientNom, 52, y + 12, { width: 500 });
  if (clientAdresse) doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(clientAdresse, 52, y + 30, { width: 500 });
  y += hBloc + 14;

  // ---- Caissier (référence) ----
  const caissierNom = ((vente.caissier_prenom || '') + ' ' + (vente.caissier_nom || vente.caissier_username || '')).trim();
  if (caissierNom) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('CAISSIER  ', 40, y, { continued: true, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9).fillColor(NOIR).text(caissierNom);
    y = doc.y + 6;
  }
  y += 4;

  // ---- Tableau lignes ----
  const cols = { desc: { x: 45, w: 220, label: 'DÉSIGNATION' },
                 ref:  { x: 265, w: 60, label: 'RÉF.',  align: 'left' },
                 qte:  { x: 325, w: 45, label: 'QTÉ',  align: 'center' },
                 pu:   { x: 375, w: 80, label: 'P.U.', align: 'right' },
                 tot:  { x: 460, w: 95, label: 'TOTAL HT', align: 'right' } };
  const rowH = 24;
  doc.rect(40, y, 515, rowH).fill(NOIR);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(OR);
  for (const c of Object.values(cols)) {
    doc.text(c.label, c.x, y + 8, { width: c.w, align: c.align || 'left', characterSpacing: 1 });
  }
  y += rowH;
  let idxLigne = 0;
  for (const l of vente.lignes) {
    const hauteur = Math.max(20, doc.heightOfString(l.designation, { width: cols.desc.w }) + 10);
    if (idxLigne % 2 === 0) doc.rect(40, y, 515, hauteur).fill('#FBF8ED');
    doc.rect(40, y + hauteur - 0.5, 515, 0.5).fill(OR_CLAIR);
    doc.font('Helvetica').fontSize(9).fillColor(NOIR);
    doc.text(l.designation, cols.desc.x, y + 6, { width: cols.desc.w });
    doc.text(l.reference || '', cols.ref.x, y + 6, { width: cols.ref.w });
    doc.text(String(l.quantite), cols.qte.x, y + 6, { width: cols.qte.w, align: 'center' });
    doc.text(h.formatNombre(l.prix_unitaire), cols.pu.x, y + 6, { width: cols.pu.w, align: 'right' });
    doc.font('Helvetica-Bold').text(h.formatNombre(l.sous_total), cols.tot.x, y + 6, { width: cols.tot.w, align: 'right' });
    y += hauteur;
    idxLigne++;
  }
  doc.rect(40, y, 515, 1.5).fill(NOIR);
  y += 12;

  // ---- Bloc totaux Executive Classic ----
  const rows = [['Montant HT', vente.montant_total]];
  if (Number(vente.montant_remise) > 0) rows.push(['Remise', -Math.abs(Number(vente.montant_remise))]);
  if (Number(vente.montant_tva) > 0) rows.push([`TVA ${vente.taux_tva} %`, vente.montant_tva]);
  rows.push(['TOTAL TTC', vente.montant_net]);
  const blocX = 295, blocW = 260;
  let bY = y;
  const hTotal = (rows.length - 1) * 22 + 30;
  doc.rect(blocX, bY, blocW, hTotal).lineWidth(1).strokeColor(NOIR).stroke();
  for (let i = 0; i < rows.length; i++) {
    const [lbl, val] = rows[i];
    const isFinal = i === rows.length - 1;
    const rh = isFinal ? 30 : 22;
    if (isFinal) {
      doc.rect(blocX, bY, blocW, rh).fill(NOIR);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(OR).text(lbl, blocX + 12, bY + 10, { width: 110, characterSpacing: 2 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor(OR).text(h.formatNombre(val) + ' ' + devise, blocX + 122, bY + 9, { width: blocW - 134, align: 'right' });
    } else {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(OR_FONCE).text(lbl, blocX + 12, bY + 7, { width: 110 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text(h.formatNombre(val), blocX + 122, bY + 7, { width: blocW - 134, align: 'right' });
    }
    bY += rh;
  }
  y = bY + 16;

  // ---- Mention paiement (déjà acquittée en B2C) ----
  const modeLbl = vente.mode_paiement_style ? vente.mode_paiement_style.label : vente.mode_paiement;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('PAIEMENT  ', 40, y, { continued: true, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(NOIR).text('Facture réglée le ' + h.formatDate(vente.date_vente, true) + ' — Mode : ' + modeLbl + ' — Montant reçu : ' + h.formatNombre(vente.montant_paye) + ' ' + devise);
  y = doc.y + 8;

  // ---- Montant en lettres ----
  doc.font('Helvetica-Oblique').fontSize(10).fillColor(NOIR).text('Arrêtée à la somme de ', 40, y, { continued: true });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text(h.montantEnLettres(vente.montant_net, 'Francs CFA') + '.', { width: 515 });
  y = doc.y + 20;

  // ---- Signature ----
  y = Math.max(y, 640);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text('LE CAISSIER', 380, y, { align: 'center', width: 175, characterSpacing: 2 });
  doc.rect(380, y + 15, 175, 55).lineWidth(0.5).strokeColor(NOIR).stroke();

  // ---- Footer ----
  const footerY = doc.page.height - 42;
  doc.rect(40, footerY, 515, 0.8).fill(OR);
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS);
  const l1 = [ tel ? 'Tél : ' + tel : '', email ? 'Email : ' + email : '' ].filter(Boolean).join('   ·   ');
  doc.text(l1, 40, footerY + 6, { align: 'center', width: 515, lineBreak: false });
  const l2 = [ niu ? 'NIU ' + niu : '', rccm ? 'RCCM ' + rccm : '' ].filter(Boolean).join('   ·   ');
  if (l2) doc.text(l2, 40, footerY + 18, { align: 'center', width: 515, lineBreak: false });

  doc.end();
});

// =========================================================
// CLIENTS (par activité)
// =========================================================
router.get('/clients/', (req, res) => {
  const q = (req.query.q || '').trim();
  const filtres = ['activite_id = ?'];
  const params = [req.activiteId];
  if (q) { filtres.push('(nom LIKE ? OR telephone LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const p = h.pagination(req);
  const totalClients = db.prepare(`SELECT COUNT(*) AS n FROM client WHERE ${filtres.join(' AND ')}`).get(...params).n;
  const clients = db.prepare(`SELECT * FROM client WHERE ${filtres.join(' AND ')} ORDER BY nom LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset).map(c => ({
    ...c, type_label: h.TYPE_CLIENT_LABEL[c.type_client] || c.type_client, est_entreprise: c.type_client === 'ENTR',
  }));
  res.render('ventes/clients_liste', { title: 'Clients', page_title: `Clients — ${req.activite.nom}`, clients, q,
    pagination: h.paginationInfo(p, totalClients, req) });
});

router.get('/clients/nouveau', (req, res) => {
  res.render('ventes/client_form', { title: 'Nouveau client', page_title: 'Nouveau client', clientData: { type_client: 'PART' }, mode: 'creer' });
});
router.post('/clients/nouveau', (req, res) => {
  const b = req.body;
  db.prepare(`INSERT INTO client (activite_id, type_client, nom, telephone, email, adresse, niu, rccm, contact_personne, delai_paiement_jours)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.activiteId, b.type_client || 'PART', b.nom, b.telephone || '', b.email || '', b.adresse || '', b.niu || '', b.rccm || '', b.contact_personne || '', Number(b.delai_paiement_jours || 30));
  req.flash('success', `Client « ${b.nom} » ajouté.`);
  res.redirect('/ventes/clients/');
});
router.get('/clients/:id(\\d+)/modifier', (req, res) => {
  const client = db.prepare('SELECT * FROM client WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!client) return res.redirect('/ventes/clients/');
  res.render('ventes/client_form', { title: 'Modifier client', page_title: 'Modifier client', clientData: client, mode: 'modifier' });
});
router.post('/clients/:id(\\d+)/modifier', (req, res) => {
  const b = req.body;
  db.prepare(`UPDATE client SET type_client=?, nom=?, telephone=?, email=?, adresse=?, niu=?, rccm=?, contact_personne=?, delai_paiement_jours=?
              WHERE id=? AND activite_id=?`)
    .run(b.type_client || 'PART', b.nom, b.telephone || '', b.email || '', b.adresse || '', b.niu || '', b.rccm || '', b.contact_personne || '', Number(b.delai_paiement_jours || 30), req.params.id, req.activiteId);
  req.flash('success', `Client « ${b.nom} » modifié.`);
  res.redirect('/ventes/clients/');
});
router.get('/clients/:id(\\d+)/supprimer', (req, res) => {
  const client = db.prepare('SELECT * FROM client WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!client) return res.redirect('/ventes/clients/');
  res.render('ventes/client_confirmer_suppression', { title: 'Supprimer client', page_title: 'Supprimer client', objet: client, libelle: client.nom, retour: '/ventes/clients/' });
});
router.post('/clients/:id(\\d+)/supprimer', (req, res) => {
  const c = db.prepare('SELECT nom FROM client WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  db.prepare('DELETE FROM client WHERE id = ? AND activite_id = ?').run(req.params.id, req.activiteId);
  if (c) h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'CLIENT_SUPPRIME',
    entite: 'client', entite_id: Number(req.params.id), details: c.nom });
  req.flash('success', 'Client supprimé.');
  res.redirect('/ventes/clients/');
});

router.post('/clients/api/creer/', express.json(), (req, res) => {
  const b = req.body || {};
  const type = ['PART', 'ENTR'].includes(b.type_client) ? b.type_client : 'PART';
  const nom = (b.nom || '').trim();
  if (!nom) return res.status(400).json({ erreur: 'Nom obligatoire' });
  const tel = (b.telephone || '').trim();
  if (tel) {
    const dup = db.prepare('SELECT * FROM client WHERE activite_id = ? AND LOWER(nom) = LOWER(?) AND telephone = ?').get(req.activiteId, nom, tel);
    if (dup) return res.json({ id: dup.id, nom: dup.nom, deja_existant: true });
  }
  const info = db.prepare(`INSERT INTO client (activite_id, type_client, nom, telephone, email, adresse, niu, rccm, contact_personne)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.activiteId, type, nom, tel, b.email || '', b.adresse || '', b.niu || '', b.rccm || '', b.contact_personne || '');
  res.json({ id: Number(info.lastInsertRowid), nom, deja_existant: false, type: h.TYPE_CLIENT_LABEL[type] });
});

// =========================================================
// IMPORT EXCEL — CLIENTS
// =========================================================
function colonnesClients() {
  return [
    { header: 'Type', key: 'type_client', width: 14, required: true, options: ['PART', 'ENTR'], note: 'PART = Particulier · ENTR = Entreprise' },
    { header: 'Nom', key: 'nom', width: 32, required: true },
    { header: 'Téléphone', key: 'telephone', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Adresse', key: 'adresse', width: 34 },
    { header: 'NIU', key: 'niu', width: 16, note: 'Numéro d\'identifiant unique (entreprises)' },
    { header: 'RCCM', key: 'rccm', width: 20 },
    { header: 'Contact personne', key: 'contact_personne', width: 22 },
    { header: 'Délai paiement (jours)', key: 'delai_paiement_jours', width: 12, type: 'number' },
  ];
}

router.get('/clients/import/modele', async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Clients',
    colonnes: colonnesClients(),
    lignes_exemple: [
      { type_client: 'ENTR', nom: 'HÔTEL LA FALAISE', telephone: '233 000 000', email: 'contact@lafalaise.cm', adresse: 'Yaoundé', niu: 'M0123456789A', rccm: 'YAO/2015/B/001', contact_personne: 'Mme Ngo', delai_paiement_jours: 30 },
      { type_client: 'PART', nom: 'M. Kamga Paul', telephone: '699 111 222', email: '', adresse: 'Yaoundé', delai_paiement_jours: 0 },
    ],
    instructions: [
      `Activité de destination : ${req.activite.nom}`,
      'Colonnes obligatoires : Type (PART ou ENTR) et Nom.',
      'Pour les entreprises, renseignez si possible NIU et RCCM (utilisés sur les factures).',
      'Délai paiement : en jours (0 = paiement comptant, 30 = fin de mois).',
      'Les clients déjà existants (même nom, insensible à la casse) seront ignorés.',
    ],
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_clients_${req.activite.nom.replace(/\s+/g, '_')}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/clients/import', (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer des clients', page_title: 'Importer des clients',
    apercu: null, erreurs: [], type_import: 'clients',
    url_modele: '/ventes/clients/import/modele', url_upload: '/ventes/clients/import/apercu', url_confirmer: '/ventes/clients/import/confirmer',
    url_retour: '/ventes/clients/',
  });
});

router.post('/clients/import/apercu', uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/ventes/clients/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesClients() });
    const existants = db.prepare('SELECT id, nom FROM client WHERE activite_id = ?').all(req.activiteId);
    const mapExistants = new Map(existants.map(c => [h.normaliserNom(c.nom), c]));
    const dansFichier = new Map();
    for (const l of lignes) {
      if (!l.nom) continue;
      const key = h.normaliserNom(l.nom);
      if (mapExistants.has(key)) l.__doublon = { type: 'existant', existant: mapExistants.get(key) };
      else if (dansFichier.has(key)) l.__doublon = { type: 'fichier', ligne: dansFichier.get(key) };
      else dansFichier.set(key, l.__ligne_excel);
    }
    req.session.import_clients = { lignes, activiteId: req.activiteId };
    res.render('produits/import_excel', {
      title: 'Aperçu import clients', page_title: 'Aperçu import clients',
      apercu: lignes, erreurs, type_import: 'clients',
      url_modele: '/ventes/clients/import/modele', url_upload: '/ventes/clients/import/apercu', url_confirmer: '/ventes/clients/import/confirmer',
      url_retour: '/ventes/clients/',
    });
  } catch (e) { req.flash('error', 'Fichier illisible : ' + e.message); res.redirect('/ventes/clients/import'); }
});

router.post('/clients/import/confirmer', (req, res) => {
  const data = req.session.import_clients;
  if (!data || data.activiteId !== req.activiteId) { req.flash('warning', 'Session expirée.'); return res.redirect('/ventes/clients/import'); }
  const insertC = db.prepare(`INSERT INTO client (activite_id, type_client, nom, telephone, email, adresse, niu, rccm, contact_personne, delai_paiement_jours)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const existants = db.prepare('SELECT nom FROM client WHERE activite_id = ?').all(req.activiteId);
  const mapEx = new Set(existants.map(c => h.normaliserNom(c.nom)));
  const dansImport = new Set();
  let crees = 0, ignores = 0;
  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) { ignores++; continue; }
    const key = h.normaliserNom(l.nom);
    if (mapEx.has(key) || dansImport.has(key)) { ignores++; continue; }
    dansImport.add(key);
    const type = ['PART', 'ENTR'].includes(String(l.type_client).toUpperCase()) ? String(l.type_client).toUpperCase() : 'PART';
    insertC.run(req.activiteId, type, String(l.nom), String(l.telephone || ''), String(l.email || ''),
                String(l.adresse || ''), String(l.niu || ''), String(l.rccm || ''),
                String(l.contact_personne || ''), Number(l.delai_paiement_jours || 30));
    crees++;
  }
  delete req.session.import_clients;
  if (crees) req.flash('success', `${crees} client(s) importé(s).`);
  if (ignores) req.flash('warning', `${ignores} ligne(s) ignorée(s) (déjà existants, doublons ou invalides).`);
  res.redirect('/ventes/clients/');
});

module.exports = router;
