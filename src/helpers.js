const config = require('./config');

function formatNombre(n) {
  if (n === null || n === undefined || n === '') return '0';
  const num = Number(n);
  if (Number.isNaN(num)) return '0';
  return Math.round(num).toLocaleString('fr-FR').replace(/ /g, ' ');
}

function formatDecimal(n, dec = 2) {
  const num = Number(n || 0);
  return num.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ============================================================
// PAGINATION — lit ?page et ?taille depuis l'URL, préserve les filtres
// ============================================================
// Retourne { page, taille, offset } à utiliser dans les requêtes SQL.
// Tailles autorisées : 5 à 200 (défaut 25). Bornes de sécurité pour éviter
// qu'un client crée `?taille=999999` qui exploserait la DB.
function pagination(req, tailleParDefaut = 25) {
  const taille = Math.min(200, Math.max(5, parseInt(req.query.taille, 10) || tailleParDefaut));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * taille;
  return { page, taille, offset };
}

// Enrichit avec les données nécessaires au template pagination.ejs
// - total : nombre total de résultats (obtenu via SELECT COUNT(*))
// - req : pour lire req.query et req.path (préservation des autres filtres)
// Retourne un objet exploitable directement par le partial pagination.ejs.
function paginationInfo(p, total, req) {
  const nbPages = Math.max(1, Math.ceil(Number(total) / p.taille));
  // Copie de req.query sans les clés qui changent (page, taille)
  const paramsFixes = {};
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === 'page' || k === 'taille') continue;
    if (v === '' || v === null || v === undefined) continue;
    paramsFixes[k] = String(v);
  }
  // req.path est relatif au router mount ; req.baseUrl donne le préfixe (ex: '/commandes').
  // Le combiné reproduit l'URL absolue attendue par le navigateur.
  const cheminComplet = (req.baseUrl || '') + req.path;
  function buildUrl(page, taille) {
    const q = new URLSearchParams(paramsFixes);
    if (taille) q.set('taille', taille);
    if (page)   q.set('page', page);
    const qs = q.toString();
    return cheminComplet + (qs ? '?' + qs : '');
  }
  return {
    page: p.page, taille: p.taille, offset: p.offset,
    total: Number(total),
    nbPages,
    debut: Number(total) === 0 ? 0 : p.offset + 1,
    fin: Math.min(p.offset + p.taille, Number(total)),
    hasPrev: p.page > 1,
    hasNext: p.page < nbPages,
    urlPage:   (page) => buildUrl(page, p.taille),
    urlTaille: (taille) => buildUrl(1, taille),
  };
}

// Résout un filtre de période depuis les paramètres URL (preset, debut, fin)
// Renvoie { debut, fin, preset, label } — bornes au format 'YYYY-MM-DD'
function resoudrePeriode(query) {
  const preset = String(query.preset || '').toLowerCase();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  // Formatage local (évite le décalage UTC qui décale d'un jour près de minuit)
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let debut, fin;
  if (query.debut && query.fin) {
    debut = String(query.debut); fin = String(query.fin);
    return { debut, fin, preset: 'personnalise', label: `du ${debut} au ${fin}` };
  }
  if (preset === 'aujourdhui') { debut = iso(now); fin = iso(now); return { debut, fin, preset, label: "Aujourd'hui" }; }
  if (preset === '7j') {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { debut: iso(d), fin: iso(now), preset, label: '7 derniers jours' };
  }
  if (preset === '30j') {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { debut: iso(d), fin: iso(now), preset, label: '30 derniers jours' };
  }
  if (preset === 'mois') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { debut: iso(d), fin: iso(now), preset, label: 'Ce mois' };
  }
  if (preset === 'mois_precedent') {
    const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
    return { debut: iso(d1), fin: iso(d2), preset, label: 'Mois précédent' };
  }
  if (preset === 'annee') { return { debut: `${now.getFullYear()}-01-01`, fin: iso(now), preset, label: `Année ${now.getFullYear()}` }; }
  return { debut: null, fin: null, preset: 'tous', label: 'Toutes les dates' };
}

// Normalise un nom pour comparaison : minuscules + suppression accents + suppression espaces multiples
// "École" et "ecole" et "ÉCOLE" et "  École  " donnent tous "ecole"
function normaliserNom(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD')                    // décompose les caractères accentués
    .replace(/[̀-ͯ]/g, '')     // supprime les marques diacritiques
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');               // normalise les espaces multiples
}

// Conversion d'un nombre en toutes lettres en français (mentions légales OHADA/Cameroun)
function montantEnLettres(nombre, devise = 'Francs CFA') {
  const n = Math.round(Number(nombre || 0));
  if (n === 0) return 'Zéro ' + devise;
  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

  // multiplie = true si le nombre sera suivi de mille/million/milliard (pas de "s" à cent/vingt)
  function moinsMille(n, multiplie) {
    if (n < 20) return units[n];
    if (n < 100) {
      const t = Math.floor(n / 10), u = n % 10;
      if (t === 7 || t === 9) {
        const dizBase = t === 7 ? 'soixante' : 'quatre-vingt';
        const reste = 10 + u;
        return dizBase + (reste === 11 && t === 7 ? ' et onze' : '-' + units[reste]);
      }
      // quatre-vingts → 's' seulement si en fin de nombre (pas multiplié)
      if (u === 0) return tens[t] + (t === 8 && !multiplie ? 's' : '');
      if (u === 1 && t !== 8) return tens[t] + ' et un';
      return tens[t] + '-' + units[u];
    }
    const c = Math.floor(n / 100), r = n % 100;
    // cent(s) : "s" seulement si multiplié et non suivi d'un nombre
    const centPart = c === 1 ? 'cent' : units[c] + ' cent' + (r === 0 && !multiplie ? 's' : '');
    return r === 0 ? centPart : centPart + ' ' + moinsMille(r, false);
  }

  const parts = [];
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;
  if (milliards) parts.push(moinsMille(milliards, true) + ' milliard' + (milliards > 1 ? 's' : ''));
  if (millions) parts.push(moinsMille(millions, true) + ' million' + (millions > 1 ? 's' : ''));
  if (milliers) parts.push((milliers === 1 ? '' : moinsMille(milliers, true) + ' ') + 'mille');
  if (reste) parts.push(moinsMille(reste, false));

  let phrase = parts.join(' ').trim();
  // Capitaliser la première lettre
  phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return phrase + ' ' + devise;
}

function formatDate(d, withTime = false) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  if (!withTime) return `${dd}/${mm}/${yyyy}`;
  const hh = String(dt.getHours()).padStart(2, '0');
  const mn = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mn}`;
}

function pluralize(n, s = '', p = 's') {
  return Number(n) > 1 ? p : s;
}

function truncate(s, n = 30) {
  if (!s) return '';
  return s.length > n ? s.substring(0, n - 1) + '...' : s;
}

function escapeJs(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
}

// Icone / couleur d'une categorie selon son nom
function categorieStyle(nom) {
  const n = (nom || '').toLowerCase();
  let icone = 'bi-box-seam';
  if (n.includes('phon') || n.includes('smart') || n.includes('mobile')) icone = 'bi-phone';
  else if (n.includes('clim')) icone = 'bi-snow';
  else if (n.includes('audio') || n.includes('musique') || n.includes('son') || n.includes('enceinte')) icone = 'bi-music-note-beamed';
  else if (n.includes('info') || n.includes('ordi') || n.includes('pc')) icone = 'bi-laptop';
  else if (n.includes('petit')) icone = 'bi-cup-hot';
  else if (n.includes('tv') || n.includes('télévis') || n.includes('televis')) icone = 'bi-tv';
  else if (n.includes('électro') || n.includes('electro') || n.includes('ménag') || n.includes('menag')) icone = 'bi-house';
  const palette = {
    'bi-tv': '#1e3a8a',
    'bi-snow': '#0e7490',
    'bi-phone': '#475569',
    'bi-music-note-beamed': '#7c2d12',
    'bi-laptop': '#1e293b',
    'bi-cup-hot': '#92400e',
    'bi-house': '#047857',
    'bi-box-seam': '#64748b',
  };
  return { icone, couleur: palette[icone] };
}

// ============================================================
// RÔLES — Le Traiteur du Bistrot (nommés, non génériques)
// ============================================================
const ROLES = {
  DG:           'DG',            // Direction Générale — vue totale, sélection activité
  SECRETARIAT:  'SECRETARIAT',   // Secrétariat — commandes/factures des activités B2B autorisées
  DISTRIBUTION: 'DISTRIBUTION',  // Responsable Distribution — lecture seule stocks toutes activités
  GESTIONNAIRE: 'GESTIONNAIRE',  // Gestionnaire — stock, achats, cuisine d'UNE activité
  CAISSIER:     'CAISSIER',      // Caissier — caisse d'UNE activité B2C
  CUISINIER:    'CUISINIER',     // Cuisinier — recettes + productions d'UNE activité
};

const ROLE_LABEL = {
  DG:           'Directrice Générale',
  SECRETARIAT:  'Secrétariat',
  DISTRIBUTION: 'Responsable Distribution',
  GESTIONNAIRE: 'Gestionnaire de stock',
  CAISSIER:     'Caissier',
  CUISINIER:    'Cuisinier',
};

const ROLE_LABEL_COURT = {
  DG:           'DG',
  SECRETARIAT:  'Secr.',
  DISTRIBUTION: 'Distrib.',
  GESTIONNAIRE: 'Gest.',
  CAISSIER:     'Caissier',
  CUISINIER:    'Cuisine',
};

// -------- Prédicats de rôle --------
function isDG(u)           { return u && u.role === 'DG'; }
function isSecretariat(u)  { return u && u.role === 'SECRETARIAT'; }
function isDistribution(u) { return u && u.role === 'DISTRIBUTION'; }
function isGestionnaire(u) { return u && u.role === 'GESTIONNAIRE'; }
function isCaissier(u)     { return u && u.role === 'CAISSIER'; }
function isCuisinier(u)    { return u && u.role === 'CUISINIER'; }

// Rétro-compat avec l'ancien code (à retirer progressivement)
function isAdmin(u)          { return isDG(u); }

// Peut gérer les utilisateurs et paramètres système
function canAdmin(u)         { return isDG(u); }

// Peut voir plusieurs activités (soit toutes, soit un sous-ensemble via utilisateur_activite)
function isTransversal(u)    { return u && (u.role === 'DG' || u.role === 'DISTRIBUTION' || u.role === 'SECRETARIAT'); }

// -------- Périmètre d'activités accessible à un utilisateur --------
// Retourne un tableau d'IDs d'activités auxquelles cet utilisateur a accès
function activitesAccessibles(db, user) {
  if (!user) return [];
  if (user.role === 'DG' || user.role === 'DISTRIBUTION') {
    return db.prepare('SELECT id FROM activite WHERE actif = 1 ORDER BY id').all().map(r => r.id);
  }
  if (user.role === 'SECRETARIAT') {
    return db.prepare('SELECT activite_id AS id FROM utilisateur_activite WHERE utilisateur_id = ?')
      .all(user.id).map(r => r.id);
  }
  // GESTIONNAIRE et CAISSIER : leur seule activité
  return user.activite_id ? [user.activite_id] : [];
}

// A-t-il accès à cette activité précise ?
function hasAccessToActivite(db, user, activiteId) {
  return activitesAccessibles(db, user).includes(Number(activiteId));
}

// L'activité "courante" à afficher :
//   - GESTIONNAIRE, CAISSIER : leur seule activité
//   - DG, DISTRIBUTION, SECRETARIAT : celle stockée en session (sélecteur topbar)
//     avec fallback sur la première accessible
function currentActiviteId(db, user, session) {
  if (!user) return null;
  const accessibles = activitesAccessibles(db, user);
  if (!accessibles.length) return null;
  if (!isTransversal(user)) return accessibles[0];
  const s = session && Number(session.activiteId);
  if (s && accessibles.includes(s)) return s;
  return accessibles[0];
}

// Peut-il **écrire** sur cette activité (produits, stocks, commandes, ventes…) ?
// Le CUISINIER n'écrit PAS via ce prédicat : il utilise ses propres routes cuisine.
function canWriteActivite(db, user, activiteId) {
  if (!user) return false;
  if (user.role === 'DISTRIBUTION') return false; // lecture seule
  if (user.role === 'CUISINIER') return false;    // limité aux modules cuisine (voir canWriteCuisine)
  return hasAccessToActivite(db, user, activiteId);
}

// Peut-il **écrire en cuisine** (productions, fiches techniques, alertes cuisine) ?
// Autorise le CUISINIER en plus des rôles gestionnaires classiques.
function canWriteCuisine(db, user, activiteId) {
  if (!user) return false;
  if (user.role === 'CUISINIER') return hasAccessToActivite(db, user, activiteId);
  return canWriteActivite(db, user, activiteId);
}

// ============================================================
// MODES DE PAIEMENT — B2C (caisse) et B2B (commande)
// ============================================================
const MODE_PAIEMENT_STYLES = {
  // B2C — Pâtisserie et Bona Burger
  ESPECES:  { couleur: '#047857', fond: '#ecfdf5', icone: 'bi-cash-stack',        label: 'Espèces' },
  CARTE:    { couleur: '#1e3a8a', fond: '#eff6ff', icone: 'bi-credit-card-2-front', label: 'Carte bancaire' },
  CARTE_CREDIT: { couleur: '#2563EB', fond: '#eff6ff', icone: 'bi-credit-card-fill', label: 'Carte de crédit' },
  ORANGE:   { couleur: '#ea580c', fond: '#fff7ed', icone: 'bi-phone-vibrate',     label: 'Orange Money' },
  MTN:      { couleur: '#ca8a04', fond: '#fefce8', icone: 'bi-phone-vibrate',     label: 'MTN Mobile Money' },
  // B2B — Traiteur et Cantine
  VIREMENT: { couleur: '#0891b2', fond: '#ecfeff', icone: 'bi-bank',              label: 'Virement bancaire' },
  CHEQUE:   { couleur: '#7c2d12', fond: '#fef2f2', icone: 'bi-card-text',         label: 'Chèque' },
  // Fallbacks
  MOBILE:   { couleur: '#0891b2', fond: '#ecfeff', icone: 'bi-phone-vibrate',     label: 'Mobile Money' },
  CREDIT:   { couleur: '#b91c1c', fond: '#fef2f2', icone: 'bi-clock-history',     label: 'Crédit' },
};

// Modes B2C (caisse quotidienne)
const MODES_PAIEMENT_B2C = [
  ['ESPECES',      'Espèces'],
  ['CARTE_CREDIT', 'Carte de crédit'],
  ['ORANGE',       'Orange Money'],
  ['MTN',          'MTN Mobile Money'],
];

// Modes B2B (sur commande — virement, chèque et espèces)
const MODES_PAIEMENT_B2B = [
  ['VIREMENT', 'Virement bancaire'],
  ['CHEQUE',   'Chèque'],
  ['ESPECES',  'Espèces'],
];

// Rétro-compat
const MODES_PAIEMENT_CHOICES = MODES_PAIEMENT_B2C;

const TYPE_MOUVEMENT_LABEL = {
  ENTREE:  'Entrée (réception)',
  SORTIE:  'Sortie (vente / consommation)',
  AJUST_P: 'Ajustement positif',
  AJUST_M: 'Ajustement négatif',
  RETOUR:  'Retour client',
  PERTE:   'Perte / casse',
};

const TYPES_MOUVEMENT_CHOICES = Object.entries(TYPE_MOUVEMENT_LABEL);

const NIVEAU_ALERTE_LABEL = {
  INFO: 'Information',
  ALERTE: 'Alerte',
  CRITIQUE: 'Critique',
};

const STATUT_INVENTAIRE_LABEL = {
  EN_COURS: 'En cours',
  VALIDE: 'Validé',
  ANNULE: 'Annulé',
};

// Statuts d'une commande B2B (Traiteur + Cantine)
// Cycle : PROFORMA → VALIDE → EN_PRODUCTION (opt) → LIVREE → FACTUREE → PAYEE
// À tout moment : ANNULEE
const STATUT_COMMANDE_LABEL = {
  PROFORMA:       'Proforma',
  VALIDE:         'Bon de commande',
  EN_PRODUCTION:  'En production',
  LIVREE:         'Livrée',
  FACTUREE:       'Facturée',
  PAYEE:          'Soldée',
  ANNULEE:        'Annulée',
};

// Couleurs de badge (Bootstrap-like)
const STATUT_COMMANDE_BADGE = {
  PROFORMA:       'bg-secondary',
  VALIDE:         'bg-info',
  EN_PRODUCTION:  'bg-primary',
  LIVREE:         'bg-warning',
  FACTUREE:       'bg-warning',
  PAYEE:          'bg-success',
  ANNULEE:        'bg-danger',
};

// Transitions autorisées : source → [cibles]
const STATUT_COMMANDE_TRANSITIONS = {
  PROFORMA:       ['VALIDE', 'ANNULEE'],
  VALIDE:         ['EN_PRODUCTION', 'LIVREE', 'ANNULEE'],
  EN_PRODUCTION:  ['LIVREE', 'ANNULEE'],
  LIVREE:         ['FACTUREE'],
  FACTUREE:       ['PAYEE'],           // via paiements — cette transition est calculée
  PAYEE:          [],
  ANNULEE:        [],
};

// Analyse du retard et du prochain niveau de relance recommandé
// Retourne : { jours_retard, prochain_niveau (J7/J15/J30/null), dernier_niveau_envoye, en_retard }
function analyseRelance(cmd, relancesEnvoyees = []) {
  const total = Number(cmd.montant_total || 0);
  const paye = Number(cmd.montant_paye || 0);
  const solde = total - paye;
  if (solde <= 0.01 || cmd.statut !== 'FACTUREE') {
    return { jours_retard: 0, prochain_niveau: null, dernier_niveau: null, en_retard: false, solde: 0 };
  }
  if (!cmd.date_echeance) return { jours_retard: 0, prochain_niveau: null, dernier_niveau: null, en_retard: false, solde };
  const ech = new Date(cmd.date_echeance); ech.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const joursRetard = Math.floor((now - ech) / 86400000);
  if (joursRetard < 0) return { jours_retard: joursRetard, prochain_niveau: null, dernier_niveau: null, en_retard: false, solde };

  const niveauxEnvoyes = new Set(relancesEnvoyees.map(r => r.niveau));
  let prochain = null;
  if (joursRetard >= 30 && !niveauxEnvoyes.has('J30')) prochain = 'J30';
  else if (joursRetard >= 15 && !niveauxEnvoyes.has('J15')) prochain = 'J15';
  else if (joursRetard >= 7 && !niveauxEnvoyes.has('J7')) prochain = 'J7';

  const dernier = relancesEnvoyees.length ? relancesEnvoyees[relancesEnvoyees.length - 1].niveau : null;
  return { jours_retard: joursRetard, prochain_niveau: prochain, dernier_niveau: dernier, en_retard: true, solde };
}

const NIVEAU_RELANCE_LABEL = {
  J7:  'Rappel amical (J+7)',
  J15: 'Rappel ferme (J+15)',
  J30: 'Mise en demeure (J+30)',
};
const NIVEAU_RELANCE_COULEUR = {
  J7:  'bg-info',
  J15: 'bg-warning',
  J30: 'bg-danger',
};
const CANAL_RELANCE_LABEL = {
  IMPRIMEE:  'Imprimée / remise en main propre',
  EMAIL:     'Email',
  TELEPHONE: 'Téléphone',
  SMS:       'SMS',
};

function statutPaiementCommande(cmd) {
  const total = Number(cmd.montant_total || 0);
  const paye = Number(cmd.montant_paye || 0);
  if (total <= 0) return { code: 'AUCUN', libelle: 'Aucun montant', couleur: 'bg-secondary' };
  if (paye <= 0) return { code: 'IMPAYE', libelle: 'Impayée', couleur: 'bg-danger' };
  if (paye + 0.01 < total) return { code: 'PARTIEL', libelle: `Acompte reçu (${Math.round(paye * 100 / total)}%)`, couleur: 'bg-warning' };
  return { code: 'SOLDE', libelle: 'Soldée', couleur: 'bg-success' };
}

const TYPE_CLIENT_LABEL = {
  PART: 'Particulier',
  ENTR: 'Entreprise',
};

function niveauStock(p) {
  if (p.stock_actuel <= 0) return 'RUPTURE';
  if (p.stock_actuel <= p.stock_minimum) return 'ALERTE';
  return 'OK';
}

function enrichirProduit(p) {
  if (!p) return p;
  const cat = categorieStyle(p.categorie_nom);
  return {
    ...p,
    icone: cat.icone,
    couleur_hex: cat.couleur,
    marge: Math.max((p.prix_vente || 0) - (p.prix_achat || 0), 0),
    valeur_stock: (p.prix_achat || 0) * (p.stock_actuel || 0),
    en_rupture: p.stock_actuel <= 0,
    en_alerte: p.stock_actuel <= p.stock_minimum,
    niveau_stock: niveauStock(p),
    taux_marge: p.prix_vente ? (((p.prix_vente - (p.prix_achat || 0)) / p.prix_vente) * 100) : 0,
  };
}

function statutPaiement(v) {
  const net = Number(v.montant_total || 0) - Number(v.montant_remise || 0) + Number(v.montant_tva || 0);
  const paye = Number(v.montant_paye || 0);
  if (paye >= net) return 'PAYE';
  if (paye > 0) return 'PARTIEL';
  return 'IMPAYE';
}

function enrichirVente(v) {
  if (!v) return v;
  const net = Number(v.montant_total || 0) - Number(v.montant_remise || 0) + Number(v.montant_tva || 0);
  const paye = Number(v.montant_paye || 0);
  const statut = statutPaiement(v);
  return {
    ...v,
    montant_ht: Number(v.montant_total || 0) - Number(v.montant_remise || 0),
    montant_net: net,
    reste_a_payer: Math.max(net - paye, 0),
    statut_paiement: statut,
    statut_paiement_libelle: { PAYE: 'Payée', PARTIEL: 'Partiel', IMPAYE: 'Impayée' }[statut],
    mode_paiement_style: MODE_PAIEMENT_STYLES[v.mode_paiement] || MODE_PAIEMENT_STYLES.ESPECES,
  };
}

// ============================================================
// NUMÉROTATION — format court avec année, par activité
// ============================================================
// Format : PREFIX-CODE_ACTIVITE-YYYY-XXXX
//   TIC-PAT-2026-0001  = ticket caisse Pâtisserie
//   PRO-TRAIT-2026-0001 = proforma Traiteur
//   CMD-CAN-2026-0001   = commande Cantine
//   FAC-TRAIT-2026-0001 = facture Traiteur
//   BL-TRAIT-2026-0001  = bon de livraison Traiteur
//   REC-TRAIT-2026-0001 = reçu de paiement Traiteur
//   CLO-PAT-2026-0001   = clôture caisse Pâtisserie

function prochainNumeroDocument(db, table, colonne, prefix, codeActivite) {
  const annee = new Date().getFullYear();
  const base = `${prefix}-${codeActivite}-${annee}-`;
  const row = db.prepare(`SELECT ${colonne} AS num FROM ${table} WHERE ${colonne} LIKE ? ORDER BY ${colonne} DESC LIMIT 1`)
    .get(base + '%');
  let n = 1;
  if (row) {
    const parsed = parseInt(row.num.substring(base.length), 10);
    if (!Number.isNaN(parsed)) n = parsed + 1;
  }
  return base + String(n).padStart(4, '0');
}

function prochainNumeroVente(db, codeActivite = 'PAT') {
  return prochainNumeroDocument(db, 'vente', 'numero', 'TIC', codeActivite);
}
function prochainNumeroCommande(db, codeActivite) {
  return prochainNumeroDocument(db, 'commande', 'numero', 'CMD', codeActivite);
}
function prochainNumeroProforma(db, codeActivite) {
  return prochainNumeroDocument(db, 'commande', 'numero_proforma', 'PRO', codeActivite);
}
function prochainNumeroBonCommande(db, codeActivite) {
  return prochainNumeroDocument(db, 'commande', 'numero_bon_commande', 'BC', codeActivite);
}
function prochainNumeroFacture(db, codeActivite) {
  return prochainNumeroDocument(db, 'commande', 'numero_facture', 'FAC', codeActivite);
}
function prochainNumeroBL(db, codeActivite) {
  return prochainNumeroDocument(db, 'commande', 'numero_bl', 'BL', codeActivite);
}
function prochainNumeroRecu(db, codeActivite) {
  return prochainNumeroDocument(db, 'paiement', 'numero_recu', 'REC', codeActivite);
}
function prochainNumeroCloture(db, codeActivite) {
  return prochainNumeroDocument(db, 'cloture_caisse', 'numero', 'CLO', codeActivite);
}
function prochainNumeroProduction(db, codeActivite) {
  return prochainNumeroDocument(db, 'production', 'numero', 'FAB', codeActivite);
}
// Achat et Distribution : globaux (pas par activité)
function prochainNumeroAchat(db) {
  const annee = new Date().getFullYear();
  const prefix = `ACH-${annee}-`;
  const row = db.prepare("SELECT numero FROM achat WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1").get(prefix + '%');
  let n = 1;
  if (row) { const p = parseInt(row.numero.substring(prefix.length), 10); if (!Number.isNaN(p)) n = p + 1; }
  return prefix + String(n).padStart(4, '0');
}
function prochainNumeroDistribution(db) {
  const annee = new Date().getFullYear();
  const prefix = `DIST-${annee}-`;
  const row = db.prepare("SELECT numero FROM distribution WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1").get(prefix + '%');
  let n = 1;
  if (row) { const p = parseInt(row.numero.substring(prefix.length), 10); if (!Number.isNaN(p)) n = p + 1; }
  return prefix + String(n).padStart(4, '0');
}

// Référence produit : PATxxx, TRAITxxx, CANxxx, BURxxx
function prochaineReferenceProduit(db, activiteId) {
  const activite = db.prepare('SELECT code FROM activite WHERE id = ?').get(activiteId);
  if (!activite) throw new Error('Activité introuvable');
  const code = activite.code;
  const row = db.prepare(`SELECT reference FROM produit WHERE activite_id = ? AND reference LIKE ? ORDER BY reference DESC LIMIT 1`)
    .get(activiteId, code + '%');
  let n = 1;
  if (row) {
    const suffix = row.reference.substring(code.length);
    const parsed = parseInt(suffix, 10);
    if (!Number.isNaN(parsed)) n = parsed + 1;
  }
  return code + String(n).padStart(3, '0');
}

// Référence inventaire : INV-CODE-YYYY-XXX
function prochaineReferenceInventaire(db, codeActivite = 'GEN') {
  return prochainNumeroDocument(db, 'inventaire', 'reference', 'INV', codeActivite).replace(/-(\d{4})$/, (_, s) => '-' + s.slice(1)); // 3 chiffres pour inventaire
}

// ============================================================
// FEATURES : catalogue des fonctionnalités contrôlables
// Utilisées dans les permissions granulaires par utilisateur
// ============================================================
const FEATURES = {
  // ---- Catalogue produits ----
  'produits.lire':            { module: 'Catalogue',      libelle: 'Consulter les produits' },
  'produits.ecrire':          { module: 'Catalogue',      libelle: 'Créer/modifier les produits' },
  'categories.gerer':         { module: 'Catalogue',      libelle: 'Gérer les catégories' },
  'fournisseurs.gerer':       { module: 'Catalogue',      libelle: 'Gérer les fournisseurs' },
  // ---- Stocks ----
  'stock.lire':               { module: 'Stocks',         libelle: "Voir l'état du stock" },
  'stock.mouvements':         { module: 'Stocks',         libelle: 'Enregistrer entrées/sorties/ajustements' },
  'stock.inventaires':        { module: 'Stocks',         libelle: 'Créer et valider des inventaires' },
  'stock.alertes':            { module: 'Stocks',         libelle: 'Voir/traiter les alertes' },
  'reception.confirmer':      { module: 'Stocks',         libelle: 'Confirmer les réceptions de distribution' },
  // ---- Achats & Distribution ----
  'achats.saisir':            { module: 'Achats',         libelle: "Saisir les bons d'achat", global: true },
  'achats.consulter':         { module: 'Achats',         libelle: "Consulter les achats", global: true },
  'achats.receptionner':      { module: 'Achats',         libelle: "Marquer un achat comme physiquement reçu", global: true },
  'achats.annuler':           { module: 'Achats',         libelle: "Annuler un bon d'achat", global: true },
  'distribution.creer':       { module: 'Distribution',   libelle: 'Créer des distributions internes', global: true },
  'distribution.remettre':    { module: 'Distribution',   libelle: 'Marquer une distribution comme remise', global: true },
  'distribution.consulter':   { module: 'Distribution',   libelle: 'Consulter les distributions', global: true },
  'distribution.annuler':     { module: 'Distribution',   libelle: 'Annuler une distribution non réceptionnée', global: true },
  // ---- Cuisine (fiches techniques + productions) ----
  'cuisine.recettes.lire':    { module: 'Cuisine',        libelle: 'Consulter les fiches techniques (recettes)' },
  'cuisine.recettes.ecrire':  { module: 'Cuisine',        libelle: 'Créer/modifier les fiches techniques' },
  'cuisine.production.creer': { module: 'Cuisine',        libelle: 'Créer une demande de production (BROUILLON)' },
  'cuisine.production.valider': { module: 'Cuisine',      libelle: "Valider la sortie d'ingrédients (rôle gestionnaire)" },
  'cuisine.production.terminer': { module: 'Cuisine',     libelle: 'Terminer une production (rôle cuisinier)' },
  'cuisine.alerter':          { module: 'Cuisine',        libelle: 'Alerter le gestionnaire (ingrédients manquants)' },
  // ---- Ventes B2C (caisse) ----
  'caisse.utiliser':          { module: 'Caisse B2C',     libelle: 'Utiliser la caisse (encaisser)' },
  'caisse.ouvrir':            { module: 'Caisse B2C',     libelle: 'Ouvrir une session de caisse (fond initial)' },
  'caisse.cloturer':          { module: 'Caisse B2C',     libelle: 'Clôturer sa session de caisse' },
  'caisse.etat.lire':         { module: 'Caisse B2C',     libelle: 'Consulter les états de caisse (tableau de bord)' },
  'caisse.etat.detail':       { module: 'Caisse B2C',     libelle: "Voir le détail d'un état de caisse" },
  'caisse.etat.pdf':          { module: 'Caisse B2C',     libelle: "Télécharger l'état de caisse en PDF" },
  'ventes.historique':        { module: 'Caisse B2C',     libelle: "Consulter l'historique des ventes" },
  // ---- Commandes B2B ----
  'commandes.saisir':         { module: 'Commandes B2B',  libelle: 'Saisir des commandes clients' },
  'proforma.editer':          { module: 'Commandes B2B',  libelle: 'Éditer des proformas' },
  'facture.emettre':          { module: 'Commandes B2B',  libelle: 'Émettre des factures + BL' },
  'facture.annuler':          { module: 'Commandes B2B',  libelle: 'Annuler une facture émise (sensible)' },
  'paiement.enregistrer':     { module: 'Commandes B2B',  libelle: 'Enregistrer les règlements' },
  'remise.exceptionnelle':    { module: 'Commandes B2B',  libelle: 'Accorder une remise > 10% (sensible)' },
  // ---- Clients ----
  'clients.gerer':            { module: 'Clients',        libelle: 'Créer/modifier les clients' },
  // ---- Intelligence ----
  'intelligence.acceder':     { module: 'Intelligence',   libelle: 'Prévisions, ABC, recommandations' },
  // ---- Dashboards ----
  'dashboard.activite':       { module: 'Dashboards',     libelle: "Voir le dashboard d'une activité" },
  'dashboard.consolide':      { module: 'Dashboards',     libelle: 'Voir le dashboard consolidé (multi-activités)' },
  'analytics.exporter':       { module: 'Dashboards',     libelle: 'Exporter les données en CSV (Power BI)' },
  // ---- Magasin central ----
  'magasin.lire':             { module: 'Magasin',        libelle: 'Consulter le magasin central', global: true },
  // ---- Comptabilité (OHADA) ----
  'compta.consulter':         { module: 'Comptabilité',   libelle: 'Consulter les journaux et le grand livre',   global: true },
  'compta.tva':               { module: 'Comptabilité',   libelle: 'Voir la déclaration TVA mensuelle',           global: true },
  'compta.plan_comptable':    { module: 'Comptabilité',   libelle: 'Voir le plan comptable OHADA',                global: true },
  'compta.exports':           { module: 'Comptabilité',   libelle: 'Exporter les fichiers comptables mensuels',   global: true },
  // ---- Administration (features globales, activite_id=NULL) ----
  'admin.utilisateurs':       { module: 'Administration', libelle: 'Gérer les utilisateurs', global: true },
  'admin.activites':          { module: 'Administration', libelle: 'Gérer les activités', global: true },
  'admin.parametres':         { module: 'Administration', libelle: 'Modifier les paramètres système', global: true },
  'admin.audit':              { module: 'Administration', libelle: "Consulter le journal d'audit", global: true },
};

// Grouper les features par module pour l'UI
function featuresByModule() {
  const modules = {};
  for (const [key, def] of Object.entries(FEATURES)) {
    if (!modules[def.module]) modules[def.module] = [];
    modules[def.module].push({ key, ...def });
  }
  return modules;
}

// Templates de permissions par rôle : liste des features autorisées par défaut
const ROLE_PERMISSIONS = {
  // La DG a tout SAUF les gestes de distribution (réceptionner, créer/remettre/annuler
  // des distributions) qui reviennent au Responsable Distribution.
  // Sur les distributions, la DG n'a que la CONSULTATION.
  // Elle garde les droits admin, la vue globale, et peut créer/annuler des achats.
  // Si un cas exceptionnel exige que la DG fasse un geste de distribution, elle peut
  // se l'accorder via /admin/utilisateurs/:id?onglet=permissions.
  DG: Object.keys(FEATURES).filter(k => ![
    'achats.receptionner',
    'distribution.creer',
    'distribution.remettre',
    'distribution.annuler',
  ].includes(k)),
  SECRETARIAT: [
    'produits.lire', 'categories.gerer', 'fournisseurs.gerer',
    'stock.lire', 'stock.alertes',
    'commandes.saisir', 'proforma.editer', 'facture.emettre',
    'paiement.enregistrer', 'ventes.historique', 'clients.gerer',
    'intelligence.acceder',
    'dashboard.activite', 'analytics.exporter',
    // Accès comptabilité (comme l'ancien requireCompta le faisait)
    'compta.consulter', 'compta.tva', 'compta.plan_comptable', 'compta.exports',
    // Consultation du magasin central (comme l'ancien requireAcces le faisait)
    'magasin.lire',
  ],
  DISTRIBUTION: [
    'produits.lire', 'stock.lire', 'stock.alertes', 'dashboard.consolide',
    'achats.consulter', 'achats.receptionner',
    'distribution.creer', 'distribution.remettre', 'distribution.consulter', 'distribution.annuler',
    'magasin.lire',
  ],
  GESTIONNAIRE: [
    'produits.lire', 'produits.ecrire', 'categories.gerer', 'fournisseurs.gerer',
    'stock.lire', 'stock.mouvements', 'stock.inventaires', 'stock.alertes',
    'reception.confirmer',
    // Consultation des recettes + validation des sorties d'ingrédients pour production
    'cuisine.recettes.lire',
    'cuisine.production.valider',
    // Consultation des états de caisse de son activité (pas d'action)
    'caisse.etat.lire', 'caisse.etat.detail', 'caisse.etat.pdf',
    'intelligence.acceder', 'dashboard.activite', 'analytics.exporter',
  ],
  CAISSIER: [
    'produits.lire',
    'caisse.utiliser', 'caisse.ouvrir', 'caisse.cloturer',
    'caisse.etat.lire', 'caisse.etat.detail', 'caisse.etat.pdf',
    'ventes.historique', 'clients.gerer',
    // Pas de tableau de bord (graphes/KPI) par défaut — la caisse est son espace de travail.
    // Si un DG veut exceptionnellement lui en donner l'accès, coche 'dashboard.activite' via l'admin.
  ],
  // Cuisinier : périmètre focalisé cuisine d'une activité
  // - Consulte produits + stock de son activité (voir dispos ingrédients)
  // - Gère recettes + lance et termine productions
  // - Peut alerter le gestionnaire quand il manque des ingrédients
  CUISINIER: [
    'produits.lire',
    'stock.lire', 'stock.alertes',
    'cuisine.recettes.lire', 'cuisine.recettes.ecrire',
    'cuisine.production.creer', 'cuisine.production.terminer',
    'cuisine.alerter',
    'dashboard.activite',
  ],
};

function permissionsParDefautDuRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

// ============================================================
// PERMISSIONS UTILISATEUR — vérification runtime
// ============================================================
// Logique :
//   1. On lit les surcharges (permission_utilisateur) pour cet user + activité
//   2. Si aucune surcharge : template du rôle
//   3. Sinon : template du rôle ± surcharges
function utilisateurPeut(db, user, feature, activiteId = null) {
  if (!user) return false;
  const featureDef = FEATURES[feature];
  const estGlobale = featureDef && featureDef.global;
  const actParam = estGlobale ? null : activiteId;

  // Vérifier surcharge explicite
  const surcharge = actParam === null
    ? db.prepare('SELECT autorise FROM permission_utilisateur WHERE utilisateur_id = ? AND feature = ? AND activite_id IS NULL').get(user.id, feature)
    : db.prepare('SELECT autorise FROM permission_utilisateur WHERE utilisateur_id = ? AND feature = ? AND activite_id = ?').get(user.id, feature, actParam);
  if (surcharge) return !!surcharge.autorise;

  // Pas de surcharge : appliquer le template du rôle
  const templateAutorise = ROLE_PERMISSIONS[user.role]?.includes(feature) || false;
  if (!templateAutorise) return false;

  // Le rôle autorise cette feature — vérifier que l'utilisateur a bien accès à l'activité si non global
  if (!estGlobale && actParam !== null) {
    return hasAccessToActivite(db, user, actParam);
  }
  return true;
}

// Middleware factory : bloque la requête si l'utilisateur n'a pas la feature demandée.
// Usage dans une route : router.get('/xxx', h.permissionRequise(db, 'caisse.etat.lire'), handler)
// Pour les features globales (global:true), req.activiteId est ignoré.
function permissionRequise(db, feature) {
  return function(req, res, next) {
    if (!req.user) { req.flash('info', 'Veuillez vous connecter.'); return res.redirect('/comptes/connexion'); }
    if (!utilisateurPeut(db, req.user, feature, req.activiteId)) {
      const lbl = FEATURES[feature]?.libelle || feature;
      req.flash('error', `Accès refusé : « ${lbl} » n'est pas autorisé pour votre compte.`);
      return res.redirect('/tableau-de-bord/');
    }
    next();
  };
}

// Retourne toutes les features autorisées pour un user (pour l'UI)
function permissionsEffectives(db, userId, activiteId = null) {
  const user = db.prepare('SELECT * FROM utilisateur WHERE id = ?').get(userId);
  if (!user) return {};
  const rolePerms = new Set(ROLE_PERMISSIONS[user.role] || []);
  const surcharges = activiteId === null
    ? db.prepare('SELECT feature, autorise FROM permission_utilisateur WHERE utilisateur_id = ? AND activite_id IS NULL').all(userId)
    : db.prepare('SELECT feature, autorise FROM permission_utilisateur WHERE utilisateur_id = ? AND activite_id = ?').all(userId, activiteId);
  const map = new Map(surcharges.map(s => [s.feature, s.autorise]));
  const out = {};
  for (const feature of Object.keys(FEATURES)) {
    if (map.has(feature)) out[feature] = !!map.get(feature);
    else out[feature] = rolePerms.has(feature);
  }
  return out;
}

// ============================================================
// PARAMÈTRES SYSTÈME — lus dans la table parametre
// ============================================================
let _parametresCache = null;
let _parametresCacheAt = 0;
const PARAMETRES_TTL_MS = 30000;

function chargerParametres(db) {
  const now = Date.now();
  if (_parametresCache && now - _parametresCacheAt < PARAMETRES_TTL_MS) return _parametresCache;
  const rows = db.prepare('SELECT cle, valeur, type FROM parametre').all();
  const map = {};
  for (const r of rows) {
    let v = r.valeur;
    if (r.type === 'nombre') v = parseFloat(v);
    else if (r.type === 'booleen') v = v === 'true' || v === '1';
    map[r.cle] = v;
  }
  _parametresCache = map;
  _parametresCacheAt = now;
  return map;
}

function invaliderCacheParametres() {
  _parametresCache = null;
  _parametresCacheAt = 0;
}

// ============================================================
// JOURS FÉRIÉS CAMEROUNAIS — pour blocage Cantine
// ============================================================
// Fériés fixes + Pâques/Ascension/Aïd calculés
function joursFeriesCameroun(annee) {
  const feries = new Map(); // 'YYYY-MM-DD' → nom

  // Fixes
  feries.set(`${annee}-01-01`, 'Jour de l\'An');
  feries.set(`${annee}-02-11`, 'Fête de la Jeunesse');
  feries.set(`${annee}-05-01`, 'Fête du Travail');
  feries.set(`${annee}-05-20`, 'Fête Nationale');
  feries.set(`${annee}-08-15`, 'Assomption');
  feries.set(`${annee}-12-25`, 'Noël');

  // Pâques (algo Meeus/Jones/Butcher)
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const mois = Math.floor((h + L - 7 * m + 114) / 31);
  const jour = ((h + L - 7 * m + 114) % 31) + 1;
  const paques = new Date(annee, mois - 1, jour);
  const lundiPaques = new Date(paques.getTime() + 86400000);
  const ascension = new Date(paques.getTime() + 39 * 86400000);
  const pentecote = new Date(paques.getTime() + 50 * 86400000);
  const isoDate = d => d.toISOString().slice(0, 10);
  feries.set(isoDate(lundiPaques), 'Lundi de Pâques');
  feries.set(isoDate(ascension), 'Ascension');
  feries.set(isoDate(pentecote), 'Lundi de Pentecôte');

  return feries;
}

function estJourFerie(date) {
  const d = date instanceof Date ? date : new Date(date);
  const feries = joursFeriesCameroun(d.getFullYear());
  return feries.get(d.toISOString().slice(0, 10)) || null;
}

// (helper sortieStockAvecFiche retiré — les ventes décrémentent toujours le produit fini.
//  Les fiches techniques ne servent qu'à la PRODUCTION en amont : la production sort les ingrédients
//  du stock et fait entrer le produit fini, puis la vente sort le produit fini.)

// ============================================================
// TYPES DE PRODUITS — déduits automatiquement de leur usage
// PRODUIT_FINI : a une fiche technique active (fabriqué en cuisine)
// INGREDIENT   : référencé dans une fiche technique (utilisé pour fabriquer)
// REVENTE      : ni ingrédient ni produit fini, mais vendu tel quel (prix_vente > 0)
// CONSOMMABLE  : ni ingrédient ni fini ni revendu (matériel, produits d'entretien, etc.)
// ============================================================
const TYPE_PRODUIT = {
  PRODUIT_FINI: { icone: 'bi-fire',       libelle: 'Produit fini',  couleur: '#CA8A04', bg: '#FEF3C7', desc: 'Fabriqué en cuisine à partir d\'ingrédients' },
  INGREDIENT:   { icone: 'bi-basket',     libelle: 'Ingrédient',    couleur: '#059669', bg: '#ECFDF5', desc: 'Utilisé pour fabriquer des produits finis' },
  REVENTE:      { icone: 'bi-cup-straw',  libelle: 'Revente directe', couleur: '#2563EB', bg: '#EFF6FF', desc: 'Vendu tel quel (boisson, canette...)' },
  CONSOMMABLE:  { icone: 'bi-box-seam',   libelle: 'Consommable',   couleur: '#64748B', bg: '#F1F5F9', desc: 'Ni vendu ni utilisé en cuisine (matériel...)' },
};

function getTypesProduits(db, activiteId) {
  const rows = db.prepare(`
    SELECT p.id, p.prix_vente,
      (SELECT 1 FROM fiche_technique ft WHERE ft.produit_id = p.id AND ft.actif = 1 LIMIT 1) AS a_fiche,
      (SELECT 1 FROM composition_fiche cf JOIN fiche_technique ft2 ON ft2.id = cf.fiche_id
        WHERE cf.ingredient_id = p.id AND ft2.actif = 1 LIMIT 1) AS est_ingredient
    FROM produit p WHERE p.activite_id = ?`).all(activiteId);
  const map = new Map();
  for (const r of rows) {
    let type;
    if (r.a_fiche) type = 'PRODUIT_FINI';
    else if (r.est_ingredient) type = 'INGREDIENT';
    else if (Number(r.prix_vente) > 0) type = 'REVENTE';
    else type = 'CONSOMMABLE';
    map.set(Number(r.id), type);
  }
  return map;
}

// Version pour un seul produit (utilisée dans le détail)
function getTypeProduit(db, produitId) {
  const p = db.prepare('SELECT prix_vente FROM produit WHERE id = ?').get(produitId);
  if (!p) return 'CONSOMMABLE';
  const aFiche = db.prepare('SELECT 1 FROM fiche_technique WHERE produit_id = ? AND actif = 1').get(produitId);
  if (aFiche) return 'PRODUIT_FINI';
  const estIng = db.prepare(`SELECT 1 FROM composition_fiche cf JOIN fiche_technique ft ON ft.id = cf.fiche_id
                             WHERE cf.ingredient_id = ? AND ft.actif = 1`).get(produitId);
  if (estIng) return 'INGREDIENT';
  return Number(p.prix_vente) > 0 ? 'REVENTE' : 'CONSOMMABLE';
}

// ============================================================
// JOURNAL D'AUDIT — traçabilité des opérations sensibles
// ============================================================
const AUDIT_ACTIONS = {
  // Utilisateurs
  UTIL_CREE:              'Création utilisateur',
  UTIL_MODIFIE:           'Modification utilisateur',
  UTIL_SUPPRIME:          'Suppression utilisateur',
  UTIL_ROLE_CHANGE:       'Changement de rôle',
  UTIL_ACTIVITE_CHANGE:   'Changement activité principale',
  UTIL_PERM_CHANGE:       'Modification des permissions',
  UTIL_ACTIVITE_BASCULE:  'Bascule assignation activité',
  UTIL_MDP_RESET:         'Réinitialisation mot de passe',
  // Activités
  ACTIVITE_CREE:          'Création d\'activité',
  ACTIVITE_MODIFIEE:      'Modification d\'activité',
  ACTIVITE_BASCULEE:      'Activation/désactivation activité',
  // Catalogue
  PRODUIT_SUPPRIME:       'Suppression produit',
  CATEGORIE_SUPPRIMEE:    'Suppression catégorie',
  FOURNISSEUR_SUPPRIME:   'Suppression fournisseur',
  CLIENT_SUPPRIME:        'Suppression client',
  // Ventes / commandes
  VENTE_ANNULEE:          'Annulation vente',
  COMMANDE_ANNULEE:       'Annulation commande',
  COMMANDE_FACTUREE:      'Émission facture',
  COMMANDE_LIVREE:        'Livraison commande',
  LIVRAISON_CREDIT:       'Livraison à crédit (autorisation DG)',
  PAIEMENT_ENREGISTRE:    'Enregistrement paiement',
  // Canal en ligne (/commander/ → /ventes-web/)
  CMD_WEB_VALIDEE:        'Validation commande WhatsApp',
  CMD_WEB_CONFIRMEE:      'Confirmation commande en ligne',
  CMD_WEB_PRETE:          'Commande en ligne prête',
  CMD_WEB_CUISINE:        'Envoi en cuisine (commande en ligne)',
  CMD_WEB_RECUPEREE:      'Commande en ligne récupérée et encaissée',
  CMD_WEB_LIVREE:         'Commande en ligne livrée et encaissée',
  CMD_WEB_ANNULEE:        'Annulation commande en ligne',
  CMD_LIGNE_MODIFIEE_CLIENT: 'Modification commande par le client',
  CMD_LIGNE_ANNULEE_CLIENT:  'Annulation commande par le client',
  RELANCE_ENVOYEE:        'Envoi relance',
  RELANCE_SUPPRIMEE:      'Suppression relance',
  // Achats / distributions
  ACHAT_ANNULE:           'Annulation achat',
  DISTRIBUTION_ANNULEE:   'Annulation distribution',
  RECEPTION_ECART:        'Réception avec écart',
  // Caisse
  CAISSE_OUVERTE:         'Ouverture caisse',
  CAISSE_CLOTUREE:        'Clôture caisse',
  CAISSE_ECART:           'Écart de caisse déclaré',
  // Paramètres
  PARAM_MODIFIE:          'Modification paramètre système',
};

// Actions considérées "critiques" (mises en avant dans la liste)
const AUDIT_ACTIONS_CRITIQUES = new Set([
  'UTIL_SUPPRIME', 'UTIL_ROLE_CHANGE', 'UTIL_MDP_RESET',
  'VENTE_ANNULEE', 'COMMANDE_ANNULEE', 'ACHAT_ANNULE', 'DISTRIBUTION_ANNULEE',
  'LIVRAISON_CREDIT', 'RECEPTION_ECART', 'CAISSE_ECART',
  'ACTIVITE_BASCULEE',
]);

/**
 * Enregistre une entrée dans le journal d'audit.
 * @param {*} db - instance sqlite
 * @param {object} opts - { user, activiteId, action, entite, entite_id, details }
 *                       action doit être une clé de AUDIT_ACTIONS
 */
function journaliser(db, { user, activiteId, action, entite, entite_id, details }) {
  try {
    if (!AUDIT_ACTIONS[action]) {
      console.warn('[audit] action inconnue :', action);
    }
    db.prepare(`INSERT INTO journal_audit (utilisateur_id, activite_id, action, entite, entite_id, details)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(user ? user.id : null, activiteId || null, action,
           entite || '', entite_id || null, details || '');
  } catch (e) {
    // L'audit ne doit jamais casser l'opération métier
    console.error('[audit] échec enregistrement :', e.message);
  }
}

// Un jour ouvré Cantine = lundi à vendredi non férié
function estJourOuvreCantine(date) {
  const d = date instanceof Date ? date : new Date(date);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !estJourFerie(d);
}

// Cree une alerte si le stock passe sous le seuil (avec activite_id)
function verifierAlerte(db, produit) {
  if (produit.stock_actuel <= 0) {
    db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, message, vue, creee_le)
                VALUES (?, ?, 'CRITIQUE', ?, 0, datetime('now'))`)
      .run(produit.activite_id, produit.id, `Rupture de stock pour ${produit.designation}`);
  } else if (produit.stock_actuel <= produit.stock_minimum) {
    const existe = db.prepare(`SELECT id FROM alerte WHERE produit_id = ? AND niveau = 'ALERTE' AND vue = 0`).get(produit.id);
    if (!existe) {
      db.prepare(`INSERT INTO alerte (activite_id, produit_id, niveau, message, vue, creee_le)
                  VALUES (?, ?, 'ALERTE', ?, 0, datetime('now'))`)
        .run(produit.activite_id, produit.id, `Stock bas pour ${produit.designation} : ${produit.stock_actuel} restant (seuil : ${produit.stock_minimum})`);
    }
  }
}

// Applique un mouvement de stock et cree l'alerte si necessaire (avec activite_id)
function appliquerMouvement(db, {
  produit_id, type, quantite, motif = '', reference_doc = '', utilisateur_id = null,
}) {
  const produit = db.prepare('SELECT * FROM produit WHERE id = ?').get(produit_id);
  if (!produit) throw new Error('Produit introuvable');
  const signe = ['ENTREE', 'AJUST_P', 'RETOUR'].includes(type) ? 1 : -1;
  const stock_avant = produit.stock_actuel;
  const stock_apres = stock_avant + signe * Math.abs(quantite);

  db.prepare(`INSERT INTO mouvement_stock
              (activite_id, produit_id, type, quantite, motif, reference_doc, stock_avant, stock_apres, utilisateur_id, date_mouvement)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(produit.activite_id, produit_id, type, Math.abs(quantite), motif, reference_doc, stock_avant, stock_apres, utilisateur_id);
  db.prepare('UPDATE produit SET stock_actuel = ?, modifie_le = datetime(\'now\') WHERE id = ?').run(stock_apres, produit_id);

  verifierAlerte(db, { ...produit, stock_actuel: stock_apres });
  return { stock_avant, stock_apres };
}

// ============================================================
// COMPTABILITÉ — Journalisation automatique
// ============================================================

// Taux TVA standard OHADA Cameroun
const TVA_TAUX = 0.1925;

// Extrait HT et TVA à partir d'un montant TTC (mode assujetti standard)
function decomposerTTC(ttc, taux = TVA_TAUX) {
  const ht = ttc / (1 + taux);
  const tva = ttc - ht;
  return { ht: Math.round(ht * 100) / 100, tva: Math.round(tva * 100) / 100, ttc };
}

// Retourne le journal / compte caisse d'une activité.
// Depuis la refonte dynamique, ces valeurs sont stockées sur la table `activite`
// (colonnes journal_code / compte_caisse) et provisionnées automatiquement à la création.
// Le paramètre `db` est nécessaire pour lookup. Le legacy map sert de fallback ultime.
const _LEGACY_JRN = { TRAIT: 'CA-TR', TRAITEUR: 'CA-TR', CAN: 'CA-CA', CANTINE: 'CA-CA',
                      PAT: 'CA-PA', PATISSERIE: 'CA-PA', BUR: 'CA-BU', BURGER: 'CA-BU' };
const _LEGACY_CPT = { TRAIT: '571', TRAITEUR: '571', CAN: '572', CANTINE: '572',
                      PAT: '573', PATISSERIE: '573', BUR: '574', BURGER: '574' };
function journalCaisseActivite(db, activiteCode) {
  const row = db.prepare('SELECT journal_code FROM activite WHERE code = ?').get(String(activiteCode || ''));
  if (row && row.journal_code) return row.journal_code;
  return _LEGACY_JRN[String(activiteCode || '').toUpperCase()] || 'CA-TR';
}
function compteCaisseActivite(db, activiteCode) {
  const row = db.prepare('SELECT compte_caisse FROM activite WHERE code = ?').get(String(activiteCode || ''));
  if (row && row.compte_caisse) return row.compte_caisse;
  return _LEGACY_CPT[String(activiteCode || '').toUpperCase()] || '571';
}

// Provisionne automatiquement un compte caisse (5xx) + un journal comptable (CA-XX)
// pour une nouvelle activité B2C. Idempotent : ne réalloue rien si déjà provisionné.
// Retourne { journal_code, compte_caisse } stockés sur la ligne activité.
function provisionnerCompteJournalActivite(db, activite) {
  if (activite.journal_code && activite.compte_caisse) {
    return { journal_code: activite.journal_code, compte_caisse: activite.compte_caisse };
  }
  // 1. Trouver le prochain numéro de compte caisse libre (571-579)
  const comptesUtilises = new Set(db.prepare("SELECT numero FROM compte_comptable WHERE numero LIKE '57%' AND numero != '57'").all().map(r => r.numero));
  let compteCaisse = null;
  for (let n = 571; n <= 579; n++) {
    if (!comptesUtilises.has(String(n))) { compteCaisse = String(n); break; }
  }
  if (!compteCaisse) throw new Error('Plus de compte caisse disponible (571-579 pris)');
  // 2. Générer un code journal CA-XX à partir du code activité (2-4 lettres max après CA-)
  const suffixe = String(activite.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'XX';
  let journalCode = `CA-${suffixe}`;
  // Éviter collision : si déjà utilisé, ajouter un suffixe numérique
  let i = 2;
  while (db.prepare('SELECT 1 FROM journal_comptable WHERE code = ?').get(journalCode)) {
    journalCode = `CA-${suffixe}${i}`;
    i++;
    if (i > 99) throw new Error('Impossible de générer un code journal unique');
  }
  // 3. Créer le compte comptable
  db.prepare(`INSERT INTO compte_comptable (numero, libelle, classe, type, sens_normal, parent_numero)
              VALUES (?, ?, 5, 'BILAN', 'D', '57')`)
    .run(compteCaisse, `Caisse — ${activite.nom}`);
  // 4. Créer le journal comptable
  db.prepare(`INSERT INTO journal_comptable (code, libelle, compte_contrepartie, couleur)
              VALUES (?, ?, ?, '#3B82F6')`)
    .run(journalCode, `Caisse ${activite.nom}`, compteCaisse);
  // 5. Mettre à jour l'activité
  db.prepare('UPDATE activite SET journal_code = ?, compte_caisse = ? WHERE id = ?')
    .run(journalCode, compteCaisse, activite.id);
  return { journal_code: journalCode, compte_caisse: compteCaisse };
}

// Numéro de pièce séquentiel par journal et par année
function prochainNumeroPiece(db, journal, dateEcriture) {
  const annee = String(dateEcriture || new Date().toISOString()).slice(0, 4);
  const prefix = `${journal}-${annee}-`;
  const dernier = db.prepare(`SELECT numero_piece FROM ecriture_comptable
                              WHERE journal = ? AND numero_piece LIKE ?
                              ORDER BY numero_piece DESC LIMIT 1`).get(journal, prefix + '%');
  let n = 1;
  if (dernier) { const m = dernier.numero_piece.match(/-(\d+)$/); if (m) n = Number(m[1]) + 1; }
  return `${prefix}${String(n).padStart(6, '0')}`;
}

// Enregistre une écriture comptable en partie double
// { date, journal, libelle, lignes: [{compte, debit, credit}], referenceMetier, activiteId, utilisateurId }
// Vérifie que débit total = crédit total. Rollback complet si déséquilibré.
function enregistrerEcriture(db, { date, journal, libelle, lignes, referenceMetier = '', activiteId = null, utilisateurId = null }) {
  if (!Array.isArray(lignes) || lignes.length < 2) throw new Error('Une écriture doit avoir au moins 2 lignes');
  let totalDebit = 0, totalCredit = 0;
  for (const l of lignes) {
    totalDebit += Number(l.debit || 0);
    totalCredit += Number(l.credit || 0);
  }
  // Tolérance à l'arrondi (< 1 F)
  if (Math.abs(totalDebit - totalCredit) > 0.99) {
    throw new Error(`Écriture déséquilibrée : débit ${totalDebit} ≠ crédit ${totalCredit}`);
  }
  const dateEcr = date || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const numeroPiece = prochainNumeroPiece(db, journal, dateEcr);
  const ins = db.prepare(`INSERT INTO ecriture_comptable
    (date_ecriture, journal, numero_piece, libelle, compte, debit, credit, reference_metier, activite_id, utilisateur_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const l of lignes) {
      ins.run(dateEcr, journal, numeroPiece, libelle, String(l.compte), Number(l.debit || 0), Number(l.credit || 0), referenceMetier, activiteId, utilisateurId);
    }
  });
  tx();
  return numeroPiece;
}

// Solde d'un compte à une date donnée (ou global si non précisée)
function soldeCompte(db, compte, { dateMax = null, activiteId = null } = {}) {
  const params = [compte];
  let where = 'compte = ?';
  if (dateMax) { where += ' AND date_ecriture <= ?'; params.push(dateMax); }
  if (activiteId) { where += ' AND activite_id = ?'; params.push(activiteId); }
  const r = db.prepare(`SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
                        FROM ecriture_comptable WHERE ${where}`).get(...params);
  return { debit: r.d || 0, credit: r.c || 0, solde: (r.d || 0) - (r.c || 0) };
}

// ============================================================
// PROMOTIONS (Phase 2 & 3 marketing)
// ============================================================
// Jours de la semaine (correspond à Date.getDay(): 0=DIM, 1=LUN…)
const JOURS_SEMAINE_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const JOURS_SEMAINE_LABELS = {
  MON: 'Lundi', TUE: 'Mardi', WED: 'Mercredi', THU: 'Jeudi',
  FRI: 'Vendredi', SAT: 'Samedi', SUN: 'Dimanche',
};

/** Une promotion est-elle active MAINTENANT ? (dates + heures + jours) */
function promotionActiveMaintenant(promo, now = new Date()) {
  if (!promo || !promo.actif) return false;
  const today = now.toISOString().slice(0, 10);
  if (promo.date_debut && promo.date_debut > today) return false;
  if (promo.date_fin && promo.date_fin < today) return false;
  // Jours de la semaine
  if (promo.jours_semaine) {
    const jours = String(promo.jours_semaine).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const jourActuel = JOURS_SEMAINE_CODES[now.getDay()];
    if (jours.length && !jours.includes(jourActuel)) return false;
  }
  // Créneau horaire
  if (promo.heure_debut && promo.heure_fin) {
    const heureNow = now.getHours() * 60 + now.getMinutes();
    const [hd, md] = String(promo.heure_debut).split(':').map(Number);
    const [hf, mf] = String(promo.heure_fin).split(':').map(Number);
    if (isFinite(hd) && isFinite(hf)) {
      const debutMin = hd * 60 + (md || 0);
      const finMin = hf * 60 + (mf || 0);
      if (heureNow < debutMin || heureNow > finMin) return false;
    }
  }
  // Usage max atteint
  if (promo.usage_max && promo.usage_count >= promo.usage_max) return false;
  return true;
}

/** Combien de minutes restantes avant la fin du créneau ou de la journée si applicable */
function promotionMinutesRestantes(promo, now = new Date()) {
  if (!promotionActiveMaintenant(promo, now)) return null;
  if (promo.heure_fin) {
    const [hf, mf] = String(promo.heure_fin).split(':').map(Number);
    if (isFinite(hf)) {
      const finMin = hf * 60 + (mf || 0);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const diff = finMin - nowMin;
      if (diff > 0) return diff;
    }
  }
  return null;
}

/** Toutes les promotions actives maintenant (automatiques = sans code, visibles en bannière) */
function chargerPromotionsAutoActives(db) {
  const promos = db.prepare(`SELECT p.*, c.nom AS categorie_nom, pr.designation AS produit_nom
                             FROM promotion p
                             LEFT JOIN categorie c ON c.id = p.categorie_id
                             LEFT JOIN produit pr ON pr.id = p.produit_id
                             WHERE p.actif = 1 AND (p.code IS NULL OR p.code = '')`).all();
  return promos.filter(p => promotionActiveMaintenant(p));
}

/** Toutes les promotions actives maintenant, quelle que soit leur nature (avec/sans code) */
function chargerToutesPromotionsActives(db) {
  const promos = db.prepare(`SELECT p.*, c.nom AS categorie_nom, pr.designation AS produit_nom
                             FROM promotion p
                             LEFT JOIN categorie c ON c.id = p.categorie_id
                             LEFT JOIN produit pr ON pr.id = p.produit_id
                             WHERE p.actif = 1`).all();
  return promos.filter(p => promotionActiveMaintenant(p));
}

/** Retourne l'ID de produits ciblés par une promo (pour badges de remise) */
function produitsConcernesParPromo(db, promo) {
  if (promo.produit_id) return [promo.produit_id];
  if (promo.categorie_id) {
    return db.prepare('SELECT id FROM produit WHERE categorie_id = ? AND actif = 1').all(promo.categorie_id).map(r => r.id);
  }
  if (promo.activite_id) {
    return db.prepare('SELECT id FROM produit WHERE activite_id = ? AND actif = 1').all(promo.activite_id).map(r => r.id);
  }
  return null; // null = tout le catalogue
}

// Vérifie un code promo et calcule la remise applicable
// Retourne : { ok: bool, erreur?: string, promotion?: {...}, remise: number }
function verifierPromotion(db, code, opts = {}) {
  const { sousTotal = 0, panierItems = [], activiteId = null, clientTel = '' } = opts;
  if (!code) return { ok: false, erreur: 'Aucun code saisi', remise: 0 };
  const codeNormalise = String(code).trim().toUpperCase();
  const promo = db.prepare('SELECT * FROM promotion WHERE UPPER(code) = ? AND actif = 1').get(codeNormalise);
  if (!promo) return { ok: false, erreur: 'Code inconnu ou désactivé', remise: 0 };

  // Vérif période
  const now = new Date().toISOString().slice(0, 10);
  if (promo.date_debut && promo.date_debut > now) return { ok: false, erreur: 'Cette promotion n\'a pas encore commencé', remise: 0 };
  if (promo.date_fin && promo.date_fin < now) return { ok: false, erreur: 'Cette promotion est expirée', remise: 0 };

  // Vérif créneau horaire + jours (happy hour)
  const nowDate = new Date();
  if (promo.jours_semaine) {
    const jours = String(promo.jours_semaine).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const jourActuel = JOURS_SEMAINE_CODES[nowDate.getDay()];
    if (jours.length && !jours.includes(jourActuel)) {
      const joursLabels = jours.map(j => JOURS_SEMAINE_LABELS[j] || j).join(', ');
      return { ok: false, erreur: `Ce code est valable uniquement : ${joursLabels}`, remise: 0 };
    }
  }
  if (promo.heure_debut && promo.heure_fin) {
    const [hd, md] = String(promo.heure_debut).split(':').map(Number);
    const [hf, mf] = String(promo.heure_fin).split(':').map(Number);
    if (isFinite(hd) && isFinite(hf)) {
      const heureNow = nowDate.getHours() * 60 + nowDate.getMinutes();
      const debutMin = hd * 60 + (md || 0);
      const finMin = hf * 60 + (mf || 0);
      if (heureNow < debutMin || heureNow > finMin) {
        return { ok: false, erreur: `Ce code est valable de ${promo.heure_debut} à ${promo.heure_fin}`, remise: 0 };
      }
    }
  }

  // Vérif panier minimum
  if (promo.panier_min > 0 && sousTotal < promo.panier_min) {
    return {
      ok: false,
      erreur: `Panier minimum ${Math.round(promo.panier_min).toLocaleString('fr-FR').replace(/,/g, ' ')} FCFA requis`,
      remise: 0,
    };
  }

  // Vérif usage max total
  if (promo.usage_max && promo.usage_count >= promo.usage_max) {
    return { ok: false, erreur: 'Cette promotion n\'est plus disponible', remise: 0 };
  }

  // Vérif usage par client (basé sur téléphone)
  if (promo.usage_par_client && clientTel) {
    const nbUsagesClient = db.prepare('SELECT COUNT(*) AS n FROM promotion_usage WHERE promotion_id = ? AND client_tel = ?').get(promo.id, clientTel).n;
    if (nbUsagesClient >= promo.usage_par_client) {
      return { ok: false, erreur: 'Vous avez déjà utilisé ce code le maximum de fois autorisé', remise: 0 };
    }
  }

  // Calcul de la remise selon le type
  let base = sousTotal;
  // Si cible catégorie/produit, on calcule la remise seulement sur les items éligibles
  if (promo.categorie_id || promo.produit_id) {
    base = panierItems
      .filter(it => (promo.produit_id ? it.id === promo.produit_id : true))
      .filter(it => (promo.categorie_id ? it.categorie_id === promo.categorie_id : true))
      .reduce((s, it) => s + Number(it.total || 0), 0);
    if (base === 0) return { ok: false, erreur: 'Aucun produit du panier n\'est éligible', remise: 0 };
  }

  let remise = 0;
  if (promo.type === 'POURCENTAGE') {
    remise = Math.round(base * promo.valeur / 100);
  } else if (promo.type === 'MONTANT_FIXE') {
    remise = Math.min(Math.round(promo.valeur), base);
  } else if (promo.type === 'LIVRAISON_OFFERTE') {
    remise = 0; // La logique de livraison offerte est appliquée séparément
  }

  return { ok: true, promotion: promo, remise, base };
}

// Enregistre l'utilisation d'une promotion (à appeler après validation d'une commande)
function enregistrerUsagePromotion(db, promotionId, opts = {}) {
  const { commandeWebId = null, clientTel = '', remise = 0 } = opts;
  db.prepare(`INSERT INTO promotion_usage (promotion_id, commande_web_id, client_tel, remise_appliquee, date_usage)
              VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(promotionId, commandeWebId, clientTel, remise);
  db.prepare('UPDATE promotion SET usage_count = usage_count + 1 WHERE id = ?').run(promotionId);
}

module.exports = {
  verifierPromotion,
  enregistrerUsagePromotion,
  promotionActiveMaintenant,
  promotionMinutesRestantes,
  chargerPromotionsAutoActives,
  chargerToutesPromotionsActives,
  produitsConcernesParPromo,
  JOURS_SEMAINE_CODES,
  JOURS_SEMAINE_LABELS,
  formatNombre,
  formatDecimal,
  formatDate,
  montantEnLettres,
  normaliserNom,
  resoudrePeriode,
  pagination,
  paginationInfo,
  pluralize,
  truncate,
  escapeJs,
  categorieStyle,
  // Rôles
  ROLES,
  ROLE_LABEL,
  ROLE_LABEL_COURT,
  isAdmin,
  isDG,
  isSecretariat,
  isDistribution,
  isGestionnaire,
  isCaissier,
  isCuisinier,
  isTransversal,
  canAdmin,
  activitesAccessibles,
  hasAccessToActivite,
  currentActiviteId,
  canWriteActivite,
  canWriteCuisine,
  // Modes de paiement
  MODE_PAIEMENT_STYLES,
  MODES_PAIEMENT_CHOICES,
  MODES_PAIEMENT_B2C,
  MODES_PAIEMENT_B2B,
  // Types divers
  TYPE_MOUVEMENT_LABEL,
  TYPES_MOUVEMENT_CHOICES,
  NIVEAU_ALERTE_LABEL,
  STATUT_INVENTAIRE_LABEL,
  STATUT_COMMANDE_LABEL,
  STATUT_COMMANDE_BADGE,
  STATUT_COMMANDE_TRANSITIONS,
  statutPaiementCommande,
  analyseRelance,
  NIVEAU_RELANCE_LABEL,
  NIVEAU_RELANCE_COULEUR,
  CANAL_RELANCE_LABEL,
  TYPE_CLIENT_LABEL,
  // Enrichissement
  niveauStock,
  enrichirProduit,
  enrichirVente,
  statutPaiement,
  // Numérotation
  prochaineReferenceProduit,
  prochainNumeroVente,
  prochainNumeroCommande,
  prochainNumeroProforma,
  prochainNumeroBonCommande,
  prochainNumeroFacture,
  prochainNumeroBL,
  prochainNumeroRecu,
  prochainNumeroCloture,
  prochainNumeroProduction,
  prochainNumeroAchat,
  prochainNumeroDistribution,
  prochaineReferenceInventaire,
  // Jours fériés / ouvrés
  joursFeriesCameroun,
  estJourFerie,
  estJourOuvreCantine,
  // Journal d'audit
  AUDIT_ACTIONS,
  AUDIT_ACTIONS_CRITIQUES,
  journaliser,
  // Type de produit (déduit automatiquement)
  TYPE_PRODUIT,
  getTypesProduits,
  getTypeProduit,
  // Paramètres système
  chargerParametres,
  invaliderCacheParametres,
  // Permissions granulaires
  FEATURES,
  ROLE_PERMISSIONS,
  featuresByModule,
  permissionsParDefautDuRole,
  utilisateurPeut,
  permissionsEffectives,
  permissionRequise,
  // Stock helpers
  verifierAlerte,
  appliquerMouvement,
  // Comptabilité
  TVA_TAUX,
  decomposerTTC,
  journalCaisseActivite,
  compteCaisseActivite,
  provisionnerCompteJournalActivite,
  prochainNumeroPiece,
  enregistrerEcriture,
  soldeCompte,
};
