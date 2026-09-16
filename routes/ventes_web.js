const express = require('express');

const db = require('../src/db');
const h = require('../src/helpers');

const router = express.Router();

// =========================================================
// COMMANDES EN LIGNE (B2C) — back-office caissier
//
// Les commandes arrivent du site public /commander/ (routes/public.js) et
// suivent ce cycle de vie :
//   WHATSAPP_ATTENTE → NOUVELLE → CONFIRMEE → PRETE → RECUPEREE | LIVREE
// avec ANNULEE possible tant que la commande n'est pas clôturée.
//
// La finalisation (RECUPEREE / LIVREE) crée une VRAIE vente en caisse :
// ticket numéroté, sortie de stock et écriture comptable, exactement comme
// un encaissement au comptoir.
// =========================================================

// Transitions autorisées — toute autre combinaison est refusée.
const TRANSITIONS = {
  WHATSAPP_ATTENTE: ['NOUVELLE', 'ANNULEE'],
  NOUVELLE:         ['CONFIRMEE', 'ANNULEE'],
  CONFIRMEE:        ['PRETE', 'ANNULEE'],
  PRETE:            ['RECUPEREE', 'LIVREE', 'ANNULEE'],
  RECUPEREE:        [],
  LIVREE:           [],
  ANNULEE:          [],
};
// Commandes « à traiter » : celles qui demandent encore un geste du caissier.
const STATUTS_ACTIFS = ['WHATSAPP_ATTENTE', 'NOUVELLE', 'CONFIRMEE', 'PRETE'];
const STATUTS_CLOTURES = ['RECUPEREE', 'LIVREE', 'ANNULEE'];

// Traiter les commandes web fait partie du métier caisse : même permission.
function requireCaisse(req, res, next) {
  if (h.utilisateurPeut(db, req.user, 'caisse.utiliser', req.activiteId)) return next();
  req.flash('error', "Vous n'avez pas la permission de traiter les commandes en ligne.");
  return res.redirect('/tableau-de-bord/');
}
router.use(requireCaisse);

// Périmètre : une commande est visible si au moins une de ses lignes appartient
// à une activité accessible à l'utilisateur (un caissier BUR ne voit pas les
// commandes Pâtisserie).
function perimetre(req) {
  const ids = h.activitesAccessibles(db, req.user);
  return { ids, placeholders: ids.map(() => '?').join(',') };
}
function clauseScope(placeholders) {
  return `EXISTS (SELECT 1 FROM ligne_commande_client_web l
                  WHERE l.commande_id = c.id AND l.activite_id IN (${placeholders}))`;
}

// =========================================================
// API temps réel (polling sidebar + liste + détail)
// =========================================================
router.get('/api/count-nouvelles', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { ids, placeholders } = perimetre(req);
  if (!ids.length) return res.json({ nb_nouvelles: 0, nb_actives: 0, derniere: null, derniere_modif: null });
  const scope = clauseScope(placeholders);
  const agg = db.prepare(`SELECT
        SUM(CASE WHEN c.statut = 'NOUVELLE' THEN 1 ELSE 0 END) AS nb_nouvelles,
        SUM(CASE WHEN c.statut IN ('NOUVELLE', 'CONFIRMEE', 'PRETE') THEN 1 ELSE 0 END) AS nb_actives,
        MAX(c.modifie_le) AS derniere_modif
      FROM commande_client_web c WHERE ${scope}`).get(...ids);
  const derniere = db.prepare(`SELECT c.code_suivi, c.client_nom, c.total
                               FROM commande_client_web c
                               WHERE ${scope} AND c.statut = 'NOUVELLE'
                               ORDER BY c.date_creation DESC, c.id DESC LIMIT 1`).get(...ids);
  res.json({
    nb_nouvelles: Number((agg && agg.nb_nouvelles) || 0),
    nb_actives: Number((agg && agg.nb_actives) || 0),
    derniere: derniere || null,
    derniere_modif: (agg && agg.derniere_modif) || null,
  });
});

// Le client peut modifier ou annuler sa commande pendant que le caissier la consulte.
router.get('/api/commande/:id(\\d+)', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { ids, placeholders } = perimetre(req);
  if (!ids.length) return res.status(404).json({ erreur: 'Hors périmètre' });
  const c = db.prepare(`SELECT c.id, c.statut, c.modifie_le FROM commande_client_web c
                        WHERE c.id = ? AND ${clauseScope(placeholders)}`).get(req.params.id, ...ids);
  if (!c) return res.status(404).json({ erreur: 'Commande introuvable' });
  res.json(c);
});

// =========================================================
// LISTE
// =========================================================
router.get('/', (req, res) => {
  const { ids, placeholders } = perimetre(req);
  const statutFiltre = String(req.query.statut || 'ACTIVES').toUpperCase();
  const periode = h.resoudrePeriode(req.query);
  if (!ids.length) {
    return res.render('ventes_web/liste', {
      title: 'Commandes en ligne', page_title: 'Commandes en ligne',
      commandes: [], stats: { whatsapp: 0, nouvelle: 0, confirmee: 0, prete: 0, fin: 0 },
      statut_filtre: statutFiltre, periode,
      pagination: h.paginationInfo(h.pagination(req), 0, req),
    });
  }
  const scope = clauseScope(placeholders);

  // KPI : calculés sur tout le périmètre, sans le filtre de période — ils
  // représentent la charge de travail réelle, pas le contenu de la page.
  const parStatut = {};
  for (const r of db.prepare(`SELECT c.statut, COUNT(*) AS n FROM commande_client_web c
                              WHERE ${scope} GROUP BY c.statut`).all(...ids)) {
    parStatut[r.statut] = r.n;
  }
  const stats = {
    whatsapp:  parStatut.WHATSAPP_ATTENTE || 0,
    nouvelle:  parStatut.NOUVELLE || 0,
    confirmee: parStatut.CONFIRMEE || 0,
    prete:     parStatut.PRETE || 0,
    fin:       (parStatut.RECUPEREE || 0) + (parStatut.LIVREE || 0),
  };

  const filtres = [scope];
  const params = [...ids];
  if (statutFiltre === 'ACTIVES') {
    filtres.push(`c.statut IN (${STATUTS_ACTIFS.map(() => '?').join(',')})`);
    params.push(...STATUTS_ACTIFS);
  } else if (statutFiltre !== 'TOUTES') {
    filtres.push('c.statut = ?');
    params.push(statutFiltre);
  }
  if (periode.debut) { filtres.push('date(c.date_creation) >= date(?)'); params.push(periode.debut); }
  if (periode.fin)   { filtres.push('date(c.date_creation) <= date(?)'); params.push(periode.fin); }
  const where = filtres.join(' AND ');

  const p = h.pagination(req);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM commande_client_web c WHERE ${where}`).get(...params).n;
  const commandes = db.prepare(`SELECT c.* FROM commande_client_web c WHERE ${where}
                                ORDER BY CASE c.statut
                                           WHEN 'WHATSAPP_ATTENTE' THEN 0 WHEN 'NOUVELLE' THEN 1
                                           WHEN 'CONFIRMEE' THEN 2 WHEN 'PRETE' THEN 3 ELSE 4 END,
                                         c.date_creation DESC, c.id DESC
                                LIMIT ? OFFSET ?`).all(...params, p.taille, p.offset);

  // Activités concernées + nombre d'articles : une seule requête pour toute la page
  if (commandes.length) {
    const ph = commandes.map(() => '?').join(',');
    const lignes = db.prepare(`SELECT l.commande_id, l.quantite, a.code, a.couleur
                               FROM ligne_commande_client_web l
                               JOIN activite a ON a.id = l.activite_id
                               WHERE l.commande_id IN (${ph}) ORDER BY l.id`).all(...commandes.map(c => c.id));
    const parCmd = new Map();
    for (const l of lignes) {
      if (!parCmd.has(l.commande_id)) parCmd.set(l.commande_id, { nb: 0, acts: new Map() });
      const e = parCmd.get(l.commande_id);
      e.nb += Number(l.quantite);
      if (!e.acts.has(l.code)) e.acts.set(l.code, { code: l.code, couleur: l.couleur });
    }
    for (const c of commandes) {
      const e = parCmd.get(c.id) || { nb: 0, acts: new Map() };
      c.nb_articles = e.nb;
      c.activites_concernees = [...e.acts.values()];
    }
  }

  res.render('ventes_web/liste', {
    title: 'Commandes en ligne', page_title: 'Commandes en ligne',
    commandes, stats, statut_filtre: statutFiltre, periode,
    pagination: h.paginationInfo(p, total, req),
  });
});

// =========================================================
// CHARGEMENT D'UNE COMMANDE COMPLÈTE
// =========================================================
function chargerCommande(id, ids) {
  if (!ids.length) return null;
  const placeholders = ids.map(() => '?').join(',');
  const cmd = db.prepare(`SELECT c.* FROM commande_client_web c
                          WHERE c.id = ? AND ${clauseScope(placeholders)}`).get(id, ...ids);
  if (!cmd) return null;

  const lignes = db.prepare(`SELECT l.*, a.code AS activite_code, a.couleur AS activite_couleur,
                                    p.stock_actuel, p.stock_maximum
                             FROM ligne_commande_client_web l
                             JOIN activite a ON a.id = l.activite_id
                             LEFT JOIN produit p ON p.id = l.produit_id
                             WHERE l.commande_id = ? ORDER BY l.id`).all(cmd.id);
  const supplements = db.prepare(`SELECT s.* FROM ligne_commande_web_supplement s
                                  JOIN ligne_commande_client_web l ON l.id = s.ligne_id
                                  WHERE l.commande_id = ? ORDER BY s.id`).all(cmd.id);
  // Ordres de cuisine déjà lancés pour cette commande (hors ordres annulés)
  const productions = db.prepare(`SELECT * FROM production
                                  WHERE commande_web_id = ? AND COALESCE(statut, 'TERMINEE') <> 'ANNULEE'
                                  ORDER BY id`).all(cmd.id);

  let nbAProduire = 0;
  let nbEnProduction = 0;
  for (const l of lignes) {
    l.supplements = supplements.filter(s => s.ligne_id === l.id);
    // « Cuisine » = produit fini, c.-à-d. disposant d'une fiche technique active.
    // Les produits de revente (boissons, canettes) ne se produisent pas.
    l.est_kitchen = !!db.prepare('SELECT 1 FROM fiche_technique WHERE produit_id = ? AND actif = 1').get(l.produit_id);
    l.stock_actuel = Number(l.stock_actuel || 0);
    l.manque = Math.max(0, Number(l.quantite) - l.stock_actuel);
    l.production = productions.find(pr => pr.produit_id === l.produit_id) || null;
    l.a_produire = l.est_kitchen && !l.production && l.manque > 0;
    if (l.a_produire) nbAProduire++;
    if (l.production && l.production.statut !== 'TERMINEE') nbEnProduction++;
  }
  return { ...cmd, lignes, nb_a_produire: nbAProduire, nb_en_production: nbEnProduction };
}

router.get('/:id(\\d+)', (req, res) => {
  const { ids } = perimetre(req);
  const commande = chargerCommande(req.params.id, ids);
  if (!commande) { req.flash('error', 'Commande introuvable.'); return res.redirect('/ventes-web/'); }
  res.render('ventes_web/detail', {
    title: 'Commande ' + commande.code_suivi,
    page_title: 'Commande ' + commande.code_suivi,
    commande,
  });
});

// =========================================================
// OUTILS DE FINALISATION
// =========================================================

// Note reprise sur le ticket de caisse, pour retrouver l'origine web.
function noteVente(cmd) {
  const lieu = cmd.quartier ? ` (${cmd.quartier})` : '';
  return `Web ${cmd.code_suivi} · ${cmd.client_nom} · ${cmd.client_tel}${lieu}`;
}

// Produit système facturant les frais de livraison, créé à la demande dans
// l'activité concernée. Il est masqué de la caisse et du catalogue par le
// filtre `reference NOT LIKE 'FRAIS-%'` présent dans les autres modules.
function produitFraisLivraison(activiteId, montant) {
  const existant = db.prepare("SELECT * FROM produit WHERE activite_id = ? AND reference = 'FRAIS-LIV'").get(activiteId);
  if (existant) return existant;
  let cat = db.prepare("SELECT * FROM categorie WHERE activite_id = ? AND nom = 'Services'").get(activiteId);
  if (!cat) {
    const infoCat = db.prepare("INSERT INTO categorie (activite_id, nom, description) VALUES (?, 'Services', 'Frais annexes non stockés')").run(activiteId);
    cat = { id: Number(infoCat.lastInsertRowid) };
  }
  const info = db.prepare(`INSERT INTO produit
      (activite_id, reference, designation, description, categorie_id,
       prix_achat, prix_vente, stock_actuel, stock_minimum, stock_maximum, unite, actif)
      VALUES (?, 'FRAIS-LIV', 'Frais de livraison', 'Frais de livraison — produit système, ne pas modifier',
              ?, 0, ?, 0, 0, 0, 'unité', 1)`).run(activiteId, cat.id, Number(montant) || 0);
  return db.prepare('SELECT * FROM produit WHERE id = ?').get(Number(info.lastInsertRowid));
}

// Sortie de stock d'une ligne web.
// Différence avec la caisse comptoir : on n'échoue JAMAIS sur un stock
// insuffisant. Le client peut commander un produit en rupture (le caissier
// l'envoie alors en cuisine) ; le stock est simplement ramené à 0 sans passer
// en négatif.
function sortirStock(ligne, numero, cmd, utilisateurId) {
  const p = db.prepare('SELECT * FROM produit WHERE id = ?').get(ligne.produit_id);
  if (!p) return;
  if (Number(p.stock_maximum) <= 0) return; // produit non stocké (frais, service)
  const avant = Number(p.stock_actuel || 0);
  const apres = Math.max(0, avant - Number(ligne.quantite));
  db.prepare(`INSERT INTO mouvement_stock
      (activite_id, produit_id, type, quantite, motif, reference_doc, stock_avant, stock_apres, utilisateur_id, date_mouvement)
      VALUES (?, ?, 'SORTIE', ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(p.activite_id, p.id, Number(ligne.quantite),
         `Livraison vente ${numero} (Web ${cmd.code_suivi})`, numero, avant, apres, utilisateurId);
  db.prepare("UPDATE produit SET stock_actuel = ?, modifie_le = datetime('now') WHERE id = ?").run(apres, p.id);
  h.verifierAlerte(db, { ...p, stock_actuel: apres });
}

// Encaissement : une vente par activité concernée (chaque caisse encaisse ce
// qui la concerne), stock débité et écriture comptable passée.
function finaliser(req, cmd, statutFinal) {
  const mode = String(req.body.mode_paiement || '').toUpperCase();
  if (!h.MODES_PAIEMENT_B2C.some(m => m[0] === mode)) throw new Error('Mode de paiement invalide.');
  if (!cmd.lignes.length) throw new Error('Commande sans article.');

  const groupes = new Map();
  for (const l of cmd.lignes) {
    if (!groupes.has(l.activite_id)) groupes.set(l.activite_id, []);
    groupes.get(l.activite_id).push(l);
  }
  // Les frais de livraison ne sont facturés qu'une fois, sur l'activité de la
  // première ligne de la commande.
  const activiteFrais = cmd.lignes[0].activite_id;
  const sousTotal = cmd.lignes.reduce((s, l) => s + Number(l.prix_unitaire) * Number(l.quantite), 0);
  const remiseTotale = Number(cmd.remise_promo || 0);
  const numeros = [];

  db.transaction(() => {
    let remiseRestante = remiseTotale;
    let index = 0;
    for (const [activiteId, lignes] of groupes) {
      index++;
      const act = db.prepare('SELECT * FROM activite WHERE id = ?').get(activiteId);
      const numero = h.prochainNumeroVente(db, act.code);
      const sousTotalGroupe = lignes.reduce((s, l) => s + Number(l.prix_unitaire) * Number(l.quantite), 0);
      // Remise promo répartie au prorata du sous-total ; le dernier groupe
      // absorbe l'arrondi pour que la somme encaissée retombe sur le total.
      const remise = (index === groupes.size)
        ? remiseRestante
        : Math.round(remiseTotale * (sousTotalGroupe / (sousTotal || 1)));
      remiseRestante -= remise;
      const frais = (activiteId === activiteFrais) ? Number(cmd.frais_livraison || 0) : 0;
      const montantTotal = sousTotalGroupe + frais;
      const montantPaye = montantTotal - remise;

      const info = db.prepare(`INSERT INTO vente
          (activite_id, numero, caissier_id, client_id, mode_paiement, montant_total, montant_remise,
           montant_tva, taux_tva, montant_paye, notes, origine, commande_web_id)
          VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 0, ?, ?, 'WEB', ?)`)
        .run(activiteId, numero, req.user.id, mode, montantTotal, remise, montantPaye, noteVente(cmd), cmd.id);
      const venteId = Number(info.lastInsertRowid);

      const insLigne = db.prepare('INSERT INTO ligne_vente (vente_id, produit_id, quantite, prix_unitaire, remise) VALUES (?, ?, ?, ?, 0)');
      for (const l of lignes) {
        // prix_unitaire inclut déjà les suppléments choisis par le client
        insLigne.run(venteId, l.produit_id, Number(l.quantite), Number(l.prix_unitaire));
        sortirStock(l, numero, cmd, req.user.id);
      }
      if (frais > 0) {
        const pf = produitFraisLivraison(activiteId, frais);
        insLigne.run(venteId, pf.id, 1, frais);
      }

      // Comptabilité — encaissement caisse (pas de TVA sur le canal B2C en ligne)
      // Débit 57x Caisse activité · Crédit 707 Ventes de marchandises
      if (montantPaye > 0) {
        h.enregistrerEcriture(db, {
          journal: h.journalCaisseActivite(db, act.code),
          libelle: `Vente ${numero} (${mode}) — Web ${cmd.code_suivi}`,
          lignes: [
            { compte: h.compteCaisseActivite(db, act.code), debit: montantPaye, credit: 0 },
            { compte: '707', debit: 0, credit: montantPaye },
          ],
          referenceMetier: `VENTE#${venteId}`,
          activiteId,
          utilisateurId: req.user.id,
        });
      }
      numeros.push(numero);
    }
    db.prepare(`UPDATE commande_client_web
                SET statut = ?, date_fin = datetime('now'), modifie_le = datetime('now')
                WHERE id = ?`).run(statutFinal, cmd.id);
  })();

  h.journaliser(db, {
    user: req.user, activiteId: activiteFrais,
    action: statutFinal === 'LIVREE' ? 'CMD_WEB_LIVREE' : 'CMD_WEB_RECUPEREE',
    entite: 'commande_client_web', entite_id: cmd.id,
    details: `${cmd.code_suivi} · ${cmd.client_nom} · ${cmd.total} F · Paiement : ${mode} · Ventes : ${numeros.join(', ')}`,
  });
  req.flash('success', `Commande ${cmd.code_suivi} encaissée (${h.formatNombre(cmd.total)} F) — ticket ${numeros.join(', ')}.`);
}

function annuler(req, cmd) {
  const motif = String(req.body.motif_annulation || '').trim();
  if (motif.length < 3) throw new Error("le motif d'annulation est obligatoire (3 caractères minimum).");
  db.prepare(`UPDATE commande_client_web
              SET statut = 'ANNULEE', motif_annulation = ?, annulee_par = 'PERSONNEL',
                  date_fin = datetime('now'), modifie_le = datetime('now')
              WHERE id = ?`).run(motif.slice(0, 200), cmd.id);
  h.journaliser(db, {
    user: req.user, activiteId: req.activiteId,
    action: 'CMD_WEB_ANNULEE', entite: 'commande_client_web', entite_id: cmd.id,
    details: `${cmd.code_suivi} · ${cmd.client_nom} · Motif : ${motif}`,
  });
  req.flash('warning', `Commande ${cmd.code_suivi} annulée.`);
}

// Avancement simple : validation WhatsApp, confirmation, mise à disposition.
function avancer(req, cmd, cible) {
  if (cible === 'NOUVELLE') {
    db.prepare(`UPDATE commande_client_web SET statut = 'NOUVELLE', modifie_le = datetime('now')
                WHERE id = ?`).run(cmd.id);
  } else if (cible === 'CONFIRMEE') {
    db.prepare(`UPDATE commande_client_web
                SET statut = 'CONFIRMEE', date_confirmation = datetime('now'),
                    confirme_par_id = ?, modifie_le = datetime('now')
                WHERE id = ?`).run(req.user.id, cmd.id);
  } else if (cible === 'PRETE') {
    db.prepare(`UPDATE commande_client_web
                SET statut = 'PRETE', date_prete = datetime('now'), modifie_le = datetime('now')
                WHERE id = ?`).run(cmd.id);
  }
  const actions = { NOUVELLE: 'CMD_WEB_VALIDEE', CONFIRMEE: 'CMD_WEB_CONFIRMEE', PRETE: 'CMD_WEB_PRETE' };
  h.journaliser(db, {
    user: req.user, activiteId: req.activiteId,
    action: actions[cible], entite: 'commande_client_web', entite_id: cmd.id,
    details: `${cmd.code_suivi} · ${cmd.client_nom} · ${cmd.total} F`,
  });
  const messages = {
    NOUVELLE:  `Commande WhatsApp ${cmd.code_suivi} validée — à confirmer.`,
    CONFIRMEE: `Commande ${cmd.code_suivi} confirmée — en préparation.`,
    PRETE:     `Commande ${cmd.code_suivi} prête à remettre.`,
  };
  req.flash('success', messages[cible]);
}

// =========================================================
// CHANGEMENT DE STATUT
// =========================================================
router.post('/:id(\\d+)/statut', (req, res) => {
  const { ids } = perimetre(req);
  const retourListe = String(req.body.retour || '') === 'liste';
  const redirige = () => res.redirect(retourListe ? '/ventes-web/' : '/ventes-web/' + req.params.id);

  const cmd = chargerCommande(req.params.id, ids);
  if (!cmd) { req.flash('error', 'Commande introuvable.'); return res.redirect('/ventes-web/'); }

  const cible = String(req.body.statut || '').toUpperCase();
  const permises = TRANSITIONS[cmd.statut] || [];
  if (!permises.includes(cible)) {
    // Cas courant : le client a modifié ou annulé sa commande entre l'affichage
    // de la page et le clic du caissier.
    req.flash('error', `Transition impossible : ${cmd.statut} → ${cible || '?'}. La commande a peut-être changé entre-temps.`);
    return redirige();
  }

  try {
    if (cible === 'ANNULEE') annuler(req, cmd);
    else if (cible === 'RECUPEREE' || cible === 'LIVREE') finaliser(req, cmd, cible);
    else avancer(req, cmd, cible);
  } catch (e) {
    console.error('[ventes-web] statut', cmd.code_suivi, e);
    req.flash('error', 'Opération refusée : ' + e.message);
  }
  return redirige();
});

// =========================================================
// ENVOI EN CUISINE — crée les ordres de production manquants
// =========================================================
router.post('/:id(\\d+)/envoyer-cuisine', (req, res) => {
  const { ids } = perimetre(req);
  const cmd = chargerCommande(req.params.id, ids);
  if (!cmd) { req.flash('error', 'Commande introuvable.'); return res.redirect('/ventes-web/'); }
  const redirige = () => res.redirect('/ventes-web/' + cmd.id);

  if (STATUTS_CLOTURES.includes(cmd.statut)) {
    req.flash('warning', 'Cette commande est clôturée — aucun ordre de cuisine ne peut être lancé.');
    return redirige();
  }
  const aProduire = cmd.lignes.filter(l => l.a_produire);
  if (!aProduire.length) {
    req.flash('info', 'Rien à envoyer en cuisine : tous les articles sont disponibles ou déjà lancés.');
    return redirige();
  }

  const numeros = [];
  try {
    db.transaction(() => {
      for (const l of aProduire) {
        const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(l.produit_id);
        const act = db.prepare('SELECT * FROM activite WHERE id = ?').get(produit.activite_id);
        const fiche = db.prepare('SELECT * FROM fiche_technique WHERE produit_id = ? AND actif = 1').get(produit.id);
        if (!fiche) continue;
        const composition = db.prepare(`SELECT cf.quantite, p.prix_achat
                                        FROM composition_fiche cf JOIN produit p ON p.id = cf.ingredient_id
                                        WHERE cf.fiche_id = ?`).all(fiche.id);
        const rendement = Math.max(1, Number(fiche.rendement) || 1);
        // Coût matière estimé — informatif, non bloquant (comme /productions/nouveau)
        let coutMatiere = 0;
        for (const c of composition) {
          coutMatiere += (Number(c.quantite) * l.manque / rendement) * Number(c.prix_achat || 0);
        }
        const numero = h.prochainNumeroProduction(db, act.code);
        // BROUILLON : le gestionnaire valide la sortie des ingrédients avant que
        // le cuisinier ne lance la production (même workflow que /productions).
        db.prepare(`INSERT INTO production
            (activite_id, numero, produit_id, quantite_produite, produit_par_id, cout_matiere, notes, statut, commande_web_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'BROUILLON', ?)`)
          .run(act.id, numero, produit.id, l.manque, req.user.id, Math.round(coutMatiere),
               `Commande web ${cmd.code_suivi} — ${cmd.client_nom}`, cmd.id);
        numeros.push(numero);
      }
    })();
  } catch (e) {
    console.error('[ventes-web] cuisine', cmd.code_suivi, e);
    req.flash('error', "Échec de l'envoi en cuisine : " + e.message);
    return redirige();
  }

  if (!numeros.length) {
    req.flash('warning', "Aucun ordre créé : les produits concernés n'ont pas de fiche technique active.");
    return redirige();
  }
  h.journaliser(db, {
    user: req.user, activiteId: req.activiteId,
    action: 'CMD_WEB_CUISINE', entite: 'commande_client_web', entite_id: cmd.id,
    details: `${cmd.code_suivi} · ${numeros.length} ordre(s) : ${numeros.join(', ')}`,
  });
  req.flash('success', `${numeros.length} ordre(s) de production envoyé(s) en cuisine : ${numeros.join(', ')}.`);
  return redirige();
});

module.exports = router;
