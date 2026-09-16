// Workflow B2B : Proforma → Bon de commande → BL → Facture → Reçus (acomptes autorisés)
// Applicable aux activités type B2B_COMMANDE (Traiteur, Cantine)
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const db = require('../src/db');
const h = require('../src/helpers');
const config = require('../src/config');

const router = express.Router();

// Multer : upload des pièces justificatives de paiement (chèque scanné, ordre virement…)
const paiementUploadDir = path.join(config.UPLOADS_DIR, 'paiements');
if (!fs.existsSync(paiementUploadDir)) fs.mkdirSync(paiementUploadDir, { recursive: true });
const paiementStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, paiementUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    cb(null, Date.now() + '-' + safe + ext);
  },
});
const paiementUpload = multer({
  storage: paiementStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
  fileFilter: (req, file, cb) => {
    const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
    if (okTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté : ' + file.mimetype + ' (autorisés : JPG, PNG, WEBP, HEIC, PDF)'));
  },
});

// ---------------------- Middlewares ----------------------
function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité B2B.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
function requireB2B(req, res, next) {
  if (!req.activite || req.activite.type !== 'B2B_COMMANDE') {
    req.flash('warning', "Le module Commandes est réservé aux activités B2B (Traiteur, Cantine).");
    return res.redirect('/tableau-de-bord/');
  }
  next();
}
// Enforcement basé sur permissions : `commandes.saisir` couvre la saisie/modification.
function requireEcritureCommandes(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'commandes.saisir', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission « Saisir des commandes clients ».");
  return res.redirect('/commandes/');
}
// Lecture requise (via commandes.saisir — pas de feature "lecture seule" B2B pour l'instant)
router.use(requireActivite, requireB2B, h.permissionRequise(db, 'commandes.saisir'));

// ---------------------- Helpers internes ----------------------
function chargerCommande(id, activiteId) {
  const cmd = db.prepare(`SELECT c.*, cl.nom AS client_nom, cl.type_client, cl.telephone AS client_tel,
                                cl.email AS client_email, cl.adresse AS client_adresse, cl.niu AS client_niu,
                                cl.rccm AS client_rccm, cl.contact_personne AS client_contact,
                                u.username AS cree_par_username, u.first_name AS cree_par_prenom,
                                a.nom AS activite_nom, a.code AS activite_code
                         FROM commande c
                         JOIN client cl ON cl.id = c.client_id
                         LEFT JOIN utilisateur u ON u.id = c.cree_par_id
                         LEFT JOIN activite a ON a.id = c.activite_id
                         WHERE c.id = ? AND c.activite_id = ?`).get(id, activiteId);
  if (!cmd) return null;
  cmd.lignes = db.prepare(`SELECT lc.*, p.reference AS produit_ref, p.unite AS produit_unite
                           FROM ligne_commande lc JOIN produit p ON p.id = lc.produit_id
                           WHERE lc.commande_id = ? ORDER BY lc.id`).all(id);
  cmd.paiements = db.prepare(`SELECT p.*, u.first_name AS caisse_prenom, u.username AS caisse_username
                              FROM paiement p LEFT JOIN utilisateur u ON u.id = p.cree_par_id
                              WHERE p.commande_id = ? ORDER BY p.date_paiement`).all(id);
  cmd.relances = db.prepare(`SELECT r.*, u.first_name AS envoye_par_prenom, u.username AS envoye_par_username
                             FROM relance r LEFT JOIN utilisateur u ON u.id = r.envoye_par_id
                             WHERE r.commande_id = ? ORDER BY r.date_envoi`).all(id);
  cmd.statut_paiement = h.statutPaiementCommande(cmd);
  cmd.montant_restant = Math.max(0, Number(cmd.montant_total || 0) - Number(cmd.montant_paye || 0));
  cmd.analyse_relance = h.analyseRelance(cmd, cmd.relances);
  return cmd;
}

// Recalcule les totaux à partir des lignes + remise globale + TVA par ligne + frais livraison
// FCFA : pas de décimales — on arrondit tous les montants au franc entier
function recalculerTotaux(commandeId, _taux_tva_ignore = 0, remise = 0) {
  const lignes = db.prepare('SELECT quantite, prix_unitaire, remise, taux_tva FROM ligne_commande WHERE commande_id = ?').all(commandeId);
  const cmdRow = db.prepare('SELECT frais_livraison FROM commande WHERE id = ?').get(commandeId);
  const fraisLiv = Number(cmdRow && cmdRow.frais_livraison || 0);
  let ht = 0;
  let tva = 0;
  for (const l of lignes) {
    const total = Number(l.quantite) * Number(l.prix_unitaire);
    const totalRemise = total * (1 - Number(l.remise || 0) / 100);
    ht += totalRemise;
    tva += totalRemise * Number(l.taux_tva || 0) / 100;
  }
  const remiseGlobale = Number(remise || 0);
  const htNet = Math.max(0, ht - remiseGlobale);
  const ttc = htNet + tva + fraisLiv;
  return {
    montant_ht: Math.round(htNet),
    montant_tva: Math.round(tva),
    montant_total: Math.round(ttc),
  };
}

function parseLignes(body) {
  const produits = Array.isArray(body.produit_id) ? body.produit_id : (body.produit_id ? [body.produit_id] : []);
  const designations = Array.isArray(body.designation) ? body.designation : (body.designation ? [body.designation] : []);
  const quantites = Array.isArray(body.quantite) ? body.quantite : (body.quantite ? [body.quantite] : []);
  const prix = Array.isArray(body.prix_unitaire) ? body.prix_unitaire : (body.prix_unitaire ? [body.prix_unitaire] : []);
  const remises = Array.isArray(body.remise_ligne) ? body.remise_ligne : (body.remise_ligne ? [body.remise_ligne] : []);
  const tvasLigne = Array.isArray(body.taux_tva_ligne) ? body.taux_tva_ligne : (body.taux_tva_ligne ? [body.taux_tva_ligne] : []);
  const out = [];
  for (let i = 0; i < produits.length; i++) {
    const pid = Number(produits[i] || 0);
    const qte = Number(String(quantites[i] || '0').replace(',', '.'));
    const pu = Number(String(prix[i] || '0').replace(',', '.'));
    const rem = Number(String(remises[i] || '0').replace(',', '.'));
    const tva = Number(String(tvasLigne[i] || '0').replace(',', '.'));
    if (pid && qte > 0 && pu >= 0) out.push({ produit_id: pid, designation: String(designations[i] || '').trim(), quantite: qte, prix_unitaire: pu, remise: rem, taux_tva: tva });
  }
  return out;
}

// =========================================================
// LISTE
// =========================================================
router.get('/', (req, res) => {
  // Réparation idempotente des données historiques (arrondi FCFA + statut PAYEE + numéros de facture manquants)
  db.prepare(`UPDATE commande SET
                montant_ht = ROUND(montant_ht), montant_tva = ROUND(montant_tva),
                montant_total = ROUND(montant_total), montant_paye = ROUND(montant_paye)
              WHERE activite_id = ?`).run(req.activiteId);
  // Générer les numéros de facture manquants pour les commandes livrées/soldées
  const cmdSansFactureLst = db.prepare(`SELECT id FROM commande
    WHERE activite_id = ? AND statut IN ('LIVREE', 'FACTUREE', 'PAYEE')
      AND (numero_facture IS NULL OR numero_facture = '')`).all(req.activiteId);
  for (const c of cmdSansFactureLst) {
    const numeroF = h.prochainNumeroFacture(db, req.activite.code);
    db.prepare(`UPDATE commande SET numero_facture = ?,
                statut = CASE WHEN statut = 'LIVREE' THEN 'FACTUREE' ELSE statut END
                WHERE id = ?`).run(numeroF, c.id);
  }
  db.prepare(`UPDATE commande SET statut = 'PAYEE'
              WHERE activite_id = ? AND statut = 'FACTUREE' AND montant_paye >= montant_total`).run(req.activiteId);

  const statut = (req.query.statut || '').trim();
  const q = (req.query.q || '').trim();
  const periode = h.resoudrePeriode(req.query);
  const filtres = ['c.activite_id = ?'];
  const params = [req.activiteId];
  if (statut) { filtres.push('c.statut = ?'); params.push(statut); }
  if (q) {
    filtres.push('(cl.nom LIKE ? OR c.numero LIKE ? OR c.numero_proforma LIKE ? OR c.numero_facture LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (periode.debut) { filtres.push('date(c.date_commande) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { filtres.push('date(c.date_commande) <= date(?)'); params.push(periode.fin); }
  const p = h.pagination(req);
  const nbTotalRow = db.prepare(`SELECT COUNT(*) AS n FROM commande c JOIN client cl ON cl.id = c.client_id WHERE ${filtres.join(' AND ')}`).get(...params);
  const commandes = db.prepare(`SELECT c.*, cl.nom AS client_nom, cl.type_client
                                FROM commande c JOIN client cl ON cl.id = c.client_id
                                WHERE ${filtres.join(' AND ')}
                                ORDER BY c.date_commande DESC
                                LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);
  commandes.forEach(c => { c.statut_paiement = h.statutPaiementCommande(c); c.montant_restant = Math.max(0, c.montant_total - c.montant_paye); });

  const pagination = h.paginationInfo(p, nbTotalRow.n, req);

  // KPIs par statut (toujours calculés sur l'activité entière)
  const kpisRows = db.prepare(`SELECT statut, COUNT(*) AS n, COALESCE(SUM(montant_total), 0) AS montant
                               FROM commande WHERE activite_id = ? GROUP BY statut`).all(req.activiteId);
  const kpis = { PROFORMA: 0, VALIDE: 0, EN_PRODUCTION: 0, LIVREE: 0, FACTUREE: 0, PAYEE: 0, ANNULEE: 0 };
  const kpisMontant = { PROFORMA: 0, VALIDE: 0, EN_PRODUCTION: 0, LIVREE: 0, FACTUREE: 0, PAYEE: 0, ANNULEE: 0 };
  for (const r of kpisRows) { kpis[r.statut] = r.n; kpisMontant[r.statut] = r.montant; }

  // KPIs financiers : CA soldé mois courant + en attente + CA moyen + panier moyen
  // Utilisation de SQL natif pour les périodes (évite les décalages de format ISO/SQLite)
  const caMoisRow = db.prepare(`SELECT COUNT(*) AS nb, COALESCE(SUM(montant_total), 0) AS ca
                                FROM commande WHERE activite_id = ? AND statut = 'PAYEE'
                                  AND date(date_commande) >= date('now', 'start of month')`).get(req.activiteId);
  const caMoisPrecRow = db.prepare(`SELECT COALESCE(SUM(montant_total), 0) AS ca
                                    FROM commande WHERE activite_id = ? AND statut = 'PAYEE'
                                      AND date(date_commande) >= date('now', 'start of month', '-1 month')
                                      AND date(date_commande) < date('now', 'start of month')`).get(req.activiteId);
  const enAttenteRow = db.prepare(`SELECT COALESCE(SUM(montant_total - montant_paye), 0) AS attente
                                   FROM commande WHERE activite_id = ? AND statut = 'FACTUREE' AND montant_paye + 0.01 < montant_total`).get(req.activiteId);
  const impayeesRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total - montant_paye), 0) AS reste
                                  FROM commande WHERE activite_id = ? AND statut = 'FACTUREE' AND montant_paye + 0.01 < montant_total`).get(req.activiteId);
  const enRetardRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total - montant_paye), 0) AS reste
                                  FROM commande WHERE activite_id = ? AND statut = 'FACTUREE'
                                    AND montant_paye + 0.01 < montant_total
                                    AND date_echeance IS NOT NULL AND date(date_echeance) < date('now')`).get(req.activiteId);

  // Top 3 clients (CA cumulé toutes commandes soldées)
  const topClients = db.prepare(`SELECT cl.nom, COUNT(c.id) AS nb, COALESCE(SUM(c.montant_total), 0) AS ca
                                 FROM commande c JOIN client cl ON cl.id = c.client_id
                                 WHERE c.activite_id = ? AND c.statut = 'PAYEE'
                                 GROUP BY cl.id ORDER BY ca DESC LIMIT 3`).all(req.activiteId);

  // Top 3 clients non soldés (cumul des restes dus sur factures non payées)
  const topNonSoldes = db.prepare(`SELECT cl.nom, COUNT(c.id) AS nb,
                                          COALESCE(SUM(c.montant_total - c.montant_paye), 0) AS reste_du,
                                          COALESCE(SUM(c.montant_total), 0) AS ca
                                   FROM commande c JOIN client cl ON cl.id = c.client_id
                                   WHERE c.activite_id = ? AND c.statut = 'FACTUREE'
                                     AND c.montant_paye + 1 < c.montant_total
                                   GROUP BY cl.id ORDER BY reste_du DESC LIMIT 3`).all(req.activiteId);

  const financier = {
    ca_mois: caMoisRow.ca,
    nb_commandes_mois: caMoisRow.nb,
    ca_mois_precedent: caMoisPrecRow.ca,
    evolution: caMoisPrecRow.ca > 0 ? Math.round((caMoisRow.ca - caMoisPrecRow.ca) / caMoisPrecRow.ca * 100) : null,
    panier_moyen: caMoisRow.nb > 0 ? caMoisRow.ca / caMoisRow.nb : 0,
    en_attente: enAttenteRow.attente,
    nb_en_retard: enRetardRow.n,
    montant_en_retard: enRetardRow.reste,
  };

  res.render('commandes/liste', {
    title: 'Commandes B2B', page_title: `Commandes B2B — ${req.activite.nom}`,
    commandes, statut_filtre: statut, q, periode,
    kpis, kpisMontant, nb_impayees: impayeesRow.n, montant_impaye: impayeesRow.reste,
    financier, topClients, topNonSoldes, pagination,
    statuts_label: h.STATUT_COMMANDE_LABEL, statuts_badge: h.STATUT_COMMANDE_BADGE,
  });
});

// =========================================================
// NOUVEAU PROFORMA — formulaire
// =========================================================
router.get('/nouveau', requireEcritureCommandes, (req, res) => {
  const clients = db.prepare('SELECT * FROM client WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  const produits = db.prepare(`SELECT id, reference, designation, prix_vente, unite
                               FROM produit WHERE activite_id = ? AND actif = 1
                               ORDER BY designation`).all(req.activiteId);
  const tauxDefaut = Number(req.parametres?.taux_tva) || config.TAUX_TVA || 19.25;
  const feriesAnnee = req.activite.code === 'CAN' ? Array.from(h.joursFeriesCameroun(new Date().getFullYear()).entries()).map(([iso, nom]) => ({ iso, nom })) : [];
  res.render('commandes/proforma_form', {
    title: 'Nouvelle proforma', page_title: 'Nouvelle proforma',
    commande: { taux_tva: tauxDefaut, mode_paiement: 'VIREMENT' },
    clients, produits, mode: 'creer', erreurs: [],
    modes_paiement: h.MODES_PAIEMENT_B2B,
    feriesAnnee, estCantine: req.activite.code === 'CAN',
  });
});

router.post('/nouveau', requireEcritureCommandes, (req, res) => {
  const b = req.body;
  const erreurs = [];
  const clientId = Number(b.client_id || 0);
  if (!clientId) erreurs.push('Le client est obligatoire.');
  const lignes = parseLignes(b);
  if (!lignes.length) erreurs.push('Ajoutez au moins une ligne au proforma.');
  const taux_tva = Number(b.taux_tva || 0);
  const remise = Number(String(b.montant_remise || '0').replace(',', '.'));
  // Cohérence livraison / échéance : l'échéance ne peut être antérieure à la livraison prévue
  if (b.date_livraison_prevue && b.date_echeance && b.date_echeance < b.date_livraison_prevue) {
    erreurs.push(`La date d'échéance (${b.date_echeance}) ne peut pas être avant la livraison prévue (${b.date_livraison_prevue}).`);
  }
  // Blocage jour non ouvré pour Cantine
  if (req.activite.code === 'CAN' && b.date_livraison_prevue) {
    const dLiv = new Date(b.date_livraison_prevue + 'T12:00:00');
    if (!h.estJourOuvreCantine(dLiv)) {
      const ferie = h.estJourFerie(dLiv);
      const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][dLiv.getDay()];
      const motif = ferie ? `jour férié (${ferie})` : `${jour} — hors jours ouvrés`;
      erreurs.push(`Livraison Cantine impossible le ${h.formatDate(dLiv)} : ${motif}. Choisissez un jour ouvré (lundi–vendredi hors férié).`);
    }
  }
  if (erreurs.length) {
    const clients = db.prepare('SELECT * FROM client WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
    const produits = db.prepare("SELECT id, reference, designation, prix_vente, unite FROM produit WHERE activite_id = ? AND actif = 1 AND (reference IS NULL OR reference NOT LIKE 'FRAIS-%') ORDER BY designation").all(req.activiteId);
    const feriesAnnee = req.activite.code === 'CAN' ? Array.from(h.joursFeriesCameroun(new Date().getFullYear()).entries()).map(([iso, nom]) => ({ iso, nom })) : [];
    return res.render('commandes/proforma_form', {
      title: 'Nouvelle proforma', page_title: 'Nouvelle proforma',
      commande: b, clients, produits, mode: 'creer', erreurs, modes_paiement: h.MODES_PAIEMENT_B2B,
      feriesAnnee, estCantine: req.activite.code === 'CAN',
    });
  }
  const numero = h.prochainNumeroCommande(db, req.activite.code);
  const numero_proforma = h.prochainNumeroProforma(db, req.activite.code);
  const info = db.transaction(() => {
    const dinfo = db.prepare(`INSERT INTO commande
      (activite_id, numero, statut, client_id, date_commande, date_livraison_prevue, date_echeance,
       mode_paiement, taux_tva, montant_remise, numero_proforma, cree_par_id, notes)
      VALUES (?, ?, 'PROFORMA', ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.activiteId, numero, clientId, b.date_livraison_prevue || null, b.date_echeance || null,
           b.mode_paiement || 'VIREMENT', taux_tva, remise, numero_proforma, req.user.id, b.notes || '');
    const cid = Number(dinfo.lastInsertRowid);
    const insL = db.prepare('INSERT INTO ligne_commande (commande_id, produit_id, designation, quantite, prix_unitaire, remise, taux_tva) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const l of lignes) insL.run(cid, l.produit_id, l.designation || '', l.quantite, l.prix_unitaire, l.remise, l.taux_tva || 0);
    const tot = recalculerTotaux(cid, taux_tva, remise);
    db.prepare('UPDATE commande SET montant_ht = ?, montant_tva = ?, montant_total = ? WHERE id = ?')
      .run(tot.montant_ht, tot.montant_tva, tot.montant_total, cid);
    return cid;
  })();
  req.flash('success', `Proforma ${numero_proforma} créé.`);
  res.redirect('/commandes/' + info);
});

// =========================================================
// DÉTAIL COMMANDE
// =========================================================
router.get('/:id(\\d+)', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd) { req.flash('warning', 'Commande introuvable dans cette activité.'); return res.redirect('/commandes/'); }
  res.render('commandes/detail', {
    title: cmd.numero, page_title: `${cmd.numero} · ${cmd.client_nom}`,
    cmd, statuts_label: h.STATUT_COMMANDE_LABEL, statuts_badge: h.STATUT_COMMANDE_BADGE,
    transitions_possibles: h.STATUT_COMMANDE_TRANSITIONS[cmd.statut] || [],
    modes_paiement: h.MODES_PAIEMENT_B2B,
  });
});

// =========================================================
// MODIFIER PROFORMA (uniquement tant qu'en statut PROFORMA)
// =========================================================
router.get('/:id(\\d+)/modifier', requireEcritureCommandes, (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (cmd.statut !== 'PROFORMA') {
    req.flash('warning', 'On ne peut modifier une commande qu\'au stade Proforma.');
    return res.redirect('/commandes/' + cmd.id);
  }
  const clients = db.prepare('SELECT * FROM client WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  const produits = db.prepare("SELECT id, reference, designation, prix_vente, unite FROM produit WHERE activite_id = ? AND actif = 1 AND (reference IS NULL OR reference NOT LIKE 'FRAIS-%') ORDER BY designation").all(req.activiteId);
  const feriesAnnee = req.activite.code === 'CAN' ? Array.from(h.joursFeriesCameroun(new Date().getFullYear()).entries()).map(([iso, nom]) => ({ iso, nom })) : [];
  res.render('commandes/proforma_form', {
    title: 'Modifier ' + cmd.numero_proforma, page_title: 'Modifier ' + cmd.numero_proforma,
    commande: cmd, clients, produits, mode: 'modifier', erreurs: [],
    modes_paiement: h.MODES_PAIEMENT_B2B,
    feriesAnnee, estCantine: req.activite.code === 'CAN',
  });
});

router.post('/:id(\\d+)/modifier', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (cmd.statut !== 'PROFORMA') { req.flash('warning', 'Statut non modifiable.'); return res.redirect('/commandes/' + cmd.id); }
  const b = req.body;
  const lignes = parseLignes(b);
  if (!lignes.length) { req.flash('error', 'Au moins une ligne est requise.'); return res.redirect('/commandes/' + cmd.id + '/modifier'); }
  const taux_tva = Number(b.taux_tva || 0);
  const remise = Number(String(b.montant_remise || '0').replace(',', '.'));
  // Cohérence livraison / échéance
  if (b.date_livraison_prevue && b.date_echeance && b.date_echeance < b.date_livraison_prevue) {
    req.flash('error', `La date d'échéance ne peut pas être avant la livraison prévue.`);
    return res.redirect('/commandes/' + cmd.id + '/modifier');
  }
  // Blocage jour non ouvré pour Cantine
  if (req.activite.code === 'CAN' && b.date_livraison_prevue) {
    const dLiv = new Date(b.date_livraison_prevue + 'T12:00:00');
    if (!h.estJourOuvreCantine(dLiv)) {
      const ferie = h.estJourFerie(dLiv);
      const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][dLiv.getDay()];
      const motif = ferie ? `jour férié (${ferie})` : `${jour} — hors jours ouvrés`;
      req.flash('error', `Livraison Cantine impossible le ${h.formatDate(dLiv)} : ${motif}.`);
      return res.redirect('/commandes/' + cmd.id + '/modifier');
    }
  }
  db.transaction(() => {
    db.prepare(`UPDATE commande SET client_id = ?, date_livraison_prevue = ?, date_echeance = ?,
                mode_paiement = ?, taux_tva = ?, montant_remise = ?, notes = ? WHERE id = ?`)
      .run(Number(b.client_id), b.date_livraison_prevue || null, b.date_echeance || null,
           b.mode_paiement || 'VIREMENT', taux_tva, remise, b.notes || '', cmd.id);
    db.prepare('DELETE FROM ligne_commande WHERE commande_id = ?').run(cmd.id);
    const insL = db.prepare('INSERT INTO ligne_commande (commande_id, produit_id, designation, quantite, prix_unitaire, remise, taux_tva) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const l of lignes) insL.run(cmd.id, l.produit_id, l.designation || '', l.quantite, l.prix_unitaire, l.remise, l.taux_tva || 0);
    const tot = recalculerTotaux(cmd.id, taux_tva, remise);
    db.prepare('UPDATE commande SET montant_ht = ?, montant_tva = ?, montant_total = ? WHERE id = ?')
      .run(tot.montant_ht, tot.montant_tva, tot.montant_total, cmd.id);
  })();
  req.flash('success', 'Proforma mis à jour.');
  res.redirect('/commandes/' + cmd.id);
});

// =========================================================
// TRANSITIONS DE STATUT
// =========================================================
function transitionAutorisee(source, cible) {
  return (h.STATUT_COMMANDE_TRANSITIONS[source] || []).includes(cible);
}

// PROFORMA → VALIDE (client a signé le proforma → devient bon de commande)
router.post('/:id(\\d+)/valider', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (!transitionAutorisee(cmd.statut, 'VALIDE')) { req.flash('error', 'Transition non autorisée.'); return res.redirect('/commandes/' + cmd.id); }
  const numeroBC = cmd.numero_bon_commande || h.prochainNumeroBonCommande(db, req.activite.code);
  db.prepare(`UPDATE commande SET statut = 'VALIDE', numero_bon_commande = ?, valide_par_id = ? WHERE id = ?`)
    .run(numeroBC, req.user.id, cmd.id);
  req.flash('success', `Proforma validé et transformé en bon de commande ${numeroBC}.`);
  res.redirect('/commandes/' + cmd.id);
});

// Définir les frais de livraison sur une commande (statut VALIDE ou EN_PRODUCTION)
router.post('/:id(\\d+)/frais-livraison', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (!['VALIDE', 'EN_PRODUCTION', 'LIVREE'].includes(cmd.statut)) {
    req.flash('warning', 'Les frais de livraison ne peuvent être ajoutés qu\'après validation du bon de commande.');
    return res.redirect('/commandes/' + cmd.id);
  }
  const frais = Math.max(0, Math.round(Number(String(req.body.frais_livraison || '0').replace(',', '.'))));
  db.prepare('UPDATE commande SET frais_livraison = ? WHERE id = ?').run(frais, cmd.id);
  // Recalculer le total avec les nouveaux frais
  const tot = recalculerTotaux(cmd.id, 0, cmd.montant_remise || 0);
  db.prepare('UPDATE commande SET montant_ht = ?, montant_tva = ?, montant_total = ? WHERE id = ?')
    .run(tot.montant_ht, tot.montant_tva, tot.montant_total, cmd.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'FRAIS_LIVRAISON',
    entite: 'commande', entite_id: cmd.id, details: `${cmd.numero} · Frais livraison : ${frais} FCFA` });
  req.flash('success', frais > 0
    ? `Frais de livraison ajoutés : ${frais.toLocaleString('fr-FR')} FCFA. Nouveau total : ${tot.montant_total.toLocaleString('fr-FR')} FCFA.`
    : 'Frais de livraison retirés (livraison offerte).');
  res.redirect('/commandes/' + cmd.id);
});

// VALIDE → EN_PRODUCTION (info interne, optionnel)
router.post('/:id(\\d+)/production', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (!transitionAutorisee(cmd.statut, 'EN_PRODUCTION')) { req.flash('error', 'Transition non autorisée.'); return res.redirect('/commandes/' + cmd.id); }
  db.prepare(`UPDATE commande SET statut = 'EN_PRODUCTION' WHERE id = ?`).run(cmd.id);
  req.flash('success', 'Commande passée en production.');
  res.redirect('/commandes/' + cmd.id);
});

// VALIDE/EN_PRODUCTION → LIVREE (émission du BL + décrément stock)
// Règle métier :
//   - Par défaut : impossible de livrer tant que la commande n'est pas intégralement soldée.
//   - Exception : le DG peut autoriser une "livraison à crédit" avec traçabilité (client de confiance,
//     paiement à échéance). Dans ce cas les relances de paiement s'activeront après émission de la facture.
router.post('/:id(\\d+)/livrer', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (!transitionAutorisee(cmd.statut, 'LIVREE')) { req.flash('error', 'Transition non autorisée.'); return res.redirect('/commandes/' + cmd.id); }
  // Blocage jour non ouvré pour Cantine (aujourd'hui)
  if (req.activite.code === 'CAN' && !h.estJourOuvreCantine(new Date())) {
    const ferie = h.estJourFerie(new Date());
    const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][new Date().getDay()];
    const motif = ferie ? `jour férié (${ferie})` : `${jour} — hors jours ouvrés`;
    req.flash('error', `Livraison Cantine impossible aujourd'hui : ${motif}. La Cantine ne livre que du lundi au vendredi hors fériés.`);
    return res.redirect('/commandes/' + cmd.id);
  }
  const restant = Number(cmd.montant_total) - Number(cmd.montant_paye);
  const aCredit = String(req.body.a_credit || '') === '1';

  if (restant > 0.01) {
    // Livraison à crédit : uniquement le DG peut autoriser
    if (!aCredit) {
      req.flash('error', `Livraison impossible : le client doit d'abord solder la commande (reste ${h.formatNombre(restant)} ${req.parametres?.devise || 'FCFA'}).`);
      return res.redirect('/commandes/' + cmd.id);
    }
    if (!h.isDG(req.user)) {
      req.flash('error', "La livraison à crédit doit être autorisée par la Direction Générale.");
      return res.redirect('/commandes/' + cmd.id);
    }
    const motifCredit = String(req.body.motif_credit || '').trim();
    if (motifCredit.length < 10) {
      req.flash('error', 'Motif de la livraison à crédit obligatoire (minimum 10 caractères).');
      return res.redirect('/commandes/' + cmd.id);
    }
    // Ajouter le motif aux notes pour traçabilité
    const notesActuelles = cmd.notes ? cmd.notes + '\n' : '';
    const traceCredit = `[LIVRAISON À CRÉDIT autorisée par ${req.user.first_name || req.user.username} le ${h.formatDate(new Date(), true)} — Reste dû : ${h.formatNombre(restant)} — Motif : ${motifCredit}]`;
    db.prepare('UPDATE commande SET notes = ? WHERE id = ?').run(notesActuelles + traceCredit, cmd.id);
  }

  const lignes = db.prepare('SELECT * FROM ligne_commande WHERE commande_id = ?').all(cmd.id);
  const numeroBL = cmd.numero_bl || h.prochainNumeroBL(db, req.activite.code);
  db.transaction(() => {
    const insMouv = db.prepare(`INSERT INTO mouvement_stock (activite_id, produit_id, type, quantite, utilisateur_id, motif, reference_doc)
                                VALUES (?, ?, 'SORTIE', ?, ?, ?, ?)`);
    const updProd = db.prepare('UPDATE produit SET stock_actuel = stock_actuel - ? WHERE id = ?');
    for (const l of lignes) {
      insMouv.run(req.activiteId, l.produit_id, l.quantite, req.user.id, `Livraison commande ${cmd.numero}${aCredit ? ' (à crédit)' : ''}`, numeroBL);
      updProd.run(l.quantite, l.produit_id);
    }
    db.prepare(`UPDATE commande SET statut = 'LIVREE', numero_bl = ?, date_livraison_reelle = datetime('now') WHERE id = ?`)
      .run(numeroBL, cmd.id);
  })();
  // Journal d'audit
  if (aCredit) {
    h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'LIVRAISON_CREDIT',
      entite: 'commande', entite_id: cmd.id,
      details: `Livraison à crédit — commande ${cmd.numero}, BL ${numeroBL}, restant ${h.formatNombre(restant)}, motif: ${String(req.body.motif_credit || '').slice(0, 200)}` });
  } else {
    h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'COMMANDE_LIVREE',
      entite: 'commande', entite_id: cmd.id, details: `BL ${numeroBL} émis pour ${cmd.numero}` });
  }
  req.flash('success', `Commande marquée livrée. BL ${numeroBL} émis.${aCredit ? ' Livraison à crédit tracée.' : ''}`);
  res.redirect('/commandes/' + cmd.id);
});

// LIVREE → FACTUREE
router.post('/:id(\\d+)/facturer', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (!transitionAutorisee(cmd.statut, 'FACTUREE')) { req.flash('error', 'Transition non autorisée.'); return res.redirect('/commandes/' + cmd.id); }
  const numeroF = cmd.numero_facture || h.prochainNumeroFacture(db, req.activite.code);
  const dejaFacture = !!cmd.numero_facture;
  db.prepare(`UPDATE commande SET statut = 'FACTUREE', numero_facture = ? WHERE id = ?`).run(numeroF, cmd.id);

  // Journalisation comptable — Facture B2B (une seule fois par facture)
  // Débit 411 Clients · Crédit 701 Ventes prod finis · Crédit 443 TVA collectée
  if (!dejaFacture) {
    const ttc = Number(cmd.montant_total) || 0;
    const tva = Number(cmd.montant_tva || 0);
    const ht = ttc - tva;
    const lignes = [
      { compte: '411', debit: ttc, credit: 0 },
      { compte: '701', debit: 0, credit: ht },
    ];
    if (tva > 0) lignes.push({ compte: '443', debit: 0, credit: tva });
    h.enregistrerEcriture(db, {
      journal: 'VE',
      libelle: `Facture ${numeroF} — client ${cmd.client_id}`,
      lignes,
      referenceMetier: `COMMANDE#${cmd.id}`,
      activiteId: req.activiteId,
      utilisateurId: req.user.id,
    });
  }

  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'COMMANDE_FACTUREE',
    entite: 'commande', entite_id: cmd.id,
    details: `Facture ${numeroF} émise pour commande ${cmd.numero} — montant ${h.formatNombre(cmd.montant_total)}` });
  req.flash('success', `Facture ${numeroF} émise.`);
  res.redirect('/commandes/' + cmd.id);
});

// Annulation (à tout moment sauf PAYEE et déjà ANNULEE)
router.post('/:id(\\d+)/annuler', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (['PAYEE', 'ANNULEE'].includes(cmd.statut)) { req.flash('warning', 'Cette commande ne peut plus être annulée.'); return res.redirect('/commandes/' + cmd.id); }
  db.prepare(`UPDATE commande SET statut = 'ANNULEE' WHERE id = ?`).run(cmd.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'COMMANDE_ANNULEE',
    entite: 'commande', entite_id: cmd.id,
    details: `Commande ${cmd.numero} (${cmd.statut} → ANNULEE) client=${cmd.client_id} montant=${h.formatNombre(cmd.montant_total)}` });
  req.flash('info', 'Commande annulée.');
  res.redirect('/commandes/' + cmd.id);
});

// =========================================================
// ENCAISSEMENTS (acomptes multiples autorisés)
// =========================================================
router.post('/:id(\\d+)/paiement', requireEcritureCommandes, paiementUpload.single('piece_jointe'), (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  if (['PROFORMA', 'ANNULEE'].includes(cmd.statut)) {
    // Supprimer le fichier uploadé si erreur
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    req.flash('error', 'Un proforma n\'est pas encaissable — validez-le d\'abord.');
    return res.redirect('/commandes/' + cmd.id);
  }
  const montant = Number(String(req.body.montant || '0').replace(',', '.'));
  if (!montant || montant <= 0) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    req.flash('error', 'Montant invalide.'); return res.redirect('/commandes/' + cmd.id);
  }
  const restant = Number(cmd.montant_total) - Number(cmd.montant_paye);
  if (montant > restant + 0.01) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    req.flash('error', `Le montant dépasse le restant dû (${h.formatNombre(restant)}).`); return res.redirect('/commandes/' + cmd.id);
  }
  const mode = req.body.mode_paiement || cmd.mode_paiement || 'VIREMENT';
  const reference = req.body.reference_transaction || '';
  const notes = req.body.notes || '';
  const pieceJointe = req.file ? `/paiements/${req.file.filename}` : '';
  const numeroRecu = h.prochainNumeroRecu(db, req.activite.code);
  // Arrondi FCFA
  const montantArrondi = Math.round(montant);
  db.transaction(() => {
    db.prepare(`INSERT INTO paiement (activite_id, commande_id, numero_recu, mode_paiement, montant, reference_transaction, piece_jointe, cree_par_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.activiteId, cmd.id, numeroRecu, mode, montantArrondi, reference, pieceJointe, req.user.id, notes);
    const nouveauPaye = Math.round(Number(cmd.montant_paye)) + montantArrondi;
    db.prepare('UPDATE commande SET montant_paye = ? WHERE id = ?').run(nouveauPaye, cmd.id);
    // Émission automatique de la facture si commande LIVREE encaissée sans facture préalable
    // (garantit qu'une commande encaissée a toujours un numéro de facture — obligation OHADA)
    let factureNouvellementEmise = false;
    let numeroFacture = cmd.numero_facture;
    if (cmd.statut === 'LIVREE' && !cmd.numero_facture) {
      numeroFacture = h.prochainNumeroFacture(db, req.activite.code);
      db.prepare(`UPDATE commande SET statut = 'FACTUREE', numero_facture = ? WHERE id = ?`).run(numeroFacture, cmd.id);
      factureNouvellementEmise = true;
    }
    // Passage à PAYEE si soldée
    if (nouveauPaye >= Math.round(Number(cmd.montant_total))) {
      db.prepare("UPDATE commande SET statut = 'PAYEE' WHERE id = ?").run(cmd.id);
    }

    // Journalisation comptable
    // Cas 1 : facture auto-émise → écriture 411/701/443 comme dans /facturer
    if (factureNouvellementEmise) {
      const ttc = Number(cmd.montant_total) || 0;
      const tva = Number(cmd.montant_tva || 0);
      const ht = ttc - tva;
      const lignesFact = [
        { compte: '411', debit: ttc, credit: 0 },
        { compte: '701', debit: 0, credit: ht },
      ];
      if (tva > 0) lignesFact.push({ compte: '443', debit: 0, credit: tva });
      h.enregistrerEcriture(db, {
        journal: 'VE', libelle: `Facture ${numeroFacture} — client ${cmd.client_id}`,
        lignes: lignesFact, referenceMetier: `COMMANDE#${cmd.id}`,
        activiteId: req.activiteId, utilisateurId: req.user.id,
      });
    }
    // Cas 2 : encaissement → Débit caisse/banque · Crédit 411
    const isEspeces = String(mode).toUpperCase().includes('ESPECES') || String(mode).toUpperCase().includes('CAISSE');
    const compteContrepartie = isEspeces ? h.compteCaisseActivite(db, req.activite.code) : '521';
    const journalContrepartie = isEspeces ? h.journalCaisseActivite(db, req.activite.code) : 'BQ';
    h.enregistrerEcriture(db, {
      journal: journalContrepartie,
      libelle: `Reçu ${numeroRecu} — ${mode} — commande ${cmd.numero}`,
      lignes: [
        { compte: compteContrepartie, debit: montantArrondi, credit: 0 },
        { compte: '411', debit: 0, credit: montantArrondi },
      ],
      referenceMetier: `COMMANDE#${cmd.id}`,
      activiteId: req.activiteId, utilisateurId: req.user.id,
    });
  })();
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PAIEMENT_ENREGISTRE',
    entite: 'commande', entite_id: cmd.id,
    details: `Reçu ${numeroRecu} — ${h.formatNombre(montantArrondi)} en ${mode}${pieceJointe ? ' (pièce jointe)' : ''} sur commande ${cmd.numero}` });
  req.flash('success', `Reçu ${numeroRecu} enregistré (${h.formatNombre(montant)})${pieceJointe ? ' — pièce justificative attachée' : ''}.`);
  res.redirect('/commandes/' + cmd.id);
});

// =========================================================
// PDF : proforma / BC / BL / facture / reçu
// Design inspiré du vrai modèle Le Traiteur du Bistrot SUARL
// =========================================================

// Bande décorative haut/bas (imitation "code-barres" du modèle réel)
// =============================================================================
// STYLE PRESTIGE DORÉ — Palette or + noir
// =============================================================================
const OR         = '#C9A227';   // Or principal
const OR_FONCE   = '#8B6914';   // Or foncé (bordures, mentions)
const OR_CLAIR   = '#E9D8A6';   // Or clair (fond secondaire)
const NOIR       = '#0A0A0A';
const NOIR_DOUX  = '#2D2D2D';
const GRIS       = '#666666';

// Bandeau doré plein — en haut ou en bas de page
function dessinerBandeauOr(doc, y, hauteur = 28) {
  // Rectangle plein doré principal
  doc.rect(0, y, doc.page.width, hauteur).fill(OR);
  // Fine ligne noire top & bottom pour finition
  doc.rect(0, y, doc.page.width, 1.5).fill(NOIR);
  doc.rect(0, y + hauteur - 1.5, doc.page.width, 1.5).fill(NOIR);
  // Fine ligne or foncé interne (double bord chic)
  doc.rect(0, y + 3, doc.page.width, 0.5).fill(OR_FONCE);
  doc.rect(0, y + hauteur - 3.5, doc.page.width, 0.5).fill(OR_FONCE);
  doc.fillColor(NOIR);
}

// Filigrane diagonal 45° — style Executive Classic
// Nom de l'activité en très grande police, rotation -40°, opacité 8%
// lineBreak:false + textWidth précis pour éviter que le wrap crée des pages parasites
// même quand le nom d'activité est long (ex "Pâtisserie / Salon de Thé / Restaurant")
function dessinerFiligrane(doc, texte) {
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
  // Largeur généreuse (× 2) + lineBreak:false pour garantir une seule ligne
  const textWidth = doc.widthOfString(t, { characterSpacing: spacing });
  doc.text(t, -textWidth / 2, -fontSize / 2, {
    width: textWidth * 2,
    lineBreak: false,
    characterSpacing: spacing,
  });
  doc.restore();
  doc.fillOpacity(1).fillColor(NOIR);
}

// Compat rétro (autres appels dans le fichier utilisent encore dessinerBandeDeco)
function dessinerBandeDeco(doc, y) {
  dessinerBandeauOr(doc, y, 20);
}

function generateDocPDF(cmd, opts, res, params) {
  // Marge bottom à 0 : le footer est en position absolue, la marge PDF ne doit pas déclencher d'auto-flow
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${opts.filename}"`);
  doc.pipe(res);
  const devise = params.devise || 'FCFA';
  const afficherPrix = opts.afficher_prix !== false;

  // ---- FILIGRANE : nom de l'activité (dessiné en premier pour être sous le contenu) ----
  dessinerFiligrane(doc, cmd.activite_nom || params.entreprise_nom || '');

  // ---- EN-TÊTE SOBRE — pas de bandeau, juste raison sociale + activité ----
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NOIR)
     .text((params.entreprise_nom || 'LE TRAITEUR DU BISTROT SUARL').toUpperCase(), 40, 40, { width: 380, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS)
     .text(params.entreprise_adresse || '', 40, 62, { width: 380 });
  if (cmd.activite_nom) {
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
       .text('ACTIVITÉ', 400, 40, { align: 'right', width: 155, characterSpacing: 2 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR)
       .text(cmd.activite_nom.toUpperCase(), 400, 51, { align: 'right', width: 155, characterSpacing: 2 });
  }
  // Fine ligne noire de séparation
  doc.rect(40, 85, 515, 1.2).fill(NOIR);

  // ---- TITRE DU DOCUMENT — grande police, filet or fin dessous ----
  let y = 110;
  const titreDoc = opts.titre.toUpperCase();
  doc.font('Helvetica-Bold').fontSize(26).fillColor(NOIR)
     .text(titreDoc, 40, y, { align: 'center', width: 515, characterSpacing: 6 });
  // Filet or fin centré
  doc.rect((doc.page.width - 60) / 2, y + 38, 60, 2).fill(OR);

  // ---- LIGNE INFO : Numéro (gauche) — Date (droite) ----
  y = 162;
  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('N° DU DOCUMENT', 40, y, { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(opts.numero || '—', 40, y + 12);

  doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('DOUALA, LE', 400, y, { align: 'right', width: 155, characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(h.formatDate(opts.date || new Date()), 400, y + 12, { align: 'right', width: 155 });

  // ---- BLOC CLIENT — bordure gauche or ----
  y = 200;
  doc.rect(40, y, 3, cmd.client_adresse ? 46 : 30).fill(OR);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(OR_FONCE).text('DOIT', 52, y, { characterSpacing: 3 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NOIR).text(cmd.client_nom || '', 52, y + 12, { width: 500 });
  if (cmd.client_adresse) {
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(cmd.client_adresse, 52, y + 30, { width: 500 });
  }
  y += (cmd.client_adresse ? 60 : 44);

  // ---- Objet / références ----
  if (opts.objet) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('OBJET  ', 40, y, { continued: true, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9).fillColor(NOIR).text(opts.objet, { width: 500 });
    y = doc.y + 4;
  }
  if (opts.references && opts.references.length) {
    for (const ref of opts.references) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text(ref.label.toUpperCase() + '  ', 40, y, { continued: true, characterSpacing: 1 });
      doc.font('Helvetica').fontSize(9).fillColor(NOIR).text(ref.valeur);
      y = doc.y + 2;
    }
    y += 4;
  }
  if (cmd.client_contact || cmd.client_tel) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('CONTACT  ', 40, y, { continued: true, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9).fillColor(NOIR).text([cmd.client_contact, cmd.client_tel].filter(Boolean).join(' — '));
    y = doc.y + 6;
  }
  y += 6;

  // ---- Tableau des lignes ----
  const cols = afficherPrix
    ? { desc: { x: 45, w: 240, label: 'DÉSIGNATION' },
        qte:  { x: 290, w: 70, label: 'Quantité', align: 'center' },
        pu:   { x: 365, w: 90, label: 'Prix Unitaire', align: 'right' },
        tot:  { x: 460, w: 95, label: 'Prix Total HT', align: 'right' } }
    : { desc: { x: 45, w: 340, label: 'DÉSIGNATION' },
        qte:  { x: 390, w: 80, label: 'Qté commandée', align: 'center' },
        livre:{ x: 475, w: 80, label: 'Qté livrée', align: 'center' } };

  // En-tête tableau — NOIR avec texte OR
  const rowH = 24;
  doc.rect(40, y, 515, rowH).fill(NOIR);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(OR);
  for (const [k, c] of Object.entries(cols)) {
    doc.text(c.label, c.x, y + 8, { width: c.w, align: c.align || 'left', characterSpacing: 1 });
  }
  y += rowH;

  // Lignes — zebra très clair pour lisibilité
  doc.fillColor(NOIR);
  let idxLigne = 0;
  for (const l of cmd.lignes) {
    if (y > 680) { doc.addPage(); y = 60; }
    const hauteur = Math.max(20, doc.heightOfString(l.designation, { width: cols.desc.w }) + 10);
    // Fond zebra
    if (idxLigne % 2 === 0) { doc.rect(40, y, 515, hauteur).fill('#FBF8ED'); }
    // Bordure inférieure or clair
    doc.rect(40, y + hauteur - 0.5, 515, 0.5).fill(OR_CLAIR);
    doc.font('Helvetica').fontSize(9).fillColor(NOIR);
    doc.text(l.designation, cols.desc.x, y + 6, { width: cols.desc.w });
    doc.text(String(Math.round(l.quantite * 100) / 100) + (l.produit_unite ? ' ' + l.produit_unite : ''), cols.qte.x, y + 6, { width: cols.qte.w, align: 'center' });
    if (afficherPrix) {
      doc.text(h.formatNombre(l.prix_unitaire), cols.pu.x, y + 6, { width: cols.pu.w, align: 'right' });
      const totalLigne = Number(l.quantite) * Number(l.prix_unitaire) * (1 - Number(l.remise || 0) / 100);
      doc.font('Helvetica-Bold').text(h.formatNombre(totalLigne), cols.tot.x, y + 6, { width: cols.tot.w, align: 'right' });
    } else {
      // Ligne en pointillés pour saisie manuelle de la qté livrée
      doc.strokeColor(OR_FONCE).lineWidth(0.5).dash(2, { space: 2 });
      doc.moveTo(cols.livre.x + 10, y + hauteur - 8).lineTo(cols.livre.x + cols.livre.w - 10, y + hauteur - 8).stroke().undash();
    }
    y += hauteur;
    idxLigne++;
  }
  // Ligne "Livraison" (si frais > 0)
  if (afficherPrix && Number(cmd.frais_livraison || 0) > 0) {
    if (y > 680) { doc.addPage(); y = 60; }
    if (idxLigne % 2 === 0) { doc.rect(40, y, 515, 22).fill('#FBF8ED'); }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NOIR).text('Livraison', cols.desc.x, y + 6, { width: cols.desc.w });
    doc.font('Helvetica').text('1', cols.qte.x, y + 6, { width: cols.qte.w, align: 'center' });
    doc.text(h.formatNombre(cmd.frais_livraison), cols.pu.x, y + 6, { width: cols.pu.w, align: 'right' });
    doc.font('Helvetica-Bold').text(h.formatNombre(cmd.frais_livraison), cols.tot.x, y + 6, { width: cols.tot.w, align: 'right' });
    y += 22;
  }

  // Bordure noire fine sous le tableau
  doc.rect(40, y, 515, 1.5).fill(NOIR);
  y += 8;

  // ---- BLOC TOTAUX — Executive Classic (encadré noir, ligne finale noire avec texte OR) ----
  if (afficherPrix) {
    if (y > 620) { doc.addPage(); y = 60; }
    const totalRows = [
      ['Montant HT', cmd.montant_ht],
    ];
    if (Number(cmd.montant_remise) > 0) totalRows.push(['Remise', -Math.abs(Number(cmd.montant_remise))]);
    if (Number(cmd.taux_tva) > 0) totalRows.push([`TVA ${cmd.taux_tva} %`, cmd.montant_tva]);
    totalRows.push(['TOTAL TTC', cmd.montant_total]);

    // Bloc totaux aligné à droite, largeur 260 px, encadré noir
    const blocX = 295, blocW = 260;
    let bY = y;
    const totalRowsSansFinal = totalRows.length - 1;
    const hauteurTotale = totalRowsSansFinal * 22 + 30;
    // Bordure extérieure noire
    doc.rect(blocX, bY, blocW, hauteurTotale).lineWidth(1).strokeColor(NOIR).stroke();

    for (let i = 0; i < totalRows.length; i++) {
      const [lbl, val] = totalRows[i];
      const isFinal = i === totalRows.length - 1;
      const rowHeight = isFinal ? 30 : 22;
      if (isFinal) {
        // Ligne finale — fond NOIR plein avec texte OR
        doc.rect(blocX, bY, blocW, rowHeight).fill(NOIR);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(OR)
           .text(lbl, blocX + 12, bY + 10, { width: 110, characterSpacing: 2 });
        doc.font('Helvetica-Bold').fontSize(12).fillColor(OR)
           .text(h.formatNombre(val) + ' ' + devise, blocX + 122, bY + 9, { width: blocW - 134, align: 'right' });
      } else {
        // Lignes intermédiaires — fond blanc, libellé or foncé
        doc.font('Helvetica-Bold').fontSize(10).fillColor(OR_FONCE)
           .text(lbl, blocX + 12, bY + 7, { width: 110 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR)
           .text(h.formatNombre(val), blocX + 122, bY + 7, { width: blocW - 134, align: 'right' });
      }
      bY += rowHeight;
    }
    y = bY + 16;

    // ---- Montant en toutes lettres (sobre, sans encadré) ----
    if (y > 720) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(NOIR)
       .text('Arrêtée à la somme de ', 40, y, { continued: true });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR)
       .text(h.montantEnLettres(cmd.montant_total, 'Francs CFA') + '.', { width: 515 });
    y = doc.y + 12;
  }

  // ---- Conditions de règlement ----
  if (opts.conditions) {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('CONDITIONS DE RÈGLEMENT  ', 40, y, { continued: true, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(9).fillColor(NOIR).text(opts.conditions);
    y = doc.y + 6;
  }

  // ---- Modalités bancaires ----
  if (opts.afficher_paiement && (cmd.mode_paiement === 'VIREMENT' || cmd.mode_paiement === 'CHEQUE')) {
    if (y > 660) { doc.addPage(); y = 60; }
    y += 6;
    // Encadré doré
    const paieH = cmd.mode_paiement === 'VIREMENT' ? 44 : 32;
    doc.rect(40, y, 515, paieH).lineWidth(0.5).strokeColor(OR_FONCE).stroke();
    doc.rect(40, y, 4, paieH).fill(OR);
    if (cmd.mode_paiement === 'VIREMENT') {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('MODALITÉS DE PAIEMENT — VIREMENT BANCAIRE', 52, y + 6, { characterSpacing: 1 });
      const infos = [];
      if (params.entreprise_banque_nom) infos.push('Banque : ' + params.entreprise_banque_nom);
      if (params.entreprise_banque_compte) infos.push('Compte : ' + params.entreprise_banque_compte);
      if (params.entreprise_banque_swift) infos.push('SWIFT/BIC : ' + params.entreprise_banque_swift);
      if (infos.length) {
        doc.font('Helvetica').fontSize(9).fillColor(NOIR).text(infos.join('   ·   '), 52, y + 22, { width: 500 });
      } else {
        doc.font('Helvetica').fontSize(9).fillColor('#B91C1C').text('⚠ Coordonnées bancaires non renseignées (Administration → Paramètres).', 52, y + 22);
      }
    } else {
      const libelle = params.entreprise_cheque_libelle || params.entreprise_nom || 'Le Traiteur du Bistrot';
      doc.font('Helvetica-Bold').fontSize(9).fillColor(OR_FONCE).text('CHÈQUE À LIBELLER À L\'ORDRE DE  ', 52, y + 10, { continued: true, characterSpacing: 1 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text(libelle);
    }
    y += paieH + 10;
  }

  // ---- Notes ----
  if (cmd.notes) {
    if (y > 720) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(NOIR_DOUX).text('Note : ' + cmd.notes, 40, y, { width: 515 });
    y = doc.y + 6;
  }

  // ---- Signatures ----
  if (opts.signature) {
    y = Math.max(y, 640);
    if (opts.signature === 'gerant') {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text('LE GÉRANT', 380, y, { align: 'center', width: 175, characterSpacing: 2 });
      doc.rect(380, y + 15, 175, 55).lineWidth(0.5).strokeColor(OR_FONCE).stroke();
      // Petit sceau doré coin bas-droite
      doc.rect(544, y + 60, 11, 10).fill(OR);
    } else if (opts.signature === 'livraison') {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NOIR);
      doc.text('LIVREUR', 60, y, { align: 'center', width: 200, characterSpacing: 2 });
      doc.rect(60, y + 12, 200, 60).lineWidth(0.5).strokeColor(OR_FONCE).stroke();
      doc.rect(60, y + 12, 200, 2).fill(OR);
      doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Nom & signature', 60, y + 18, { align: 'center', width: 200 });

      doc.font('Helvetica-Bold').fontSize(9).fillColor(NOIR);
      doc.text('CLIENT (Bon pour réception)', 335, y, { align: 'center', width: 200, characterSpacing: 2 });
      doc.rect(335, y + 12, 200, 60).lineWidth(0.5).strokeColor(OR_FONCE).stroke();
      doc.rect(335, y + 12, 200, 2).fill(OR);
      doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Date, nom, signature', 335, y + 18, { align: 'center', width: 200 });
    }
  }

  // ---- FOOTER — Executive Classic (filet or fin + mentions légales en gris) ----
  const footerY = doc.page.height - 42;
  // Fin filet or
  doc.rect(40, footerY, 515, 0.8).fill(OR);
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS);
  const ligneFooterHaut = [
    params.entreprise_tel ? 'Tél : ' + params.entreprise_tel : '',
    params.entreprise_email ? 'Email : ' + params.entreprise_email : '',
  ].filter(Boolean).join('   ·   ');
  doc.text(ligneFooterHaut, 40, footerY + 6, { align: 'center', width: 515, lineBreak: false });
  const ligneFooterBas = [
    params.entreprise_niu ? 'NIU ' + params.entreprise_niu : '',
    params.entreprise_rccm ? 'RCCM ' + params.entreprise_rccm : '',
    params.entreprise_banque_compte ? 'Cpte ' + params.entreprise_banque_compte + (params.entreprise_banque_nom ? ' — ' + params.entreprise_banque_nom : '') : '',
  ].filter(Boolean).join('   ·   ');
  if (ligneFooterBas) doc.text(ligneFooterBas, 40, footerY + 18, { align: 'center', width: 515, lineBreak: false });

  doc.end();
}

function chargerParametresLocaux(req) {
  return {
    entreprise_nom: req.parametres?.entreprise_nom || 'Le Traiteur du Bistrot',
    entreprise_adresse: req.parametres?.entreprise_adresse || '',
    entreprise_tel: req.parametres?.entreprise_tel || '',
    entreprise_email: req.parametres?.entreprise_email || '',
    entreprise_niu: req.parametres?.entreprise_niu || '',
    entreprise_rccm: req.parametres?.entreprise_rccm || '',
    entreprise_banque_nom: req.parametres?.entreprise_banque_nom || '',
    entreprise_banque_compte: req.parametres?.entreprise_banque_compte || '',
    entreprise_banque_swift: req.parametres?.entreprise_banque_swift || '',
    entreprise_cheque_libelle: req.parametres?.entreprise_cheque_libelle || '',
    devise: req.parametres?.devise || 'FCFA',
  };
}

router.get('/:id(\\d+)/pdf/proforma', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  const p = chargerParametresLocaux(req);
  const references = [];
  if (cmd.date_livraison_prevue) references.push({ label: 'Livraison prévue', valeur: h.formatDate(cmd.date_livraison_prevue) });
  references.push({ label: 'Validité', valeur: '30 jours à compter de l\'émission' });
  generateDocPDF(cmd, {
    titre: 'Facture Proforma',
    numero: cmd.numero_proforma,
    date: cmd.date_commande,
    filename: `proforma_${cmd.numero_proforma}.pdf`,
    objet: cmd.notes && cmd.notes.length < 200 ? cmd.notes : null,
    references,
    conditions: `${cmd.mode_paiement === 'CHEQUE' ? 'Paiement par chèque' : 'Paiement par virement'}. 100% avant livraison.`,
    afficher_paiement: true,
    signature: 'gerant',
  }, res, p);
});

router.get('/:id(\\d+)/pdf/bon-commande', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd || !cmd.numero_bon_commande) return res.redirect('/commandes/' + req.params.id);
  const p = chargerParametresLocaux(req);
  const references = [];
  if (cmd.numero_proforma) references.push({ label: 'Réf. Proforma', valeur: cmd.numero_proforma });
  if (cmd.date_livraison_prevue) references.push({ label: 'Livraison prévue', valeur: h.formatDate(cmd.date_livraison_prevue) });
  if (cmd.date_echeance) references.push({ label: 'Échéance paiement', valeur: h.formatDate(cmd.date_echeance) });
  generateDocPDF(cmd, {
    titre: 'Bon de Commande',
    numero: cmd.numero_bon_commande,
    date: cmd.date_commande,
    filename: `bc_${cmd.numero_bon_commande}.pdf`,
    objet: cmd.notes && cmd.notes.length < 200 ? cmd.notes : null,
    references,
    conditions: `${cmd.mode_paiement === 'CHEQUE' ? 'Paiement par chèque' : 'Paiement par virement'}. 100% avant livraison.`,
    afficher_paiement: true,
    signature: 'gerant',
  }, res, p);
});

router.get('/:id(\\d+)/pdf/bon-livraison', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd || !cmd.numero_bl) return res.redirect('/commandes/' + req.params.id);
  const p = chargerParametresLocaux(req);
  const references = [];
  if (cmd.numero_bon_commande) references.push({ label: 'Réf. Bon de commande', valeur: cmd.numero_bon_commande });
  if (cmd.date_livraison_reelle) references.push({ label: 'Livré le', valeur: h.formatDate(cmd.date_livraison_reelle) });
  generateDocPDF(cmd, {
    titre: 'Bon de Livraison',
    numero: cmd.numero_bl,
    date: cmd.date_livraison_reelle || new Date(),
    filename: `bl_${cmd.numero_bl}.pdf`,
    objet: cmd.notes && cmd.notes.length < 200 ? cmd.notes : null,
    references,
    afficher_prix: false,     // Le BL ne montre PAS les prix
    signature: 'livraison',
    conditions: `Vérifiez la conformité à la réception. Toute réclamation doit être formulée sous 24 heures.`,
  }, res, p);
});

router.get('/:id(\\d+)/pdf/facture', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd || !cmd.numero_facture) return res.redirect('/commandes/' + req.params.id);
  const p = chargerParametresLocaux(req);
  const restant = Math.max(0, Number(cmd.montant_total) - Number(cmd.montant_paye));
  const references = [];
  if (cmd.numero_bon_commande) references.push({ label: 'Bon de commande', valeur: cmd.numero_bon_commande });
  if (cmd.numero_bl) references.push({ label: 'Bon de livraison', valeur: cmd.numero_bl });
  if (cmd.date_echeance) references.push({ label: 'Échéance', valeur: h.formatDate(cmd.date_echeance) });
  if (Number(cmd.montant_paye) > 0) {
    references.push({ label: 'Déjà réglé', valeur: h.formatNombre(cmd.montant_paye) + ' ' + p.devise });
    references.push({ label: 'Reste à payer', valeur: h.formatNombre(restant) + ' ' + p.devise });
  }
  generateDocPDF(cmd, {
    titre: 'Facture',
    numero: cmd.numero_facture,
    date: new Date(),
    filename: `facture_${cmd.numero_facture}.pdf`,
    objet: cmd.notes && cmd.notes.length < 200 ? cmd.notes : null,
    references,
    conditions: `${cmd.mode_paiement === 'CHEQUE' ? 'Paiement par chèque' : 'Paiement par virement'}. En cas de retard, des pénalités de 1,5% par mois pourront être appliquées.`,
    afficher_paiement: true,
    signature: 'gerant',
  }, res, p);
});

router.get('/:id(\\d+)/pdf/recu/:paiementId(\\d+)', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  const paiement = cmd.paiements.find(p => p.id == req.params.paiementId);
  if (!paiement) return res.redirect('/commandes/' + cmd.id);
  const p = chargerParametresLocaux(req);
  const doc = new PDFDocument({ size: 'A5', margin: 30, layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="recu_${paiement.numero_recu}.pdf"`);
  doc.pipe(res);
  doc.fontSize(14).fillColor('#1e3a8a').text(p.entreprise_nom || 'Le Traiteur du Bistrot', 30, 30);
  doc.fontSize(18).fillColor('#000').text('REÇU DE PAIEMENT', 30, 55);
  doc.fontSize(12).fillColor('#CA8A04').text(paiement.numero_recu, 30, 78);
  doc.moveTo(30, 100).lineTo(560, 100).strokeColor('#CA8A04').lineWidth(1.5).stroke();
  let y = 120;
  const lignes = [
    ['Reçu de', cmd.client_nom],
    ['La somme de', h.formatNombre(paiement.montant) + ' ' + p.devise],
    ['Mode paiement', paiement.mode_paiement + (paiement.reference_transaction ? ' — ' + paiement.reference_transaction : '')],
    ['Au titre de', 'Facture ' + (cmd.numero_facture || cmd.numero_bon_commande || cmd.numero)],
    ['Date', h.formatDate(paiement.date_paiement, true)],
  ];
  for (const [k, v] of lignes) {
    doc.fontSize(10).fillColor('#64748B').text(k, 30, y, { width: 130 });
    doc.fontSize(11).fillColor('#000').text(v, 170, y);
    y += 20;
  }
  y += 20;
  const totalDu = Number(cmd.montant_total);
  const dejaPaye = Number(cmd.montant_paye);
  const reste = Math.max(0, totalDu - dejaPaye);
  doc.fontSize(9).fillColor('#64748B').text(`Total commande : ${h.formatNombre(totalDu)} ${p.devise}   ·   Déjà réglé : ${h.formatNombre(dejaPaye)} ${p.devise}   ·   Reste à payer : ${h.formatNombre(reste)} ${p.devise}`, 30, y);
  if (paiement.piece_jointe) {
    y += 18;
    doc.fontSize(9).fillColor('#1e3a8a').text('✓ Pièce justificative attachée au reçu (dossier électronique).', 30, y);
  }
  doc.end();
});

// =========================================================
// FACTURES À ENCAISSER — vue dédiée orientée recouvrement
// =========================================================
router.get('/factures/', (req, res) => {
  const filtre = (req.query.filtre || 'impayees').trim();
  const q = (req.query.q || '').trim();

  // Réparations idempotentes des données historiques :
  //   1) Arrondi FCFA sur tous les montants
  //   2) Tolérance 1 FCFA : si reste dû ≤ 1 FCFA, on considère la facture soldée
  //   3) Génération auto d'un numero_facture pour toute commande LIVREE/FACTUREE/PAYEE qui n'en a pas
  //   4) Passage à PAYEE pour toute commande FACTUREE désormais soldée
  db.prepare(`UPDATE commande SET
                montant_ht = ROUND(montant_ht),
                montant_tva = ROUND(montant_tva),
                montant_total = ROUND(montant_total),
                montant_paye = ROUND(montant_paye)
              WHERE activite_id = ?`).run(req.activiteId);
  db.prepare(`UPDATE commande SET montant_paye = montant_total
              WHERE activite_id = ? AND statut = 'FACTUREE'
                AND montant_paye > 0 AND montant_paye < montant_total
                AND (montant_total - montant_paye) <= 1`).run(req.activiteId);

  // Génération auto du numero_facture pour les commandes livrées/facturées/soldées qui n'en ont pas
  const cmdSansFacture = db.prepare(`SELECT id FROM commande
    WHERE activite_id = ? AND statut IN ('LIVREE', 'FACTUREE', 'PAYEE')
      AND (numero_facture IS NULL OR numero_facture = '')`).all(req.activiteId);
  for (const c of cmdSansFacture) {
    const numeroF = h.prochainNumeroFacture(db, req.activite.code);
    db.prepare(`UPDATE commande SET numero_facture = ?,
                statut = CASE WHEN statut = 'LIVREE' THEN 'FACTUREE' ELSE statut END
                WHERE id = ?`).run(numeroF, c.id);
  }

  db.prepare(`UPDATE commande SET statut = 'PAYEE'
              WHERE activite_id = ? AND statut = 'FACTUREE' AND montant_paye >= montant_total`).run(req.activiteId);

  const conditions = ['c.activite_id = ?', "c.numero_facture IS NOT NULL", "c.numero_facture != ''", "c.statut != 'ANNULEE'"];
  const params = [req.activiteId];
  const periode = h.resoudrePeriode(req.query);

  if (filtre === 'impayees') conditions.push('c.montant_paye + 1 < c.montant_total');
  else if (filtre === 'partielles') conditions.push('c.montant_paye > 0 AND c.montant_paye + 1 < c.montant_total');
  else if (filtre === 'en_retard') conditions.push("c.montant_paye + 1 < c.montant_total AND c.date_echeance IS NOT NULL AND date(c.date_echeance) < date('now')");
  else if (filtre === 'a_echeance') conditions.push("c.montant_paye + 1 < c.montant_total AND (c.date_echeance IS NULL OR date(c.date_echeance) >= date('now'))");
  else if (filtre === 'soldees') conditions.push('c.montant_paye + 1 >= c.montant_total');

  if (q) {
    conditions.push('(cl.nom LIKE ? OR c.numero_facture LIKE ? OR c.numero LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (periode.debut) { conditions.push('date(c.date_commande) >= date(?)'); params.push(periode.debut); }
  if (periode.fin) { conditions.push('date(c.date_commande) <= date(?)'); params.push(periode.fin); }

  const p = h.pagination(req);
  const totalFactures = db.prepare(`SELECT COUNT(*) AS n FROM commande c JOIN client cl ON cl.id = c.client_id WHERE ${conditions.join(' AND ')}`).get(...params).n;
  const factures = db.prepare(`SELECT c.*, cl.nom AS client_nom, cl.type_client, cl.telephone AS client_tel,
                                       cl.contact_personne AS client_contact
                               FROM commande c JOIN client cl ON cl.id = c.client_id
                               WHERE ${conditions.join(' AND ')}
                               ORDER BY (c.date_echeance IS NULL), c.date_echeance, c.numero_facture
                               LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);

  // Enrichir chaque ligne avec calculs et statut (tolérance 1 FCFA)
  const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
  for (const f of factures) {
    f.montant_restant = Math.max(0, Math.round(Number(f.montant_total) - Number(f.montant_paye)));
    f.est_soldee = f.montant_restant <= 1;
    f.est_partiel = Number(f.montant_paye) > 0 && !f.est_soldee;
    let jours = null;
    if (f.date_echeance) {
      const ech = new Date(f.date_echeance); ech.setHours(0, 0, 0, 0);
      jours = Math.floor((aujourdhui - ech) / 86400000);
    }
    f.jours_retard = jours;
    f.en_retard = jours !== null && jours > 0 && !f.est_soldee;
  }

  // KPIs globaux — requêtes séparées (plus fiable que CASE WHEN groupé avec node-sqlite3-wasm)
  const baseWhere = `activite_id = ? AND numero_facture IS NOT NULL AND numero_facture != '' AND statut != 'ANNULEE'`;
  const nbTotalRow = db.prepare(`SELECT COUNT(*) AS n FROM commande WHERE ${baseWhere}`).get(req.activiteId);
  const nbImpayeesRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total - montant_paye), 0) AS mt
                                    FROM commande WHERE ${baseWhere} AND montant_paye + 1 < montant_total`).get(req.activiteId);
  const nbPartiellesRow = db.prepare(`SELECT COUNT(*) AS n FROM commande WHERE ${baseWhere}
                                      AND montant_paye > 0 AND montant_paye + 1 < montant_total`).get(req.activiteId);
  const nbSoldeesRow = db.prepare(`SELECT COUNT(*) AS n FROM commande WHERE ${baseWhere}
                                   AND montant_paye + 1 >= montant_total`).get(req.activiteId);
  const enRetardRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total - montant_paye), 0) AS mt
                                  FROM commande WHERE ${baseWhere}
                                    AND montant_paye + 1 < montant_total
                                    AND date_echeance IS NOT NULL AND date(date_echeance) < date('now')`).get(req.activiteId);

  const kpiRow = {
    nb_total: Number(nbTotalRow.n || 0),
    nb_impayees: Number(nbImpayeesRow.n || 0),
    total_du: Number(nbImpayeesRow.mt || 0),
    nb_partielles: Number(nbPartiellesRow.n || 0),
    nb_soldees: Number(nbSoldeesRow.n || 0),
  };

  res.render('commandes/factures_liste', {
    title: 'Factures à encaisser', page_title: `Factures — ${req.activite.nom}`,
    factures, filtre, q, periode,
    kpi: {
      nb_total: kpiRow.nb_total, nb_impayees: kpiRow.nb_impayees, total_du: kpiRow.total_du,
      nb_partielles: kpiRow.nb_partielles, nb_soldees: kpiRow.nb_soldees,
      nb_en_retard: enRetardRow.n, montant_en_retard: enRetardRow.mt,
    },
    modes_paiement: h.MODES_PAIEMENT_B2B,
    pagination: h.paginationInfo(p, totalFactures, req),
  });
});

// =========================================================
// RELANCES — Liste des impayés à traiter
// =========================================================
router.get('/relances/', (req, res) => {
  const periode = h.resoudrePeriode(req.query);
  const conds = ['c.activite_id = ?', "c.statut = 'FACTUREE'", 'c.montant_paye + 0.01 < c.montant_total'];
  const prms = [req.activiteId];
  if (periode.debut) { conds.push('date(c.date_commande) >= date(?)'); prms.push(periode.debut); }
  if (periode.fin) { conds.push('date(c.date_commande) <= date(?)'); prms.push(periode.fin); }
  const factures = db.prepare(`SELECT c.*, cl.nom AS client_nom, cl.type_client, cl.telephone AS client_tel,
                                     cl.email AS client_email, cl.contact_personne AS client_contact,
                                     cl.adresse AS client_adresse
                               FROM commande c JOIN client cl ON cl.id = c.client_id
                               WHERE ${conds.join(' AND ')}
                               ORDER BY c.date_echeance`).all(...prms);
  const items = [];
  let totalDu = 0, nb_J7 = 0, nb_J15 = 0, nb_J30 = 0, nb_a_ech = 0;
  for (const f of factures) {
    const relances = db.prepare('SELECT * FROM relance WHERE commande_id = ? ORDER BY date_envoi').all(f.id);
    const analyse = h.analyseRelance(f, relances);
    f.relances = relances;
    f.analyse = analyse;
    f.montant_restant = f.montant_total - f.montant_paye;
    totalDu += f.montant_restant;
    if (analyse.en_retard) {
      if (analyse.jours_retard >= 30) nb_J30++;
      else if (analyse.jours_retard >= 15) nb_J15++;
      else if (analyse.jours_retard >= 7) nb_J7++;
      else nb_a_ech++;
    } else nb_a_ech++;
    items.push(f);
  }
  // Trier : d'abord jours_retard décroissant, puis solde décroissant
  items.sort((a, b) => (b.analyse.jours_retard - a.analyse.jours_retard) || (b.montant_restant - a.montant_restant));

  const p = h.pagination(req);
  const totalRelances = items.length;
  const itemsPage = items.slice(p.offset, p.offset + p.taille);

  res.render('commandes/relances_liste', {
    title: 'Factures à relancer', page_title: `Factures à relancer — ${req.activite.nom}`,
    factures: itemsPage, kpi: { nb_impayes: totalRelances, total_du: totalDu, nb_J7, nb_J15, nb_J30, nb_a_ech },
    labels: h.NIVEAU_RELANCE_LABEL, couleurs: h.NIVEAU_RELANCE_COULEUR, canaux: h.CANAL_RELANCE_LABEL,
    periode,
    pagination: h.paginationInfo(p, totalRelances, req),
  });
});

// Marquer une relance comme envoyée
router.post('/:id(\\d+)/relance', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  const niveau = String(req.body.niveau || '').toUpperCase();
  if (!['J7', 'J15', 'J30'].includes(niveau)) { req.flash('error', 'Niveau de relance invalide.'); return res.redirect('/commandes/' + cmd.id); }
  const canal = String(req.body.canal || 'IMPRIMEE').toUpperCase();
  const notes = req.body.notes || '';
  db.prepare('INSERT INTO relance (commande_id, niveau, canal, envoye_par_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(cmd.id, niveau, canal, req.user.id, notes);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'RELANCE_ENVOYEE',
    entite: 'commande', entite_id: cmd.id,
    details: `Relance ${niveau} (${canal}) sur commande ${cmd.numero_facture || cmd.numero}` });
  req.flash('success', `Relance ${h.NIVEAU_RELANCE_LABEL[niveau]} enregistrée.`);
  const retour = req.body.retour || '/commandes/' + cmd.id;
  res.redirect(retour);
});

// Annuler une relance (erreur de saisie)
router.post('/:id(\\d+)/relance/:relanceId(\\d+)/supprimer', requireEcritureCommandes, (req, res) => {
  const cmd = db.prepare('SELECT * FROM commande WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  const r = db.prepare('SELECT * FROM relance WHERE id = ?').get(req.params.relanceId);
  db.prepare('DELETE FROM relance WHERE id = ? AND commande_id = ?').run(req.params.relanceId, cmd.id);
  h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'RELANCE_SUPPRIMEE',
    entite: 'commande', entite_id: cmd.id,
    details: `Relance ${r ? r.niveau : '?'} du ${r ? h.formatDate(r.date_envoi) : '?'} supprimée sur ${cmd.numero}` });
  req.flash('info', 'Relance supprimée.');
  res.redirect('/commandes/' + cmd.id);
});

// PDF courrier de relance
router.get('/:id(\\d+)/pdf/relance/:niveau(J7|J15|J30)', (req, res) => {
  const cmd = chargerCommande(req.params.id, req.activiteId);
  if (!cmd) return res.redirect('/commandes/');
  const p = chargerParametresLocaux(req);
  const niveau = req.params.niveau;
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="relance_${niveau}_${cmd.numero_facture || cmd.numero}.pdf"`);
  doc.pipe(res);

  // Bande déco haut
  dessinerBandeDeco(doc, 30);

  // En-tête entreprise
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#000').text(p.entreprise_nom, 50, 55);
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  if (p.entreprise_adresse) doc.text(p.entreprise_adresse, 50, 76);
  const contactLine = [];
  if (p.entreprise_tel) contactLine.push('Tél : ' + p.entreprise_tel);
  if (p.entreprise_email) contactLine.push(p.entreprise_email);
  if (contactLine.length) doc.text(contactLine.join(' · '), 50, 88);

  // Client (droite)
  doc.font('Helvetica').fontSize(10).fillColor('#000');
  doc.text(`Douala, le ${h.formatDate(new Date())}`, 350, 55, { align: 'right', width: 200 });
  doc.font('Helvetica-Bold').fontSize(10).text('À l\'attention de :', 350, 78, { align: 'right', width: 200 });
  doc.font('Helvetica').text(cmd.client_nom, 350, 92, { align: 'right', width: 200 });
  if (cmd.client_adresse) doc.font('Helvetica').fontSize(9).fillColor('#475569').text(cmd.client_adresse, 350, 108, { align: 'right', width: 200 });

  // Titre courrier
  let y = 160;
  const titres = {
    J7:  'PREMIER RAPPEL',
    J15: 'DEUXIÈME RAPPEL',
    J30: 'MISE EN DEMEURE DE PAYER',
  };
  doc.font('Helvetica-Bold').fontSize(16).fillColor(niveau === 'J30' ? '#dc2626' : '#000').text(titres[niveau], 50, y, { align: 'center', width: 500 });
  y += 28;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
     .text(`Objet : Facture N° ${cmd.numero_facture || cmd.numero} — ${h.formatNombre(cmd.montant_restant)} ${p.devise} en souffrance`, 50, y, { width: 500 });
  y += 24;

  // Formule d'appel
  doc.font('Helvetica').fontSize(11).fillColor('#000').text('Madame, Monsieur,', 50, y);
  y += 22;

  // Corps du texte selon niveau
  const dateEch = cmd.date_echeance ? h.formatDate(cmd.date_echeance) : 'sa date d\'émission';
  const dateFact = cmd.numero_facture ? `notre facture N° ${cmd.numero_facture}` : `la commande N° ${cmd.numero}`;
  const jours = cmd.analyse_relance.jours_retard;
  let corps = '';
  if (niveau === 'J7') {
    corps = `Sauf erreur de notre part, nous constatons que ${dateFact} d'un montant de ${h.formatNombre(cmd.montant_restant)} ${p.devise}, échue le ${dateEch}, n'a pas encore été réglée à ce jour, soit ${jours} jour${jours > 1 ? 's' : ''} de retard.\n\n` +
            `Il s'agit très probablement d'un simple oubli. Nous vous serions reconnaissants de bien vouloir procéder à son règlement dans les meilleurs délais.\n\n` +
            `Si votre paiement s'est croisé avec la présente, veuillez ne pas tenir compte de ce rappel.`;
  } else if (niveau === 'J15') {
    corps = `Malgré notre premier rappel, nous constatons à ce jour, avec regret, que ${dateFact} d'un montant de ${h.formatNombre(cmd.montant_restant)} ${p.devise}, échue le ${dateEch}, demeure impayée. Le retard est désormais de ${jours} jours.\n\n` +
            `Nous vous demandons de régulariser votre situation sous huitaine, à défaut de quoi nous serons contraints d'appliquer les pénalités de retard prévues par la loi (1,5% par mois de retard).\n\n` +
            `Nous restons à votre disposition pour convenir d'un échéancier si nécessaire.`;
  } else {
    corps = `Malgré nos deux précédents rappels restés sans effet, ${dateFact} d'un montant de ${h.formatNombre(cmd.montant_restant)} ${p.devise}, échue le ${dateEch} (soit ${jours} jours de retard), reste impayée.\n\n` +
            `Par la présente, valant MISE EN DEMEURE au sens des articles 1153 et suivants du Code Civil applicable en République du Cameroun, nous vous mettons en demeure de régler la somme due sous quinzaine (15 jours) à compter de la réception du présent courrier.\n\n` +
            `À défaut de règlement dans ce délai, nous nous réservons le droit d'engager toute procédure de recouvrement contentieux, sans nouveau préavis, aux frais, risques et périls du débiteur, et de mettre en œuvre les pénalités de retard légales.`;
  }
  doc.font('Helvetica').fontSize(11).fillColor('#000').text(corps, 50, y, { width: 500, align: 'justify', lineGap: 3 });
  y = doc.y + 18;

  // Récap financier encadré
  doc.rect(50, y, 500, 90).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('RÉCAPITULATIF', 60, y + 8);
  doc.font('Helvetica').fontSize(10);
  doc.text('Facture :', 60, y + 26);
  doc.text(cmd.numero_facture || cmd.numero, 200, y + 26);
  doc.text('Date d\'échéance :', 60, y + 42);
  doc.text(dateEch, 200, y + 42);
  doc.text('Montant total :', 60, y + 58);
  doc.text(h.formatNombre(cmd.montant_total) + ' ' + p.devise, 200, y + 58);
  doc.text('Déjà réglé :', 60, y + 74);
  doc.text(h.formatNombre(cmd.montant_paye) + ' ' + p.devise, 200, y + 74);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#dc2626');
  doc.text('RESTE DÛ :', 320, y + 42);
  doc.fontSize(14).text(h.formatNombre(cmd.montant_restant) + ' ' + p.devise, 320, y + 60);
  doc.fillColor('#000');
  y += 108;

  // Coordonnées bancaires (rappelées)
  if (p.entreprise_banque_compte || p.entreprise_banque_nom) {
    doc.font('Helvetica-Bold').fontSize(10).text('Pour votre règlement :', 50, y);
    y += 14;
    doc.font('Helvetica').fontSize(9);
    if (p.entreprise_banque_nom) { doc.text('Banque : ' + p.entreprise_banque_nom, 50, y); y += 12; }
    if (p.entreprise_banque_compte) { doc.text('Compte : ' + p.entreprise_banque_compte, 50, y); y += 12; }
    if (p.entreprise_cheque_libelle) { doc.text("Chèque à libeller à l'ordre de : " + p.entreprise_cheque_libelle, 50, y); y += 12; }
    y += 6;
  }

  // Formule de politesse
  doc.font('Helvetica').fontSize(11);
  const politesse = niveau === 'J30'
    ? `Dans l'espoir d'un règlement rapide, veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.`
    : `Vous remerciant par avance de votre diligence, nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.`;
  doc.text(politesse, 50, y, { width: 500, align: 'justify' });
  y = doc.y + 22;

  // Signature gérant
  doc.font('Helvetica-Bold').fontSize(10).text('LE GÉRANT', 380, y, { align: 'center', width: 170 });
  doc.rect(380, y + 15, 170, 50).lineWidth(0.5).strokeColor('#000').stroke();

  // Footer
  const footerY = 770;
  dessinerBandeDeco(doc, footerY);
  doc.font('Helvetica').fontSize(7).fillColor('#000');
  const ligne1 = [p.entreprise_adresse, p.entreprise_tel ? 'Tél : ' + p.entreprise_tel : '', p.entreprise_email].filter(Boolean).join(' · ');
  const ligne2 = [p.entreprise_rccm ? 'RC : ' + p.entreprise_rccm : '', p.entreprise_niu ? 'NIU : ' + p.entreprise_niu : ''].filter(Boolean).join(' · ');
  if (ligne1) doc.text(ligne1, 40, footerY + 12, { align: 'center', width: 515 });
  if (ligne2) doc.text(ligne2, 40, footerY + 24, { align: 'center', width: 515 });

  doc.end();
});

module.exports = router;
