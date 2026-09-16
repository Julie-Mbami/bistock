const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('../src/db');
const h = require('../src/helpers');
const config = require('../src/config');
const xl = require('../src/excel');

const router = express.Router();

const uploadDir = path.join(config.UPLOADS_DIR, 'produits');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')),
});
const upload = multer({ storage });
const uploadMemoire = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Middleware : activité obligatoire + droit d'écriture
function requireActivite(req, res, next) {
  if (!req.activiteId) { req.flash('warning', 'Sélectionnez une activité pour accéder au catalogue.'); return res.redirect('/tableau-de-bord/'); }
  next();
}
// Enforcement basé sur permissions : chaque middleware délègue à FEATURES.
function requireEcriture(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'produits.ecrire', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission « Créer/modifier les produits » sur cette activité.");
  return res.redirect('/produits/');
}
function requireEcritureCuisine(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'cuisine.recettes.ecrire', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission « Créer/modifier les fiches techniques » sur cette activité.");
  return res.redirect('/produits/' + (req.params.id || ''));
}

// Lecture requise pour accéder au module produits
router.use(requireActivite, h.permissionRequise(db, 'produits.lire'));

// =========================================================
// PRODUITS
// =========================================================
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const cat = req.query.categorie || '';
  const fourn = req.query.fournisseur || '';
  const etat = req.query.etat || '';
  const typeFiltre = (req.query.type || '').toUpperCase();

  const filtres = ['p.activite_id = ?'];
  const params = [req.activiteId];
  // Cacher les produits système (Frais de livraison, etc.) — utilisés uniquement en interne pour la facturation
  filtres.push("(p.reference IS NULL OR p.reference NOT LIKE 'FRAIS-%')");
  if (q) { filtres.push('(p.designation LIKE ? OR p.reference LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (cat) { filtres.push('p.categorie_id = ?'); params.push(cat); }
  if (fourn) { filtres.push('p.fournisseur_id = ?'); params.push(fourn); }
  if (etat === 'rupture') filtres.push('p.stock_actuel <= 0');
  else if (etat === 'alerte') filtres.push('p.stock_actuel > 0 AND p.stock_actuel <= p.stock_minimum');

  const rows = db.prepare(`SELECT p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom
                           FROM produit p
                           LEFT JOIN categorie c ON c.id = p.categorie_id
                           LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                           WHERE ${filtres.join(' AND ')}
                           ORDER BY p.designation`).all(...params);
  const types = h.getTypesProduits(db, req.activiteId);
  let produits = rows.map(h.enrichirProduit).map(p => ({ ...p, type_produit: types.get(p.id) || 'CONSOMMABLE' }));
  // Filtre par type (appliqué après enrichissement car type est déduit dynamiquement)
  if (['PRODUIT_FINI', 'INGREDIENT', 'REVENTE', 'CONSOMMABLE'].includes(typeFiltre)) {
    produits = produits.filter(p => p.type_produit === typeFiltre);
  }

  // Compteurs par type (basés sur tous les produits, pour l'affichage des onglets)
  const compteursTypes = { PRODUIT_FINI: 0, INGREDIENT: 0, REVENTE: 0, CONSOMMABLE: 0 };
  for (const t of types.values()) if (compteursTypes[t] !== undefined) compteursTypes[t]++;

  // Pagination — appliquée après le filtre type (calculé côté JS)
  const p = h.pagination(req);
  const total = produits.length;
  produits = produits.slice(p.offset, p.offset + p.taille);

  const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  const fournisseur_actif = fourn ? db.prepare('SELECT * FROM fournisseur WHERE id = ?').get(fourn) : null;

  res.render('produits/liste', {
    title: 'Produits', page_title: `Catalogue — ${req.activite.nom}`,
    produits, categories,
    q, cat_filtre: cat, fourn_filtre: fourn, etat_filtre: etat, type_filtre: typeFiltre,
    fournisseur_actif,
    types_produit: h.TYPE_PRODUIT, compteurs_types: compteursTypes,
    pagination: h.paginationInfo(p, total, req),
  });
});

router.get('/nouveau', requireEcriture, (req, res) => {
  const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  const fournisseurs = db.prepare('SELECT * FROM fournisseur WHERE activite_id = ? ORDER BY raison_sociale').all(req.activiteId);
  res.render('produits/produit_form', {
    title: 'Nouveau produit', page_title: 'Nouveau produit',
    produit: { reference: h.prochaineReferenceProduit(db, req.activiteId), stock_minimum: 5, stock_maximum: 100, unite: 'pièce', actif: 1 },
    categories, fournisseurs, mode: 'creer', erreurs: [],
  });
});

function _valider(body) {
  const erreurs = [];
  const pa = Number(body.prix_achat || 0);
  const pv = Number(body.prix_vente || 0);
  const smin = Number(body.stock_minimum || 0);
  const smax = Number(body.stock_maximum || 0);
  if (pv && pa && pv < pa) erreurs.push('Le prix de vente doit être supérieur ou égal au prix d\'achat.');
  if (smax && smin && smax < smin) erreurs.push('Le stock maximum doit être supérieur ou égal au stock minimum.');
  return erreurs;
}

router.post('/nouveau', requireEcriture, upload.single('image'), (req, res) => {
  const erreurs = _valider(req.body);
  if (erreurs.length) {
    const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
    const fournisseurs = db.prepare('SELECT * FROM fournisseur WHERE activite_id = ? ORDER BY raison_sociale').all(req.activiteId);
    return res.render('produits/produit_form', {
      title: 'Nouveau produit', page_title: 'Nouveau produit',
      produit: req.body, categories, fournisseurs, mode: 'creer', erreurs,
    });
  }
  const image = req.file ? `/produits/${req.file.filename}` : '';
  const b = req.body;
  db.prepare(`INSERT INTO produit
    (activite_id, reference, designation, description, categorie_id, fournisseur_id, prix_achat, prix_vente,
     stock_actuel, stock_minimum, stock_maximum, unite, image, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      req.activiteId, b.reference, b.designation, b.description || '',
      b.categorie_id, b.fournisseur_id || null,
      Number(b.prix_achat || 0), Number(b.prix_vente || 0),
      Number(b.stock_actuel || 0), Number(b.stock_minimum || 5), Number(b.stock_maximum || 100),
      b.unite || 'pièce', image, b.actif ? 1 : 0,
    );
  req.flash('success', 'Produit créé avec succès.');
  res.redirect('/produits/');
});

router.get('/:id(\\d+)', (req, res) => {
  const row = db.prepare(`SELECT p.*, c.nom AS categorie_nom, f.raison_sociale AS fournisseur_nom, f.telephone AS fournisseur_tel
                          FROM produit p
                          LEFT JOIN categorie c ON c.id = p.categorie_id
                          LEFT JOIN fournisseur f ON f.id = p.fournisseur_id
                          WHERE p.id = ? AND p.activite_id = ?`).get(req.params.id, req.activiteId);
  if (!row) { req.flash('warning', 'Produit introuvable dans cette activité.'); return res.redirect('/produits/'); }
  const produit = h.enrichirProduit(row);
  produit.type_produit = h.getTypeProduit(db, produit.id);
  const mouvements = db.prepare(`SELECT m.*, u.username FROM mouvement_stock m
                                 LEFT JOIN utilisateur u ON u.id = m.utilisateur_id
                                 WHERE produit_id = ? ORDER BY date_mouvement DESC LIMIT 20`).all(req.params.id);
  res.render('produits/detail', { title: produit.designation, page_title: produit.designation, produit, mouvements, types_produit: h.TYPE_PRODUIT });
});

router.get('/:id(\\d+)/modifier', requireEcriture, (req, res) => {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!produit) return res.redirect('/produits/');
  const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
  const fournisseurs = db.prepare('SELECT * FROM fournisseur WHERE activite_id = ? ORDER BY raison_sociale').all(req.activiteId);
  // Charger la liste des suppléments existants
  const supplements = db.prepare('SELECT * FROM supplement WHERE produit_id = ? ORDER BY ordre, id').all(produit.id);
  res.render('produits/produit_form', {
    title: 'Modifier ' + produit.designation, page_title: 'Modifier ' + produit.designation,
    produit, categories, fournisseurs, supplements, mode: 'modifier', erreurs: [],
  });
});

// Sauvegarde du produit + de ses suppléments.
// Stratégie suppléments : on parse les tableaux du form et on synchronise la table :
//  - Chaque ligne du form a un id (ou vide pour un nouveau), un nom, un prix, un ordre.
//  - On UPDATE ceux qui ont un id existant, INSERT les nouveaux, DELETE ceux qui ont disparu.
function _synchroniserSupplements(produitId, body) {
  const ids     = [].concat(body.supplement_id || []);
  const noms    = [].concat(body.supplement_nom || []);
  const prix    = [].concat(body.supplement_prix || []);
  const actifs  = [].concat(body.supplement_actif || []); // checkbox — les cochés remontent, mais pas d'index de correspondance
  // On préfère utiliser un champ hidden par ligne pour actif
  const actifsHidden = [].concat(body.supplement_actif_val || []);

  const idsExistants = new Set(
    db.prepare('SELECT id FROM supplement WHERE produit_id = ?').all(produitId).map(r => r.id)
  );
  const gardes = new Set();
  const upd = db.prepare('UPDATE supplement SET nom = ?, prix = ?, ordre = ?, actif = ? WHERE id = ? AND produit_id = ?');
  const ins = db.prepare('INSERT INTO supplement (produit_id, nom, prix, ordre, actif) VALUES (?, ?, ?, ?, ?)');
  const del = db.prepare('DELETE FROM supplement WHERE id = ? AND produit_id = ?');

  for (let i = 0; i < noms.length; i++) {
    const nom = String(noms[i] || '').trim();
    if (!nom) continue;
    const pri = Math.max(0, Number(prix[i] || 0));
    const ord = i;
    const act = Number(actifsHidden[i] || 1) ? 1 : 0;
    const id = Number(ids[i] || 0);
    if (id && idsExistants.has(id)) { upd.run(nom, pri, ord, act, id, produitId); gardes.add(id); }
    else { ins.run(produitId, nom, pri, ord, act); }
  }
  // Suppression des suppléments qui ne sont plus dans le formulaire
  for (const id of idsExistants) if (!gardes.has(id)) del.run(id, produitId);
}

router.post('/:id(\\d+)/modifier', requireEcriture, upload.single('image'), (req, res) => {
  const existant = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!existant) return res.redirect('/produits/');
  const erreurs = _valider(req.body);
  if (erreurs.length) {
    const categories = db.prepare('SELECT * FROM categorie WHERE activite_id = ? ORDER BY nom').all(req.activiteId);
    const fournisseurs = db.prepare('SELECT * FROM fournisseur WHERE activite_id = ? ORDER BY raison_sociale').all(req.activiteId);
    const supplements = db.prepare('SELECT * FROM supplement WHERE produit_id = ? ORDER BY ordre, id').all(existant.id);
    return res.render('produits/produit_form', {
      title: 'Modifier produit', page_title: 'Modifier produit',
      produit: { ...existant, ...req.body }, categories, fournisseurs, supplements, mode: 'modifier', erreurs,
    });
  }
  const b = req.body;
  const image = req.file ? `/produits/${req.file.filename}` : existant.image;
  db.transaction(() => {
    db.prepare(`UPDATE produit SET reference=?, designation=?, description=?, categorie_id=?, fournisseur_id=?,
                prix_achat=?, prix_vente=?, stock_actuel=?, stock_minimum=?, stock_maximum=?, unite=?, image=?, actif=?,
                modifie_le = datetime('now') WHERE id=? AND activite_id=?`)
      .run(
        b.reference, b.designation, b.description || '',
        b.categorie_id, b.fournisseur_id || null,
        Number(b.prix_achat || 0), Number(b.prix_vente || 0),
        Number(b.stock_actuel || 0), Number(b.stock_minimum || 5), Number(b.stock_maximum || 100),
        b.unite || 'pièce', image, b.actif ? 1 : 0, req.params.id, req.activiteId,
      );
    _synchroniserSupplements(Number(req.params.id), b);
  })();
  req.flash('success', 'Produit modifié.');
  res.redirect('/produits/' + req.params.id);
});

router.get('/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!produit) return res.redirect('/produits/');
  res.render('produits/confirmer_suppression', {
    title: 'Supprimer', page_title: 'Supprimer',
    objet: produit, libelle: produit.designation, retour: '/produits/',
  });
});
router.post('/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const prod = db.prepare('SELECT designation, reference FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  try {
    db.prepare('DELETE FROM produit WHERE id = ? AND activite_id = ?').run(req.params.id, req.activiteId);
    if (prod) h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'PRODUIT_SUPPRIME',
      entite: 'produit', entite_id: Number(req.params.id),
      details: `${prod.designation} (réf ${prod.reference})` });
    req.flash('success', 'Produit supprimé.');
  } catch (e) { req.flash('error', 'Impossible : produit lié à des ventes ou mouvements.'); }
  res.redirect('/produits/');
});

// =========================================================
// CATÉGORIES
// =========================================================
router.get('/categories/', (req, res) => {
  // Exclut la catégorie technique "Services" créée pour le produit système "Frais de livraison"
  const categories = db.prepare("SELECT * FROM categorie WHERE activite_id = ? AND nom != 'Services' ORDER BY nom").all(req.activiteId);
  const debutMois = new Date();
  debutMois.setDate(1);
  const debutMoisIso = debutMois.toISOString().slice(0, 10);

  const stats = [];
  let total_produits = 0, total_stock = 0, total_valeur = 0, total_ca = 0;
  for (const c of categories) {
    const prods = db.prepare("SELECT * FROM produit WHERE categorie_id = ? AND activite_id = ? AND (reference IS NULL OR reference NOT LIKE 'FRAIS-%')").all(c.id, req.activiteId).map(h.enrichirProduit);
    const stockTotal = prods.reduce((s, p) => s + p.stock_actuel, 0);
    const valeur = prods.reduce((s, p) => s + p.valeur_stock, 0);
    const alertes = prods.filter(p => p.en_alerte || p.en_rupture).length;
    const caRow = db.prepare(`SELECT COALESCE(SUM(lv.quantite * lv.prix_unitaire), 0) AS ca
      FROM ligne_vente lv JOIN vente v ON v.id = lv.vente_id
      JOIN produit p ON p.id = lv.produit_id
      WHERE p.categorie_id = ? AND v.activite_id = ? AND date(v.date_vente) >= ?`).get(c.id, req.activiteId, debutMoisIso);
    const ca_mois = caRow ? caRow.ca : 0;
    const cs = h.categorieStyle(c.nom);
    stats.push({ categorie: { ...c, icone: cs.icone, couleur_hex: cs.couleur }, nb_produits: prods.length, stock_total: stockTotal, valeur_stock: valeur, ca_mois, nb_alertes: alertes });
    total_produits += prods.length; total_stock += stockTotal; total_valeur += valeur; total_ca += ca_mois;
  }
  res.render('produits/categories', {
    title: 'Catégories', page_title: `Catégories — ${req.activite.nom}`,
    stats, total_categories: stats.length, total_produits, total_stock, total_valeur, total_ca,
  });
});

router.get('/categories/nouveau', requireEcriture, (req, res) => {
  res.render('produits/formulaire', { title: 'Nouvelle catégorie', page_title: 'Nouvelle catégorie', entite: {}, mode: 'creer', kind: 'categorie', erreurs: [] });
});
router.post('/categories/nouveau', requireEcriture, (req, res) => {
  const { nom, description = '' } = req.body;
  if (!nom) return res.render('produits/formulaire', { title: 'Nouvelle catégorie', page_title: 'Nouvelle catégorie', entite: req.body, mode: 'creer', kind: 'categorie', erreurs: ['Le nom est requis'] });
  db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)').run(req.activiteId, nom, description);
  req.flash('success', 'Catégorie créée.');
  res.redirect('/produits/categories/');
});
router.get('/categories/:id(\\d+)/modifier', requireEcriture, (req, res) => {
  const entite = db.prepare('SELECT * FROM categorie WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!entite) return res.redirect('/produits/categories/');
  res.render('produits/formulaire', { title: 'Modifier catégorie', page_title: 'Modifier catégorie', entite, mode: 'modifier', kind: 'categorie', erreurs: [] });
});
router.post('/categories/:id(\\d+)/modifier', requireEcriture, (req, res) => {
  db.prepare('UPDATE categorie SET nom = ?, description = ? WHERE id = ? AND activite_id = ?')
    .run(req.body.nom, req.body.description || '', req.params.id, req.activiteId);
  req.flash('success', 'Catégorie modifiée.');
  res.redirect('/produits/categories/');
});
router.get('/categories/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const entite = db.prepare('SELECT * FROM categorie WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!entite) return res.redirect('/produits/categories/');
  res.render('produits/confirmer_suppression', { title: 'Supprimer catégorie', page_title: 'Supprimer catégorie', objet: entite, libelle: entite.nom, retour: '/produits/categories/' });
});
router.post('/categories/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const cat = db.prepare('SELECT nom FROM categorie WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  try {
    db.prepare('DELETE FROM categorie WHERE id = ? AND activite_id = ?').run(req.params.id, req.activiteId);
    if (cat) h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'CATEGORIE_SUPPRIMEE',
      entite: 'categorie', entite_id: Number(req.params.id), details: cat.nom });
    req.flash('success', 'Catégorie supprimée.');
  } catch (e) { req.flash('error', 'Catégorie utilisée par des produits.'); }
  res.redirect('/produits/categories/');
});

// =========================================================
// FOURNISSEURS
// =========================================================
router.get('/fournisseurs/', (req, res) => {
  const q = (req.query.q || '').trim();
  const statut = req.query.statut || '';
  const filtres = ['activite_id = ?'];
  const params = [req.activiteId];
  if (q) { filtres.push('(raison_sociale LIKE ? OR contact LIKE ? OR telephone LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (statut === 'actif') filtres.push('actif = 1');
  else if (statut === 'inactif') filtres.push('actif = 0');
  const fournisseurs = db.prepare(`SELECT * FROM fournisseur WHERE ${filtres.join(' AND ')} ORDER BY raison_sociale`).all(...params);
  const stats = [];
  let total_actifs = 0, total_valeur = 0, total_produits = 0;
  for (const f of fournisseurs) {
    const prods = db.prepare('SELECT * FROM produit WHERE fournisseur_id = ? AND activite_id = ?').all(f.id, req.activiteId).map(h.enrichirProduit);
    const valeur = prods.reduce((s, p) => s + p.valeur_stock, 0);
    const alertes = prods.filter(p => p.en_alerte || p.en_rupture).length;
    stats.push({ fournisseur: f, nb_produits: prods.length, valeur_stock: valeur, nb_alertes: alertes });
    if (f.actif) total_actifs++;
    total_valeur += valeur;
    total_produits += prods.length;
  }
  res.render('produits/fournisseurs', {
    title: 'Fournisseurs', page_title: `Fournisseurs — ${req.activite.nom}`,
    stats, total_fournisseurs: stats.length, total_actifs, total_valeur, total_produits,
    q, statut_filtre: statut,
  });
});

router.get('/fournisseurs/nouveau', requireEcriture, (req, res) => {
  res.render('produits/formulaire', {
    title: 'Nouveau fournisseur', page_title: 'Nouveau fournisseur',
    entite: { actif: 1, delai_livraison_jours: 7 }, mode: 'creer', kind: 'fournisseur', erreurs: [],
  });
});
router.post('/fournisseurs/nouveau', requireEcriture, (req, res) => {
  const b = req.body;
  db.prepare(`INSERT INTO fournisseur (activite_id, raison_sociale, contact, telephone, email, adresse, delai_livraison_jours, actif)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.activiteId, b.raison_sociale, b.contact || '', b.telephone || '', b.email || '', b.adresse || '',
         Number(b.delai_livraison_jours || 7), b.actif ? 1 : 0);
  req.flash('success', 'Fournisseur créé.');
  res.redirect('/produits/fournisseurs/');
});
router.get('/fournisseurs/:id(\\d+)', (req, res) => {
  const fournisseur = db.prepare('SELECT * FROM fournisseur WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!fournisseur) return res.redirect('/produits/fournisseurs/');
  const produits = db.prepare(`SELECT p.*, c.nom AS categorie_nom FROM produit p
                               LEFT JOIN categorie c ON c.id = p.categorie_id
                               WHERE p.fournisseur_id = ? AND p.activite_id = ? ORDER BY p.designation`)
                     .all(req.params.id, req.activiteId).map(h.enrichirProduit);
  const valeur_totale = produits.reduce((s, p) => s + p.valeur_stock, 0);
  const nb_alertes = produits.filter(p => p.en_alerte || p.en_rupture).length;
  const stock_total = produits.reduce((s, p) => s + p.stock_actuel, 0);
  const receptions = db.prepare(`SELECT m.*, p.designation FROM mouvement_stock m
                                 JOIN produit p ON p.id = m.produit_id
                                 WHERE p.fournisseur_id = ? AND m.type = 'ENTREE' AND m.activite_id = ?
                                 ORDER BY m.date_mouvement DESC LIMIT 15`).all(req.params.id, req.activiteId);
  res.render('produits/fournisseur_detail', {
    title: fournisseur.raison_sociale, page_title: fournisseur.raison_sociale,
    fournisseur, produits, nb_produits: produits.length, valeur_totale, stock_total, nb_alertes, receptions,
  });
});
router.get('/fournisseurs/:id(\\d+)/modifier', requireEcriture, (req, res) => {
  const entite = db.prepare('SELECT * FROM fournisseur WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!entite) return res.redirect('/produits/fournisseurs/');
  res.render('produits/formulaire', { title: 'Modifier fournisseur', page_title: 'Modifier fournisseur', entite, mode: 'modifier', kind: 'fournisseur', erreurs: [] });
});
router.post('/fournisseurs/:id(\\d+)/modifier', requireEcriture, (req, res) => {
  const b = req.body;
  db.prepare(`UPDATE fournisseur SET raison_sociale=?, contact=?, telephone=?, email=?, adresse=?,
              delai_livraison_jours=?, actif=? WHERE id=? AND activite_id=?`)
    .run(b.raison_sociale, b.contact || '', b.telephone || '', b.email || '', b.adresse || '',
         Number(b.delai_livraison_jours || 7), b.actif ? 1 : 0, req.params.id, req.activiteId);
  req.flash('success', 'Fournisseur modifié.');
  res.redirect('/produits/fournisseurs/');
});
router.get('/fournisseurs/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const entite = db.prepare('SELECT * FROM fournisseur WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!entite) return res.redirect('/produits/fournisseurs/');
  res.render('produits/confirmer_suppression', { title: 'Supprimer fournisseur', page_title: 'Supprimer fournisseur', objet: entite, libelle: entite.raison_sociale, retour: '/produits/fournisseurs/' });
});
router.post('/fournisseurs/:id(\\d+)/supprimer', requireEcriture, (req, res) => {
  const f = db.prepare('SELECT raison_sociale FROM fournisseur WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  try {
    db.prepare('DELETE FROM fournisseur WHERE id = ? AND activite_id = ?').run(req.params.id, req.activiteId);
    if (f) h.journaliser(db, { user: req.user, activiteId: req.activiteId, action: 'FOURNISSEUR_SUPPRIME',
      entite: 'fournisseur', entite_id: Number(req.params.id), details: f.raison_sociale });
    req.flash('success', 'Fournisseur supprimé.');
  } catch (e) { req.flash('error', 'Fournisseur lié à des produits.'); }
  res.redirect('/produits/fournisseurs/');
});

// =========================================================
// IMPORT EXCEL — PRODUITS
// =========================================================
function colonnesProduits() {
  return [
    { header: 'Référence', key: 'reference', width: 14, note: 'Laisser vide pour auto-générer (ex : PRO-0001)' },
    { header: 'Désignation', key: 'designation', width: 32, required: true },
    { header: 'Catégorie', key: 'categorie', width: 20, required: true, note: 'Doit exister ou sera créée automatiquement' },
    { header: 'Fournisseur', key: 'fournisseur', width: 22, note: 'Laisser vide ou nom exact d\'un fournisseur existant' },
    { header: 'Prix achat (FCFA)', key: 'prix_achat', width: 15, type: 'number' },
    { header: 'Prix vente (FCFA)', key: 'prix_vente', width: 15, type: 'number' },
    { header: 'Stock actuel', key: 'stock_actuel', width: 12, type: 'number' },
    { header: 'Stock minimum', key: 'stock_minimum', width: 13, type: 'number' },
    { header: 'Stock maximum', key: 'stock_maximum', width: 13, type: 'number' },
    { header: 'Unité', key: 'unite', width: 12, options: ['pièce', 'kg', 'g', 'litre', 'ml', 'carton', 'paquet', 'sac', 'sachet', 'plaque', 'barquette', 'bouteille'] },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Actif', key: 'actif', width: 8, options: ['Oui', 'Non'] },
  ];
}

router.get('/import/modele', requireEcriture, async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Produits',
    colonnes: colonnesProduits(),
    lignes_exemple: [
      { designation: 'Barquette repas 750ml', categorie: 'Emballages', fournisseur: '', prix_achat: 150, prix_vente: 200, stock_actuel: 50, stock_minimum: 20, stock_maximum: 200, unite: 'pièce', actif: 'Oui' },
      { designation: 'Beurre plaque 500g', categorie: 'Frais', prix_achat: 2500, prix_vente: 3000, stock_actuel: 10, stock_minimum: 5, stock_maximum: 30, unite: 'plaque', actif: 'Oui' },
    ],
    instructions: [
      `Activité de destination : ${req.activite.nom}`,
      '',
      'Colonnes obligatoires (*) : Désignation, Catégorie.',
      '',
      '• Référence : laissez vide pour que le système génère automatiquement (PRO-0001, PRO-0002…).',
      '• Catégorie : si elle n\'existe pas, elle sera créée automatiquement dans cette activité.',
      '• Fournisseur : facultatif. S\'il est renseigné, il doit correspondre exactement à un fournisseur existant.',
      '• Prix : en FCFA, sans décimales, sans espaces (ex : 1500 et non 1 500).',
      '• Unité : choisissez dans la liste déroulante (pièce, kg, litre…).',
      '• Actif : "Oui" pour vendre le produit, "Non" pour le désactiver.',
      '',
      'Après remplissage, retournez sur "Importer des produits" et téléversez ce fichier.',
      'Un aperçu vous sera affiché avant validation définitive.',
    ],
  });
  const dt = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_produits_${req.activite.nom.replace(/\s+/g, '_')}_${dt}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/import', requireEcriture, (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer des produits', page_title: 'Importer des produits',
    apercu: null, erreurs: [], type_import: 'produits',
    url_modele: '/produits/import/modele', url_upload: '/produits/import/apercu', url_confirmer: '/produits/import/confirmer',
    url_retour: '/produits/',
  });
});

router.post('/import/apercu', requireEcriture, uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/produits/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesProduits() });
    // Détection de doublons : construire une map normalisée des produits existants
    const produitsExistants = db.prepare('SELECT id, designation FROM produit WHERE activite_id = ?').all(req.activiteId);
    const mapExistants = new Map(produitsExistants.map(p => [h.normaliserNom(p.designation), p]));
    // Détection de doublons INTRA-fichier
    const dansFichier = new Map();
    for (const l of lignes) {
      if (!l.designation) continue;
      const key = h.normaliserNom(l.designation);
      if (mapExistants.has(key)) {
        l.__doublon = { type: 'existant', existant: mapExistants.get(key) };
      } else if (dansFichier.has(key)) {
        l.__doublon = { type: 'fichier', ligne: dansFichier.get(key) };
      } else {
        dansFichier.set(key, l.__ligne_excel);
      }
    }
    req.session.import_produits = { lignes, activiteId: req.activiteId };
    res.render('produits/import_excel', {
      title: 'Aperçu import produits', page_title: 'Aperçu import produits',
      apercu: lignes, erreurs, type_import: 'produits',
      url_modele: '/produits/import/modele', url_upload: '/produits/import/apercu', url_confirmer: '/produits/import/confirmer',
      url_retour: '/produits/',
    });
  } catch (e) {
    req.flash('error', 'Fichier illisible : ' + e.message);
    res.redirect('/produits/import');
  }
});

router.post('/import/confirmer', requireEcriture, (req, res) => {
  const data = req.session.import_produits;
  if (!data || data.activiteId !== req.activiteId) { req.flash('warning', 'Session expirée, recommencez l\'import.'); return res.redirect('/produits/import'); }

  const insertProduit = db.prepare(`INSERT INTO produit
    (activite_id, reference, designation, description, categorie_id, fournisseur_id, prix_achat, prix_vente,
     stock_actuel, stock_minimum, stock_maximum, unite, image, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCategorie = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)');

  // Construire des maps normalisées pour comparaison insensible casse/accents
  const catExistantes = db.prepare('SELECT id, nom FROM categorie WHERE activite_id = ?').all(req.activiteId);
  const mapCat = new Map(catExistantes.map(c => [h.normaliserNom(c.nom), c.id]));
  const foursExistants = db.prepare('SELECT id, raison_sociale FROM fournisseur WHERE activite_id = ?').all(req.activiteId);
  const mapFour = new Map(foursExistants.map(f => [h.normaliserNom(f.raison_sociale), f.id]));
  const prodsExistants = db.prepare('SELECT id, designation FROM produit WHERE activite_id = ?').all(req.activiteId);
  const mapProd = new Map(prodsExistants.map(p => [h.normaliserNom(p.designation), p]));
  // Suivi des produits créés durant l'import pour éviter les doublons intra-fichier
  const dansImport = new Set();

  let crees = 0, ignores = 0;
  const problemes = [];

  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) { ignores++; problemes.push(...l.__erreurs); continue; }
    // Doublon désignation (existant OU dans le fichier) ?
    const keyProd = h.normaliserNom(l.designation);
    if (mapProd.has(keyProd)) {
      ignores++;
      const existant = mapProd.get(keyProd);
      problemes.push(`ligne ${l.__ligne_excel} : « ${l.designation} » existe déjà comme « ${existant.designation} » — ignoré`);
      continue;
    }
    if (dansImport.has(keyProd)) {
      ignores++;
      problemes.push(`ligne ${l.__ligne_excel} : « ${l.designation} » présent en double dans le fichier — ignoré`);
      continue;
    }
    dansImport.add(keyProd);
    // Catégorie (comparaison sans casse/accents ; création si absente)
    const keyCat = h.normaliserNom(l.categorie);
    let catId = mapCat.get(keyCat);
    if (!catId) {
      const info = insertCategorie.run(req.activiteId, String(l.categorie), '');
      catId = Number(info.lastInsertRowid);
      mapCat.set(keyCat, catId);
    }
    // Fournisseur (optionnel)
    let fournId = null;
    if (l.fournisseur) {
      const keyFour = h.normaliserNom(l.fournisseur);
      if (mapFour.has(keyFour)) fournId = mapFour.get(keyFour);
      else problemes.push(`ligne ${l.__ligne_excel} : fournisseur « ${l.fournisseur} » introuvable — laissé vide`);
    }
    const ref = (l.reference && String(l.reference).trim()) || h.prochaineReferenceProduit(db, req.activiteId);
    const actif = (l.actif == null || String(l.actif).toLowerCase() === 'oui' || l.actif === 1 || l.actif === true) ? 1 : 0;
    insertProduit.run(
      req.activiteId, String(ref), String(l.designation), String(l.description || ''),
      catId, fournId,
      Number(l.prix_achat || 0), Number(l.prix_vente || 0),
      Number(l.stock_actuel || 0), Number(l.stock_minimum || 5), Number(l.stock_maximum || 100),
      String(l.unite || 'pièce'), '', actif,
    );
    crees++;
  }

  delete req.session.import_produits;
  if (crees) req.flash('success', `${crees} produit(s) importé(s) avec succès.`);
  if (ignores) req.flash('warning', `${ignores} ligne(s) ignorée(s). Détails : ${problemes.slice(0, 5).join(' ; ')}${problemes.length > 5 ? '…' : ''}`);
  res.redirect('/produits/');
});

// =========================================================
// IMPORT EXCEL — CATÉGORIES
// =========================================================
function colonnesCategories() {
  return [
    { header: 'Nom', key: 'nom', width: 25, required: true },
    { header: 'Description', key: 'description', width: 50 },
  ];
}

router.get('/categories/import/modele', requireEcriture, async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Catégories',
    colonnes: colonnesCategories(),
    lignes_exemple: [
      { nom: 'Frais', description: 'Produits frais réfrigérés' },
      { nom: 'Emballages', description: 'Emballages jetables (barquettes, gobelets…)' },
    ],
    instructions: [
      `Activité de destination : ${req.activite.nom}`,
      'Seul le nom est obligatoire. La description est facultative.',
      'Les catégories déjà existantes (même nom, insensible à la casse) seront ignorées.',
    ],
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_categories_${req.activite.nom.replace(/\s+/g, '_')}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/categories/import', requireEcriture, (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer des catégories', page_title: 'Importer des catégories',
    apercu: null, erreurs: [], type_import: 'catégories',
    url_modele: '/produits/categories/import/modele', url_upload: '/produits/categories/import/apercu', url_confirmer: '/produits/categories/import/confirmer',
    url_retour: '/produits/categories/',
  });
});

router.post('/categories/import/apercu', requireEcriture, uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/produits/categories/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesCategories() });
    // Détection doublons (existants + intra-fichier)
    const existantes = db.prepare('SELECT id, nom FROM categorie WHERE activite_id = ?').all(req.activiteId);
    const mapExistantes = new Map(existantes.map(c => [h.normaliserNom(c.nom), c]));
    const dansFichier = new Map();
    for (const l of lignes) {
      if (!l.nom) continue;
      const key = h.normaliserNom(l.nom);
      if (mapExistantes.has(key)) l.__doublon = { type: 'existant', existant: mapExistantes.get(key) };
      else if (dansFichier.has(key)) l.__doublon = { type: 'fichier', ligne: dansFichier.get(key) };
      else dansFichier.set(key, l.__ligne_excel);
    }
    req.session.import_categories = { lignes, activiteId: req.activiteId };
    res.render('produits/import_excel', {
      title: 'Aperçu import catégories', page_title: 'Aperçu import catégories',
      apercu: lignes, erreurs, type_import: 'catégories',
      url_modele: '/produits/categories/import/modele', url_upload: '/produits/categories/import/apercu', url_confirmer: '/produits/categories/import/confirmer',
      url_retour: '/produits/categories/',
    });
  } catch (e) { req.flash('error', 'Fichier illisible : ' + e.message); res.redirect('/produits/categories/import'); }
});

router.post('/categories/import/confirmer', requireEcriture, (req, res) => {
  const data = req.session.import_categories;
  if (!data || data.activiteId !== req.activiteId) { req.flash('warning', 'Session expirée.'); return res.redirect('/produits/categories/import'); }
  const insertCat = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)');
  const existantes = db.prepare('SELECT nom FROM categorie WHERE activite_id = ?').all(req.activiteId);
  const mapEx = new Set(existantes.map(c => h.normaliserNom(c.nom)));
  const dansImport = new Set();
  let crees = 0, ignores = 0;
  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) { ignores++; continue; }
    const key = h.normaliserNom(l.nom);
    if (mapEx.has(key) || dansImport.has(key)) { ignores++; continue; }
    dansImport.add(key);
    insertCat.run(req.activiteId, String(l.nom), String(l.description || ''));
    crees++;
  }
  delete req.session.import_categories;
  if (crees) req.flash('success', `${crees} catégorie(s) importée(s).`);
  if (ignores) req.flash('warning', `${ignores} ligne(s) ignorée(s) (déjà existantes, doublons ou invalides).`);
  res.redirect('/produits/categories/');
});

// =========================================================
// IMPORT EXCEL — FOURNISSEURS
// =========================================================
function colonnesFournisseurs() {
  return [
    { header: 'Raison sociale', key: 'raison_sociale', width: 28, required: true },
    { header: 'Contact', key: 'contact', width: 22 },
    { header: 'Téléphone', key: 'telephone', width: 16 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Adresse', key: 'adresse', width: 36 },
    { header: 'Délai livraison (jours)', key: 'delai_livraison_jours', width: 12, type: 'number' },
    { header: 'Actif', key: 'actif', width: 8, options: ['Oui', 'Non'] },
  ];
}

router.get('/fournisseurs/import/modele', requireEcriture, async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Fournisseurs',
    colonnes: colonnesFournisseurs(),
    lignes_exemple: [
      { raison_sociale: 'MARCHÉ MOKOLO', contact: 'M. Mbarga', telephone: '699 000 000', email: '', adresse: 'Yaoundé', delai_livraison_jours: 1, actif: 'Oui' },
      { raison_sociale: 'SODECOTON', contact: 'Mme Ngo', telephone: '677 111 222', email: 'contact@sodecoton.cm', adresse: 'Douala', delai_livraison_jours: 3, actif: 'Oui' },
    ],
    instructions: [
      `Activité de destination : ${req.activite.nom}`,
      'Seule la raison sociale est obligatoire.',
      'Délai livraison : en jours, entier (ex : 7). Vide = 7 par défaut.',
      'Actif : "Oui" (par défaut) ou "Non".',
    ],
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_fournisseurs_${req.activite.nom.replace(/\s+/g, '_')}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/fournisseurs/import', requireEcriture, (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer des fournisseurs', page_title: 'Importer des fournisseurs',
    apercu: null, erreurs: [], type_import: 'fournisseurs',
    url_modele: '/produits/fournisseurs/import/modele', url_upload: '/produits/fournisseurs/import/apercu', url_confirmer: '/produits/fournisseurs/import/confirmer',
    url_retour: '/produits/fournisseurs/',
  });
});

router.post('/fournisseurs/import/apercu', requireEcriture, uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/produits/fournisseurs/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesFournisseurs() });
    const existants = db.prepare('SELECT id, raison_sociale FROM fournisseur WHERE activite_id = ?').all(req.activiteId);
    const mapExistants = new Map(existants.map(f => [h.normaliserNom(f.raison_sociale), f]));
    const dansFichier = new Map();
    for (const l of lignes) {
      if (!l.raison_sociale) continue;
      const key = h.normaliserNom(l.raison_sociale);
      if (mapExistants.has(key)) l.__doublon = { type: 'existant', existant: mapExistants.get(key) };
      else if (dansFichier.has(key)) l.__doublon = { type: 'fichier', ligne: dansFichier.get(key) };
      else dansFichier.set(key, l.__ligne_excel);
    }
    req.session.import_fournisseurs = { lignes, activiteId: req.activiteId };
    res.render('produits/import_excel', {
      title: 'Aperçu import fournisseurs', page_title: 'Aperçu import fournisseurs',
      apercu: lignes, erreurs, type_import: 'fournisseurs',
      url_modele: '/produits/fournisseurs/import/modele', url_upload: '/produits/fournisseurs/import/apercu', url_confirmer: '/produits/fournisseurs/import/confirmer',
      url_retour: '/produits/fournisseurs/',
    });
  } catch (e) { req.flash('error', 'Fichier illisible : ' + e.message); res.redirect('/produits/fournisseurs/import'); }
});

router.post('/fournisseurs/import/confirmer', requireEcriture, (req, res) => {
  const data = req.session.import_fournisseurs;
  if (!data || data.activiteId !== req.activiteId) { req.flash('warning', 'Session expirée.'); return res.redirect('/produits/fournisseurs/import'); }
  const insertF = db.prepare(`INSERT INTO fournisseur (activite_id, raison_sociale, contact, telephone, email, adresse, delai_livraison_jours, actif)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const existants = db.prepare('SELECT raison_sociale FROM fournisseur WHERE activite_id = ?').all(req.activiteId);
  const mapEx = new Set(existants.map(f => h.normaliserNom(f.raison_sociale)));
  const dansImport = new Set();
  let crees = 0, ignores = 0;
  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) { ignores++; continue; }
    const key = h.normaliserNom(l.raison_sociale);
    if (mapEx.has(key) || dansImport.has(key)) { ignores++; continue; }
    dansImport.add(key);
    const actif = (l.actif == null || String(l.actif).toLowerCase() === 'oui') ? 1 : 0;
    insertF.run(req.activiteId, String(l.raison_sociale), String(l.contact || ''), String(l.telephone || ''),
                String(l.email || ''), String(l.adresse || ''), Number(l.delai_livraison_jours || 7), actif);
    crees++;
  }
  delete req.session.import_fournisseurs;
  if (crees) req.flash('success', `${crees} fournisseur(s) importé(s).`);
  if (ignores) req.flash('warning', `${ignores} ligne(s) ignorée(s) (déjà existants, doublons ou invalides).`);
  res.redirect('/produits/fournisseurs/');
});

// =========================================================
// TOP VENTES — Analyse des produits les plus vendus
// =========================================================
router.get('/analytics/ventes-produits', (req, res) => {
  // Filtre période (par défaut : 30 derniers jours)
  const preset = (req.query.preset || '30j').toLowerCase();
  const now = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  let debut, fin;
  if (req.query.debut && req.query.fin) {
    debut = req.query.debut; fin = req.query.fin;
  } else if (preset === '7j') { debut = iso(new Date(Date.now() - 6 * 86400000)); fin = iso(now); }
  else if (preset === 'mois') { const d = new Date(now.getFullYear(), now.getMonth(), 1); debut = iso(d); fin = iso(now); }
  else if (preset === 'mois_precedent') {
    const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
    debut = iso(d1); fin = iso(d2);
  } else if (preset === 'annee') { debut = `${now.getFullYear()}-01-01`; fin = iso(now); }
  else { debut = iso(new Date(Date.now() - 29 * 86400000)); fin = iso(now); }

  // Top produits vendus (via ligne_vente sur la période)
  const topB2C = db.prepare(`
    SELECT p.id, p.designation, p.reference, p.unite, p.prix_vente, p.prix_achat,
           a.nom AS activite_nom, a.couleur AS activite_couleur,
           SUM(lv.quantite) AS qte_totale,
           COUNT(DISTINCT v.id) AS nb_ventes,
           SUM(lv.quantite * lv.prix_unitaire - COALESCE(lv.remise, 0)) AS ca_ht,
           (SELECT COUNT(*) FROM fiche_technique ft WHERE ft.produit_id = p.id AND ft.actif = 1) AS a_fiche
    FROM ligne_vente lv
    JOIN vente v ON v.id = lv.vente_id
    JOIN produit p ON p.id = lv.produit_id
    JOIN activite a ON a.id = v.activite_id
    WHERE date(v.date_vente) BETWEEN ? AND ?
    GROUP BY p.id ORDER BY ca_ht DESC LIMIT 30`).all(debut, fin);

  // Top produits vendus en B2B (via ligne_commande sur commandes payées)
  const topB2B = db.prepare(`
    SELECT p.id, p.designation, p.reference, p.unite, p.prix_vente,
           a.nom AS activite_nom, a.couleur AS activite_couleur,
           SUM(lc.quantite) AS qte_totale,
           COUNT(DISTINCT c.id) AS nb_ventes,
           SUM(lc.quantite * lc.prix_unitaire - COALESCE(lc.remise, 0)) AS ca_ht
    FROM ligne_commande lc
    JOIN commande c ON c.id = lc.commande_id
    JOIN produit p ON p.id = lc.produit_id
    JOIN activite a ON a.id = c.activite_id
    WHERE c.statut IN ('LIVREE', 'FACTUREE', 'PAYEE')
      AND date(c.date_commande) BETWEEN ? AND ?
    GROUP BY p.id ORDER BY ca_ht DESC LIMIT 30`).all(debut, fin);

  // KPIs globaux (B2C + B2B additionnés)
  const totalCA_B2C = topB2C.reduce((s, p) => s + Number(p.ca_ht), 0);
  const totalCA_B2B = topB2B.reduce((s, p) => s + Number(p.ca_ht), 0);
  const nbProduitsUniques = new Set([...topB2C.map(p => p.id), ...topB2B.map(p => p.id)]).size;

  // Répartition par activité
  const parActivite = new Map();
  for (const p of topB2C) {
    const k = p.activite_nom;
    if (!parActivite.has(k)) parActivite.set(k, { nom: k, couleur: p.activite_couleur, ca: 0, qte: 0 });
    parActivite.get(k).ca += Number(p.ca_ht);
    parActivite.get(k).qte += Number(p.qte_totale);
  }
  for (const p of topB2B) {
    const k = p.activite_nom;
    if (!parActivite.has(k)) parActivite.set(k, { nom: k, couleur: p.activite_couleur, ca: 0, qte: 0 });
    parActivite.get(k).ca += Number(p.ca_ht);
    parActivite.get(k).qte += Number(p.qte_totale);
  }

  // Calcul part du CA
  const total = totalCA_B2C + totalCA_B2B;
  const enrichir = (rows, totalCA) => rows.map(r => ({
    ...r,
    qte_totale: Number(r.qte_totale),
    nb_ventes: Number(r.nb_ventes),
    ca_ht: Number(r.ca_ht),
    part_pct: totalCA > 0 ? Math.round(Number(r.ca_ht) / totalCA * 100 * 10) / 10 : 0,
    a_fiche: Number(r.a_fiche || 0) > 0,
  }));

  res.render('produits/analytics_ventes', {
    title: 'Top produits vendus', page_title: 'Top produits vendus',
    topB2C: enrichir(topB2C, totalCA_B2C),
    topB2B: enrichir(topB2B, totalCA_B2B),
    parActivite: Array.from(parActivite.values()).sort((a, b) => b.ca - a.ca),
    kpi: { totalCA_B2C, totalCA_B2B, totalCA: total, nbProduitsUniques },
    periode: { preset, debut, fin },
  });
});

// API : recherche produit (autocomplétion) — pour éviter les doublons à la création
router.get('/api/rechercher', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rows = db.prepare(`SELECT p.id, p.reference, p.designation, p.unite, p.prix_vente, p.stock_actuel,
                                  c.nom AS categorie_nom
                           FROM produit p LEFT JOIN categorie c ON c.id = p.categorie_id
                           WHERE p.activite_id = ? AND p.designation LIKE ?
                           ORDER BY p.designation LIMIT 8`).all(req.activiteId, `%${q}%`);
  res.json(rows);
});

// API : recherche catégorie (autocomplétion anti-doublon)
router.get('/api/rechercher-categorie', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rows = db.prepare(`SELECT c.id, c.nom, c.description,
                                  (SELECT COUNT(*) FROM produit WHERE categorie_id = c.id) AS nb_produits
                           FROM categorie c
                           WHERE c.activite_id = ? AND c.nom LIKE ?
                           ORDER BY c.nom LIMIT 8`).all(req.activiteId, `%${q}%`);
  res.json(rows);
});

// API : recherche fournisseur (autocomplétion anti-doublon)
router.get('/api/rechercher-fournisseur', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const rows = db.prepare(`SELECT f.id, f.raison_sociale, f.contact, f.telephone, f.email,
                                  (SELECT COUNT(*) FROM produit WHERE fournisseur_id = f.id) AS nb_produits
                           FROM fournisseur f
                           WHERE f.activite_id = ? AND f.raison_sociale LIKE ?
                           ORDER BY f.raison_sociale LIMIT 8`).all(req.activiteId, `%${q}%`);
  res.json(rows);
});

// API : création rapide de catégorie
router.post('/api/categorie-rapide', requireEcriture, express.json(), (req, res) => {
  const nom = String(req.body.nom || '').trim();
  if (!nom) return res.status(400).json({ erreur: 'Nom obligatoire' });
  const dup = db.prepare('SELECT id, nom FROM categorie WHERE activite_id = ? AND LOWER(nom) = LOWER(?)').get(req.activiteId, nom);
  if (dup) return res.json({ id: dup.id, nom: dup.nom, deja_existant: true });
  const info = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)')
                 .run(req.activiteId, nom, req.body.description || '');
  res.json({ id: Number(info.lastInsertRowid), nom, deja_existant: false });
});

// API : création rapide de fournisseur
router.post('/api/fournisseur-rapide', requireEcriture, express.json(), (req, res) => {
  const raison = String(req.body.raison_sociale || '').trim();
  if (!raison) return res.status(400).json({ erreur: 'Raison sociale obligatoire' });
  const dup = db.prepare('SELECT id, raison_sociale FROM fournisseur WHERE activite_id = ? AND LOWER(raison_sociale) = LOWER(?)').get(req.activiteId, raison);
  if (dup) return res.json({ id: dup.id, raison_sociale: dup.raison_sociale, deja_existant: true });
  const info = db.prepare(`INSERT INTO fournisseur (activite_id, raison_sociale, contact, telephone, email, adresse, delai_livraison_jours, actif)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(req.activiteId, raison, req.body.contact || '', req.body.telephone || '', req.body.email || '',
         req.body.adresse || '', Number(req.body.delai_livraison_jours || 7));
  res.json({ id: Number(info.lastInsertRowid), raison_sociale: raison, deja_existant: false });
});

// API : création rapide d'un ingrédient (depuis la fiche technique)
router.post('/api/ingredient-rapide', requireEcriture, express.json(), (req, res) => {
  const b = req.body || {};
  const designation = String(b.designation || '').trim();
  if (!designation) return res.status(400).json({ erreur: 'Désignation obligatoire' });
  const unite = String(b.unite || 'pièce').trim() || 'pièce';
  const prix_achat = Math.round(Number(b.prix_achat || 0));
  const stock_actuel = Number(b.stock_actuel || 0);
  const categorieNom = String(b.categorie || 'Ingrédients').trim() || 'Ingrédients';
  try {
    // Vérifier / créer catégorie "Ingrédients"
    let cat = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND LOWER(nom) = LOWER(?)').get(req.activiteId, categorieNom);
    if (!cat) {
      const info = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)').run(req.activiteId, categorieNom, 'Ingrédients cuisine');
      cat = { id: Number(info.lastInsertRowid) };
    }
    // Doublon ?
    const dup = db.prepare('SELECT id FROM produit WHERE activite_id = ? AND LOWER(designation) = LOWER(?)').get(req.activiteId, designation);
    if (dup) return res.json({ id: dup.id, designation, deja_existant: true });
    const reference = h.prochaineReferenceProduit(db, req.activiteId);
    const info = db.prepare(`INSERT INTO produit
      (activite_id, reference, designation, categorie_id, prix_achat, prix_vente, stock_actuel, stock_minimum, stock_maximum, unite, actif)
      VALUES (?, ?, ?, ?, ?, 0, ?, 0, 999999, ?, 1)`)
      .run(req.activiteId, reference, designation, cat.id, prix_achat, stock_actuel, unite);
    res.json({ id: Number(info.lastInsertRowid), designation, reference, unite, prix_achat, stock_actuel, deja_existant: false });
  } catch (e) { console.error(e); res.status(400).json({ erreur: e.message }); }
});

// =========================================================
// FICHES TECHNIQUES (recettes) — un produit fini = X ingrédients
// =========================================================
router.get('/:id(\\d+)/fiche-technique', (req, res) => {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!produit) { req.flash('warning', 'Produit introuvable.'); return res.redirect('/produits/'); }
  let fiche = db.prepare('SELECT * FROM fiche_technique WHERE produit_id = ?').get(produit.id);
  const composition = fiche
    ? db.prepare(`SELECT cf.*, p.designation AS ingredient_nom, p.reference AS ingredient_ref, p.unite AS ingredient_unite, p.stock_actuel AS ingredient_stock, p.prix_achat AS ingredient_prix_achat
                  FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                  WHERE cf.fiche_id = ? ORDER BY p.designation`).all(fiche.id)
    : [];
  // Liste des ingrédients potentiels : produits actifs de la MÊME activité
  const ingredientsDispo = db.prepare(`SELECT id, designation, reference, unite, stock_actuel, prix_achat
                                       FROM produit WHERE activite_id = ? AND actif = 1 AND id != ?
                                       ORDER BY designation`).all(req.activiteId, produit.id);
  const coutMatiere = composition.reduce((s, c) => s + (Number(c.quantite) * Number(c.ingredient_prix_achat || 0)), 0);
  // Historique récent des productions de ce produit fini
  const historique = fiche ? db.prepare(`SELECT p.id, p.numero, p.date_production, p.date_fin, p.statut, p.quantite_produite,
                                                p.cout_matiere, p.motif_annulation,
                                                u.first_name AS auteur_prenom, u.username AS auteur_username
                                         FROM production p LEFT JOIN utilisateur u ON u.id = p.produit_par_id
                                         WHERE p.produit_id = ? AND p.activite_id = ?
                                         ORDER BY p.date_production DESC LIMIT 10`).all(produit.id, req.activiteId) : [];
  // Statistiques de production sur 90j (rendement moyen, taux de perte)
  const stats90j = fiche ? db.prepare(`SELECT COUNT(*) AS nb,
                                              COALESCE(SUM(quantite_produite), 0) AS qte_totale,
                                              COALESCE(SUM(CASE WHEN motif_annulation LIKE 'Perte cuisson%' OR motif_annulation LIKE 'Annulation perte totale%' THEN 1 ELSE 0 END), 0) AS nb_pertes
                                       FROM production
                                       WHERE produit_id = ? AND activite_id = ?
                                         AND date(date_production) >= date('now','-90 day')
                                         AND statut IN ('TERMINEE','ANNULEE')`).get(produit.id, req.activiteId) : { nb: 0, qte_totale: 0, nb_pertes: 0 };
  const peutModifier = h.isDG(req.user) || h.isGestionnaire(req.user) || h.isSecretariat(req.user);
  res.render('produits/fiche_technique', {
    title: 'Fiche technique · ' + produit.designation,
    page_title: 'Fiche technique — ' + produit.designation,
    produit, fiche, composition, ingredientsDispo, coutMatiere,
    historique, stats90j, peut_modifier: peutModifier,
  });
});

// Sauvegarder la fiche technique (upsert)
router.post('/:id(\\d+)/fiche-technique', requireEcritureCuisine, express.json(), (req, res) => {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!produit) return res.status(404).json({ erreur: 'Produit introuvable' });
  const { rendement = 1, actif = 1, notes = '', lignes = [] } = req.body;
  try {
    db.transaction(() => {
      let fiche = db.prepare('SELECT * FROM fiche_technique WHERE produit_id = ?').get(produit.id);
      if (!fiche) {
        const info = db.prepare(`INSERT INTO fiche_technique (produit_id, rendement, actif, notes, cree_par_id)
                                 VALUES (?, ?, ?, ?, ?)`).run(produit.id, Math.max(1, Number(rendement) || 1), actif ? 1 : 0, notes, req.user.id);
        fiche = { id: Number(info.lastInsertRowid) };
      } else {
        db.prepare(`UPDATE fiche_technique SET rendement = ?, actif = ?, notes = ?, modifie_le = datetime('now') WHERE id = ?`)
          .run(Math.max(1, Number(rendement) || 1), actif ? 1 : 0, notes, fiche.id);
      }
      db.prepare('DELETE FROM composition_fiche WHERE fiche_id = ?').run(fiche.id);
      const ins = db.prepare('INSERT INTO composition_fiche (fiche_id, ingredient_id, quantite, notes) VALUES (?, ?, ?, ?)');
      for (const l of lignes) {
        const iid = Number(l.ingredient_id);
        const qte = Number(String(l.quantite || '0').replace(',', '.'));
        if (iid > 0 && qte > 0 && iid !== produit.id) {
          // Vérifier que l'ingrédient appartient à la même activité (sécurité cloisonnement)
          const ing = db.prepare('SELECT id FROM produit WHERE id = ? AND activite_id = ?').get(iid, req.activiteId);
          if (ing) ins.run(fiche.id, iid, qte, l.notes || '');
        }
      }
    })();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(400).json({ erreur: e.message }); }
});

// Supprimer la fiche
router.post('/:id(\\d+)/fiche-technique/supprimer', requireEcritureCuisine, (req, res) => {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ? AND activite_id = ?').get(req.params.id, req.activiteId);
  if (!produit) return res.redirect('/produits/');
  db.prepare('DELETE FROM fiche_technique WHERE produit_id = ?').run(produit.id);
  req.flash('info', 'Fiche technique supprimée.');
  res.redirect('/produits/' + produit.id);
});

// =========================================================
// IMPORT EXCEL — FICHES TECHNIQUES en masse
// =========================================================
function colonnesFichesTechniques() {
  return [
    { header: 'Produit fini (plat vendu)', key: 'produit_fini', width: 32, required: true, note: 'Nom exact du produit fini à composer' },
    { header: 'Ingrédient', key: 'ingredient', width: 30, required: true, note: 'Nom exact d\'un ingrédient existant OU nouveau (sera créé)' },
    { header: 'Quantité', key: 'quantite', width: 12, required: true, type: 'number', note: 'Quantité par portion, dans l\'unité de stock de l\'ingrédient' },
    { header: 'Unité si nouveau', key: 'unite', width: 12, options: ['', 'pièce', 'g', 'kg', 'ml', 'l', 'cuillère', 'tranche', 'paquet'] },
    { header: 'Prix achat si nouveau', key: 'prix_achat', width: 14, type: 'number' },
  ];
}

router.get('/fiches-techniques/import/modele', requireEcriture, async (req, res) => {
  const buf = await xl.genererModele({
    titre: 'Fiches techniques',
    colonnes: colonnesFichesTechniques(),
    lignes_exemple: [
      { produit_fini: 'Burger Classique', ingredient: 'Pain hamburger', quantite: 1, unite: 'pièce', prix_achat: 150 },
      { produit_fini: 'Burger Classique', ingredient: 'Steak haché 100g', quantite: 1, unite: 'pièce', prix_achat: 500 },
      { produit_fini: 'Burger Classique', ingredient: 'Salade laitue', quantite: 30, unite: 'g', prix_achat: 2 },
      { produit_fini: 'Burger Classique', ingredient: 'Tomate', quantite: 50, unite: 'g', prix_achat: 1 },
      { produit_fini: 'Burger Fromage', ingredient: 'Pain hamburger', quantite: 1, unite: 'pièce', prix_achat: 150 },
      { produit_fini: 'Burger Fromage', ingredient: 'Cheddar tranche', quantite: 1, unite: 'pièce', prix_achat: 80 },
    ],
    instructions: [
      `Activité de destination : ${req.activite.nom}`,
      '',
      'Chaque ligne représente UN ingrédient d\'un produit fini.',
      'Répétez le même produit fini sur plusieurs lignes pour composer sa recette entière.',
      '',
      '• Produit fini : doit exister dans le catalogue (créez-le d\'abord si absent).',
      '• Ingrédient : s\'il existe déjà, il est réutilisé. Sinon, il sera CRÉÉ automatiquement dans une catégorie "Ingrédients".',
      '• Quantité : nombre nécessaire pour 1 portion vendue (ex : 1 pain, 150 g de viande...).',
      '• Unité et Prix d\'achat : utiles seulement si l\'ingrédient n\'existe pas encore (pour sa création).',
      '',
      'Exemple : les 4 premières lignes définissent la recette d\'un Burger Classique = 1 pain + 1 steak + 30 g de salade + 50 g de tomate.',
      '',
      'Les fiches existantes seront écrasées et remplacées par le contenu du fichier.',
    ],
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modele_fiches_techniques_${req.activite.nom.replace(/\s+/g, '_')}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/fiches-techniques/import', requireEcriture, (req, res) => {
  res.render('produits/import_excel', {
    title: 'Importer fiches techniques', page_title: 'Importer les fiches techniques',
    apercu: null, erreurs: [], type_import: 'fiches techniques',
    url_modele: '/produits/fiches-techniques/import/modele',
    url_upload: '/produits/fiches-techniques/import/apercu',
    url_confirmer: '/produits/fiches-techniques/import/confirmer',
    url_retour: '/produits/',
  });
});

router.post('/fiches-techniques/import/apercu', requireEcriture, uploadMemoire.single('fichier'), async (req, res) => {
  if (!req.file) { req.flash('error', 'Aucun fichier reçu.'); return res.redirect('/produits/fiches-techniques/import'); }
  try {
    const { lignes, erreurs } = await xl.parserImport(req.file.buffer, { colonnes: colonnesFichesTechniques() });
    // Vérifications supplémentaires : produit fini doit exister (comparaison sans casse/accents)
    const produitsExistants = db.prepare('SELECT id, designation FROM produit WHERE activite_id = ?').all(req.activiteId);
    const mapProdNorm = new Map(produitsExistants.map(p => [h.normaliserNom(p.designation), p]));
    for (const l of lignes) {
      l.__erreurs = l.__erreurs || [];
      if (l.produit_fini) {
        const p = mapProdNorm.get(h.normaliserNom(l.produit_fini));
        if (!p) l.__erreurs.push(`ligne ${l.__ligne_excel} : produit fini "${l.produit_fini}" introuvable dans le catalogue`);
      }
      if (l.quantite !== undefined && Number(l.quantite) <= 0) l.__erreurs.push(`ligne ${l.__ligne_excel} : quantité doit être > 0`);
    }
    const erreursGlobales = lignes.flatMap(l => l.__erreurs);
    req.session.import_fiches = { lignes, activiteId: req.activiteId };
    res.render('produits/import_excel', {
      title: 'Aperçu fiches techniques', page_title: 'Aperçu import fiches techniques',
      apercu: lignes, erreurs: erreursGlobales, type_import: 'fiches techniques',
      url_modele: '/produits/fiches-techniques/import/modele',
      url_upload: '/produits/fiches-techniques/import/apercu',
      url_confirmer: '/produits/fiches-techniques/import/confirmer',
      url_retour: '/produits/',
    });
  } catch (e) { req.flash('error', 'Fichier illisible : ' + e.message); res.redirect('/produits/fiches-techniques/import'); }
});

router.post('/fiches-techniques/import/confirmer', requireEcriture, (req, res) => {
  const data = req.session.import_fiches;
  if (!data || data.activiteId !== req.activiteId) { req.flash('warning', 'Session expirée.'); return res.redirect('/produits/fiches-techniques/import'); }

  const findFiche = db.prepare('SELECT id FROM fiche_technique WHERE produit_id = ?');
  // Map normalisée des produits pour recherche insensible casse/accents
  const tousProduits = db.prepare('SELECT id, designation FROM produit WHERE activite_id = ?').all(req.activiteId);
  const mapProduitNorm = new Map(tousProduits.map(p => [h.normaliserNom(p.designation), p]));
  const findProduit = { get: (activiteId, nom) => mapProduitNorm.get(h.normaliserNom(nom)) };
  const insertFiche = db.prepare(`INSERT INTO fiche_technique (produit_id, rendement, actif, notes, cree_par_id) VALUES (?, 1, 1, '', ?)`);
  const deleteComp = db.prepare('DELETE FROM composition_fiche WHERE fiche_id = ?');
  const insertComp = db.prepare('INSERT INTO composition_fiche (fiche_id, ingredient_id, quantite, notes) VALUES (?, ?, ?, ?)');
  const insertCat = db.prepare('INSERT INTO categorie (activite_id, nom, description) VALUES (?, ?, ?)');
  const findCat = db.prepare('SELECT id FROM categorie WHERE activite_id = ? AND LOWER(nom) = LOWER(?)');
  const insertIng = db.prepare(`INSERT INTO produit (activite_id, reference, designation, categorie_id, prix_achat, prix_vente, stock_actuel, stock_minimum, stock_maximum, unite, actif)
                                VALUES (?, ?, ?, ?, ?, 0, 0, 0, 999999, ?, 1)`);

  // Regrouper par produit fini
  const parProduitFini = new Map();
  for (const l of data.lignes) {
    if (l.__erreurs && l.__erreurs.length) continue;
    const key = String(l.produit_fini).trim().toLowerCase();
    if (!parProduitFini.has(key)) parProduitFini.set(key, { nom: String(l.produit_fini).trim(), lignes: [] });
    parProduitFini.get(key).lignes.push(l);
  }

  let fichesCreees = 0, ingredientsCrees = 0, erreursCount = 0;

  db.transaction(() => {
    // Catégorie Ingrédients (créée si absente)
    let catIng = findCat.get(req.activiteId, 'Ingrédients');
    if (!catIng) {
      const info = insertCat.run(req.activiteId, 'Ingrédients', 'Ingrédients cuisine');
      catIng = { id: Number(info.lastInsertRowid) };
    }
    for (const [, groupe] of parProduitFini) {
      const pfini = findProduit.get(req.activiteId, groupe.nom);
      if (!pfini) { erreursCount++; continue; }
      // Créer ou récupérer la fiche
      let fiche = findFiche.get(pfini.id);
      if (!fiche) {
        const info = insertFiche.run(pfini.id, req.user.id);
        fiche = { id: Number(info.lastInsertRowid) };
      } else {
        deleteComp.run(fiche.id);
      }
      for (const l of groupe.lignes) {
        // Chercher ingrédient (comparaison sans casse/accents), sinon créer
        const nomIng = String(l.ingredient).trim();
        const keyIng = h.normaliserNom(nomIng);
        let ing = mapProduitNorm.get(keyIng);
        if (!ing) {
          const ref = h.prochaineReferenceProduit(db, req.activiteId);
          const infoIng = insertIng.run(req.activiteId, ref, nomIng, catIng.id,
            Math.round(Number(l.prix_achat || 0)), String(l.unite || 'pièce').trim() || 'pièce');
          ing = { id: Number(infoIng.lastInsertRowid), designation: nomIng };
          mapProduitNorm.set(keyIng, ing); // ajouter à la map pour lignes suivantes
          ingredientsCrees++;
        }
        if (ing.id === pfini.id) continue; // pas d'auto-référence
        insertComp.run(fiche.id, ing.id, Number(l.quantite), '');
      }
      fichesCreees++;
    }
  })();

  delete req.session.import_fiches;
  const msg = `${fichesCreees} fiche(s) technique(s) créée(s)/mise(s) à jour${ingredientsCrees > 0 ? `, ${ingredientsCrees} ingrédient(s) créé(s) automatiquement` : ''}.`;
  if (fichesCreees > 0) req.flash('success', msg);
  if (erreursCount > 0) req.flash('warning', `${erreursCount} produit(s) fini(s) introuvable(s) et ignoré(s).`);
  res.redirect('/produits/');
});

module.exports = router;
