const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('../src/db');
const h = require('../src/helpers');
const config = require('../src/config');
const xl = require('../src/excel');

const router = express.Router();

const uploadDir = path.join(config.UPLOADS_DIR, 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')),
});
const upload = multer({ storage });
const uploadMemoire = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function requireAuth(req, res, next) { if (!req.user) return res.redirect('/comptes/connexion'); next(); }
function requireDG(req, res, next) {
  if (!req.user || !h.isDG(req.user)) { req.flash('error', 'Accès Direction Générale requis.'); return res.redirect('/tableau-de-bord/'); }
  next();
}

// ----- Connexion / Déconnexion -----
router.get('/connexion', (req, res) => {
  if (req.user) return res.redirect('/tableau-de-bord/');
  res.render('accounts/login', { title: 'Connexion', page_title: 'Connexion', erreur: null });
});

router.post('/connexion', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM utilisateur WHERE username = ? AND is_active = 1').get(username);
  if (!u || !bcrypt.compareSync(password, u.password)) {
    return res.render('accounts/login', { title: 'Connexion', page_title: 'Connexion', erreur: 'Identifiants incorrects.' });
  }
  req.session.userId = u.id;
  // Pré-sélectionner l'activité de l'utilisateur s'il en a une
  if (u.activite_id) req.session.activiteId = u.activite_id;
  const label = (u.titre ? u.titre + ' ' : '') + (u.first_name || u.username);
  req.flash('success', `Bienvenue ${label} !`);
  res.redirect('/tableau-de-bord/');
});

router.get('/deconnexion', (req, res) => {
  req.session.destroy(() => res.redirect('/comptes/connexion'));
});

// ----- Profil -----
router.get('/profil', requireAuth, (req, res) => {
  res.render('accounts/profil', { title: 'Mon profil', page_title: 'Mon profil', utilisateur: req.user });
});

// ----- Gestion des utilisateurs (DG uniquement) -----
router.get('/utilisateurs', requireDG, (req, res) => {
  const p = h.pagination(req);
  const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM utilisateur').get().n;
  const utilisateurs = db.prepare(`SELECT u.*, a.nom AS activite_nom, a.code AS activite_code, a.couleur AS activite_couleur
                                   FROM utilisateur u LEFT JOIN activite a ON a.id = u.activite_id
                                   ORDER BY u.role, u.first_name LIMIT ? OFFSET ?`).all(p.taille, p.offset);
  res.render('accounts/liste', { title: 'Utilisateurs', page_title: 'Utilisateurs', utilisateurs,
    pagination: h.paginationInfo(p, totalUsers, req) });
});

router.get('/utilisateurs/nouveau', requireDG, (req, res) => {
  const activites = db.prepare('SELECT * FROM activite WHERE actif = 1 ORDER BY id').all();
  res.render('accounts/formulaire', {
    title: 'Nouvel utilisateur', page_title: 'Nouvel utilisateur',
    utilisateur: null, activites, roles: h.ROLE_LABEL, mode: 'creer', erreurs: [],
  });
});

router.post('/utilisateurs/nouveau', requireDG, upload.single('photo'), (req, res) => {
  const { username, titre = '', first_name = '', last_name = '', email = '', telephone = '',
          role = 'CAISSIER', activite_id = null, password1, password2 } = req.body;
  const erreurs = [];
  if (!username) erreurs.push('Nom d\'utilisateur requis.');
  if (!password1 || password1.length < 6) erreurs.push('Mot de passe : min 6 caractères.');
  if (password1 !== password2) erreurs.push('Les mots de passe ne correspondent pas.');
  if (db.prepare('SELECT 1 FROM utilisateur WHERE username = ?').get(username)) erreurs.push('Nom d\'utilisateur déjà utilisé.');
  if (['GESTIONNAIRE', 'CAISSIER', 'CUISINIER'].includes(role) && !activite_id) erreurs.push('Une activité est requise pour ce rôle.');
  if (!['DG', 'SECRETARIAT', 'DISTRIBUTION', 'GESTIONNAIRE', 'CAISSIER', 'CUISINIER'].includes(role)) erreurs.push('Rôle invalide.');
  if (erreurs.length) {
    const activites = db.prepare('SELECT * FROM activite WHERE actif = 1 ORDER BY id').all();
    return res.render('accounts/formulaire', {
      title: 'Nouvel utilisateur', page_title: 'Nouvel utilisateur',
      utilisateur: req.body, activites, roles: h.ROLE_LABEL, mode: 'creer', erreurs,
    });
  }
  const hash = bcrypt.hashSync(password1, 8);
  const photo = req.file ? `/avatars/${req.file.filename}` : '';
  const info = db.prepare(`INSERT INTO utilisateur
    (username, password, titre, first_name, last_name, email, telephone, role, activite_id, photo, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(username, hash, titre, first_name, last_name, email, telephone, role,
         (role === 'DG' || role === 'DISTRIBUTION' || role === 'SECRETARIAT') ? null : activite_id, photo);
  h.journaliser(db, { user: req.user, action: 'UTIL_CREE',
    entite: 'utilisateur', entite_id: Number(info.lastInsertRowid),
    details: `${username} (${role}) — ${first_name} ${last_name}` });
  req.flash('success', 'Utilisateur créé.');
  res.redirect('/comptes/utilisateurs');
});

router.get('/utilisateurs/:id(\\d+)/modifier', requireDG, (req, res) => {
  const utilisateur = db.prepare('SELECT * FROM utilisateur WHERE id = ?').get(req.params.id);
  if (!utilisateur) return res.redirect('/comptes/utilisateurs');
  const activites = db.prepare('SELECT * FROM activite WHERE actif = 1 ORDER BY id').all();
  res.render('accounts/formulaire', {
    title: 'Modifier utilisateur', page_title: 'Modifier utilisateur',
    utilisateur, activites, roles: h.ROLE_LABEL, mode: 'modifier', erreurs: [],
  });
});

router.post('/utilisateurs/:id(\\d+)/modifier', requireDG, upload.single('photo'), (req, res) => {
  const u = db.prepare('SELECT * FROM utilisateur WHERE id = ?').get(req.params.id);
  if (!u) return res.redirect('/comptes/utilisateurs');
  const { titre = '', first_name = '', last_name = '', email = '', telephone = '',
          role = 'CAISSIER', activite_id, is_active } = req.body;
  const photo = req.file ? `/avatars/${req.file.filename}` : u.photo;
  const actId = (role === 'DG' || role === 'DISTRIBUTION' || role === 'SECRETARIAT') ? null : (activite_id || null);
  db.prepare(`UPDATE utilisateur SET titre=?, first_name=?, last_name=?, email=?, telephone=?, role=?, activite_id=?, is_active=?, photo=?
              WHERE id = ?`)
    .run(titre, first_name, last_name, email, telephone, role, actId, is_active ? 1 : 0, photo, req.params.id);
  req.flash('success', 'Utilisateur modifié.');
  res.redirect('/comptes/utilisateurs');
});

router.get('/utilisateurs/:id(\\d+)/supprimer', requireDG, (req, res) => {
  const utilisateur = db.prepare('SELECT * FROM utilisateur WHERE id = ?').get(req.params.id);
  if (!utilisateur) return res.redirect('/comptes/utilisateurs');
  res.render('accounts/confirmer_suppression', { title: 'Supprimer', page_title: 'Supprimer utilisateur', objet: utilisateur, libelle: utilisateur.username, retour: '/comptes/utilisateurs' });
});

router.post('/utilisateurs/:id(\\d+)/supprimer', requireDG, (req, res) => {
  if (Number(req.params.id) === req.user.id) { req.flash('error', 'Impossible de supprimer votre propre compte.'); return res.redirect('/comptes/utilisateurs'); }
  const u = db.prepare('SELECT username, role, first_name, last_name FROM utilisateur WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM utilisateur WHERE id = ?').run(req.params.id);
  if (u) h.journaliser(db, { user: req.user, action: 'UTIL_SUPPRIME',
    entite: 'utilisateur', entite_id: Number(req.params.id),
    details: `${u.username} (${u.role}) — ${u.first_name || ''} ${u.last_name || ''}`.trim() });
  req.flash('success', 'Utilisateur supprimé.');
  res.redirect('/comptes/utilisateurs');
});

// =========================================================
// IMPORT EXCEL — UTILISATEURS (DG uniquement)
// =========================================================
function colonnesUtilisateurs() {
  return [
    { header: 'Nom d\'utilisateur', key: 'username', width: 18, required: true, note: 'Doit être unique — sans espaces, lettres/chiffres/point/underscore' },
    { header: 'Mot de passe', key: 'password', width: 16, required: true, note: 'Min. 6 caractères. Sera chiffré à l\'import' },
    { header: 'Titre', key: 'titre', width: 10, options: ['', 'M.', 'Mme', 'Mlle'] },
    { header: 'Prénom', key: 'first_name', width: 18 },
    { header: 'Nom', key: 'last_name', width: 18 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Téléphone', key: 'telephone', width: 14 },
    { header: 'Rôle', key: 'role', width: 16, required: true, options: ['DG', 'SECRETARIAT', 'DISTRIBUTION', 'GESTIONNAIRE', 'CAISSIER', 'CUISINIER'] },
    { header: 'Code activité', key: 'code_activite', width: 14, note: 'Obligatoire pour GESTIONNAIRE / CAISSIER. Ex : TRAIT, CAN, PAT, BUR' },
    { header: 'Actif', key: 'actif', width: 8, options: ['Oui', 'Non'] },
  ];
}

router.get('/utilisateurs/import/modele', requireDG, async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Utilisateurs',
    colonnes: colonnesUtilisateurs(),
    lignes_exemple: [
      { username: 'exemple_gest', password: 'motdepasse', titre: 'M.', first_name: 'Jean', last_name: 'Nkomo', email: 'j.nkomo@bistrot.cm', telephone: '699 000 000', role: 'GESTIONNAIRE', code_activite: 'TRAIT', actif: 'Oui' },
      { username: 'exemple_caissiere', password: 'motdepasse', titre: 'Mlle', first_name: 'Marie', last_name: 'Ossoa', email: '', telephone: '677 111 222', role: 'CAISSIER', code_activite: 'PAT', actif: 'Oui' },
    ],
    instructions: [
      'Import réservé à la Direction Générale.',
      '',
      'Colonnes obligatoires : Nom d\'utilisateur, Mot de passe, Rôle.',
      '',
      '• Nom d\'utilisateur : sans espace, unique (les doublons seront ignorés).',
      '• Mot de passe : min 6 caractères ; il sera chiffré au moment de l\'import.',
      '• Rôle : DG, SECRETARIAT, DISTRIBUTION (Nestor), GESTIONNAIRE, CAISSIER, CUISINIER.',
      '• Code activité : obligatoire pour GESTIONNAIRE, CAISSIER et CUISINIER (TRAIT, CAN, PAT, BUR). Laisser vide pour DG/SECRETARIAT/DISTRIBUTION (accès global).',
      '• Actif : "Oui" pour autoriser la connexion, "Non" pour désactiver.',
      '',
      'Vous pourrez raffiner les permissions et les activités secondaires depuis la fiche utilisateur après import.',
    ],
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_utilisateurs.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/utilisateurs/import', requireDG, (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer des utilisateurs', page_title: 'Importer des utilisateurs',
    apercu: null, erreurs: [], type_import: 'utilisateurs',
    url_modele: '/comptes/utilisateurs/import/modele', url_upload: '/comptes/utilisateurs/import/apercu', url_confirmer: '/comptes/utilisateurs/import/confirmer',
    url_retour: '/comptes/utilisateurs',
  });
});

router.post('/utilisateurs/import/apercu', requireDG, uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/comptes/utilisateurs/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesUtilisateurs() });
    // Validation additionnelle : vérifier unicité username (sans casse) et code activité
    const usernamesVus = new Set();
    const usernamesExistants = new Set(
      db.prepare('SELECT username FROM utilisateur').all().map(u => h.normaliserNom(u.username))
    );
    for (const l of lignes) {
      l.__erreurs = l.__erreurs || [];
      if (l.username) {
        const uname = String(l.username).trim();
        const keyUname = h.normaliserNom(uname);
        if (usernamesVus.has(keyUname)) l.__erreurs.push(`ligne ${l.__ligne_excel} : nom d'utilisateur « ${uname} » présent en double dans le fichier`);
        usernamesVus.add(keyUname);
        if (usernamesExistants.has(keyUname)) {
          l.__erreurs.push(`ligne ${l.__ligne_excel} : utilisateur « ${uname} » existe déjà`);
        }
      }
      if (l.password && String(l.password).length < 6) l.__erreurs.push(`ligne ${l.__ligne_excel} : mot de passe trop court (min 6)`);
      const roleUpper = String(l.role || '').toUpperCase();
      if (!['DG', 'SECRETARIAT', 'DISTRIBUTION', 'GESTIONNAIRE', 'CAISSIER', 'CUISINIER'].includes(roleUpper)) {
        l.__erreurs.push(`ligne ${l.__ligne_excel} : rôle « ${l.role} » invalide`);
      }
      if (['GESTIONNAIRE', 'CAISSIER', 'CUISINIER'].includes(roleUpper) && !l.code_activite) {
        l.__erreurs.push(`ligne ${l.__ligne_excel} : code activité requis pour le rôle ${roleUpper}`);
      }
      if (l.code_activite) {
        const act = db.prepare('SELECT id FROM activite WHERE code = ?').get(String(l.code_activite).toUpperCase());
        if (!act) l.__erreurs.push(`ligne ${l.__ligne_excel} : code activité « ${l.code_activite} » inconnu`);
      }
    }
    const erreursGlobales = lignes.flatMap(l => l.__erreurs);
    req.session.import_utilisateurs = { lignes };
    res.render('produits/import_excel', {
      title: 'Aperçu import utilisateurs', page_title: 'Aperçu import utilisateurs',
      apercu: lignes, erreurs: erreursGlobales, type_import: 'utilisateurs',
      url_modele: '/comptes/utilisateurs/import/modele', url_upload: '/comptes/utilisateurs/import/apercu', url_confirmer: '/comptes/utilisateurs/import/confirmer',
      url_retour: '/comptes/utilisateurs',
    });
  } catch (e) { req.flash('error', 'Fichier illisible : ' + e.message); res.redirect('/comptes/utilisateurs/import'); }
});

router.post('/utilisateurs/import/confirmer', requireDG, (req, res) => {
  const data = req.session.import_utilisateurs;
  if (!data) { req.flash('warning', 'Session expirée.'); return res.redirect('/comptes/utilisateurs/import'); }
  const insertU = db.prepare(`INSERT INTO utilisateur
    (username, password, titre, first_name, last_name, email, telephone, role, activite_id, photo, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const findActivite = db.prepare('SELECT id FROM activite WHERE code = ?');
  let crees = 0, ignores = 0;
  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) { ignores++; continue; }
    const role = String(l.role).toUpperCase();
    let actId = null;
    if (l.code_activite && !['DG', 'SECRETARIAT', 'DISTRIBUTION'].includes(role)) {
      const a = findActivite.get(String(l.code_activite).toUpperCase());
      actId = a ? a.id : null;
    }
    const actif = (l.actif == null || String(l.actif).toLowerCase() === 'oui') ? 1 : 0;
    const hash = bcrypt.hashSync(String(l.password), 8);
    insertU.run(String(l.username).trim(), hash, String(l.titre || ''), String(l.first_name || ''), String(l.last_name || ''),
                String(l.email || ''), String(l.telephone || ''), role, actId, '', actif);
    crees++;
  }
  delete req.session.import_utilisateurs;
  if (crees) req.flash('success', `${crees} utilisateur(s) importé(s).`);
  if (ignores) req.flash('warning', `${ignores} ligne(s) ignorée(s). Corrigez le fichier et relancez l'import.`);
  res.redirect('/comptes/utilisateurs');
});

module.exports = router;
