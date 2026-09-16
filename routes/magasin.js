// Magasin virtuel Nestor : vue calculée à la volée depuis les tables achat + distribution
// Accès : Nestor (DISTRIBUTION), Sandra secrétariat, DG
const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');
const router = express.Router();

// Enforcement granulaire : accès magasin central protégé par la feature magasin.lire
router.use(h.permissionRequise(db, 'magasin.lire'));

// =========================================================
// Calcul du "solde magasin" pour une ligne d'achat
// =========================================================
// Retourne { total, chez_nestor, en_transit, recu_ok, refuse, ecart_manquant, distributions[] }
function calculerSoldeLigne(ligneAchat) {
  const total = Number(ligneAchat.quantite || 0);
  const distributions = db.prepare(`
    SELECT ld.*, d.numero AS dist_numero, d.statut AS dist_statut, d.motif_refus,
           d.activite_id AS dist_activite_id, d.date_creation, d.date_remise, d.date_reception,
           a.nom AS activite_nom, a.code AS activite_code, a.couleur AS activite_couleur
    FROM ligne_distribution ld
    JOIN distribution d ON d.id = ld.distribution_id
    JOIN activite a ON a.id = d.activite_id
    WHERE ld.ligne_achat_id = ?
      AND d.statut != 'ANNULEE'
    ORDER BY d.date_creation
  `).all(ligneAchat.id);

  let enTransit = 0;   // PREPAREE ou REMISE — parti mais pas encore validé
  let recuOk = 0;      // RECEPTIONNEE, quantite_recue
  let refuse = 0;      // REFUSEE — revenu chez Nestor
  let ecartManquant = 0; // RECEPTIONNEE, quantite_annoncee - quantite_recue

  const details = distributions.map(d => {
    const qteAnn = Number(d.quantite_annoncee || 0);
    const qteRecue = Number(d.quantite_recue || 0);
    const item = {
      distribution_id: d.distribution_id,
      dist_numero: d.dist_numero,
      dist_statut: d.dist_statut,
      activite_nom: d.activite_nom,
      activite_code: d.activite_code,
      activite_couleur: d.activite_couleur,
      qte_annoncee: qteAnn,
      qte_recue: qteRecue,
      ecart: 0,
      motif: '',
      etat: '',
      date_creation: d.date_creation,
      date_remise: d.date_remise,
      date_reception: d.date_reception,
    };
    if (d.dist_statut === 'PREPAREE' || d.dist_statut === 'REMISE') {
      enTransit += qteAnn;
      item.etat = d.dist_statut === 'PREPAREE' ? 'À remettre' : 'En attente réception';
    } else if (d.dist_statut === 'RECEPTIONNEE') {
      recuOk += qteRecue;
      const e = qteAnn - qteRecue;
      if (e > 0.001) {
        ecartManquant += e;
        item.ecart = e;
        item.motif = d.motif_ecart || '';
        item.etat = 'Reçue avec écart';
      } else {
        item.etat = 'Reçue';
      }
    } else if (d.dist_statut === 'REFUSEE') {
      refuse += qteAnn;
      item.motif = d.motif_refus || '';
      item.etat = 'Refusée';
    }
    return item;
  });

  // Chez Nestor = ce qui n'est ni en transit, ni chez un gestionnaire, ni manquant (ecart déclaré perdu)
  // Le refusé revient physiquement chez Nestor, il est donc dans "chez Nestor"
  const chezNestor = Math.max(0, total - enTransit - recuOk - ecartManquant);
  return {
    total,
    chez_nestor: chezNestor,
    en_transit: enTransit,
    recu_ok: recuOk,
    refuse,
    ecart_manquant: ecartManquant,
    distributions: details,
    // Somme distributed (pour info)
    total_parti: enTransit + recuOk + ecartManquant + refuse,
  };
}

// =========================================================
// LISTE — vue synthétique par ligne d'achat
// =========================================================
router.get('/', (req, res) => {
  // Modes d'affichage :
  //   (défaut)     = actives   : lignes avec quelque chose à surveiller (Nestor / transit / refus / écart)
  //   anomalies=1  = uniquement les lignes en refus, écart, ou traîne anormale
  //   tout=1       = tout, y compris lignes clôturées (tout distribué et reçu OK)
  const modeAffichage = req.query.tout === '1' ? 'TOUT' : (req.query.anomalies === '1' ? 'ANOMALIES' : 'ACTIVES');
  const periode = h.resoudrePeriode(req.query);

  const conds = [`a.statut IN ('RECEPTIONNE', 'DISTRIBUE', 'CLOTURE')`];
  const params = [];
  if (periode.debut) { conds.push('date(a.date_achat) >= date(?)'); params.push(periode.debut); }
  if (periode.fin)   { conds.push('date(a.date_achat) <= date(?)'); params.push(periode.fin); }

  const rows = db.prepare(`
    SELECT la.*, a.numero AS achat_numero, a.date_achat, a.statut AS achat_statut,
           COALESCE(f.raison_sociale, a.fournisseur_libre) AS fournisseur_nom,
           act.code AS activite_pressentie_code, act.nom AS activite_pressentie_nom, act.couleur AS activite_pressentie_couleur
    FROM ligne_achat la
    JOIN achat a ON a.id = la.achat_id
    LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
    LEFT JOIN activite act ON act.id = la.activite_pressentie_id
    WHERE ${conds.join(' AND ')}
    ORDER BY a.date_achat DESC, la.id DESC
    LIMIT 500
  `).all(...params);

  const lignes = rows.map(r => ({ ...r, solde: calculerSoldeLigne(r) }));

  const now = Date.now();

  // Fonctions d'appartenance aux filtres
  const estActive = (l) => (l.solde.chez_nestor > 0.001) || (l.solde.en_transit > 0.001) || (l.solde.refuse > 0.001) || (l.solde.ecart_manquant > 0.001);
  const estAnomalie = (l) => {
    if (l.solde.refuse > 0.001 || l.solde.ecart_manquant > 0.001) return true;
    const dateAchat = new Date(l.date_achat).getTime();
    const joursDepuis = (now - dateAchat) / 86400000;
    if (l.solde.en_transit > 0.001 && joursDepuis > 7) return true;
    if (l.solde.chez_nestor > 0.001 && joursDepuis > 30) return true;
    return false;
  };

  // KPIs globaux calculés sur les lignes actives uniquement (pas sur toutes)
  const lignesActives = lignes.filter(estActive);
  const kpis = {
    lignes_total: lignes.length,
    lignes_actives: lignesActives.length,
    lignes_anomalie: lignes.filter(estAnomalie).length,
    total_chez_nestor: lignes.reduce((s, l) => s + l.solde.chez_nestor, 0),
    total_en_transit: lignes.reduce((s, l) => s + l.solde.en_transit, 0),
    total_refuse: lignes.reduce((s, l) => s + l.solde.refuse, 0),
    total_ecart: lignes.reduce((s, l) => s + l.solde.ecart_manquant, 0),
  };

  let lignesFiltrees;
  if (modeAffichage === 'TOUT')            lignesFiltrees = lignes;
  else if (modeAffichage === 'ANOMALIES')  lignesFiltrees = lignes.filter(estAnomalie);
  else                                      lignesFiltrees = lignesActives; // ACTIVES par défaut

  res.render('magasin/liste', {
    title: 'Magasin Nestor', page_title: 'Magasin Nestor — Suivi post-achat',
    lignes: lignesFiltrees, kpis, mode_affichage: modeAffichage, periode,
  });
});

// =========================================================
// RAPPROCHEMENT — tableau croisé par achat
// =========================================================
router.get('/rapprochement/:achatId(\\d+)', (req, res) => {
  const achat = db.prepare(`
    SELECT a.*, COALESCE(f.raison_sociale, a.fournisseur_libre) AS fournisseur_nom,
           u.first_name || ' ' || u.last_name AS cree_par_nom
    FROM achat a LEFT JOIN fournisseur f ON f.id = a.fournisseur_id
    LEFT JOIN utilisateur u ON u.id = a.cree_par_id
    WHERE a.id = ?
  `).get(req.params.achatId);
  if (!achat) { req.flash('error', 'Achat introuvable.'); return res.redirect('/magasin-nestor/'); }

  const lignesRaw = db.prepare(`
    SELECT la.*, act.code AS activite_pressentie_code, act.couleur AS activite_pressentie_couleur
    FROM ligne_achat la
    LEFT JOIN activite act ON act.id = la.activite_pressentie_id
    WHERE la.achat_id = ?
    ORDER BY la.id
  `).all(achat.id);

  const lignes = lignesRaw.map(l => ({ ...l, solde: calculerSoldeLigne(l) }));

  // Récupérer toutes les activités destinataires (pour l'entête des colonnes)
  const activites = db.prepare(`
    SELECT DISTINCT a.id, a.code, a.nom, a.couleur, a.icone
    FROM activite a
    WHERE a.id IN (
      SELECT DISTINCT d.activite_id
      FROM distribution d
      JOIN ligne_distribution ld ON ld.distribution_id = d.id
      WHERE ld.ligne_achat_id IN (SELECT id FROM ligne_achat WHERE achat_id = ?)
        AND d.statut != 'ANNULEE'
    )
    ORDER BY a.id
  `).all(achat.id);

  res.render('magasin/rapprochement', {
    title: 'Rapprochement ' + achat.numero, page_title: 'Rapprochement — ' + achat.numero,
    achat, lignes, activites,
  });
});

module.exports = router;
