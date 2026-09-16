// Routes publiques du canal B2C /commander
// - Catalogue (lecture des produits actifs)
// - Panier en session
// - Checkout : crée la commande dans commande_client_web (0 impact sur tables existantes)
// - Suivi client via code_suivi
const express = require('express');
const db = require('../src/db');
const h = require('../src/helpers');
const router = express.Router();

// =========================================================
// Emoji fallback si le produit n'a pas de photo
// =========================================================
function emojiFallback(designation, categorie) {
  const s = ((designation || '') + ' ' + (categorie || '')).toLowerCase();
  if (/burger|hamburger/.test(s)) return '🍔';
  if (/pizza/.test(s)) return '🍕';
  if (/frite/.test(s)) return '🍟';
  if (/salade|salad/.test(s)) return '🥗';
  if (/pain|baguette|sandwich/.test(s)) return '🥖';
  if (/croissant|viennois/.test(s)) return '🥐';
  if (/gateau|gâteau|fondant|fraisier|tart|cake|cupcake|patisser|pâtisser/.test(s)) return '🍰';
  if (/chocolat/.test(s)) return '🍫';
  if (/jus|boisson|soda|coca|eau|smoothie/.test(s)) return '🥤';
  if (/poulet|chicken/.test(s)) return '🍗';
  if (/poisson|fish/.test(s)) return '🐟';
  if (/riz|rice/.test(s)) return '🍚';
  if (/beignet|donut/.test(s)) return '🍩';
  if (/glace|ice/.test(s)) return '🍦';
  if (/pâtes|pasta|spaghetti/.test(s)) return '🍝';
  return '🍽️';
}

// =========================================================
// Récupération des paramètres canal + activités visibles
// =========================================================
function getParametreWeb(cle, defaut) {
  const row = db.prepare("SELECT valeur FROM parametre WHERE cle = ?").get(cle);
  return row ? row.valeur : defaut;
}

function getActivitesCanalWeb() {
  const paramIds = getParametreWeb('web_activites_ids', '');
  if (paramIds && paramIds.trim()) {
    return paramIds.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
  }
  return db.prepare("SELECT id FROM activite WHERE type = 'B2C_CAISSE' AND actif = 1").all().map(r => r.id);
}

function chargerProduit(produitId) {
  const p = db.prepare(`
    SELECT p.id, p.designation, p.description, p.prix_vente, p.stock_actuel, p.unite, p.image,
           p.activite_id, p.categorie_id, p.temps_preparation_min, c.nom AS categorie_nom
    FROM produit p LEFT JOIN categorie c ON c.id = p.categorie_id
    WHERE p.id = ? AND p.actif = 1
  `).get(produitId);
  if (!p) return null;
  p.supplements = db.prepare('SELECT id, nom, prix FROM supplement WHERE produit_id = ? AND actif = 1 ORDER BY ordre, id').all(produitId);
  return p;
}

function chargerProduitsCanalWeb() {
  const canalActif = getParametreWeb('web_canal_actif', '1');
  if (canalActif === '0') return { produits: [], canalDesactive: true };

  const ids = getActivitesCanalWeb();
  if (!ids.length) return { produits: [], canalDesactive: false };

  const placeholders = ids.map(() => '?').join(',');
  // Exclut les produits système (frais de livraison, etc.) — non commercialisables
  const produits = db.prepare(`
    SELECT p.id, p.designation, p.description, p.prix_vente, p.stock_actuel, p.unite, p.image,
           p.activite_id, p.categorie_id, p.stock_maximum, p.temps_preparation_min,
           a.nom AS activite_nom, a.code AS activite_code,
           c.nom AS categorie_nom
    FROM produit p
    JOIN activite a ON a.id = p.activite_id
    LEFT JOIN categorie c ON c.id = p.categorie_id
    WHERE p.activite_id IN (${placeholders})
      AND p.actif = 1 AND p.prix_vente > 0
      AND (p.reference IS NULL OR p.reference NOT LIKE 'FRAIS-%')
    ORDER BY p.designation
  `).all(...ids);

  // Charger les suppléments actifs pour tous les produits en une seule requête
  const suppMap = new Map();
  if (produits.length) {
    const idsP = produits.map(p => p.id);
    const ph2 = idsP.map(() => '?').join(',');
    const supps = db.prepare(`SELECT id, produit_id, nom, prix FROM supplement
                              WHERE produit_id IN (${ph2}) AND actif = 1
                              ORDER BY ordre, id`).all(...idsP);
    for (const s of supps) {
      if (!suppMap.has(s.produit_id)) suppMap.set(s.produit_id, []);
      suppMap.get(s.produit_id).push({ id: s.id, nom: s.nom, prix: Number(s.prix) });
    }
  }

  return {
    produits: produits.map(p => ({
      ...p,
      emoji: emojiFallback(p.designation, p.categorie_nom),
      supplements: suppMap.get(p.id) || [],
      // en_rupture n'est plus affiché côté client (tous les produits sont commandables).
      // Il reste calculé (pour usage interne/caissier) : uniquement pour les produits stockés (stock_maximum > 0).
      en_rupture: (Number(p.stock_maximum) || 0) > 0 && (Number(p.stock_actuel) || 0) <= 0,
    })),
    canalDesactive: false,
  };
}

// =========================================================
// PANIER EN SESSION
// req.session.panier = { items: [{ produit_id, quantite }] }
// =========================================================
function getPanierBrut(req) {
  if (!req.session.panier) req.session.panier = { items: [] };
  return req.session.panier;
}

// Enrichi : rejoint chaque item avec les données produit à jour + suppléments choisis
function enrichirPanier(panier) {
  if (!panier.items.length) return { items: [], sous_total: 0, nb_articles: 0 };
  const items = [];
  let sousTotal = 0;
  let nbArticles = 0;
  for (const item of panier.items) {
    const p = chargerProduit(item.produit_id);
    if (!p) continue; // produit supprimé — on l'ignore silencieusement
    // Résoudre les suppléments choisis (item.supplements = tableau d'IDs, ou undefined)
    const idsChoisis = Array.isArray(item.supplements) ? item.supplements.map(Number) : [];
    const suppsChoisis = p.supplements.filter(s => idsChoisis.includes(Number(s.id)));
    const suppTotal = suppsChoisis.reduce((s, x) => s + Number(x.prix), 0);
    const prixLigneUnit = Number(p.prix_vente) + suppTotal;
    const total = Math.round(prixLigneUnit * item.quantite);
    items.push({
      ...p,
      emoji: emojiFallback(p.designation, p.categorie_nom),
      quantite: item.quantite,
      supplements_choisis: suppsChoisis,
      supp_total: suppTotal,
      prix_unit_total: prixLigneUnit,
      total,
      // ID unique de ligne : produit + hash des suppléments choisis (pour distinguer 2 burgers avec supps différents)
      ligne_key: item.produit_id + '_' + idsChoisis.slice().sort((a,b)=>a-b).join('.'),
    });
    sousTotal += total;
    nbArticles += item.quantite;
  }
  return { items, sous_total: sousTotal, nb_articles: nbArticles };
}

// Middleware : expose le panier + les infos entreprise (récupérées des paramètres système)
// aux vues publiques. Toute modification dans /admin/parametres/ se reflète ici sans code.
router.use((req, res, next) => {
  const panier = enrichirPanier(getPanierBrut(req));
  res.locals.panier_count = panier.nb_articles;
  res.locals.panier_sous_total = panier.sous_total;
  req.panierEnrichi = panier;

  // Infos entreprise depuis la table `parametre` (avec fallbacks légitimes)
  res.locals.ent_nom       = getParametreWeb('entreprise_nom', 'Le Traiteur du Bistrot');
  res.locals.ent_tel       = getParametreWeb('entreprise_tel', '');
  res.locals.ent_email     = getParametreWeb('entreprise_email', '');
  res.locals.ent_adresse   = getParametreWeb('entreprise_adresse', '');
  res.locals.ent_horaires  = getParametreWeb('web_horaires', 'Lun-Ven 8h-22h');
  res.locals.web_frais_livraison = Number(getParametreWeb('web_frais_livraison', '1000'));
  // Seuil livraison gratuite : si sous_total >= ce seuil, frais offerts. 0 = jamais offerts.
  res.locals.web_livraison_gratuite_seuil = Number(getParametreWeb('web_livraison_gratuite_seuil', '0'));

  // Phase 3 marketing : promos automatiques actives à afficher en bannière (sans code, avec afficher_banniere=1)
  try {
    const autoPromos = h.chargerPromotionsAutoActives(db)
      .filter(p => p.afficher_banniere !== 0);
    res.locals.banniere_promos = autoPromos.map(p => ({
      id: p.id, nom: p.nom, description: p.description,
      type: p.type, valeur: p.valeur,
      categorie: p.categorie_nom, produit: p.produit_nom,
      categorie_id: p.categorie_id, produit_id: p.produit_id, activite_id: p.activite_id,
      panier_min: p.panier_min,
      minutes_restantes: h.promotionMinutesRestantes(p),
    }));
  } catch(e) { res.locals.banniere_promos = []; }
  // Numéros pour tel/WhatsApp — extrait le premier numéro proprement pour le clic-to-call
  const telBrut = String(res.locals.ent_tel || '');
  const premierTel = (telBrut.match(/(\+?\d[\d\s]{6,})/) || [''])[0].replace(/\s+/g, '');
  res.locals.ent_tel_lien   = premierTel || '';
  res.locals.ent_whatsapp   = premierTel.replace(/[^\d]/g, ''); // que des chiffres pour wa.me

  // Preuve sociale : compteurs dynamiques calculés depuis la DB
  // - nb_cmd_semaine = commandes finalisées (RECUPEREE ou LIVREE) sur les 7 derniers jours
  // - nb_cmd_total = toutes les commandes finalisées
  // - note_moyenne = paramètre configurable (défaut 4.8) — à remplacer par vraies notes plus tard
  try {
    const semaine = db.prepare(`SELECT COUNT(*) AS n FROM commande_client_web
                                WHERE statut IN ('RECUPEREE', 'LIVREE')
                                  AND date(date_fin) >= date('now', '-7 day')`).get();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM commande_client_web
                              WHERE statut IN ('RECUPEREE', 'LIVREE')`).get();
    res.locals.nb_cmd_semaine = semaine.n || 0;
    res.locals.nb_cmd_total = total.n || 0;
  } catch (e) { res.locals.nb_cmd_semaine = 0; res.locals.nb_cmd_total = 0; }
  res.locals.note_moyenne = getParametreWeb('web_note_moyenne', '4.8');
  res.locals.nb_avis = getParametreWeb('web_nb_avis', '');

  // Codes marchand pour paiement Mobile Money — affichés au client au checkout
  // Configurables dans /admin/parametres/ (clés : web_orange_code, web_mtn_code)
  res.locals.orange_code = getParametreWeb('web_orange_code', '');
  res.locals.mtn_code    = getParametreWeb('web_mtn_code', '');
  next();
});

// =========================================================
// CATALOGUE (accueil)
// =========================================================
router.get('/', (req, res) => {
  const { produits, canalDesactive } = chargerProduitsCanalWeb();
  const categories = [...new Set(produits.map(p => p.categorie_nom).filter(Boolean))].sort();
  const catFiltre = (req.query.categorie || '').trim();
  const q = String(req.query.q || '').trim();
  const produitsAffiches = catFiltre ? produits.filter(p => p.categorie_nom === catFiltre) : produits;
  const menus = !catFiltre
    ? produits.filter(p => /menu|combo/i.test(p.categorie_nom || ''))
    : [];
  // Phase 3 : promotions actives (pour badges sur les cartes produits)
  const promosActives = h.chargerToutesPromotionsActives(db);
  const remisesParProduit = {}; // { produit_id: { pct, label } }
  for (const promo of promosActives) {
    if (promo.type !== 'POURCENTAGE' && promo.type !== 'MONTANT_FIXE') continue;
    const ids = h.produitsConcernesParPromo(db, promo);
    const label = promo.type === 'POURCENTAGE'
      ? `-${promo.valeur}%`
      : `-${Math.round(promo.valeur).toLocaleString('fr-FR').replace(/,/g, ' ')} F`;
    if (ids === null) {
      // Tous produits : appliquer à chaque produit affiché
      for (const p of produits) {
        if (!remisesParProduit[p.id]) remisesParProduit[p.id] = { label, sansCode: !promo.code };
      }
    } else {
      for (const pid of ids) {
        if (!remisesParProduit[pid]) remisesParProduit[pid] = { label, sansCode: !promo.code };
      }
    }
  }
  res.render('public/catalogue', {
    title: 'Notre menu',
    produits: produitsAffiches,
    categories,
    categorie_active: catFiltre,
    q,
    nb_total: produits.length,
    canal_desactive: canalDesactive,
    menus,
    promos_actives: promosActives,
    remises_par_produit: remisesParProduit,
  });
});

// Page dédiée : toutes les offres et promotions actives
router.get('/offres', (req, res) => {
  const promos = h.chargerToutesPromotionsActives(db);
  res.render('public/offres', {
    title: 'Nos offres du moment',
    promos,
  });
});
router.get('/catalogue', (req, res) => res.redirect('/commander/' + (req.query.categorie ? '?categorie=' + encodeURIComponent(req.query.categorie) : '')));

// =========================================================
// PANIER — vue
// =========================================================
router.get('/panier', (req, res) => {
  const panier = req.panierEnrichi;
  const frais = Number(getParametreWeb('web_frais_livraison', '1000'));
  res.render('public/panier', {
    title: 'Mon panier',
    panier,
    frais_livraison: frais,
    modification: req.session.modification || null,
  });
});

// =========================================================
// PANIER — API AJAX
// =========================================================
router.post('/panier/ajouter', express.json(), (req, res) => {
  const produitId = Number(req.body.produit_id);
  if (!produitId) return res.status(400).json({ erreur: 'produit_id manquant' });
  const p = chargerProduit(produitId);
  if (!p) return res.status(404).json({ erreur: 'Produit introuvable' });

  // Suppléments choisis : tableau d'IDs, on filtre pour ne garder que ceux réellement disponibles
  const suppIdsRaw = Array.isArray(req.body.supplements) ? req.body.supplements.map(Number) : [];
  const suppIdsValides = new Set(p.supplements.map(s => Number(s.id)));
  const suppIds = [...new Set(suppIdsRaw.filter(id => suppIdsValides.has(id)))].sort((a,b)=>a-b);

  const panier = getPanierBrut(req);
  // Un article avec supp est distinct d'un même produit sans supp (ou avec supp différents)
  // → on fusionne uniquement si le tableau de supp est identique
  const cleAgg = suppIds.join('.');
  const idx = panier.items.findIndex(i => i.produit_id === produitId && (Array.isArray(i.supplements) ? i.supplements.slice().sort((a,b)=>a-b).join('.') : '') === cleAgg);
  if (idx >= 0) panier.items[idx].quantite += 1;
  else panier.items.push({ produit_id: produitId, quantite: 1, supplements: suppIds });

  const enrichi = enrichirPanier(panier);
  res.json({ ok: true, nb_articles: enrichi.nb_articles, sous_total: enrichi.sous_total, produit_nom: p.designation });
});

router.post('/panier/modifier', express.json(), (req, res) => {
  const produitId = Number(req.body.produit_id);
  const quantite = Math.max(0, Number(req.body.quantite || 0));
  // ligne_key permet de distinguer plusieurs lignes du même produit avec des suppléments différents
  const ligneKey = String(req.body.ligne_key || '');
  const panier = getPanierBrut(req);
  const idx = panier.items.findIndex(i => {
    if (i.produit_id !== produitId) return false;
    if (!ligneKey) return true; // rétro-compat : si pas de key, on prend le premier match
    const cle = (i.produit_id + '_' + (Array.isArray(i.supplements) ? i.supplements.slice().sort((a,b)=>a-b).join('.') : ''));
    return cle === ligneKey;
  });
  if (idx < 0) return res.status(404).json({ erreur: 'Article absent du panier' });
  if (quantite === 0) panier.items.splice(idx, 1);
  else panier.items[idx].quantite = quantite;
  const enrichi = enrichirPanier(panier);
  res.json({ ok: true, nb_articles: enrichi.nb_articles, sous_total: enrichi.sous_total });
});

// Recommander une ancienne commande — recharge ses lignes dans le panier courant.
// Utilisé par le modal "Mes commandes" (localStorage) pour repasser en 1 clic.
router.post('/api/recommander/:code', express.json(), (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ erreur: 'Code manquant' });
  const cmd = db.prepare('SELECT id FROM commande_client_web WHERE code_suivi = ?').get(code);
  if (!cmd) return res.status(404).json({ erreur: "Commande introuvable — elle a peut-être été supprimée." });

  const lignes = db.prepare('SELECT produit_id, quantite FROM ligne_commande_client_web WHERE commande_id = ?').all(cmd.id);
  if (!lignes.length) return res.status(400).json({ erreur: 'Commande sans articles.' });

  const panier = getPanierBrut(req);
  let ajoutes = 0, indisponibles = 0;
  for (const l of lignes) {
    // Vérifier que le produit existe toujours et est actif
    const p = chargerProduit(l.produit_id);
    if (!p) { indisponibles++; continue; }
    const idx = panier.items.findIndex(i => i.produit_id === l.produit_id);
    if (idx >= 0) panier.items[idx].quantite += Number(l.quantite);
    else panier.items.push({ produit_id: l.produit_id, quantite: Number(l.quantite) });
    ajoutes += Number(l.quantite);
  }

  const enrichi = enrichirPanier(panier);
  res.json({
    ok: true,
    nb_articles: enrichi.nb_articles,
    sous_total: enrichi.sous_total,
    ajoutes,
    indisponibles,
  });
});

router.post('/panier/vider', (req, res) => {
  req.session.panier = { items: [] };
  res.redirect('/commander/');
});

// =========================================================
// CHECKOUT
// =========================================================
router.get('/checkout', (req, res) => {
  const panier = req.panierEnrichi;
  if (!panier.items.length) return res.redirect('/commander/panier');
  const frais = Number(getParametreWeb('web_frais_livraison', '1000'));
  res.render('public/checkout', {
    title: req.session.modification ? 'Modifier ma commande' : 'Finaliser ma commande',
    panier,
    frais_livraison: frais,
    modification: req.session.modification || null,
  });
});

// Génère un code de suivi court et mémorable (6 caractères A-Z 0-9, sans O/0/I/1 pour éviter confusion)
function genererCodeSuivi() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let essai = 0; essai < 20; essai++) {
    let code = 'CMD-';
    for (let i = 0; i < 6; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
    const exists = db.prepare('SELECT 1 FROM commande_client_web WHERE code_suivi = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Impossible de générer un code unique après 20 essais');
}

router.post('/checkout', (req, res) => {
  const panier = req.panierEnrichi;
  if (!panier.items.length) { req.flash('error', 'Votre panier est vide.'); return res.redirect('/commander/panier'); }

  const nom = String(req.body.nom || '').trim();
  const tel = String(req.body.tel || '').trim();
  const mode = String(req.body.mode_recuperation || 'RETRAIT').toUpperCase();
  const modePaiement = String(req.body.mode_paiement_prevu || 'ESPECES').toUpperCase();
  const quartier = String(req.body.quartier || '').trim();
  const adresse = String(req.body.adresse || '').trim();
  const notes = String(req.body.notes || '').trim();

  if (!nom || !tel) { req.flash('error', 'Nom et téléphone obligatoires.'); return res.redirect('/commander/checkout'); }
  // Validation numéro Cameroun : commence par 6 (mobile) ou 2 (fixe), 9 chiffres, +237 ou 237 optionnel
  const telRegex = /^\s*(\+?237)?\s*[62]\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*$/;
  if (!telRegex.test(tel)) {
    req.flash('error', 'Numéro de téléphone invalide. Format attendu : +237 6XX XX XX XX (mobile Cameroun).');
    return res.redirect('/commander/checkout');
  }
  if (!['RETRAIT', 'LIVRAISON'].includes(mode)) { req.flash('error', 'Mode de récupération invalide.'); return res.redirect('/commander/checkout'); }
  if (!['ESPECES', 'ORANGE', 'MTN'].includes(modePaiement)) { req.flash('error', 'Mode de paiement invalide.'); return res.redirect('/commander/checkout'); }
  if (mode === 'LIVRAISON' && (!quartier || !adresse)) { req.flash('error', 'Adresse et quartier requis pour la livraison.'); return res.redirect('/commander/checkout'); }

  // Frais de livraison : offerts si sous_total >= seuil défini (0 = jamais offerts)
  const sousTotal = panier.sous_total;
  let frais = mode === 'LIVRAISON' ? Number(getParametreWeb('web_frais_livraison', '1000')) : 0;
  const seuilGratuit = Number(getParametreWeb('web_livraison_gratuite_seuil', '0'));
  if (frais > 0 && seuilGratuit > 0 && sousTotal >= seuilGratuit) frais = 0;

  // Validation du code promo (si saisi) — prioritaire sur les promos auto
  const codePromoSaisi = String(req.body.code_promo || '').trim().toUpperCase();
  let remisePromo = 0;
  let promotionId = null;
  let codePromoApplique = '';
  const items = panier.items.map(it => ({ id: it.id, total: it.total, categorie_id: it.categorie_id || null }));
  if (codePromoSaisi) {
    const check = h.verifierPromotion(db, codePromoSaisi, { sousTotal, panierItems: items, clientTel: tel });
    if (!check.ok) {
      req.flash('error', 'Code promo : ' + check.erreur);
      return res.redirect('/commander/checkout');
    }
    promotionId = check.promotion.id;
    codePromoApplique = check.promotion.code;
    if (check.promotion.type === 'LIVRAISON_OFFERTE') {
      frais = 0;
    } else {
      remisePromo = check.remise;
    }
  } else {
    // Aucun code saisi : rechercher la meilleure promo automatique applicable
    const autoPromos = h.chargerPromotionsAutoActives(db);
    let meilleure = null, meilleureRemise = 0, meilleureLivraison = false;
    for (const promo of autoPromos) {
      // On simule via verifierPromotion en passant le code (les promos auto n'ont pas de code mais on peut réutiliser)
      // Comme verifierPromotion nécessite un code, on émule le calcul directement.
      if (promo.panier_min > 0 && sousTotal < promo.panier_min) continue;
      let base = sousTotal;
      if (promo.categorie_id || promo.produit_id) {
        base = items
          .filter(it => (promo.produit_id ? it.id === promo.produit_id : true))
          .filter(it => (promo.categorie_id ? it.categorie_id === promo.categorie_id : true))
          .reduce((s, it) => s + Number(it.total || 0), 0);
        if (base === 0) continue;
      }
      let remise = 0, livraisonOfferte = false;
      if (promo.type === 'POURCENTAGE') remise = Math.round(base * promo.valeur / 100);
      else if (promo.type === 'MONTANT_FIXE') remise = Math.min(Math.round(promo.valeur), base);
      else if (promo.type === 'LIVRAISON_OFFERTE') { livraisonOfferte = true; remise = frais; } // équivalent remise = frais
      if (remise > meilleureRemise) {
        meilleure = promo; meilleureRemise = remise; meilleureLivraison = livraisonOfferte;
      }
    }
    if (meilleure) {
      promotionId = meilleure.id;
      codePromoApplique = 'AUTO';
      if (meilleureLivraison) frais = 0;
      else remisePromo = meilleureRemise;
    }
  }

  const total = Math.max(0, sousTotal - remisePromo + frais);

  // Détection du mode modification (le client édite une commande existante)
  const modification = req.session.modification;
  const estModification = modification && modification.commande_id;
  let codeSuivi;

  if (estModification) {
    // Vérifier que la commande est toujours modifiable
    const cmd = db.prepare('SELECT * FROM commande_client_web WHERE id = ?').get(modification.commande_id);
    if (!cmd || cmd.statut !== 'NOUVELLE') {
      delete req.session.modification;
      req.flash('warning', 'La commande a déjà été prise en charge, impossible de la modifier.');
      return res.redirect('/commander/');
    }
    codeSuivi = cmd.code_suivi;
    const trx = db.transaction(() => {
      db.prepare(`UPDATE commande_client_web SET
                    client_nom = ?, client_tel = ?, mode_recuperation = ?,
                    quartier = ?, adresse = ?,
                    sous_total = ?, frais_livraison = ?, total = ?,
                    notes_client = ?, mode_paiement_prevu = ?,
                    modifie_le = datetime('now')
                  WHERE id = ?`)
        .run(nom, tel, mode, quartier, adresse, sousTotal, frais, total, notes, modePaiement, cmd.id);
      // Reset des lignes (cascade supprime aussi les suppléments liés)
      db.prepare('DELETE FROM ligne_commande_client_web WHERE commande_id = ?').run(cmd.id);
      const insL = db.prepare(`INSERT INTO ligne_commande_client_web
        (commande_id, produit_id, activite_id, designation, prix_unitaire, quantite)
        VALUES (?, ?, ?, ?, ?, ?)`);
      const insSupp = db.prepare(`INSERT INTO ligne_commande_web_supplement
        (ligne_id, supplement_id, nom, prix) VALUES (?, ?, ?, ?)`);
      for (const item of panier.items) {
        // prix_unitaire = prix de base + total des suppléments (facilite l'affichage)
        // prix_unitaire = base + suppléments choisis (bundled) — total ligne = prix × qté
        const prixUnit = Number(item.prix_unit_total) || Number(item.prix_vente);
        const info = insL.run(cmd.id, item.id, item.activite_id, item.designation, prixUnit, item.quantite);
        const ligneId = Number(info.lastInsertRowid);
        for (const s of (item.supplements_choisis || [])) {
          insSupp.run(ligneId, s.id, s.nom, Number(s.prix));
        }
      }
    });
    trx();
    h.journaliser(db, {
      user: null, activiteId: null,
      action: 'CMD_LIGNE_MODIFIEE_CLIENT',
      entite: 'commande_client_web', entite_id: cmd.id,
      details: `${cmd.code_suivi} · ${nom} · nouveau total ${total}`,
    });
    delete req.session.modification;
    req.session.panier = { items: [] };
    req.flash('success', 'Votre commande a bien été mise à jour.');
    return res.redirect('/commander/suivi/' + codeSuivi);
  }

  // Création normale
  codeSuivi = genererCodeSuivi();
  let commandeCreeeId = null;
  const trx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO commande_client_web
      (code_suivi, client_nom, client_tel, mode_recuperation, quartier, adresse,
       sous_total, frais_livraison, total, statut, notes_client, mode_paiement_prevu,
       promotion_id, code_promo_utilise, remise_promo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOUVELLE', ?, ?, ?, ?, ?)`)
      .run(codeSuivi, nom, tel, mode, quartier, adresse, sousTotal, frais, total, notes, modePaiement,
           promotionId, codePromoApplique, remisePromo);
    const cmdId = Number(info.lastInsertRowid);
    commandeCreeeId = cmdId;
    const insL = db.prepare(`INSERT INTO ligne_commande_client_web
      (commande_id, produit_id, activite_id, designation, prix_unitaire, quantite)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const insSupp = db.prepare(`INSERT INTO ligne_commande_web_supplement
      (ligne_id, supplement_id, nom, prix) VALUES (?, ?, ?, ?)`);
    for (const item of panier.items) {
      // prix_unitaire = base + suppléments choisis (bundled) — total ligne = prix × qté
      const prixUnit = Number(item.prix_unit_total) || Number(item.prix_vente);
      const infoL = insL.run(cmdId, item.id, item.activite_id, item.designation, prixUnit, item.quantite);
      const ligneId = Number(infoL.lastInsertRowid);
      for (const s of (item.supplements_choisis || [])) {
        insSupp.run(ligneId, s.id, s.nom, Number(s.prix));
      }
    }
  });
  trx();

  // Enregistrer l'utilisation de la promotion (hors transaction pour éviter les rollback partiels)
  if (promotionId && commandeCreeeId) {
    try {
      h.enregistrerUsagePromotion(db, promotionId, {
        commandeWebId: commandeCreeeId,
        clientTel: tel,
        remise: remisePromo || (mode === 'LIVRAISON' && frais === 0 ? Number(getParametreWeb('web_frais_livraison', '1000')) : 0),
      });
    } catch(e) { /* log silencieux si problème */ }
  }

  req.session.panier = { items: [] };
  res.redirect('/commander/confirmation/' + codeSuivi);
});

// =========================================================
// CONFIRMATION + SUIVI
// =========================================================
function chargerCommande(code) {
  const cmd = db.prepare(`SELECT * FROM commande_client_web WHERE code_suivi = ?`).get(code);
  if (!cmd) return null;
  const lignes = db.prepare(`
    SELECT l.*, a.nom AS activite_nom, a.code AS activite_code
    FROM ligne_commande_client_web l JOIN activite a ON a.id = l.activite_id
    WHERE l.commande_id = ? ORDER BY l.id
  `).all(cmd.id);
  return { ...cmd, lignes };
}

router.get('/confirmation/:code', (req, res) => {
  const cmd = chargerCommande(req.params.code);
  if (!cmd) return res.redirect('/commander/');
  res.render('public/confirmation', { title: 'Commande enregistrée', commande: cmd, juste_creee: true });
});

router.get('/suivi/:code', (req, res) => {
  const cmd = chargerCommande(req.params.code);
  if (!cmd) return res.render('public/suivi_introuvable', { title: 'Commande introuvable', code: req.params.code });
  res.render('public/suivi', { title: 'Suivi de commande', commande: cmd });
});

// Page publique de recherche par code (au cas où le client perd son lien)
router.get('/suivi', (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (code) return res.redirect('/commander/suivi/' + encodeURIComponent(code));
  res.render('public/suivi_recherche', { title: 'Retrouver ma commande' });
});

// Modification par le client (uniquement si statut = NOUVELLE)
// Restaure les articles dans le panier et met la session en mode "modification"
router.get('/modifier/:code', (req, res) => {
  const code = req.params.code;
  const cmd = db.prepare('SELECT * FROM commande_client_web WHERE code_suivi = ?').get(code);
  if (!cmd) { req.flash('error', 'Commande introuvable.'); return res.redirect('/commander/'); }
  if (cmd.statut !== 'NOUVELLE') {
    req.flash('warning', 'Votre commande est déjà en préparation, elle ne peut plus être modifiée.');
    return res.redirect('/commander/suivi/' + code);
  }
  // Restaurer les articles dans le panier
  const lignes = db.prepare('SELECT produit_id, quantite FROM ligne_commande_client_web WHERE commande_id = ?').all(cmd.id);
  req.session.panier = { items: lignes.map(l => ({ produit_id: l.produit_id, quantite: l.quantite })) };
  // Marquer la session en mode modification (pour que le checkout mette à jour au lieu de créer)
  req.session.modification = {
    code_suivi: cmd.code_suivi,
    commande_id: cmd.id,
    client_nom: cmd.client_nom,
    client_tel: cmd.client_tel,
    mode_recuperation: cmd.mode_recuperation,
    mode_paiement_prevu: cmd.mode_paiement_prevu,
    quartier: cmd.quartier,
    adresse: cmd.adresse,
    notes_client: cmd.notes_client,
  };
  // Sauvegarder aussi le mode récup dans le cookie pour préselection du panier
  res.cookie('mode_recup', cmd.mode_recuperation, { path: '/commander', maxAge: 3600000 });
  req.flash('info', 'Vous modifiez votre commande ' + code + '. Ajustez le panier puis revalidez.');
  res.redirect('/commander/panier');
});

// Sortir du mode modification (garde la commande d'origine intacte)
router.get('/modifier/:code/annuler', (req, res) => {
  const code = req.params.code;
  delete req.session.modification;
  req.session.panier = { items: [] };
  res.redirect('/commander/suivi/' + code);
});

// Annulation par le client (uniquement si statut = NOUVELLE, pas encore confirmée)
router.post('/annuler/:code', (req, res) => {
  const code = req.params.code;
  const motif = String(req.body.motif || '').trim();
  const cmd = db.prepare('SELECT * FROM commande_client_web WHERE code_suivi = ?').get(code);
  if (!cmd) { req.flash('error', 'Commande introuvable.'); return res.redirect('/commander/'); }
  if (cmd.statut !== 'NOUVELLE') {
    req.flash('warning', 'Votre commande a déjà été prise en charge. Contactez-nous par téléphone pour annuler.');
    return res.redirect('/commander/suivi/' + code);
  }
  if (!motif || motif.length < 3) {
    req.flash('error', 'Merci d\'indiquer un motif d\'annulation (au moins 3 caractères).');
    return res.redirect('/commander/suivi/' + code);
  }
  db.prepare(`UPDATE commande_client_web
              SET statut = 'ANNULEE', date_fin = datetime('now'),
                  motif_annulation = ?, annulee_par = 'CLIENT',
                  modifie_le = datetime('now')
              WHERE id = ?`).run(motif, cmd.id);
  h.journaliser(db, {
    user: null, activiteId: null,
    action: 'CMD_LIGNE_ANNULEE_CLIENT',
    entite: 'commande_client_web', entite_id: cmd.id,
    details: `${cmd.code_suivi} · ${cmd.client_nom} · Motif : ${motif}`,
  });
  req.flash('info', 'Votre commande a bien été annulée.');
  res.redirect('/commander/suivi/' + code);
});

// API JSON pour polling du statut par le client
router.get('/api/statut/:code', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const cmd = db.prepare(`SELECT id, code_suivi, statut, mode_recuperation, modifie_le,
                                  date_creation, date_confirmation, date_prete, date_fin
                          FROM commande_client_web WHERE code_suivi = ?`).get(req.params.code);
  if (!cmd) return res.status(404).json({ erreur: 'introuvable' });
  res.json(cmd);
});

// Page marketing "À propos"
router.get('/a-propos', (req, res) => {
  res.render('public/accueil', { title: 'À propos' });
});

// API — vérifier un code promo saisi (au checkout OU dans la modale WhatsApp)
// Body attendu : { code, tel?, items?: [{id, quantite}] }
// Si "items" est fourni (ex: modale WhatsApp), on calcule contre ces items.
// Sinon on utilise le panier de session (checkout classique).
router.post('/api/promo/verifier', express.json(), (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { code, tel, items: itemsClient } = req.body || {};
  let sousTotal, itemsPourPromo;
  if (Array.isArray(itemsClient) && itemsClient.length) {
    // Cas modale WhatsApp : recharger les produits pour connaître prix + catégorie
    sousTotal = 0;
    itemsPourPromo = [];
    for (const raw of itemsClient) {
      const pid = Number(raw.id);
      const q = Math.max(1, Number(raw.quantite) || 1);
      const p = chargerProduit(pid);
      if (!p) continue;
      const total = Number(p.prix_vente) * q;
      sousTotal += total;
      itemsPourPromo.push({ id: pid, total, categorie_id: p.categorie_id || null });
    }
  } else {
    const panier = req.panierEnrichi;
    sousTotal = panier.sous_total;
    itemsPourPromo = panier.items.map(it => ({
      id: it.id,
      total: it.total,
      categorie_id: it.categorie_id || null,
    }));
  }
  const result = h.verifierPromotion(db, code, {
    sousTotal,
    panierItems: itemsPourPromo,
    clientTel: String(tel || '').trim(),
  });
  if (!result.ok) return res.json({ ok: false, message: result.erreur });
  const p = result.promotion;
  let message = '';
  if (p.type === 'POURCENTAGE') message = `-${p.valeur}% appliqués`;
  else if (p.type === 'MONTANT_FIXE') message = `-${Math.round(p.valeur).toLocaleString('fr-FR').replace(/,/g, ' ')} FCFA appliqués`;
  else if (p.type === 'LIVRAISON_OFFERTE') message = 'Livraison offerte 🚚';
  if (p.description) message += ' · ' + p.description;
  res.json({
    ok: true,
    remise: result.remise,
    type: p.type,
    livraison_offerte: p.type === 'LIVRAISON_OFFERTE',
    message,
    code_normalise: (p.code || '').toUpperCase(),
  });
});

// API — Créer une commande BROUILLON WhatsApp
// Appelée par la modale WhatsApp AVANT d'ouvrir wa.me
// Le caissier voit la commande arriver en temps réel dans /ventes-web/
router.post('/api/whatsapp/creer-brouillon', express.json(), (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { items, nom, tel, code_promo } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, erreur: 'Aucun produit sélectionné' });
  }

  // Charger les produits et calculer les totaux
  let sousTotal = 0;
  const lignes = [];
  for (const raw of items) {
    const pid = Number(raw.id);
    const q = Math.max(1, Number(raw.quantite) || 1);
    const suppIds = Array.isArray(raw.supplements) ? raw.supplements.map(Number) : [];
    const p = chargerProduit(pid);
    if (!p) continue;
    const suppsChoisis = (p.supplements || []).filter(s => suppIds.includes(Number(s.id)));
    const prixSupp = suppsChoisis.reduce((s, x) => s + Number(x.prix), 0);
    const prixUnit = Number(p.prix_vente) + prixSupp;
    const totalLigne = prixUnit * q;
    sousTotal += totalLigne;
    lignes.push({
      produit_id: pid, activite_id: p.activite_id, designation: p.designation,
      prix_unitaire: prixUnit, quantite: q, supplements: suppsChoisis,
    });
  }
  if (!lignes.length) return res.status(400).json({ ok: false, erreur: 'Produits introuvables' });

  // Appliquer promo (code saisi ou meilleure auto)
  let promotionId = null, remisePromo = 0, codePromoApplique = '';
  const itemsPourPromo = lignes.map(l => ({
    id: l.produit_id, total: l.prix_unitaire * l.quantite,
    categorie_id: chargerProduit(l.produit_id)?.categorie_id || null,
  }));
  if (code_promo) {
    const check = h.verifierPromotion(db, code_promo, { sousTotal, panierItems: itemsPourPromo, clientTel: String(tel || '').trim() });
    if (check.ok) {
      promotionId = check.promotion.id;
      codePromoApplique = check.promotion.code || '';
      if (check.promotion.type !== 'LIVRAISON_OFFERTE') remisePromo = check.remise;
    }
  } else {
    // Meilleure promo auto
    const autoPromos = h.chargerPromotionsAutoActives(db);
    let meilleure = null, meilleureRemise = 0;
    for (const promo of autoPromos) {
      if (promo.panier_min > 0 && sousTotal < promo.panier_min) continue;
      let base = sousTotal;
      if (promo.categorie_id || promo.produit_id) {
        base = itemsPourPromo
          .filter(it => (promo.produit_id ? it.id === promo.produit_id : true))
          .filter(it => (promo.categorie_id ? it.categorie_id === promo.categorie_id : true))
          .reduce((s, it) => s + it.total, 0);
        if (base === 0) continue;
      }
      let remise = 0;
      if (promo.type === 'POURCENTAGE') remise = Math.round(base * promo.valeur / 100);
      else if (promo.type === 'MONTANT_FIXE') remise = Math.min(Math.round(promo.valeur), base);
      if (remise > meilleureRemise) { meilleure = promo; meilleureRemise = remise; }
    }
    if (meilleure) { promotionId = meilleure.id; codePromoApplique = 'AUTO-' + meilleure.nom.slice(0, 20); remisePromo = meilleureRemise; }
  }

  const total = Math.max(0, sousTotal - remisePromo);
  const codeSuivi = genererCodeSuivi();
  let commandeId;

  const trx = db.transaction(() => {
    // Retrait par défaut (le canal WhatsApp est plutôt discussion — le caissier ajustera)
    const info = db.prepare(`INSERT INTO commande_client_web
      (code_suivi, client_nom, client_tel, mode_recuperation, quartier, adresse,
       sous_total, frais_livraison, total, statut, notes_client, mode_paiement_prevu,
       promotion_id, code_promo_utilise, remise_promo)
      VALUES (?, ?, ?, 'RETRAIT', '', '', ?, 0, ?, 'WHATSAPP_ATTENTE', ?, 'ESPECES', ?, ?, ?)`)
      .run(
        codeSuivi,
        String(nom || '').trim() || 'Client WhatsApp',
        String(tel || '').trim(),
        sousTotal, total,
        'Commande envoyée via WhatsApp — infos client à confirmer par téléphone',
        promotionId, codePromoApplique, remisePromo
      );
    commandeId = Number(info.lastInsertRowid);

    const insL = db.prepare(`INSERT INTO ligne_commande_client_web
      (commande_id, produit_id, activite_id, designation, prix_unitaire, quantite)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const insSupp = db.prepare(`INSERT INTO ligne_commande_web_supplement
      (ligne_id, supplement_id, nom, prix) VALUES (?, ?, ?, ?)`);
    for (const l of lignes) {
      const infoL = insL.run(commandeId, l.produit_id, l.activite_id, l.designation, l.prix_unitaire, l.quantite);
      const ligneId = Number(infoL.lastInsertRowid);
      for (const s of l.supplements) insSupp.run(ligneId, s.id, s.nom, Number(s.prix));
    }
  });
  trx();

  // Enregistrer l'usage de la promo si applicable
  if (promotionId) {
    try { h.enregistrerUsagePromotion(db, promotionId, { commandeWebId: commandeId, clientTel: String(tel || '').trim(), remise: remisePromo }); }
    catch(e) {}
  }

  res.json({ ok: true, code_suivi: codeSuivi, commande_id: commandeId, total });
});

// API — liste allégée des produits du canal en ligne (pour le modal WhatsApp)
// Retourne juste ce qui est nécessaire à l'affichage d'une liste sélectionnable.
router.get('/api/produits-liste', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { produits, canalDesactive } = chargerProduitsCanalWeb();
  if (canalDesactive) return res.json({ produits: [], canal_desactive: true });
  const allege = produits.map(p => ({
    id: p.id,
    nom: p.designation,
    prix: Number(p.prix_vente),
    categorie: p.categorie_nom || 'Divers',
    categorie_id: p.categorie_id || null,
    activite: p.activite_code,
    activite_id: p.activite_id || null,
    unite: p.unite || '',
    image: p.image ? ('/media' + (p.image.startsWith('/') ? p.image : '/' + p.image)) : null,
    emoji: emojiFallback(p.designation, p.categorie_nom),
    supplements: (p.supplements || []).map(s => ({
      id: Number(s.id),
      nom: s.nom,
      prix: Number(s.prix),
    })),
  }));
  res.json({ produits: allege, canal_desactive: false });
});

module.exports = router;
