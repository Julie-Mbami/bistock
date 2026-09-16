// =============================================================================
// PROMOTIONS — Gestion des codes promo et remises automatiques (DG uniquement)
// =============================================================================
const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// Réservé DG
function requireDG(req, res, next) {
  if (!req.user || req.user.role !== 'DG') {
    return res.status(403).render('errors/403', { title: 'Accès refusé', page_title: 'Accès refusé' });
  }
  next();
}
router.use(requireDG);

// =========================================================
// STATS — Dashboard marketing (Phase 4)
// =========================================================
router.get('/stats', (req, res) => {
  const periode = req.query.periode || '30j';
  let dateDebut = new Date();
  if (periode === '7j') dateDebut.setDate(dateDebut.getDate() - 7);
  else if (periode === '30j') dateDebut.setDate(dateDebut.getDate() - 30);
  else if (periode === '90j') dateDebut.setDate(dateDebut.getDate() - 90);
  else if (periode === '365j') dateDebut.setDate(dateDebut.getDate() - 365);
  else dateDebut.setDate(dateDebut.getDate() - 30);
  const isoDebut = dateDebut.toISOString().slice(0, 10);
  const isoAujourdhui = new Date().toISOString().slice(0, 10);

  // KPIs globaux — commandes web sur la période
  const totalCmd = db.prepare(`SELECT COUNT(*) AS n FROM commande_client_web
                               WHERE date(date_creation) >= ?`).get(isoDebut).n;
  const totalCmdPromo = db.prepare(`SELECT COUNT(*) AS n FROM commande_client_web
                                    WHERE date(date_creation) >= ? AND promotion_id IS NOT NULL`).get(isoDebut).n;
  const totalCA = db.prepare(`SELECT COALESCE(SUM(total), 0) AS s FROM commande_client_web
                              WHERE date(date_creation) >= ?`).get(isoDebut).s;
  const totalCAPromo = db.prepare(`SELECT COALESCE(SUM(total), 0) AS s FROM commande_client_web
                                   WHERE date(date_creation) >= ? AND promotion_id IS NOT NULL`).get(isoDebut).s;
  const totalRemise = db.prepare(`SELECT COALESCE(SUM(remise_appliquee), 0) AS s FROM promotion_usage
                                  WHERE date(date_usage) >= ?`).get(isoDebut).s;
  const totalUsages = db.prepare(`SELECT COUNT(*) AS n FROM promotion_usage
                                  WHERE date(date_usage) >= ?`).get(isoDebut).n;
  const panierMoyenPromo = totalCmdPromo > 0 ? totalCAPromo / totalCmdPromo : 0;
  const panierMoyenNormal = (totalCmd - totalCmdPromo) > 0 ? (totalCA - totalCAPromo) / (totalCmd - totalCmdPromo) : 0;
  const tauxConversion = totalCmd > 0 ? (totalCmdPromo / totalCmd) * 100 : 0;

  // Top codes promo
  const topCodes = db.prepare(`SELECT p.id, p.nom, p.code, p.type, p.valeur,
                                      COUNT(u.id) AS nb_usages,
                                      COALESCE(SUM(u.remise_appliquee), 0) AS total_remise,
                                      COALESCE(SUM(c.total), 0) AS ca_genere
                               FROM promotion p
                               LEFT JOIN promotion_usage u ON u.promotion_id = p.id AND date(u.date_usage) >= ?
                               LEFT JOIN commande_client_web c ON c.id = u.commande_web_id
                               WHERE p.code IS NOT NULL AND p.code != ''
                               GROUP BY p.id
                               HAVING nb_usages > 0
                               ORDER BY nb_usages DESC, total_remise DESC
                               LIMIT 10`).all(isoDebut);

  // Top promos automatiques
  const topAutoPromos = db.prepare(`SELECT p.id, p.nom, p.type, p.valeur,
                                           COUNT(u.id) AS nb_usages,
                                           COALESCE(SUM(u.remise_appliquee), 0) AS total_remise,
                                           COALESCE(SUM(c.total), 0) AS ca_genere
                                    FROM promotion p
                                    LEFT JOIN promotion_usage u ON u.promotion_id = p.id AND date(u.date_usage) >= ?
                                    LEFT JOIN commande_client_web c ON c.id = u.commande_web_id
                                    WHERE p.code IS NULL OR p.code = ''
                                    GROUP BY p.id
                                    HAVING nb_usages > 0
                                    ORDER BY nb_usages DESC
                                    LIMIT 10`).all(isoDebut);

  // Évolution quotidienne (nb usages + remise cumulée)
  const evolution = db.prepare(`SELECT date(date_usage) AS jour,
                                       COUNT(*) AS nb,
                                       COALESCE(SUM(remise_appliquee), 0) AS remise
                                FROM promotion_usage
                                WHERE date(date_usage) >= ?
                                GROUP BY jour
                                ORDER BY jour`).all(isoDebut);

  // Répartition par type de promotion (pour donut chart)
  const repartitionTypes = db.prepare(`SELECT p.type, COUNT(u.id) AS nb, COALESCE(SUM(u.remise_appliquee), 0) AS remise
                                       FROM promotion_usage u
                                       JOIN promotion p ON p.id = u.promotion_id
                                       WHERE date(u.date_usage) >= ?
                                       GROUP BY p.type`).all(isoDebut);

  // Distribution horaire (heatmap simple : 24 heures)
  const heatmapRaw = db.prepare(`SELECT CAST(strftime('%H', date_usage) AS INTEGER) AS heure, COUNT(*) AS nb
                                 FROM promotion_usage
                                 WHERE date(date_usage) >= ?
                                 GROUP BY heure`).all(isoDebut);
  const heatmapHeures = new Array(24).fill(0);
  for (const r of heatmapRaw) heatmapHeures[r.heure] = r.nb;

  // Distribution par jour de la semaine
  const jourSemRaw = db.prepare(`SELECT CAST(strftime('%w', date_usage) AS INTEGER) AS jour, COUNT(*) AS nb
                                 FROM promotion_usage
                                 WHERE date(date_usage) >= ?
                                 GROUP BY jour`).all(isoDebut);
  const jourSemNoms = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const jourSemVals = new Array(7).fill(0);
  for (const r of jourSemRaw) jourSemVals[r.jour] = r.nb;

  res.render('promotions/stats', {
    title: 'Statistiques Marketing', page_title: 'Marketing — Statistiques',
    periode, isoDebut, isoAujourdhui,
    kpis: {
      totalCmd, totalCmdPromo, totalCA, totalCAPromo,
      totalRemise, totalUsages,
      panierMoyenPromo, panierMoyenNormal,
      tauxConversion,
    },
    topCodes, topAutoPromos, evolution,
    repartitionTypes, heatmapHeures, jourSemNoms, jourSemVals,
  });
});

// Export CSV des utilisations
router.get('/stats/export.csv', (req, res) => {
  const periode = req.query.periode || '30j';
  let dateDebut = new Date();
  if (periode === '7j') dateDebut.setDate(dateDebut.getDate() - 7);
  else if (periode === '30j') dateDebut.setDate(dateDebut.getDate() - 30);
  else if (periode === '90j') dateDebut.setDate(dateDebut.getDate() - 90);
  else dateDebut.setDate(dateDebut.getDate() - 30);
  const isoDebut = dateDebut.toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT u.date_usage, p.nom AS promotion, p.code, p.type, p.valeur,
                                  u.client_tel, u.remise_appliquee,
                                  c.code_suivi, c.client_nom, c.total AS commande_total, c.statut
                           FROM promotion_usage u
                           JOIN promotion p ON p.id = u.promotion_id
                           LEFT JOIN commande_client_web c ON c.id = u.commande_web_id
                           WHERE date(u.date_usage) >= ?
                           ORDER BY u.date_usage DESC`).all(isoDebut);
  const header = 'Date;Promotion;Code;Type;Valeur;Client tel;Remise (FCFA);Commande;Client;Total commande (FCFA);Statut\n';
  const lignes = rows.map(r => [
    r.date_usage, r.promotion, r.code || 'AUTO', r.type, r.valeur,
    r.client_tel || '', Math.round(r.remise_appliquee),
    r.code_suivi || '', r.client_nom || '', Math.round(r.commande_total || 0), r.statut || '',
  ].map(v => String(v).replace(/;/g, ',').replace(/\n/g, ' ')).join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="promotions_stats_${periode}_${new Date().toISOString().slice(0,10)}.csv"`);
  // BOM UTF-8 pour Excel
  res.send('﻿' + header + lignes);
});

// =========================================================
// LISTE
// =========================================================
router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const filtreStatut = req.query.statut || '';
  const filtres = [];
  const params = [];
  if (q) { filtres.push('(LOWER(nom) LIKE ? OR LOWER(COALESCE(code,\'\')) LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (filtreStatut === 'actif') filtres.push('actif = 1');
  else if (filtreStatut === 'inactif') filtres.push('actif = 0');
  else if (filtreStatut === 'expire') filtres.push("date_fin IS NOT NULL AND date_fin < date('now')");
  const where = filtres.length ? 'WHERE ' + filtres.join(' AND ') : '';
  const promotions = db.prepare(`SELECT p.*,
                                        c.nom AS categorie_nom,
                                        pr.designation AS produit_nom,
                                        a.code AS activite_code, a.nom AS activite_nom
                                 FROM promotion p
                                 LEFT JOIN categorie c ON c.id = p.categorie_id
                                 LEFT JOIN produit pr ON pr.id = p.produit_id
                                 LEFT JOIN activite a ON a.id = p.activite_id
                                 ${where}
                                 ORDER BY p.actif DESC, p.cree_le DESC`).all(...params);

  // KPIs
  const now = new Date().toISOString().slice(0, 10);
  const actives = promotions.filter(p => p.actif && (!p.date_fin || p.date_fin >= now)).length;
  const expirees = promotions.filter(p => p.date_fin && p.date_fin < now).length;
  const totalUsages = promotions.reduce((s, p) => s + (p.usage_count || 0), 0);
  const totalRemise = db.prepare('SELECT COALESCE(SUM(remise_appliquee), 0) AS s FROM promotion_usage').get().s;

  res.render('promotions/liste', {
    title: 'Promotions', page_title: 'Marketing — Promotions',
    promotions, q, filtre_statut: filtreStatut,
    kpis: { actives, expirees, totalUsages, totalRemise },
  });
});

// =========================================================
// FORMULAIRE NOUVEAU / MODIFIER
// =========================================================
function _preparerFormData(req) {
  const activites = db.prepare('SELECT id, code, nom FROM activite WHERE actif = 1 ORDER BY nom').all();
  const categories = db.prepare('SELECT id, activite_id, nom FROM categorie ORDER BY nom').all();
  const produits = db.prepare('SELECT id, activite_id, designation FROM produit WHERE actif = 1 AND (reference IS NULL OR reference NOT LIKE \'FRAIS-%\') ORDER BY designation').all();
  return { activites, categories, produits };
}

router.get('/nouvelle', (req, res) => {
  const data = _preparerFormData(req);
  res.render('promotions/formulaire', {
    title: 'Nouvelle promotion', page_title: 'Nouvelle promotion', mode: 'creer',
    promo: { actif: 1, type: 'POURCENTAGE', valeur: 10, panier_min: 0, usage_par_client: 1 },
    ...data, erreurs: [],
  });
});

function _valider(body) {
  const erreurs = [];
  if (!String(body.nom || '').trim()) erreurs.push('Le nom est requis');
  if (!['POURCENTAGE', 'MONTANT_FIXE', 'LIVRAISON_OFFERTE'].includes(body.type)) erreurs.push('Type invalide');
  const val = Number(body.valeur || 0);
  if (body.type === 'POURCENTAGE' && (val <= 0 || val > 100)) erreurs.push('Le pourcentage doit être entre 1 et 100');
  if (body.type === 'MONTANT_FIXE' && val <= 0) erreurs.push('Le montant doit être supérieur à 0');
  if (body.code && !/^[A-Z0-9_-]{3,20}$/i.test(String(body.code).trim())) {
    erreurs.push('Le code doit contenir uniquement lettres, chiffres, tiret ou underscore (3 à 20 caractères)');
  }
  return erreurs;
}

function _normaliserBody(body) {
  const code = String(body.code || '').trim().toUpperCase();
  // Jours de la semaine : tableau de cases cochées → chaîne CSV
  let joursSemaine = '';
  if (body.jours_semaine) {
    if (Array.isArray(body.jours_semaine)) joursSemaine = body.jours_semaine.join(',');
    else joursSemaine = String(body.jours_semaine);
  }
  return {
    nom: String(body.nom || '').trim(),
    code: code || null,
    type: body.type,
    valeur: Number(body.valeur || 0),
    panier_min: Number(body.panier_min || 0),
    categorie_id: body.categorie_id ? Number(body.categorie_id) : null,
    produit_id: body.produit_id ? Number(body.produit_id) : null,
    activite_id: body.activite_id ? Number(body.activite_id) : null,
    date_debut: body.date_debut || null,
    date_fin: body.date_fin || null,
    heure_debut: String(body.heure_debut || '').trim(),
    heure_fin: String(body.heure_fin || '').trim(),
    jours_semaine: joursSemaine,
    afficher_banniere: (body.afficher_banniere === '1' || body.afficher_banniere === 'on') ? 1 : 0,
    usage_max: body.usage_max ? Number(body.usage_max) : null,
    usage_par_client: body.usage_par_client ? Number(body.usage_par_client) : null,
    description: String(body.description || '').trim(),
    actif: body.actif === '1' || body.actif === 'on' ? 1 : 0,
  };
}

router.post('/nouvelle', (req, res) => {
  const erreurs = _valider(req.body);
  if (erreurs.length) {
    const data = _preparerFormData(req);
    return res.render('promotions/formulaire', {
      title: 'Nouvelle promotion', page_title: 'Nouvelle promotion', mode: 'creer',
      promo: req.body, ...data, erreurs,
    });
  }
  const p = _normaliserBody(req.body);
  // Vérif code unique
  if (p.code) {
    const dup = db.prepare('SELECT id FROM promotion WHERE UPPER(code) = ?').get(p.code);
    if (dup) {
      const data = _preparerFormData(req);
      return res.render('promotions/formulaire', {
        title: 'Nouvelle promotion', page_title: 'Nouvelle promotion', mode: 'creer',
        promo: req.body, ...data, erreurs: [`Le code « ${p.code} » existe déjà`],
      });
    }
  }
  const info = db.prepare(`INSERT INTO promotion
    (nom, code, type, valeur, panier_min, categorie_id, produit_id, activite_id,
     date_debut, date_fin, heure_debut, heure_fin, jours_semaine, afficher_banniere,
     usage_max, usage_par_client, description, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.nom, p.code, p.type, p.valeur, p.panier_min, p.categorie_id, p.produit_id, p.activite_id,
         p.date_debut, p.date_fin, p.heure_debut, p.heure_fin, p.jours_semaine, p.afficher_banniere,
         p.usage_max, p.usage_par_client, p.description, p.actif);
  h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE', entite: 'promotion', entite_id: Number(info.lastInsertRowid),
                       details: `Promotion créée : ${p.nom}${p.code ? ' (code ' + p.code + ')' : ''}` });
  req.flash('success', `Promotion « ${p.nom} » créée.`);
  res.redirect('/admin/promotions/');
});

router.get('/:id(\\d+)/modifier', (req, res) => {
  const promo = db.prepare('SELECT * FROM promotion WHERE id = ?').get(req.params.id);
  if (!promo) return res.redirect('/admin/promotions/');
  const data = _preparerFormData(req);
  res.render('promotions/formulaire', {
    title: 'Modifier promotion', page_title: 'Modifier promotion', mode: 'modifier',
    promo, ...data, erreurs: [],
  });
});

router.post('/:id(\\d+)/modifier', (req, res) => {
  const existante = db.prepare('SELECT * FROM promotion WHERE id = ?').get(req.params.id);
  if (!existante) return res.redirect('/admin/promotions/');
  const erreurs = _valider(req.body);
  if (erreurs.length) {
    const data = _preparerFormData(req);
    return res.render('promotions/formulaire', {
      title: 'Modifier promotion', page_title: 'Modifier promotion', mode: 'modifier',
      promo: { ...existante, ...req.body }, ...data, erreurs,
    });
  }
  const p = _normaliserBody(req.body);
  if (p.code) {
    const dup = db.prepare('SELECT id FROM promotion WHERE UPPER(code) = ? AND id != ?').get(p.code, req.params.id);
    if (dup) {
      const data = _preparerFormData(req);
      return res.render('promotions/formulaire', {
        title: 'Modifier promotion', page_title: 'Modifier promotion', mode: 'modifier',
        promo: { ...existante, ...req.body }, ...data, erreurs: [`Le code « ${p.code} » existe déjà`],
      });
    }
  }
  db.prepare(`UPDATE promotion SET
    nom = ?, code = ?, type = ?, valeur = ?, panier_min = ?, categorie_id = ?, produit_id = ?, activite_id = ?,
    date_debut = ?, date_fin = ?, heure_debut = ?, heure_fin = ?, jours_semaine = ?, afficher_banniere = ?,
    usage_max = ?, usage_par_client = ?, description = ?, actif = ?,
    modifie_le = datetime('now')
    WHERE id = ?`)
    .run(p.nom, p.code, p.type, p.valeur, p.panier_min, p.categorie_id, p.produit_id, p.activite_id,
         p.date_debut, p.date_fin, p.heure_debut, p.heure_fin, p.jours_semaine, p.afficher_banniere,
         p.usage_max, p.usage_par_client, p.description, p.actif, req.params.id);
  h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE', entite: 'promotion', entite_id: Number(req.params.id),
                       details: `Promotion modifiée : ${p.nom}` });
  req.flash('success', `Promotion « ${p.nom} » mise à jour.`);
  res.redirect('/admin/promotions/');
});

router.post('/:id(\\d+)/toggle', (req, res) => {
  const promo = db.prepare('SELECT * FROM promotion WHERE id = ?').get(req.params.id);
  if (!promo) return res.redirect('/admin/promotions/');
  const nouveau = promo.actif ? 0 : 1;
  db.prepare("UPDATE promotion SET actif = ?, modifie_le = datetime('now') WHERE id = ?").run(nouveau, promo.id);
  h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE', entite: 'promotion', entite_id: promo.id,
                       details: `Promotion ${nouveau ? 'activée' : 'suspendue'} : ${promo.nom}` });
  req.flash('success', `Promotion ${nouveau ? 'activée' : 'suspendue'}.`);
  res.redirect('/admin/promotions/');
});

router.post('/:id(\\d+)/dupliquer', (req, res) => {
  const src = db.prepare('SELECT * FROM promotion WHERE id = ?').get(req.params.id);
  if (!src) return res.redirect('/admin/promotions/');
  const nouveauCode = src.code ? (src.code + '_COPIE') : null;
  const nouveauNom = src.nom + ' (copie)';
  const info = db.prepare(`INSERT INTO promotion
    (nom, code, type, valeur, panier_min, categorie_id, produit_id, activite_id,
     date_debut, date_fin, usage_max, usage_par_client, description, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(nouveauNom, nouveauCode, src.type, src.valeur, src.panier_min, src.categorie_id, src.produit_id, src.activite_id,
         src.date_debut, src.date_fin, src.usage_max, src.usage_par_client, src.description);
  req.flash('success', 'Promotion dupliquée (désactivée par défaut, à ajuster avant activation).');
  res.redirect('/admin/promotions/' + info.lastInsertRowid + '/modifier');
});

router.post('/:id(\\d+)/supprimer', (req, res) => {
  const promo = db.prepare('SELECT * FROM promotion WHERE id = ?').get(req.params.id);
  if (!promo) return res.redirect('/admin/promotions/');
  // Ne pas supprimer si des usages existent — juste désactiver
  const usages = db.prepare('SELECT COUNT(*) AS n FROM promotion_usage WHERE promotion_id = ?').get(req.params.id).n;
  if (usages > 0) {
    db.prepare("UPDATE promotion SET actif = 0, modifie_le = datetime('now') WHERE id = ?").run(req.params.id);
    req.flash('warning', `Promotion suspendue (${usages} utilisation${usages > 1 ? 's' : ''} en historique — suppression impossible).`);
  } else {
    db.prepare('DELETE FROM promotion WHERE id = ?').run(req.params.id);
    h.journaliser(db, { user: req.user, action: 'PARAM_MODIFIE', entite: 'promotion', entite_id: promo.id,
                         details: `Promotion supprimée : ${promo.nom}` });
    req.flash('success', 'Promotion supprimée.');
  }
  res.redirect('/admin/promotions/');
});

// Détail avec statistiques d'usage
router.get('/:id(\\d+)', (req, res) => {
  const promo = db.prepare(`SELECT p.*, c.nom AS categorie_nom, pr.designation AS produit_nom, a.code AS activite_code, a.nom AS activite_nom
                            FROM promotion p
                            LEFT JOIN categorie c ON c.id = p.categorie_id
                            LEFT JOIN produit pr ON pr.id = p.produit_id
                            LEFT JOIN activite a ON a.id = p.activite_id
                            WHERE p.id = ?`).get(req.params.id);
  if (!promo) return res.redirect('/admin/promotions/');
  const usages = db.prepare(`SELECT u.*, c.code_suivi, c.client_nom, c.total AS commande_total
                             FROM promotion_usage u
                             LEFT JOIN commande_client_web c ON c.id = u.commande_web_id
                             WHERE u.promotion_id = ?
                             ORDER BY u.date_usage DESC LIMIT 100`).all(req.params.id);
  const totalRemise = db.prepare('SELECT COALESCE(SUM(remise_appliquee), 0) AS s FROM promotion_usage WHERE promotion_id = ?').get(req.params.id).s;
  res.render('promotions/detail', {
    title: promo.nom, page_title: `Promotion — ${promo.nom}`,
    promo, usages, totalRemise,
  });
});

module.exports = router;
