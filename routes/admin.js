const express = require('express');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// Enforcement basé sur permissions : accès si au moins une feature admin.* est cochée.
// Par défaut ROLE_PERMISSIONS.DG contient toutes les admin.* — donc la DG passe.
// Un autre utilisateur peut recevoir individuellement une ou plusieurs de ces permissions.
function requireDG(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'admin.utilisateurs') ||
      h.utilisateurPeut(db, req.user, 'admin.activites')   ||
      h.utilisateurPeut(db, req.user, 'admin.parametres')  ||
      h.utilisateurPeut(db, req.user, 'admin.audit')) return next();
  req.flash('error', 'Accès Administration refusé.');
  return res.redirect('/tableau-de-bord/');
}
router.use(requireDG);

// =========================================================
// DASHBOARD ADMIN
// =========================================================
router.get('/', (req, res) => {
  const nb_utilisateurs = db.prepare('SELECT COUNT(*) AS n FROM utilisateur').get().n;
  const nb_actifs = db.prepare('SELECT COUNT(*) AS n FROM utilisateur WHERE is_active = 1').get().n;
  const nb_activites = db.prepare('SELECT COUNT(*) AS n FROM activite').get().n;
  const nb_activites_actives = db.prepare('SELECT COUNT(*) AS n FROM activite WHERE actif = 1').get().n;
  const derniers_users = db.prepare(`SELECT u.*, a.nom AS activite_nom
                                     FROM utilisateur u LEFT JOIN activite a ON a.id = u.activite_id
                                     ORDER BY u.date_joined DESC LIMIT 5`).all();
  res.render('admin/dashboard', {
    title: 'Administration', page_title: 'Administration',
    nb_utilisateurs, nb_actifs, nb_activites, nb_activites_actives, derniers_users,
  });
});

// =========================================================
// ACTIVITES CRUD
// =========================================================
router.get('/activites/', (req, res) => {
  const activites = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM utilisateur WHERE activite_id = a.id) AS nb_utilisateurs,
      (SELECT COUNT(*) FROM produit WHERE activite_id = a.id) AS nb_produits,
      (SELECT COALESCE(SUM(montant_total),0) FROM vente WHERE activite_id = a.id) AS ca_total
    FROM activite a ORDER BY a.id`).all();
  res.render('admin/activites_liste', {
    title: 'Activités', page_title: 'Gérer les activités', activites,
  });
});

router.get('/activites/nouvelle', (req, res) => {
  res.render('admin/activite_form', {
    title: 'Nouvelle activité', page_title: 'Nouvelle activité',
    activite: { couleur: '#1e3a8a', icone: 'bi-shop', type: 'B2B_COMMANDE', actif: 1 },
    mode: 'creer', erreurs: [],
  });
});

router.post('/activites/nouvelle', (req, res) => {
  const b = req.body;
  const erreurs = [];
  if (!b.code || !/^[A-Z0-9]{2,10}$/.test(b.code)) erreurs.push('Le code doit contenir 2 à 10 lettres majuscules ou chiffres (ex: TRAIT, CAN, PAT, BUR).');
  if (!b.nom) erreurs.push('Le nom est requis.');
  if (!['B2B_COMMANDE', 'B2C_CAISSE'].includes(b.type)) erreurs.push('Type invalide.');
  if (db.prepare('SELECT 1 FROM activite WHERE code = ?').get(b.code)) erreurs.push('Ce code existe déjà.');
  if (erreurs.length) {
    return res.render('admin/activite_form', {
      title: 'Nouvelle activité', page_title: 'Nouvelle activité',
      activite: b, mode: 'creer', erreurs,
    });
  }
  const info = db.prepare(`INSERT INTO activite (code, nom, type, couleur, icone, actif)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(b.code, b.nom, b.type, b.couleur || '#1e3a8a', b.icone || 'bi-shop', b.actif ? 1 : 0);
  const nouvelleActivite = db.prepare('SELECT * FROM activite WHERE id = ?').get(Number(info.lastInsertRowid));
  // Auto-provisionnement comptable pour les activités B2C (caisse quotidienne)
  let messageProvision = '';
  if (nouvelleActivite.type === 'B2C_CAISSE') {
    try {
      const p = h.provisionnerCompteJournalActivite(db, nouvelleActivite);
      messageProvision = ` · Comptabilité : compte ${p.compte_caisse} + journal ${p.journal_code} créés.`;
    } catch (e) {
      messageProvision = ` · ⚠ Provisionnement comptable échoué : ${e.message}`;
    }
  }
  h.journaliser(db, { user: req.user, activiteId: nouvelleActivite.id, action: 'ACTIVITE_CREE',
    entite: 'activite', entite_id: nouvelleActivite.id,
    details: `${nouvelleActivite.nom} (${nouvelleActivite.code} · ${nouvelleActivite.type})${messageProvision}` });
  req.flash('success', `Activité "${b.nom}" créée.${messageProvision}`);
  res.redirect('/admin/activites/');
});

router.get('/activites/:id(\\d+)/modifier', (req, res) => {
  const activite = db.prepare('SELECT * FROM activite WHERE id = ?').get(req.params.id);
  if (!activite) return res.redirect('/admin/activites/');
  res.render('admin/activite_form', {
    title: 'Modifier activité', page_title: 'Modifier ' + activite.nom,
    activite, mode: 'modifier', erreurs: [],
  });
});

router.post('/activites/:id(\\d+)/modifier', (req, res) => {
  const b = req.body;
  const existant = db.prepare('SELECT * FROM activite WHERE id = ?').get(req.params.id);
  if (!existant) return res.redirect('/admin/activites/');
  const erreurs = [];
  if (!b.nom) erreurs.push('Le nom est requis.');
  // Le code ne peut plus être modifié une fois créé (utilisé dans les numérotations)
  if (erreurs.length) {
    return res.render('admin/activite_form', {
      title: 'Modifier activité', page_title: 'Modifier activité',
      activite: { ...existant, ...b }, mode: 'modifier', erreurs,
    });
  }
  db.prepare(`UPDATE activite SET nom = ?, type = ?, couleur = ?, icone = ?, actif = ? WHERE id = ?`)
    .run(b.nom, b.type, b.couleur || '#1e3a8a', b.icone || 'bi-shop', b.actif ? 1 : 0, req.params.id);
  req.flash('success', 'Activité modifiée.');
  res.redirect('/admin/activites/');
});

router.post('/activites/:id(\\d+)/basculer', (req, res) => {
  const act = db.prepare('SELECT * FROM activite WHERE id = ?').get(req.params.id);
  if (!act) return res.redirect('/admin/activites/');
  db.prepare('UPDATE activite SET actif = ? WHERE id = ?').run(act.actif ? 0 : 1, req.params.id);
  h.journaliser(db, { user: req.user, activiteId: act.id, action: 'ACTIVITE_BASCULEE',
    entite: 'activite', entite_id: act.id,
    details: `${act.nom} — ${act.actif ? 'DÉSACTIVÉE' : 'RÉACTIVÉE'}` });
  req.flash('info', `Activité ${act.nom} ${act.actif ? 'désactivée' : 'réactivée'}.`);
  res.redirect('/admin/activites/');
});

// =========================================================
// DÉTAIL UTILISATEUR (page avec onglets)
// =========================================================
router.get('/utilisateurs/:id(\\d+)', (req, res) => {
  const utilisateur = db.prepare(`SELECT u.*, a.nom AS activite_nom, a.code AS activite_code, a.couleur AS activite_couleur
                                  FROM utilisateur u LEFT JOIN activite a ON a.id = u.activite_id
                                  WHERE u.id = ?`).get(req.params.id);
  if (!utilisateur) return res.redirect('/comptes/utilisateurs');
  const activites = db.prepare('SELECT * FROM activite ORDER BY id').all();
  const activitesLiees = db.prepare('SELECT activite_id FROM utilisateur_activite WHERE utilisateur_id = ?').all(req.params.id).map(r => r.activite_id);
  const permissionsParActivite = {};
  for (const a of activites) {
    permissionsParActivite[a.id] = h.permissionsEffectives(db, Number(req.params.id), a.id);
  }
  const permissionsGlobales = h.permissionsEffectives(db, Number(req.params.id), null);

  // Recuperer les surcharges (savoir ce qui a été modifié vs default)
  const surchargesRows = db.prepare('SELECT activite_id, feature, autorise FROM permission_utilisateur WHERE utilisateur_id = ?').all(req.params.id);
  const surchargesMap = {}; // { 'activite_id/feature': autorise }
  for (const s of surchargesRows) surchargesMap[`${s.activite_id || 'null'}/${s.feature}`] = s.autorise;

  res.render('admin/utilisateur_detail', {
    title: `Utilisateur — ${utilisateur.username}`, page_title: `Utilisateur — ${utilisateur.first_name || utilisateur.username}`,
    utilisateur, activites, activitesLiees, permissionsParActivite, permissionsGlobales,
    surchargesMap, features: h.FEATURES, featuresByModule: h.featuresByModule(),
    rolePermissions: h.ROLE_PERMISSIONS[utilisateur.role] || [],
    roles: h.ROLE_LABEL,
    onglet: req.query.onglet || 'identite',
  });
});

// AJAX : basculer l'assignation d'une activité pour cet utilisateur
router.post('/utilisateurs/:id(\\d+)/activite/:activiteId(\\d+)/basculer', express.json(), (req, res) => {
  const userId = Number(req.params.id);
  const actId = Number(req.params.activiteId);
  const existe = db.prepare('SELECT 1 FROM utilisateur_activite WHERE utilisateur_id = ? AND activite_id = ?').get(userId, actId);
  if (existe) {
    db.prepare('DELETE FROM utilisateur_activite WHERE utilisateur_id = ? AND activite_id = ?').run(userId, actId);
  } else {
    db.prepare('INSERT INTO utilisateur_activite (utilisateur_id, activite_id) VALUES (?, ?)').run(userId, actId);
  }
  res.json({ lie: !existe });
});

// AJAX : définir l'activité principale (utilisateur.activite_id)
router.post('/utilisateurs/:id(\\d+)/activite-principale/:activiteId', express.json(), (req, res) => {
  const userId = Number(req.params.id);
  const actId = req.params.activiteId === 'null' ? null : Number(req.params.activiteId);
  db.prepare('UPDATE utilisateur SET activite_id = ? WHERE id = ?').run(actId, userId);
  res.json({ ok: true });
});

// AJAX : toggle d'une permission (feature × activité)
router.post('/utilisateurs/:id(\\d+)/permission/basculer', express.json(), (req, res) => {
  const userId = Number(req.params.id);
  const { feature, activite_id, autorise } = req.body;
  if (!h.FEATURES[feature]) return res.status(400).json({ erreur: 'Feature inconnue' });
  const actId = activite_id === null || activite_id === 'null' ? null : Number(activite_id);
  const featDef = h.FEATURES[feature];
  const effectifActId = featDef.global ? null : actId;

  // Déterminer si on doit stocker une surcharge ou revenir au défaut du rôle
  const user = db.prepare('SELECT role FROM utilisateur WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ erreur: 'User introuvable' });
  const parDefaut = h.ROLE_PERMISSIONS[user.role]?.includes(feature) || false;
  const nouvelleValeur = !!autorise;

  if (nouvelleValeur === parDefaut) {
    // On revient au défaut : supprimer la surcharge s'il y en a une
    if (effectifActId === null) db.prepare('DELETE FROM permission_utilisateur WHERE utilisateur_id = ? AND feature = ? AND activite_id IS NULL').run(userId, feature);
    else db.prepare('DELETE FROM permission_utilisateur WHERE utilisateur_id = ? AND feature = ? AND activite_id = ?').run(userId, feature, effectifActId);
  } else {
    // On surcharge
    db.prepare(`INSERT OR REPLACE INTO permission_utilisateur (utilisateur_id, activite_id, feature, autorise, modifie_le, modifie_par_id)
                VALUES (?, ?, ?, ?, datetime('now'), ?)`)
      .run(userId, effectifActId, feature, nouvelleValeur ? 1 : 0, req.user.id);
  }
  // `surcharge: true` si l'état diverge du défaut du rôle (une ligne existe dans permission_utilisateur)
  res.json({ ok: true, feature, activite_id: effectifActId, autorise: nouvelleValeur, surcharge: nouvelleValeur !== parDefaut });
});

// Réinitialiser le mot de passe d'un utilisateur (DG uniquement)
router.post('/utilisateurs/:id(\\d+)/reinitialiser-mdp', express.json(), (req, res) => {
  const userId = Number(req.params.id);
  const { nouveau_mdp } = req.body || {};
  if (!nouveau_mdp || String(nouveau_mdp).length < 6) {
    return res.status(400).json({ ok: false, erreur: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }
  const cible = db.prepare('SELECT id, username, first_name, titre FROM utilisateur WHERE id = ?').get(userId);
  if (!cible) return res.status(404).json({ ok: false, erreur: 'Utilisateur introuvable.' });
  const hash = bcrypt.hashSync(String(nouveau_mdp), 8);
  db.prepare('UPDATE utilisateur SET password = ? WHERE id = ?').run(hash, userId);
  h.journaliser(db, { user: req.user, action: 'UTIL_MDP_RESET',
    entite: 'utilisateur', entite_id: userId,
    details: `Réinitialisation du mot de passe de ${cible.username} (${(cible.titre || '') + ' ' + (cible.first_name || '')})`.trim() });
  res.json({ ok: true });
});

// AJAX : réinitialiser TOUTES les permissions de l'user (retour au template du rôle)
router.post('/utilisateurs/:id(\\d+)/permissions/reinitialiser', (req, res) => {
  db.prepare('DELETE FROM permission_utilisateur WHERE utilisateur_id = ?').run(req.params.id);
  req.flash('success', 'Permissions réinitialisées au rôle par défaut.');
  res.redirect('/admin/utilisateurs/' + req.params.id + '?onglet=permissions');
});

// AJAX : changer le rôle d'un utilisateur (efface les surcharges pour réappliquer le nouveau template)
router.post('/utilisateurs/:id(\\d+)/role', express.json(), (req, res) => {
  const { role } = req.body;
  if (!['DG', 'SECRETARIAT', 'DISTRIBUTION', 'GESTIONNAIRE', 'CAISSIER', 'CUISINIER'].includes(role)) return res.status(400).json({ erreur: 'Rôle invalide' });
  const ancien = db.prepare('SELECT username, role FROM utilisateur WHERE id = ?').get(req.params.id);
  h.journaliser(db, { user: req.user, action: 'UTIL_ROLE_CHANGE',
    entite: 'utilisateur', entite_id: Number(req.params.id),
    details: ancien ? `${ancien.username} : ${ancien.role} → ${role}` : `id=${req.params.id} → ${role}` });
  db.transaction(() => {
    db.prepare('UPDATE utilisateur SET role = ? WHERE id = ?').run(role, req.params.id);
    db.prepare('DELETE FROM permission_utilisateur WHERE utilisateur_id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

// =========================================================
// PARAMÈTRES SYSTÈME
// =========================================================
router.get('/parametres/', (req, res) => {
  const parametres = db.prepare('SELECT * FROM parametre ORDER BY cle').all();
  res.render('admin/parametres', {
    title: 'Paramètres', page_title: 'Paramètres système',
    parametres,
  });
});

router.post('/parametres/', (req, res) => {
  const upd = db.prepare('UPDATE parametre SET valeur = ?, modifie_le = datetime(\'now\'), modifie_par_id = ? WHERE cle = ?');
  const changements = [];
  db.transaction(() => {
    for (const [cle, valeur] of Object.entries(req.body)) {
      const ancien = db.prepare('SELECT valeur FROM parametre WHERE cle = ?').get(cle);
      if (ancien && String(ancien.valeur) !== String(valeur)) {
        changements.push(`${cle}: "${ancien.valeur}" → "${valeur}"`);
      }
      upd.run(String(valeur), req.user.id, cle);
    }
  })();
  h.invaliderCacheParametres();
  if (changements.length) {
    h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE',
      entite: 'parametre', details: changements.slice(0, 10).join(' ; ') + (changements.length > 10 ? '…' : '') });
  }
  req.flash('success', 'Paramètres mis à jour.');
  res.redirect('/admin/parametres/');
});

// =========================================================
// PARAMÉTRAGE DU CANAL WEB B2C (/commander)
// =========================================================
router.get('/canal-web/', (req, res) => {
  const getP = (cle, defaut) => {
    const r = db.prepare('SELECT valeur FROM parametre WHERE cle = ?').get(cle);
    return r ? r.valeur : defaut;
  };
  const config = {
    actif: getP('web_canal_actif', '1') === '1',
    frais_livraison: Number(getP('web_frais_livraison', '1000')),
    activites_ids: getP('web_activites_ids', '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean),
  };
  const toutesActivites = db.prepare("SELECT id, code, nom, type FROM activite WHERE actif = 1 ORDER BY id").all();
  // Stats rapides commandes web
  const stats = {
    total: db.prepare('SELECT COUNT(*) AS n FROM commande_client_web').get().n,
    en_attente: db.prepare("SELECT COUNT(*) AS n FROM commande_client_web WHERE statut = 'NOUVELLE'").get().n,
    en_prep: db.prepare("SELECT COUNT(*) AS n FROM commande_client_web WHERE statut IN ('CONFIRMEE', 'PRETE')").get().n,
    traitees: db.prepare("SELECT COUNT(*) AS n FROM commande_client_web WHERE statut IN ('RECUPEREE', 'LIVREE')").get().n,
  };
  res.render('admin/canal_web', {
    title: 'Canal de commande en ligne',
    page_title: 'Canal de commande en ligne',
    config, toutesActivites, stats,
  });
});

router.post('/canal-web/', (req, res) => {
  const actif = req.body.actif === '1' ? '1' : '0';
  const frais = Math.max(0, parseInt(req.body.frais_livraison, 10) || 0);
  let activites = req.body.activites_ids || [];
  if (!Array.isArray(activites)) activites = [activites];
  const activitesStr = activites.map(Number).filter(Boolean).join(',');

  const upd = db.prepare("UPDATE parametre SET valeur = ?, modifie_le = datetime('now'), modifie_par_id = ? WHERE cle = ?");
  db.transaction(() => {
    upd.run(actif, req.user.id, 'web_canal_actif');
    upd.run(String(frais), req.user.id, 'web_frais_livraison');
    upd.run(activitesStr, req.user.id, 'web_activites_ids');
  })();
  h.invaliderCacheParametres();
  h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE', entite: 'canal_web',
    details: `actif=${actif}, frais=${frais}, activites=[${activitesStr}]` });
  req.flash('success', 'Paramètres du canal web enregistrés.');
  res.redirect('/admin/canal-web/');
});

// =========================================================
// JOURNAL D'AUDIT — consultation
// =========================================================
router.get('/audit/', (req, res) => {
  const filtres = [];
  const params = [];
  const action = (req.query.action || '').trim();
  const utilisateur = (req.query.utilisateur || '').trim();
  const entite = (req.query.entite || '').trim();
  const debut = (req.query.debut || '').trim();
  const fin = (req.query.fin || '').trim();
  const critique = req.query.critique === '1';

  if (action) { filtres.push('j.action = ?'); params.push(action); }
  if (utilisateur) { filtres.push('j.utilisateur_id = ?'); params.push(utilisateur); }
  if (entite) { filtres.push('j.entite = ?'); params.push(entite); }
  if (debut) { filtres.push("date(j.date_action) >= ?"); params.push(debut); }
  if (fin) { filtres.push("date(j.date_action) <= ?"); params.push(fin); }
  if (critique) {
    const codes = Array.from(h.AUDIT_ACTIONS_CRITIQUES);
    filtres.push(`j.action IN (${codes.map(() => '?').join(',')})`);
    params.push(...codes);
  }

  const whereClause = filtres.length ? 'WHERE ' + filtres.join(' AND ') : '';
  const p = h.pagination(req, 50);
  const totalAudit = db.prepare(`SELECT COUNT(*) AS n FROM journal_audit j ${whereClause}`).get(...params).n;
  const entrees = db.prepare(`
    SELECT j.*, u.username, u.first_name, u.titre, a.nom AS activite_nom, a.couleur AS activite_couleur
    FROM journal_audit j
    LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
    LEFT JOIN activite a ON a.id = j.activite_id
    ${whereClause}
    ORDER BY j.date_action DESC LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);

  // Options pour les filtres
  const utilisateurs = db.prepare(`SELECT id, username, first_name, titre FROM utilisateur ORDER BY first_name, username`).all();
  const activites = db.prepare(`SELECT id, nom FROM activite ORDER BY id`).all();

  // KPIs
  const kpi30j = db.prepare(`SELECT COUNT(*) AS n FROM journal_audit WHERE date(date_action) >= date('now','-30 day')`).get();
  const kpi7j = db.prepare(`SELECT COUNT(*) AS n FROM journal_audit WHERE date(date_action) >= date('now','-7 day')`).get();
  const kpiJour = db.prepare(`SELECT COUNT(*) AS n FROM journal_audit WHERE date(date_action) = date('now')`).get();

  res.render('admin/audit', {
    title: 'Journal d\'audit', page_title: 'Journal d\'audit',
    entrees, utilisateurs, activites,
    filtre: { action, utilisateur, entite, debut, fin, critique },
    kpi: { j30: kpi30j.n, j7: kpi7j.n, jour: kpiJour.n, total: totalAudit },
    pagination: h.paginationInfo(p, totalAudit, req),
    actions_label: h.AUDIT_ACTIONS,
    actions_critiques: h.AUDIT_ACTIONS_CRITIQUES,
  });
});

// Export CSV du journal
router.get('/audit/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT j.date_action, u.username, u.first_name, a.nom AS activite,
                                  j.action, j.entite, j.entite_id, j.details
                           FROM journal_audit j
                           LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
                           LEFT JOIN activite a ON a.id = j.activite_id
                           ORDER BY j.date_action DESC LIMIT 5000`).all();
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lignes = ['Date;Utilisateur;Prénom;Activité;Action;Entité;ID;Détails'];
  for (const r of rows) {
    lignes.push([r.date_action, r.username, r.first_name, r.activite,
                 h.AUDIT_ACTIONS[r.action] || r.action, r.entite, r.entite_id, r.details].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="journal_audit_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('﻿' + lignes.join('\n'));
});

// =========================================================
// RAPPORT MENSUEL DG — collecte des données + preview + PDF
// =========================================================

// Retourne { debut, fin, label } pour un mois YYYY-MM
function bornesMois(moisIso) {
  const [annee, mois] = moisIso.split('-').map(n => parseInt(n, 10));
  const debut = new Date(annee, mois - 1, 1);
  const fin = new Date(annee, mois, 0); // dernier jour du mois
  const iso = d => d.toISOString().slice(0, 10);
  const nomsMois = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return { debut: iso(debut), fin: iso(fin), label: `${nomsMois[mois - 1]} ${annee}`, annee, mois };
}

function collecterRapportMensuel(moisIso) {
  const { debut, fin, label, annee, mois } = bornesMois(moisIso);
  // Mois précédent pour comparaison
  const moisPrec = new Date(annee, mois - 2, 1);
  const bornesPrec = bornesMois(`${moisPrec.getFullYear()}-${String(moisPrec.getMonth() + 1).padStart(2, '0')}`);

  const activites = db.prepare(`SELECT * FROM activite WHERE actif = 1 ORDER BY id`).all();

  // Par activité
  const parActivite = activites.map(a => {
    let ca, caPrec, nbTx;
    if (a.type === 'B2C_CAISSE') {
      ca = db.prepare(`SELECT COALESCE(SUM(montant_total - montant_remise + montant_tva), 0) AS mt, COUNT(*) AS nb
                       FROM vente WHERE activite_id = ? AND date(date_vente) BETWEEN ? AND ?`).get(a.id, debut, fin);
      caPrec = db.prepare(`SELECT COALESCE(SUM(montant_total - montant_remise + montant_tva), 0) AS mt
                           FROM vente WHERE activite_id = ? AND date(date_vente) BETWEEN ? AND ?`).get(a.id, bornesPrec.debut, bornesPrec.fin);
    } else {
      // B2B : encaissements réels sur la période
      ca = db.prepare(`SELECT COALESCE(SUM(montant), 0) AS mt, COUNT(DISTINCT commande_id) AS nb
                       FROM paiement WHERE activite_id = ? AND commande_id IS NOT NULL AND date(date_paiement) BETWEEN ? AND ?`).get(a.id, debut, fin);
      caPrec = db.prepare(`SELECT COALESCE(SUM(montant), 0) AS mt
                           FROM paiement WHERE activite_id = ? AND commande_id IS NOT NULL AND date(date_paiement) BETWEEN ? AND ?`).get(a.id, bornesPrec.debut, bornesPrec.fin);
    }
    // Impayés en cours
    const impayes = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total - montant_paye), 0) AS mt
                                FROM commande WHERE activite_id = ? AND statut = 'FACTUREE'
                                  AND montant_paye + 1 < montant_total`).get(a.id);
    // Répartition modes de paiement
    let parMode = [];
    if (a.type === 'B2C_CAISSE') {
      parMode = db.prepare(`SELECT mode_paiement AS mode, COALESCE(SUM(montant_total - montant_remise + montant_tva), 0) AS mt, COUNT(*) AS nb
                            FROM vente WHERE activite_id = ? AND date(date_vente) BETWEEN ? AND ?
                            GROUP BY mode_paiement ORDER BY mt DESC`).all(a.id, debut, fin);
    } else {
      parMode = db.prepare(`SELECT mode_paiement AS mode, COALESCE(SUM(montant), 0) AS mt, COUNT(*) AS nb
                            FROM paiement WHERE activite_id = ? AND commande_id IS NOT NULL AND date(date_paiement) BETWEEN ? AND ?
                            GROUP BY mode_paiement ORDER BY mt DESC`).all(a.id, debut, fin);
    }
    const evolution = Number(caPrec.mt) > 0 ? Math.round((Number(ca.mt) - Number(caPrec.mt)) / Number(caPrec.mt) * 100) : null;
    const panierMoyen = Number(ca.nb) > 0 ? Number(ca.mt) / Number(ca.nb) : 0;
    return {
      activite: a,
      ca: Number(ca.mt), ca_precedent: Number(caPrec.mt), evolution,
      nb_transactions: Number(ca.nb), panier_moyen: panierMoyen,
      nb_impayes: Number(impayes.n), montant_impaye: Number(impayes.mt),
      par_mode: parMode.map(m => ({ ...m, mt: Number(m.mt), nb: Number(m.nb) })),
    };
  });

  const ca_total = parActivite.reduce((s, k) => s + k.ca, 0);
  const ca_total_prec = parActivite.reduce((s, k) => s + k.ca_precedent, 0);
  const evolution_totale = ca_total_prec > 0 ? Math.round((ca_total - ca_total_prec) / ca_total_prec * 100) : null;
  const nb_transactions_total = parActivite.reduce((s, k) => s + k.nb_transactions, 0);
  const impaye_total = parActivite.reduce((s, k) => s + k.montant_impaye, 0);

  // Top 10 produits (toutes activités confondues)
  const topProduits = db.prepare(`
    SELECT p.designation, p.reference, a.nom AS activite_nom, a.couleur AS activite_couleur,
           SUM(lv.quantite) AS qte, SUM(lv.quantite * lv.prix_unitaire - COALESCE(lv.remise, 0)) AS ca
    FROM ligne_vente lv
    JOIN vente v ON v.id = lv.vente_id
    JOIN produit p ON p.id = lv.produit_id
    JOIN activite a ON a.id = v.activite_id
    WHERE date(v.date_vente) BETWEEN ? AND ?
    GROUP BY p.id ORDER BY ca DESC LIMIT 10`).all(debut, fin);

  // Top 10 clients B2B (encaissements sur la période)
  const topClientsB2B = db.prepare(`
    SELECT cl.nom AS client_nom, a.nom AS activite_nom, a.couleur AS activite_couleur,
           COUNT(DISTINCT c.id) AS nb, SUM(p.montant) AS mt
    FROM paiement p
    JOIN commande c ON c.id = p.commande_id
    JOIN client cl ON cl.id = c.client_id
    JOIN activite a ON a.id = c.activite_id
    WHERE date(p.date_paiement) BETWEEN ? AND ?
    GROUP BY cl.id ORDER BY mt DESC LIMIT 10`).all(debut, fin);

  // Écarts de caisse du mois
  const ecartsCaisse = db.prepare(`SELECT c.*, a.nom AS activite_nom, u.first_name AS caissier_prenom, u.username
                                   FROM cloture_caisse c
                                   JOIN activite a ON a.id = c.activite_id
                                   LEFT JOIN utilisateur u ON u.id = c.ouvert_par_id
                                   WHERE c.statut = 'CLOTUREE' AND date(c.date_cloture) BETWEEN ? AND ?
                                     AND ABS(c.ecart) > 100
                                   ORDER BY ABS(c.ecart) DESC LIMIT 20`).all(debut, fin);

  // Achats du mois
  const achatsMois = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total), 0) AS mt
                                 FROM achat WHERE date(date_achat) BETWEEN ? AND ?`).get(debut, fin);

  // Alertes non vues actuellement
  const alertesRow = db.prepare(`SELECT COUNT(*) AS n FROM alerte WHERE vue = 0`).get();

  return {
    label, debut, fin, mois_precedent_label: bornesPrec.label,
    par_activite: parActivite,
    ca_total, ca_total_prec, evolution_totale,
    nb_transactions_total, impaye_total,
    topProduits: topProduits.map(p => ({ ...p, qte: Number(p.qte), ca: Number(p.ca) })),
    topClientsB2B: topClientsB2B.map(c => ({ ...c, nb: Number(c.nb), mt: Number(c.mt) })),
    ecartsCaisse: ecartsCaisse.map(e => ({ ...e, ecart: Number(e.ecart) })),
    achatsMois: { n: Number(achatsMois.n), mt: Number(achatsMois.mt) },
    nb_alertes_stock: Number(alertesRow.n),
  };
}

// Écran preview
router.get('/rapport-mensuel/', (req, res) => {
  const now = new Date();
  const moisPrec = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaut = `${moisPrec.getFullYear()}-${String(moisPrec.getMonth() + 1).padStart(2, '0')}`;
  const mois = req.query.mois || defaut;
  const rapport = collecterRapportMensuel(mois);
  res.render('admin/rapport_mensuel', {
    title: 'Rapport mensuel', page_title: 'Rapport mensuel — ' + rapport.label,
    rapport, mois_selectionne: mois,
  });
});

// PDF
router.get('/rapport-mensuel/pdf', (req, res) => {
  const now = new Date();
  const moisPrec = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaut = `${moisPrec.getFullYear()}-${String(moisPrec.getMonth() + 1).padStart(2, '0')}`;
  const mois = req.query.mois || defaut;
  const rapport = collecterRapportMensuel(mois);
  const p = req.parametres || {};
  const devise = p.devise || 'FCFA';
  const nomEnt = p.entreprise_nom || 'Le Traiteur du Bistrot';

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="rapport_mensuel_${mois}.pdf"`);
  doc.pipe(res);

  const PAGE_W = 555;
  const NAVY = '#1e3a8a', GOLD = '#CA8A04', MUTED = '#64748B';
  const centre = (txt, y, opts = {}) => doc.text(txt, 40, y, { width: PAGE_W - 40, align: 'center', ...opts });
  const separateur = (y) => {
    doc.moveTo(40, y).lineTo(555, y).strokeColor(GOLD).lineWidth(1.5).stroke();
  };

  // ============ PAGE 1 : COUVERTURE + SYNTHÈSE ============
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
  doc.text('CONFIDENTIEL — DIRECTION GÉNÉRALE', 40, 40);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY);
  doc.text('RAPPORT MENSUEL', 40, 70);
  doc.font('Helvetica').fontSize(16).fillColor('#000');
  doc.text(rapport.label.toUpperCase(), 40, 100);
  doc.moveTo(40, 130).lineTo(555, 130).strokeColor(GOLD).lineWidth(2).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(nomEnt + ' — Édité le ' + h.formatDate(new Date(), true), 40, 138);

  // Synthèse
  let y = 170;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY);
  doc.text('1. Synthèse consolidée', 40, y);
  y += 24;

  // 4 cases KPI
  const kpis = [
    { label: 'Chiffre d\'affaires', val: h.formatNombre(rapport.ca_total) + ' ' + devise, sub: rapport.evolution_totale !== null ? `${rapport.evolution_totale >= 0 ? '+' : ''}${rapport.evolution_totale}% vs ${rapport.mois_precedent_label}` : 'Pas de comparaison', color: rapport.evolution_totale >= 0 ? '#16a34a' : '#dc2626' },
    { label: 'Transactions', val: rapport.nb_transactions_total.toString(), sub: 'Ventes + commandes soldées', color: NAVY },
    { label: 'Impayés en cours', val: h.formatNombre(rapport.impaye_total) + ' ' + devise, sub: 'À encaisser sur factures B2B', color: rapport.impaye_total > 0 ? '#dc2626' : '#16a34a' },
    { label: 'Achats du mois', val: h.formatNombre(rapport.achatsMois.mt) + ' ' + devise, sub: rapport.achatsMois.n + ' bon(s) d\'achat', color: MUTED },
  ];
  const boxW = (PAGE_W - 40 - 3 * 8) / 4;
  for (let i = 0; i < kpis.length; i++) {
    const bx = 40 + i * (boxW + 8);
    doc.rect(bx, y, boxW, 65).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    doc.rect(bx, y, 4, 65).fill(kpis[i].color);
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(kpis[i].label.toUpperCase(), bx + 10, y + 8, { width: boxW - 15 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(kpis[i].val, bx + 10, y + 22, { width: boxW - 15 });
    doc.font('Helvetica').fontSize(7).fillColor(kpis[i].color).text(kpis[i].sub, bx + 10, y + 48, { width: boxW - 15 });
  }
  y += 85;

  // Tableau par activité
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('2. Performance par activité', 40, y);
  y += 24;
  const cols = { act: 40, ca: 240, evo: 340, tx: 400, panier: 470 };
  doc.rect(40, y, PAGE_W - 40, 22).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
  doc.text('Activité', cols.act + 5, y + 7);
  doc.text('CA du mois', cols.ca, y + 7, { width: 95, align: 'right' });
  doc.text('Évolution', cols.evo, y + 7, { width: 55, align: 'right' });
  doc.text('Nb tx', cols.tx, y + 7, { width: 60, align: 'right' });
  doc.text('Panier moyen', cols.panier, y + 7, { width: 85, align: 'right' });
  y += 22;
  for (const a of rapport.par_activite) {
    doc.rect(40, y, PAGE_W - 40, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(a.activite.nom, cols.act + 5, y + 6);
    doc.font('Helvetica-Bold').text(h.formatNombre(a.ca), cols.ca, y + 6, { width: 95, align: 'right' });
    doc.font('Helvetica').fillColor(a.evolution === null ? MUTED : (a.evolution >= 0 ? '#16a34a' : '#dc2626'));
    doc.text(a.evolution === null ? '—' : `${a.evolution >= 0 ? '+' : ''}${a.evolution}%`, cols.evo, y + 6, { width: 55, align: 'right' });
    doc.fillColor('#000');
    doc.text(a.nb_transactions.toString(), cols.tx, y + 6, { width: 60, align: 'right' });
    doc.text(h.formatNombre(a.panier_moyen), cols.panier, y + 6, { width: 85, align: 'right' });
    y += 20;
  }
  // Total
  doc.rect(40, y, PAGE_W - 40, 22).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff');
  doc.text('TOTAL', cols.act + 5, y + 7);
  doc.text(h.formatNombre(rapport.ca_total), cols.ca, y + 7, { width: 95, align: 'right' });
  doc.text(rapport.evolution_totale !== null ? `${rapport.evolution_totale >= 0 ? '+' : ''}${rapport.evolution_totale}%` : '—', cols.evo, y + 7, { width: 55, align: 'right' });
  doc.text(rapport.nb_transactions_total.toString(), cols.tx, y + 7, { width: 60, align: 'right' });
  y += 22;

  // ============ PAGE 2 : TOP PRODUITS ============
  doc.addPage();
  y = 50;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('3. Top 10 produits (par CA)', 40, y);
  y += 24;
  doc.rect(40, y, PAGE_W - 40, 22).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
  doc.text('#', 45, y + 7, { width: 25 });
  doc.text('Produit', 70, y + 7, { width: 230 });
  doc.text('Activité', 300, y + 7, { width: 100 });
  doc.text('Qté vendue', 400, y + 7, { width: 70, align: 'right' });
  doc.text('CA (' + devise + ')', 470, y + 7, { width: 85, align: 'right' });
  y += 22;
  rapport.topProduits.forEach((p, i) => {
    doc.rect(40, y, PAGE_W - 40, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text((i + 1).toString(), 45, y + 6, { width: 25 });
    doc.text(p.designation, 70, y + 6, { width: 230 });
    doc.fillColor(p.activite_couleur).text(p.activite_nom, 300, y + 6, { width: 100 });
    doc.fillColor('#000').text(h.formatNombre(p.qte), 400, y + 6, { width: 70, align: 'right' });
    doc.font('Helvetica-Bold').text(h.formatNombre(p.ca), 470, y + 6, { width: 85, align: 'right' });
    y += 20;
  });
  if (!rapport.topProduits.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Aucune vente enregistrée sur la période.', 45, y + 6);
    y += 20;
  }

  // Top clients B2B
  y += 20;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('4. Top 10 clients B2B (par encaissements)', 40, y);
  y += 24;
  doc.rect(40, y, PAGE_W - 40, 22).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
  doc.text('#', 45, y + 7, { width: 25 });
  doc.text('Client', 70, y + 7, { width: 260 });
  doc.text('Activité', 330, y + 7, { width: 100 });
  doc.text('Nb cmd', 430, y + 7, { width: 45, align: 'right' });
  doc.text('Encaissé', 475, y + 7, { width: 80, align: 'right' });
  y += 22;
  rapport.topClientsB2B.forEach((c, i) => {
    doc.rect(40, y, PAGE_W - 40, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text((i + 1).toString(), 45, y + 6, { width: 25 });
    doc.text(c.client_nom, 70, y + 6, { width: 260 });
    doc.fillColor(c.activite_couleur).text(c.activite_nom, 330, y + 6, { width: 100 });
    doc.fillColor('#000').text(c.nb.toString(), 430, y + 6, { width: 45, align: 'right' });
    doc.font('Helvetica-Bold').text(h.formatNombre(c.mt), 475, y + 6, { width: 80, align: 'right' });
    y += 20;
  });
  if (!rapport.topClientsB2B.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Aucun encaissement B2B sur la période.', 45, y + 6);
    y += 20;
  }

  // ============ PAGE 3 : ÉCARTS + SIGNATURE ============
  doc.addPage();
  y = 50;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('5. Points d\'attention', 40, y);
  y += 24;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Écarts de caisse (> 100 FCFA)', 40, y);
  y += 16;
  if (rapport.ecartsCaisse.length) {
    doc.rect(40, y, PAGE_W - 40, 20).fill('#F1F5F9');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
    doc.text('N° clôture', 45, y + 6, { width: 90 });
    doc.text('Activité', 135, y + 6, { width: 90 });
    doc.text('Caissier', 225, y + 6, { width: 100 });
    doc.text('Date', 325, y + 6, { width: 90 });
    doc.text('Écart', 415, y + 6, { width: 140, align: 'right' });
    y += 20;
    for (const e of rapport.ecartsCaisse) {
      doc.rect(40, y, PAGE_W - 40, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
      doc.font('Helvetica').fontSize(8).fillColor('#000');
      doc.text(e.numero, 45, y + 6, { width: 90 });
      doc.text(e.activite_nom, 135, y + 6, { width: 90 });
      doc.text(e.caissier_prenom || e.username || '—', 225, y + 6, { width: 100 });
      doc.text(h.formatDate(e.date_cloture), 325, y + 6, { width: 90 });
      doc.fillColor(e.ecart < 0 ? '#dc2626' : '#f59e0b').font('Helvetica-Bold');
      doc.text((e.ecart > 0 ? '+' : '') + h.formatNombre(e.ecart) + ' ' + devise, 415, y + 6, { width: 140, align: 'right' });
      y += 20;
    }
  } else {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Aucun écart significatif ce mois-ci. Excellent contrôle en caisse.', 45, y);
    y += 20;
  }

  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Situation créances B2B', 40, y); y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  if (rapport.impaye_total > 0) {
    doc.text(`Encours de créances au ${h.formatDate(new Date())} : `, 40, y, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#dc2626').text(h.formatNombre(rapport.impaye_total) + ' ' + devise + ' à recouvrer', { continued: false });
    doc.font('Helvetica').fillColor('#000');
    y = doc.y + 6;
    for (const a of rapport.par_activite.filter(a => a.montant_impaye > 0)) {
      doc.text(`   • ${a.activite.nom} : ${h.formatNombre(a.montant_impaye)} ${devise} (${a.nb_impayes} facture${a.nb_impayes > 1 ? 's' : ''})`, 40, y);
      y = doc.y + 2;
    }
  } else {
    doc.text('Aucune créance client en souffrance.', 40, y);
    y += 14;
  }

  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Alertes stock', 40, y); y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  doc.text(rapport.nb_alertes_stock > 0
    ? `${rapport.nb_alertes_stock} alerte(s) stock non traitée(s) actuellement. Consulter la liste des alertes pour arbitrage.`
    : 'Aucune alerte stock en cours. Approvisionnement maîtrisé.', 40, y, { width: PAGE_W - 40 });
  y = doc.y + 30;

  // Signature
  y = Math.max(y, 700);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text(`Rapport édité automatiquement le ${h.formatDate(new Date(), true)} par le Système d'information ${nomEnt}.`, 40, y, { width: PAGE_W - 40, align: 'center' });
  y += 20;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('LA DIRECTION GÉNÉRALE', 340, y, { align: 'center', width: 215 });
  doc.rect(340, y + 15, 215, 55).lineWidth(0.5).strokeColor('#000').stroke();
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Visa & signature', 340, y + 18, { align: 'center', width: 215 });

  doc.end();
});

module.exports = router;
