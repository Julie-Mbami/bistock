// =============================================================================
// GÉNÉRATEUR CATALOGUE RÉFÉRENCE — Excel complet pour Le Traiteur du Bistrot
// =============================================================================
// USAGE : node scripts/generer_catalogue_reference.js
//
// Génère un fichier Excel prêt à l'emploi avec :
//  - Instructions d'utilisation
//  - Toutes les catégories possibles par activité
//  - Produits finis, ingrédients, revente et consommables
//
// Objectif : servir de base si le client ne fournit pas ses données réelles.
// Sortie : docs/Catalogue_Reference_Bistock.xlsx
// =============================================================================

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const OUTPUT = path.join(__dirname, '..', 'docs', 'Catalogue_Reference_Bistock.xlsx');

// Codes activité utilisés dans l'app
const ACT = { TRAIT: 'TRAIT', CAN: 'CAN', PAT: 'PAT', BUR: 'BUR', MULTI: 'MULTI' };

// ==============================================================================
// CATEGORIES par activité
// ==============================================================================
const CATEGORIES = [
  // ----- TRAIT (Le Traiteur — événementiel) -----
  { act: ACT.TRAIT, nom: 'Plateaux repas',          desc: 'Plateaux individuels livrés en entreprise / événement' },
  { act: ACT.TRAIT, nom: 'Buffets froids',          desc: 'Salades composées, verrines, pains surprises' },
  { act: ACT.TRAIT, nom: 'Buffets chauds',          desc: 'Viandes en sauce, riz, plantains — événements' },
  { act: ACT.TRAIT, nom: 'Cocktails salés',         desc: 'Petits fours salés, mini-quiches, brochettes' },
  { act: ACT.TRAIT, nom: 'Cocktails sucrés',        desc: 'Mignardises, verrines sucrées, brochettes fruits' },
  { act: ACT.TRAIT, nom: 'Pièces montées',          desc: 'Gâteaux d\'anniversaire, mariage, baptême' },
  { act: ACT.TRAIT, nom: 'Menus mariage',           desc: 'Formules complètes mariages (entrée-plat-dessert)' },
  { act: ACT.TRAIT, nom: 'Menus séminaire',         desc: 'Pause-café + déjeuner d\'entreprise' },
  { act: ACT.TRAIT, nom: 'Menus deuil',             desc: 'Formules funérailles / veillées' },
  { act: ACT.TRAIT, nom: 'Location matériel',       desc: 'Nappes, chauffe-plats, samovars, chaises' },

  // ----- CAN (Cantine — repas courants) -----
  { act: ACT.CAN, nom: 'Plats du jour',             desc: 'Menu principal changeant selon le jour' },
  { act: ACT.CAN, nom: 'Formules complètes',        desc: 'Entrée + plat + boisson à prix cantine' },
  { act: ACT.CAN, nom: 'Plats à emporter',          desc: 'Barquettes emportées / livraison bureau' },
  { act: ACT.CAN, nom: 'Sandwichs & wraps',         desc: 'Alternatives rapides et fraîches' },
  { act: ACT.CAN, nom: 'Salades',                   desc: 'Salades composées individuelles' },
  { act: ACT.CAN, nom: 'Boissons cantine',          desc: 'Eau, jus locaux, sodas' },

  // ----- PAT (Pâtisserie + Salon + Restaurant) -----
  { act: ACT.PAT, nom: 'Viennoiseries',             desc: 'Croissants, pains chocolats, brioches' },
  { act: ACT.PAT, nom: 'Pâtisseries fines',         desc: 'Éclairs, tartes, mille-feuilles, choux' },
  { act: ACT.PAT, nom: 'Gâteaux entiers',           desc: 'Sur commande — 4/6/8/12 parts' },
  { act: ACT.PAT, nom: 'Gâteaux à la part',         desc: 'Parts vendues à l\'unité vitrine' },
  { act: ACT.PAT, nom: 'Biscuits & petits fours',   desc: 'Macarons, cookies, financiers, sablés' },
  { act: ACT.PAT, nom: 'Chocolats & confiseries',   desc: 'Bonbons, truffes, tablettes maison' },
  { act: ACT.PAT, nom: 'Glaces & sorbets',          desc: 'Boules, cornets, coupes glacées' },
  { act: ACT.PAT, nom: 'Boissons chaudes',          desc: 'Café, thé, chocolat chaud, tisanes' },
  { act: ACT.PAT, nom: 'Boissons froides',          desc: 'Jus frais, smoothies, milkshakes, sodas' },
  { act: ACT.PAT, nom: 'Entrées salon',             desc: 'Entrées du restaurant — service à table' },
  { act: ACT.PAT, nom: 'Plats principaux salon',    desc: 'Plats du restaurant — service à table' },
  { act: ACT.PAT, nom: 'Desserts restaurant',       desc: 'Desserts du menu restaurant' },
  { act: ACT.PAT, nom: 'Formule brunch',            desc: 'Brunch du week-end' },
  { act: ACT.PAT, nom: 'Cartes vins & spiritueux',  desc: 'Vins au verre, bouteilles, alcools forts' },

  // ----- BUR (Bona Burger — fast-food) -----
  { act: ACT.BUR, nom: 'Burgers signature',         desc: 'Burgers viande — cartes maison' },
  { act: ACT.BUR, nom: 'Burgers poulet',            desc: 'Filets poulet pané ou grillé' },
  { act: ACT.BUR, nom: 'Burgers spéciaux',          desc: 'Édition limitée, du mois, veggie' },
  { act: ACT.BUR, nom: 'Menus complets',            desc: 'Burger + frites + boisson' },
  { act: ACT.BUR, nom: 'Menus enfants',             desc: 'Menu kids avec surprise' },
  { act: ACT.BUR, nom: 'Accompagnements',           desc: 'Frites, onion rings, nuggets, mozza sticks' },
  { act: ACT.BUR, nom: 'Sauces',                    desc: 'Sauces maison à la portion' },
  { act: ACT.BUR, nom: 'Sodas & softs',             desc: 'Coca, Fanta, Sprite, XXL, Malta' },
  { act: ACT.BUR, nom: 'Jus frais',                 desc: 'Jus pressés du jour' },
  { act: ACT.BUR, nom: 'Desserts fast-food',        desc: 'Milkshakes, brownies, muffins' },

  // ----- MULTI (partagé — ingrédients / consommables / revente) -----
  { act: ACT.MULTI, nom: 'Farines & céréales',      desc: 'Ingrédients de base — poudres et grains secs' },
  { act: ACT.MULTI, nom: 'Sucres & édulcorants',    desc: 'Sucre, miel, sirops' },
  { act: ACT.MULTI, nom: 'Produits laitiers',       desc: 'Lait, crème, beurre, fromages' },
  { act: ACT.MULTI, nom: 'Œufs & ovoproduits',      desc: 'Œufs frais, jaunes, blancs' },
  { act: ACT.MULTI, nom: 'Chocolats & cacao',       desc: 'Chocolats de couverture, cacao, pépites' },
  { act: ACT.MULTI, nom: 'Fruits frais',            desc: 'Fruits achetés au marché' },
  { act: ACT.MULTI, nom: 'Légumes frais',           desc: 'Légumes achetés au marché' },
  { act: ACT.MULTI, nom: 'Herbes & épices',         desc: 'Sel, poivre, épices, aromates séchés' },
  { act: ACT.MULTI, nom: 'Viandes',                 desc: 'Bœuf, poulet, agneau, charcuteries' },
  { act: ACT.MULTI, nom: 'Poissons & fruits de mer', desc: 'Poissons frais et fumés, crustacés' },
  { act: ACT.MULTI, nom: 'Huiles & matières grasses', desc: 'Huiles végétales, margarines' },
  { act: ACT.MULTI, nom: 'Conserves & bases',       desc: 'Bouillons, sauces industrielles, conserves' },
  { act: ACT.MULTI, nom: 'Sodas & softs (achat)',   desc: 'Bouteilles achetées pour revente' },
  { act: ACT.MULTI, nom: 'Bières & alcools (achat)', desc: 'Alcools achetés pour revente au verre / bouteille' },
  { act: ACT.MULTI, nom: 'Snacks emballés',         desc: 'Chips, biscuits, chocolats pour revente' },
  { act: ACT.MULTI, nom: 'Emballages',              desc: 'Sacs, boîtes, gobelets à usage unique' },
  { act: ACT.MULTI, nom: 'Ustensiles jetables',     desc: 'Couverts et accessoires plastique/bois' },
  { act: ACT.MULTI, nom: 'Hygiène & protection',    desc: 'Gants, savons, désinfectants, tabliers' },
  { act: ACT.MULTI, nom: 'Nettoyage',               desc: 'Produits ménagers, éponges, torchons' },
  { act: ACT.MULTI, nom: 'Fourniture bureau',       desc: 'Blocs facturier, stylos, imprimés' },
];

// ==============================================================================
// PRODUITS FINIS (vendus au client)
// ==============================================================================
const PRODUITS_FINIS = [
  // ---------- TRAIT ----------
  { act: ACT.TRAIT, cat: 'Plateaux repas',    ref: 'TRAIT-PLA-001', nom: 'Plateau repas Executive',        u: 'plateau', pv: 8000,  pa: 3500, tp: 30, sm: 5 },
  { act: ACT.TRAIT, cat: 'Plateaux repas',    ref: 'TRAIT-PLA-002', nom: 'Plateau repas Standard',         u: 'plateau', pv: 5500,  pa: 2500, tp: 25, sm: 5 },
  { act: ACT.TRAIT, cat: 'Plateaux repas',    ref: 'TRAIT-PLA-003', nom: 'Plateau repas Végétarien',       u: 'plateau', pv: 5000,  pa: 2200, tp: 25, sm: 3 },
  { act: ACT.TRAIT, cat: 'Buffets froids',    ref: 'TRAIT-BUF-001', nom: 'Buffet froid 10 personnes',      u: 'buffet',  pv: 45000, pa: 20000, tp: 90, sm: 1 },
  { act: ACT.TRAIT, cat: 'Buffets froids',    ref: 'TRAIT-BUF-002', nom: 'Buffet froid 25 personnes',      u: 'buffet',  pv: 110000, pa: 48000, tp: 150, sm: 1 },
  { act: ACT.TRAIT, cat: 'Buffets chauds',    ref: 'TRAIT-BFC-001', nom: 'Buffet chaud 10 personnes',      u: 'buffet',  pv: 55000, pa: 25000, tp: 120, sm: 1 },
  { act: ACT.TRAIT, cat: 'Buffets chauds',    ref: 'TRAIT-BFC-002', nom: 'Buffet chaud 25 personnes',      u: 'buffet',  pv: 135000, pa: 60000, tp: 180, sm: 1 },
  { act: ACT.TRAIT, cat: 'Cocktails salés',   ref: 'TRAIT-COS-001', nom: 'Mini-quiche lorraine (pièce)',   u: 'pièce',   pv: 400,   pa: 150, tp: 3, sm: 20 },
  { act: ACT.TRAIT, cat: 'Cocktails salés',   ref: 'TRAIT-COS-002', nom: 'Mini-samoussa boeuf (pièce)',    u: 'pièce',   pv: 350,   pa: 130, tp: 4, sm: 20 },
  { act: ACT.TRAIT, cat: 'Cocktails salés',   ref: 'TRAIT-COS-003', nom: 'Brochette poulet cocktail',      u: 'pièce',   pv: 600,   pa: 250, tp: 5, sm: 15 },
  { act: ACT.TRAIT, cat: 'Cocktails salés',   ref: 'TRAIT-COS-004', nom: 'Verrine crevette-avocat',        u: 'pièce',   pv: 800,   pa: 350, tp: 5, sm: 10 },
  { act: ACT.TRAIT, cat: 'Cocktails sucrés',  ref: 'TRAIT-COX-001', nom: 'Mini-choux chocolat',            u: 'pièce',   pv: 400,   pa: 130, tp: 4, sm: 20 },
  { act: ACT.TRAIT, cat: 'Cocktails sucrés',  ref: 'TRAIT-COX-002', nom: 'Brochette fruits frais',         u: 'pièce',   pv: 600,   pa: 220, tp: 3, sm: 15 },
  { act: ACT.TRAIT, cat: 'Pièces montées',    ref: 'TRAIT-PMO-001', nom: 'Pièce montée baptême 20 pers',   u: 'unité',   pv: 45000, pa: 15000, tp: 240, sm: 0 },
  { act: ACT.TRAIT, cat: 'Pièces montées',    ref: 'TRAIT-PMO-002', nom: 'Pièce montée mariage 50 pers',   u: 'unité',   pv: 120000, pa: 40000, tp: 480, sm: 0 },
  { act: ACT.TRAIT, cat: 'Menus mariage',     ref: 'TRAIT-MMA-001', nom: 'Menu mariage complet / pers',    u: 'pers',    pv: 15000, pa: 6500, tp: 60, sm: 20 },
  { act: ACT.TRAIT, cat: 'Menus séminaire',   ref: 'TRAIT-MSE-001', nom: 'Menu séminaire / pers',          u: 'pers',    pv: 8500,  pa: 3800, tp: 45, sm: 10 },
  { act: ACT.TRAIT, cat: 'Menus séminaire',   ref: 'TRAIT-MSE-002', nom: 'Pause-café entreprise / pers',   u: 'pers',    pv: 2500,  pa: 900, tp: 15, sm: 10 },
  { act: ACT.TRAIT, cat: 'Menus deuil',       ref: 'TRAIT-MDE-001', nom: 'Menu deuil complet / pers',      u: 'pers',    pv: 4500,  pa: 2000, tp: 30, sm: 20 },
  { act: ACT.TRAIT, cat: 'Location matériel', ref: 'TRAIT-LOC-001', nom: 'Location chauffe-plat / jour',   u: 'jour',    pv: 3500,  pa: 0,    tp: 0, sm: 0 },
  { act: ACT.TRAIT, cat: 'Location matériel', ref: 'TRAIT-LOC-002', nom: 'Location samovar / jour',        u: 'jour',    pv: 5000,  pa: 0,    tp: 0, sm: 0 },
  { act: ACT.TRAIT, cat: 'Location matériel', ref: 'TRAIT-LOC-003', nom: 'Location nappe standard / jour', u: 'jour',    pv: 2000,  pa: 0,    tp: 0, sm: 0 },

  // ---------- CAN ----------
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-001', nom: 'Ndolé + riz + poisson braisé',    u: 'portion', pv: 2500, pa: 1000, tp: 15, sm: 20 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-002', nom: 'Eru + water fufu + viande',        u: 'portion', pv: 2500, pa: 1000, tp: 15, sm: 20 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-003', nom: 'Poulet DG + plantains',            u: 'portion', pv: 3000, pa: 1300, tp: 20, sm: 20 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-004', nom: 'Sauce arachide + riz + viande',    u: 'portion', pv: 2500, pa: 1000, tp: 15, sm: 20 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-005', nom: 'Koki + plantains mûrs',            u: 'portion', pv: 2000, pa: 700, tp: 12, sm: 25 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-006', nom: 'Okok + bâton de manioc',           u: 'portion', pv: 2500, pa: 1000, tp: 15, sm: 15 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-007', nom: 'Brochettes bœuf + frites',         u: 'portion', pv: 2500, pa: 1000, tp: 15, sm: 15 },
  { act: ACT.CAN, cat: 'Plats du jour',       ref: 'CAN-PDJ-008', nom: 'Poisson braisé + miondo',          u: 'portion', pv: 3000, pa: 1300, tp: 20, sm: 15 },
  { act: ACT.CAN, cat: 'Formules complètes',  ref: 'CAN-FOR-001', nom: 'Formule midi (plat + jus + fruit)', u: 'formule', pv: 3000, pa: 1200, tp: 15, sm: 15 },
  { act: ACT.CAN, cat: 'Formules complètes',  ref: 'CAN-FOR-002', nom: 'Formule étudiante',                u: 'formule', pv: 2000, pa: 800, tp: 15, sm: 20 },
  { act: ACT.CAN, cat: 'Plats à emporter',    ref: 'CAN-EMP-001', nom: 'Barquette plat du jour à emporter', u: 'barq.',  pv: 2500, pa: 1100, tp: 10, sm: 15 },
  { act: ACT.CAN, cat: 'Sandwichs & wraps',   ref: 'CAN-SAN-001', nom: 'Sandwich poulet mayonnaise',       u: 'unité',   pv: 1500, pa: 550, tp: 8, sm: 15 },
  { act: ACT.CAN, cat: 'Sandwichs & wraps',   ref: 'CAN-SAN-002', nom: 'Sandwich thon',                    u: 'unité',   pv: 1500, pa: 600, tp: 8, sm: 15 },
  { act: ACT.CAN, cat: 'Sandwichs & wraps',   ref: 'CAN-SAN-003', nom: 'Sandwich jambon-fromage',          u: 'unité',   pv: 1500, pa: 600, tp: 6, sm: 15 },
  { act: ACT.CAN, cat: 'Sandwichs & wraps',   ref: 'CAN-SAN-004', nom: 'Wrap poulet',                      u: 'unité',   pv: 2000, pa: 750, tp: 10, sm: 12 },
  { act: ACT.CAN, cat: 'Salades',             ref: 'CAN-SAL-001', nom: 'Salade César poulet',              u: 'portion', pv: 2500, pa: 900, tp: 10, sm: 12 },
  { act: ACT.CAN, cat: 'Salades',             ref: 'CAN-SAL-002', nom: 'Salade niçoise',                   u: 'portion', pv: 2500, pa: 950, tp: 10, sm: 10 },
  { act: ACT.CAN, cat: 'Salades',             ref: 'CAN-SAL-003', nom: 'Salade avocat-crevettes',          u: 'portion', pv: 3000, pa: 1200, tp: 10, sm: 10 },
  { act: ACT.CAN, cat: 'Boissons cantine',    ref: 'CAN-BOI-001', nom: 'Jus de bissap maison 33cl',        u: 'unité',   pv: 800,  pa: 250, tp: 2, sm: 20 },
  { act: ACT.CAN, cat: 'Boissons cantine',    ref: 'CAN-BOI-002', nom: 'Jus de gingembre 33cl',            u: 'unité',   pv: 800,  pa: 250, tp: 2, sm: 20 },
  { act: ACT.CAN, cat: 'Boissons cantine',    ref: 'CAN-BOI-003', nom: 'Eau minérale 50cl (revente)',      u: 'unité',   pv: 500,  pa: 250, tp: 1, sm: 30 },

  // ---------- PAT ----------
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-001', nom: 'Croissant au beurre',              u: 'pièce',   pv: 500,  pa: 150, tp: 3,  sm: 20 },
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-002', nom: 'Pain au chocolat',                 u: 'pièce',   pv: 600,  pa: 180, tp: 3,  sm: 20 },
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-003', nom: 'Brioche aux pépites de chocolat',  u: 'pièce',   pv: 700,  pa: 200, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-004', nom: 'Chausson aux pommes',              u: 'pièce',   pv: 800,  pa: 250, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-005', nom: 'Croissant amande',                 u: 'pièce',   pv: 800,  pa: 280, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Viennoiseries',       ref: 'PAT-VIE-006', nom: 'Pain au raisin',                   u: 'pièce',   pv: 600,  pa: 180, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-001', nom: 'Éclair au chocolat',               u: 'pièce',   pv: 1200, pa: 350, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-002', nom: 'Éclair café',                      u: 'pièce',   pv: 1200, pa: 350, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-003', nom: 'Mille-feuille vanille',            u: 'pièce',   pv: 1500, pa: 400, tp: 6,  sm: 8 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-004', nom: 'Tarte citron meringuée',           u: 'pièce',   pv: 1500, pa: 450, tp: 6,  sm: 8 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-005', nom: 'Paris-Brest',                      u: 'pièce',   pv: 1800, pa: 500, tp: 6,  sm: 6 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-006', nom: 'Saint-Honoré',                     u: 'pièce',   pv: 1800, pa: 500, tp: 7,  sm: 6 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-007', nom: 'Religieuse chocolat',              u: 'pièce',   pv: 1500, pa: 400, tp: 6,  sm: 8 },
  { act: ACT.PAT, cat: 'Pâtisseries fines',   ref: 'PAT-FIN-008', nom: 'Tarte aux fruits frais',           u: 'pièce',   pv: 1500, pa: 500, tp: 6,  sm: 8 },
  { act: ACT.PAT, cat: 'Gâteaux entiers',     ref: 'PAT-GEN-001', nom: 'Gâteau anniversaire 6 parts',      u: 'unité',   pv: 12000, pa: 3500, tp: 60, sm: 3 },
  { act: ACT.PAT, cat: 'Gâteaux entiers',     ref: 'PAT-GEN-002', nom: 'Gâteau anniversaire 12 parts',     u: 'unité',   pv: 22000, pa: 6500, tp: 90, sm: 2 },
  { act: ACT.PAT, cat: 'Gâteaux entiers',     ref: 'PAT-GEN-003', nom: 'Forêt-noire entière 8 parts',      u: 'unité',   pv: 15000, pa: 4500, tp: 75, sm: 2 },
  { act: ACT.PAT, cat: 'Gâteaux entiers',     ref: 'PAT-GEN-004', nom: 'Cheesecake entier 8 parts',        u: 'unité',   pv: 18000, pa: 5500, tp: 80, sm: 2 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-001', nom: 'Part de forêt-noire',              u: 'pièce',   pv: 1500, pa: 400, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-002', nom: 'Part d\'opéra',                    u: 'pièce',   pv: 1800, pa: 500, tp: 5,  sm: 8 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-003', nom: 'Cheesecake New York',              u: 'pièce',   pv: 2000, pa: 600, tp: 5,  sm: 8 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-004', nom: 'Fondant au chocolat',              u: 'pièce',   pv: 1800, pa: 500, tp: 8,  sm: 8 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-005', nom: 'Tiramisu individuel',              u: 'pièce',   pv: 1800, pa: 500, tp: 4,  sm: 8 },
  { act: ACT.PAT, cat: 'Gâteaux à la part',   ref: 'PAT-GAT-006', nom: 'Panna cotta fruits rouges',        u: 'pièce',   pv: 1500, pa: 400, tp: 4,  sm: 8 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-001', nom: 'Macaron (à l\'unité)',         u: 'pièce',   pv: 500,  pa: 150, tp: 2,  sm: 30 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-002', nom: 'Cookie chocolat noir',         u: 'pièce',   pv: 800,  pa: 200, tp: 3,  sm: 20 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-003', nom: 'Financier amande',             u: 'pièce',   pv: 600,  pa: 180, tp: 2,  sm: 20 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-004', nom: 'Brownie noix pécan',           u: 'pièce',   pv: 900,  pa: 250, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-005', nom: 'Muffin myrtille',              u: 'pièce',   pv: 800,  pa: 220, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Biscuits & petits fours', ref: 'PAT-BIS-006', nom: 'Madeleine',                    u: 'pièce',   pv: 400,  pa: 100, tp: 2,  sm: 30 },
  { act: ACT.PAT, cat: 'Chocolats & confiseries', ref: 'PAT-CHO-001', nom: 'Truffe chocolat noir',         u: 'pièce',   pv: 500,  pa: 150, tp: 2,  sm: 30 },
  { act: ACT.PAT, cat: 'Chocolats & confiseries', ref: 'PAT-CHO-002', nom: 'Tablette chocolat noir 70% 100g', u: 'unité', pv: 3500, pa: 1200, tp: 15, sm: 8 },
  { act: ACT.PAT, cat: 'Glaces & sorbets',    ref: 'PAT-GLA-001', nom: 'Boule glace vanille',              u: 'boule',   pv: 800,  pa: 250, tp: 1,  sm: 30 },
  { act: ACT.PAT, cat: 'Glaces & sorbets',    ref: 'PAT-GLA-002', nom: 'Boule glace chocolat',             u: 'boule',   pv: 800,  pa: 250, tp: 1,  sm: 30 },
  { act: ACT.PAT, cat: 'Glaces & sorbets',    ref: 'PAT-GLA-003', nom: 'Boule sorbet mangue',              u: 'boule',   pv: 800,  pa: 220, tp: 1,  sm: 25 },
  { act: ACT.PAT, cat: 'Glaces & sorbets',    ref: 'PAT-GLA-004', nom: 'Coupe glacée Dame Blanche',        u: 'coupe',   pv: 3000, pa: 900, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Glaces & sorbets',    ref: 'PAT-GLA-005', nom: 'Coupe glacée café liégeois',       u: 'coupe',   pv: 3000, pa: 900, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-001', nom: 'Café espresso',                    u: 'tasse',   pv: 500,  pa: 100, tp: 2,  sm: 50 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-002', nom: 'Café allongé',                     u: 'tasse',   pv: 600,  pa: 120, tp: 2,  sm: 50 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-003', nom: 'Cappuccino',                       u: 'tasse',   pv: 1000, pa: 200, tp: 3,  sm: 40 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-004', nom: 'Café latte',                       u: 'tasse',   pv: 1200, pa: 250, tp: 3,  sm: 40 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-005', nom: 'Chocolat chaud maison',            u: 'tasse',   pv: 1200, pa: 300, tp: 4,  sm: 30 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-006', nom: 'Thé noir Earl Grey',               u: 'tasse',   pv: 800,  pa: 150, tp: 3,  sm: 30 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-007', nom: 'Thé vert menthe',                  u: 'tasse',   pv: 800,  pa: 150, tp: 3,  sm: 30 },
  { act: ACT.PAT, cat: 'Boissons chaudes',    ref: 'PAT-BCH-008', nom: 'Infusion camomille',               u: 'tasse',   pv: 800,  pa: 130, tp: 3,  sm: 20 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-001', nom: 'Jus d\'orange pressé',             u: 'verre',   pv: 1500, pa: 400, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-002', nom: 'Jus de mangue pressé',             u: 'verre',   pv: 1500, pa: 400, tp: 3,  sm: 15 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-003', nom: 'Smoothie fruits rouges',           u: 'verre',   pv: 2000, pa: 600, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-004', nom: 'Milkshake vanille',                u: 'verre',   pv: 2000, pa: 600, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-005', nom: 'Milkshake chocolat',               u: 'verre',   pv: 2000, pa: 600, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Boissons froides',    ref: 'PAT-BFR-006', nom: 'Iced coffee',                      u: 'verre',   pv: 1500, pa: 350, tp: 4,  sm: 12 },
  { act: ACT.PAT, cat: 'Entrées salon',       ref: 'PAT-ENT-001', nom: 'Salade César poulet',              u: 'portion', pv: 4500, pa: 1500, tp: 10, sm: 10 },
  { act: ACT.PAT, cat: 'Entrées salon',       ref: 'PAT-ENT-002', nom: 'Velouté du jour',                  u: 'bol',     pv: 3000, pa: 900, tp: 8,  sm: 10 },
  { act: ACT.PAT, cat: 'Entrées salon',       ref: 'PAT-ENT-003', nom: 'Bruschetta tomate-basilic',        u: 'portion', pv: 3500, pa: 1100, tp: 8,  sm: 10 },
  { act: ACT.PAT, cat: 'Entrées salon',       ref: 'PAT-ENT-004', nom: 'Assiette de charcuteries',         u: 'portion', pv: 5000, pa: 1800, tp: 5,  sm: 8 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-001', nom: 'Filet de bœuf sauce poivre',    u: 'portion', pv: 12000, pa: 4500, tp: 20, sm: 6 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-002', nom: 'Filet de dorade grillé',        u: 'portion', pv: 10000, pa: 3800, tp: 18, sm: 6 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-003', nom: 'Pâtes carbonara',               u: 'portion', pv: 6500,  pa: 2200, tp: 15, sm: 8 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-004', nom: 'Pizza margherita',              u: 'pizza',   pv: 7000,  pa: 2200, tp: 15, sm: 8 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-005', nom: 'Pizza reine',                   u: 'pizza',   pv: 7500,  pa: 2500, tp: 15, sm: 8 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-006', nom: 'Escalope de veau milanaise',    u: 'portion', pv: 9000,  pa: 3200, tp: 18, sm: 6 },
  { act: ACT.PAT, cat: 'Plats principaux salon', ref: 'PAT-PRI-007', nom: 'Risotto aux champignons',       u: 'portion', pv: 6500,  pa: 2000, tp: 20, sm: 6 },
  { act: ACT.PAT, cat: 'Desserts restaurant', ref: 'PAT-DES-001', nom: 'Café gourmand',                    u: 'assiette', pv: 3500, pa: 900, tp: 8,  sm: 10 },
  { act: ACT.PAT, cat: 'Desserts restaurant', ref: 'PAT-DES-002', nom: 'Crème brûlée',                     u: 'portion', pv: 2500, pa: 700, tp: 5,  sm: 10 },
  { act: ACT.PAT, cat: 'Formule brunch',      ref: 'PAT-BRU-001', nom: 'Brunch complet',                   u: 'formule', pv: 8500, pa: 3000, tp: 20, sm: 10 },
  { act: ACT.PAT, cat: 'Formule brunch',      ref: 'PAT-BRU-002', nom: 'Brunch light',                     u: 'formule', pv: 6500, pa: 2200, tp: 15, sm: 10 },
  { act: ACT.PAT, cat: 'Cartes vins & spiritueux', ref: 'PAT-VIN-001', nom: 'Verre vin rouge maison',      u: 'verre',   pv: 2500, pa: 900, tp: 2,  sm: 30 },
  { act: ACT.PAT, cat: 'Cartes vins & spiritueux', ref: 'PAT-VIN-002', nom: 'Verre vin blanc maison',      u: 'verre',   pv: 2500, pa: 900, tp: 2,  sm: 30 },
  { act: ACT.PAT, cat: 'Cartes vins & spiritueux', ref: 'PAT-VIN-003', nom: 'Bouteille vin rouge',         u: 'bouteille', pv: 15000, pa: 6000, tp: 2, sm: 10 },
  { act: ACT.PAT, cat: 'Cartes vins & spiritueux', ref: 'PAT-VIN-004', nom: 'Whisky JB 4cl',               u: 'verre',   pv: 3500, pa: 1200, tp: 1,  sm: 20 },

  // ---------- BUR ----------
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-001', nom: 'Burger Classique',                 u: 'unité',   pv: 3000, pa: 1000, tp: 10, sm: 15 },
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-002', nom: 'Cheese Burger',                    u: 'unité',   pv: 3500, pa: 1200, tp: 10, sm: 15 },
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-003', nom: 'Double Cheese Burger',             u: 'unité',   pv: 5000, pa: 1800, tp: 12, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-004', nom: 'Bacon Burger',                     u: 'unité',   pv: 4500, pa: 1600, tp: 12, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-005', nom: 'Bona Spicy Burger',                u: 'unité',   pv: 4000, pa: 1400, tp: 11, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers signature',   ref: 'BUR-SIG-006', nom: 'Bona Deluxe Burger',               u: 'unité',   pv: 5500, pa: 2000, tp: 13, sm: 10 },
  { act: ACT.BUR, cat: 'Burgers poulet',      ref: 'BUR-POU-001', nom: 'Chicken Crispy Burger',            u: 'unité',   pv: 3500, pa: 1200, tp: 11, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers poulet',      ref: 'BUR-POU-002', nom: 'Chicken BBQ Burger',               u: 'unité',   pv: 4000, pa: 1400, tp: 11, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers poulet',      ref: 'BUR-POU-003', nom: 'Chicken Spicy Burger',             u: 'unité',   pv: 4000, pa: 1400, tp: 11, sm: 12 },
  { act: ACT.BUR, cat: 'Burgers spéciaux',    ref: 'BUR-SPE-001', nom: 'Veggie Burger',                    u: 'unité',   pv: 3500, pa: 1100, tp: 10, sm: 10 },
  { act: ACT.BUR, cat: 'Burgers spéciaux',    ref: 'BUR-SPE-002', nom: 'Burger du mois',                   u: 'unité',   pv: 4500, pa: 1500, tp: 12, sm: 8 },
  { act: ACT.BUR, cat: 'Menus complets',      ref: 'BUR-MEN-001', nom: 'Menu Classique',                   u: 'menu',    pv: 4500, pa: 1600, tp: 12, sm: 12 },
  { act: ACT.BUR, cat: 'Menus complets',      ref: 'BUR-MEN-002', nom: 'Menu Cheese',                      u: 'menu',    pv: 5000, pa: 1800, tp: 12, sm: 12 },
  { act: ACT.BUR, cat: 'Menus complets',      ref: 'BUR-MEN-003', nom: 'Menu Double',                      u: 'menu',    pv: 6500, pa: 2400, tp: 14, sm: 10 },
  { act: ACT.BUR, cat: 'Menus complets',      ref: 'BUR-MEN-004', nom: 'Menu Chicken',                     u: 'menu',    pv: 5000, pa: 1800, tp: 13, sm: 10 },
  { act: ACT.BUR, cat: 'Menus enfants',       ref: 'BUR-MEK-001', nom: 'Menu Kids Burger',                 u: 'menu',    pv: 3000, pa: 1000, tp: 10, sm: 8 },
  { act: ACT.BUR, cat: 'Menus enfants',       ref: 'BUR-MEK-002', nom: 'Menu Kids Nuggets',                u: 'menu',    pv: 3000, pa: 1000, tp: 10, sm: 8 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-001', nom: 'Frites maison',                    u: 'portion', pv: 1500, pa: 400, tp: 6,  sm: 30 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-002', nom: 'Frites cheese',                    u: 'portion', pv: 2000, pa: 600, tp: 7,  sm: 20 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-003', nom: 'Onion rings (6 pcs)',              u: 'portion', pv: 1500, pa: 500, tp: 6,  sm: 20 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-004', nom: 'Nuggets poulet (6 pcs)',           u: 'portion', pv: 2000, pa: 700, tp: 7,  sm: 20 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-005', nom: 'Mozzarella sticks (5 pcs)',        u: 'portion', pv: 2500, pa: 900, tp: 7,  sm: 15 },
  { act: ACT.BUR, cat: 'Accompagnements',     ref: 'BUR-ACC-006', nom: 'Ailes de poulet (6 pcs)',          u: 'portion', pv: 3000, pa: 1200, tp: 10, sm: 15 },
  { act: ACT.BUR, cat: 'Sauces',              ref: 'BUR-SAU-001', nom: 'Sauce ketchup (portion)',          u: 'portion', pv: 200,  pa: 50, tp: 1,  sm: 50 },
  { act: ACT.BUR, cat: 'Sauces',              ref: 'BUR-SAU-002', nom: 'Sauce mayo (portion)',             u: 'portion', pv: 200,  pa: 50, tp: 1,  sm: 50 },
  { act: ACT.BUR, cat: 'Sauces',              ref: 'BUR-SAU-003', nom: 'Sauce BBQ maison',                 u: 'portion', pv: 300,  pa: 80, tp: 1,  sm: 40 },
  { act: ACT.BUR, cat: 'Sauces',              ref: 'BUR-SAU-004', nom: 'Sauce piquante maison',            u: 'portion', pv: 300,  pa: 80, tp: 1,  sm: 40 },
  { act: ACT.BUR, cat: 'Sauces',              ref: 'BUR-SAU-005', nom: 'Sauce cheese',                     u: 'portion', pv: 400,  pa: 120, tp: 1,  sm: 40 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-001', nom: 'Coca-Cola 33cl',                   u: 'unité',   pv: 700,  pa: 350, tp: 1,  sm: 50 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-002', nom: 'Fanta orange 33cl',                u: 'unité',   pv: 700,  pa: 350, tp: 1,  sm: 50 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-003', nom: 'Sprite 33cl',                      u: 'unité',   pv: 700,  pa: 350, tp: 1,  sm: 40 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-004', nom: 'Malta Guinness 33cl',              u: 'unité',   pv: 800,  pa: 400, tp: 1,  sm: 30 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-005', nom: 'XXL 50cl',                         u: 'unité',   pv: 1000, pa: 500, tp: 1,  sm: 30 },
  { act: ACT.BUR, cat: 'Sodas & softs',       ref: 'BUR-SOD-006', nom: 'Eau minérale 50cl',                u: 'unité',   pv: 500,  pa: 250, tp: 1,  sm: 50 },
  { act: ACT.BUR, cat: 'Jus frais',           ref: 'BUR-JUS-001', nom: 'Jus mangue frais',                 u: 'verre',   pv: 1500, pa: 400, tp: 3,  sm: 15 },
  { act: ACT.BUR, cat: 'Jus frais',           ref: 'BUR-JUS-002', nom: 'Jus ananas gingembre',             u: 'verre',   pv: 1500, pa: 400, tp: 3,  sm: 15 },
  { act: ACT.BUR, cat: 'Desserts fast-food',  ref: 'BUR-DES-001', nom: 'Milkshake vanille',                u: 'verre',   pv: 2000, pa: 600, tp: 4,  sm: 15 },
  { act: ACT.BUR, cat: 'Desserts fast-food',  ref: 'BUR-DES-002', nom: 'Milkshake chocolat',               u: 'verre',   pv: 2000, pa: 600, tp: 4,  sm: 15 },
  { act: ACT.BUR, cat: 'Desserts fast-food',  ref: 'BUR-DES-003', nom: 'Brownie chocolat',                 u: 'pièce',   pv: 1500, pa: 400, tp: 3,  sm: 15 },
  { act: ACT.BUR, cat: 'Desserts fast-food',  ref: 'BUR-DES-004', nom: 'Muffin double chocolat',           u: 'pièce',   pv: 1200, pa: 350, tp: 3,  sm: 15 },
];

// ==============================================================================
// INGRÉDIENTS (matières premières — MULTI activités)
// ==============================================================================
const INGREDIENTS = [
  // Farines & céréales
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-001', nom: 'Farine de blé T45',     u: 'kg',     pa: 800,  sm: 20 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-002', nom: 'Farine de blé T55',     u: 'kg',     pa: 750,  sm: 30 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-003', nom: 'Farine de blé complète', u: 'kg',    pa: 900,  sm: 15 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-004', nom: 'Maïzena',               u: 'kg',     pa: 1500, sm: 5 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-005', nom: 'Semoule fine',          u: 'kg',     pa: 900,  sm: 10 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-006', nom: 'Riz blanc parfumé',     u: 'kg',     pa: 950,  sm: 30 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-007', nom: 'Riz basmati',           u: 'kg',     pa: 1500, sm: 15 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-008', nom: 'Riz local (nkang)',     u: 'kg',     pa: 700,  sm: 30 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-009', nom: 'Couscous fin',          u: 'kg',     pa: 1200, sm: 8 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-010', nom: 'Pâtes spaghetti',       u: 'kg',     pa: 1000, sm: 10 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-011', nom: 'Pâtes penne',           u: 'kg',     pa: 1000, sm: 8 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-012', nom: 'Chapelure',             u: 'kg',     pa: 1200, sm: 6 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-013', nom: 'Levure boulangère fraîche', u: 'kg', pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-014', nom: 'Levure chimique',       u: 'kg',     pa: 4500, sm: 2 },
  { act: ACT.MULTI, cat: 'Farines & céréales', ref: 'ING-FAR-015', nom: 'Bicarbonate de soude',  u: 'kg',     pa: 2500, sm: 2 },

  // Sucres & édulcorants
  { act: ACT.MULTI, cat: 'Sucres & édulcorants', ref: 'ING-SUC-001', nom: 'Sucre blanc en poudre', u: 'kg',   pa: 800,  sm: 40 },
  { act: ACT.MULTI, cat: 'Sucres & édulcorants', ref: 'ING-SUC-002', nom: 'Sucre roux (cassonade)', u: 'kg',  pa: 1200, sm: 15 },
  { act: ACT.MULTI, cat: 'Sucres & édulcorants', ref: 'ING-SUC-003', nom: 'Sucre glace',           u: 'kg',   pa: 1500, sm: 10 },
  { act: ACT.MULTI, cat: 'Sucres & édulcorants', ref: 'ING-SUC-004', nom: 'Miel',                  u: 'kg',   pa: 3500, sm: 5 },
  { act: ACT.MULTI, cat: 'Sucres & édulcorants', ref: 'ING-SUC-005', nom: 'Sirop de glucose',      u: 'kg',   pa: 2500, sm: 3 },

  // Produits laitiers
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-001', nom: 'Lait entier UHT 1L',      u: 'L',     pa: 900,  sm: 30 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-002', nom: 'Lait concentré non sucré 400g', u: 'boîte', pa: 1200, sm: 20 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-003', nom: 'Crème liquide entière 1L', u: 'L',    pa: 3500, sm: 10 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-004', nom: 'Crème épaisse 500g',      u: 'kg',    pa: 4500, sm: 5 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-005', nom: 'Beurre doux 250g',        u: 'kg',    pa: 5000, sm: 8 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-006', nom: 'Beurre demi-sel 250g',    u: 'kg',    pa: 5200, sm: 4 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-007', nom: 'Fromage blanc',           u: 'kg',    pa: 3500, sm: 5 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-008', nom: 'Mozzarella boule 125g',   u: 'pièce', pa: 1500, sm: 20 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-009', nom: 'Cheddar en tranches',     u: 'kg',    pa: 6500, sm: 8 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-010', nom: 'Gouda',                   u: 'kg',    pa: 6000, sm: 4 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-011', nom: 'Feta',                    u: 'kg',    pa: 5500, sm: 3 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-012', nom: 'Parmesan râpé',           u: 'kg',    pa: 12000, sm: 2 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-013', nom: 'Mascarpone',              u: 'kg',    pa: 6000, sm: 3 },
  { act: ACT.MULTI, cat: 'Produits laitiers', ref: 'ING-LAI-014', nom: 'Yaourt nature',           u: 'unité', pa: 400,  sm: 20 },

  // Œufs
  { act: ACT.MULTI, cat: 'Œufs & ovoproduits', ref: 'ING-OEU-001', nom: 'Œufs frais',             u: 'unité', pa: 100,  sm: 100 },
  { act: ACT.MULTI, cat: 'Œufs & ovoproduits', ref: 'ING-OEU-002', nom: 'Œufs de caille',         u: 'unité', pa: 150,  sm: 30 },

  // Chocolats & cacao
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-001', nom: 'Chocolat noir 55% couverture', u: 'kg', pa: 5500, sm: 5 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-002', nom: 'Chocolat noir 70% couverture', u: 'kg', pa: 7000, sm: 3 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-003', nom: 'Chocolat au lait couverture', u: 'kg',  pa: 5500, sm: 3 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-004', nom: 'Chocolat blanc couverture', u: 'kg',    pa: 6000, sm: 2 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-005', nom: 'Cacao en poudre non sucré', u: 'kg',    pa: 5000, sm: 3 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-006', nom: 'Pépites chocolat noir',   u: 'kg',    pa: 4500, sm: 4 },
  { act: ACT.MULTI, cat: 'Chocolats & cacao', ref: 'ING-CHO-007', nom: 'Nutella 750g',            u: 'pot',   pa: 4500, sm: 5 },

  // Fruits frais
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-001', nom: 'Pomme',                        u: 'kg', pa: 1500, sm: 5 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-002', nom: 'Banane douce',                 u: 'kg', pa: 500,  sm: 15 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-003', nom: 'Ananas',                       u: 'pièce', pa: 800, sm: 8 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-004', nom: 'Mangue',                       u: 'kg', pa: 700,  sm: 12 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-005', nom: 'Orange à jus',                 u: 'kg', pa: 600,  sm: 20 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-006', nom: 'Citron vert',                  u: 'kg', pa: 800,  sm: 8 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-007', nom: 'Citron jaune',                 u: 'kg', pa: 900,  sm: 6 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-008', nom: 'Fraise',                       u: 'kg', pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-009', nom: 'Passion (maracuja)',           u: 'kg', pa: 1500, sm: 4 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-010', nom: 'Pastèque',                     u: 'pièce', pa: 1500, sm: 3 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-011', nom: 'Melon',                        u: 'pièce', pa: 1200, sm: 3 },
  { act: ACT.MULTI, cat: 'Fruits frais', ref: 'ING-FRU-012', nom: 'Papaye',                       u: 'kg', pa: 500,  sm: 8 },

  // Légumes frais
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-001', nom: 'Tomate fraîche',              u: 'kg', pa: 800,  sm: 20 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-002', nom: 'Oignon',                      u: 'kg', pa: 700,  sm: 15 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-003', nom: 'Ail frais',                   u: 'kg', pa: 3000, sm: 3 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-004', nom: 'Gingembre frais',             u: 'kg', pa: 2500, sm: 3 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-005', nom: 'Piment frais',                u: 'kg', pa: 2000, sm: 2 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-006', nom: 'Laitue frisée',               u: 'pièce', pa: 500,  sm: 10 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-007', nom: 'Chou blanc',                  u: 'pièce', pa: 400,  sm: 8 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-008', nom: 'Carotte',                     u: 'kg', pa: 600,  sm: 10 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-009', nom: 'Concombre',                   u: 'kg', pa: 500,  sm: 8 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-010', nom: 'Poivron vert',                u: 'kg', pa: 1200, sm: 5 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-011', nom: 'Poivron rouge',               u: 'kg', pa: 1500, sm: 4 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-012', nom: 'Aubergine',                   u: 'kg', pa: 800,  sm: 4 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-013', nom: 'Champignon de Paris',         u: 'kg', pa: 3000, sm: 3 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-014', nom: 'Pomme de terre',              u: 'kg', pa: 700,  sm: 30 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-015', nom: 'Patate douce',                u: 'kg', pa: 800,  sm: 10 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-016', nom: 'Plantain mûr',                u: 'kg', pa: 600,  sm: 20 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-017', nom: 'Plantain vert',               u: 'kg', pa: 550,  sm: 20 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-018', nom: 'Manioc',                      u: 'kg', pa: 400,  sm: 15 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-019', nom: 'Igname',                      u: 'kg', pa: 700,  sm: 10 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-020', nom: 'Ndolé (feuilles)',            u: 'kg', pa: 1500, sm: 4 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-021', nom: 'Eru (feuilles)',              u: 'kg', pa: 1500, sm: 4 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-022', nom: 'Okok (feuilles)',             u: 'kg', pa: 1500, sm: 3 },
  { act: ACT.MULTI, cat: 'Légumes frais', ref: 'ING-LEG-023', nom: 'Avocat',                      u: 'kg', pa: 1200, sm: 6 },

  // Herbes & épices
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-001', nom: 'Sel fin de table',          u: 'kg', pa: 400,  sm: 8 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-002', nom: 'Sel gros',                  u: 'kg', pa: 300,  sm: 8 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-003', nom: 'Poivre noir moulu',         u: 'kg', pa: 8000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-004', nom: 'Curcuma en poudre',         u: 'kg', pa: 5000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-005', nom: 'Cannelle en poudre',        u: 'kg', pa: 6500, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-006', nom: 'Vanille (gousses)',         u: 'pièce', pa: 1500, sm: 15 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-007', nom: 'Extrait de vanille 100mL',  u: 'flacon', pa: 3500, sm: 5 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-008', nom: 'Muscade',                   u: 'kg', pa: 15000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-009', nom: 'Gingembre en poudre',       u: 'kg', pa: 5000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-010', nom: 'Cube maggi (100 pcs)',      u: 'boîte', pa: 2500, sm: 5 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-011', nom: 'Persil frais',              u: 'botte', pa: 300, sm: 10 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-012', nom: 'Basilic frais',             u: 'botte', pa: 500, sm: 6 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-013', nom: 'Coriandre fraîche',         u: 'botte', pa: 400, sm: 8 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-014', nom: 'Thym séché',                u: 'kg', pa: 6000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-015', nom: 'Laurier séché',             u: 'kg', pa: 5000, sm: 1 },
  { act: ACT.MULTI, cat: 'Herbes & épices', ref: 'ING-EPI-016', nom: 'Piment séché en poudre',    u: 'kg', pa: 4500, sm: 1 },

  // Viandes
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-001', nom: 'Bœuf haché',                        u: 'kg', pa: 4500, sm: 8 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-002', nom: 'Filet de bœuf',                     u: 'kg', pa: 8500, sm: 3 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-003', nom: 'Bœuf à mijoter',                    u: 'kg', pa: 4000, sm: 5 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-004', nom: 'Poulet entier',                     u: 'kg', pa: 2500, sm: 12 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-005', nom: 'Filet de poulet',                   u: 'kg', pa: 3500, sm: 10 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-006', nom: 'Cuisses de poulet',                 u: 'kg', pa: 2800, sm: 8 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-007', nom: 'Ailes de poulet',                   u: 'kg', pa: 2500, sm: 6 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-008', nom: 'Bacon en tranches',                 u: 'kg', pa: 7000, sm: 3 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-009', nom: 'Jambon blanc',                      u: 'kg', pa: 5500, sm: 3 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-010', nom: 'Saucisse fraîche',                  u: 'kg', pa: 4000, sm: 5 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-011', nom: 'Chair à saucisse',                  u: 'kg', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-012', nom: 'Escalope de veau',                  u: 'kg', pa: 6500, sm: 3 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-013', nom: 'Agneau (épaule)',                   u: 'kg', pa: 6000, sm: 3 },
  { act: ACT.MULTI, cat: 'Viandes', ref: 'ING-VIA-014', nom: 'Chèvre (fraîche)',                  u: 'kg', pa: 4500, sm: 3 },

  // Poissons & fruits de mer
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-001', nom: 'Bar entier',       u: 'kg', pa: 5500, sm: 4 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-002', nom: 'Dorade royale',    u: 'kg', pa: 5000, sm: 4 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-003', nom: 'Filet de tilapia', u: 'kg', pa: 4000, sm: 5 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-004', nom: 'Thon frais',       u: 'kg', pa: 6500, sm: 3 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-005', nom: 'Machoiron',        u: 'kg', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-006', nom: 'Saumon fumé',      u: 'kg', pa: 15000, sm: 1 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-007', nom: 'Crevettes fraîches (moy.)', u: 'kg', pa: 8000, sm: 2 },
  { act: ACT.MULTI, cat: 'Poissons & fruits de mer', ref: 'ING-POI-008', nom: 'Calamars',         u: 'kg', pa: 5500, sm: 2 },

  // Huiles & matières grasses
  { act: ACT.MULTI, cat: 'Huiles & matières grasses', ref: 'ING-HUI-001', nom: 'Huile de tournesol 1L', u: 'L', pa: 1500, sm: 30 },
  { act: ACT.MULTI, cat: 'Huiles & matières grasses', ref: 'ING-HUI-002', nom: 'Huile d\'arachide 1L',  u: 'L', pa: 1800, sm: 20 },
  { act: ACT.MULTI, cat: 'Huiles & matières grasses', ref: 'ING-HUI-003', nom: 'Huile d\'olive vierge 1L', u: 'L', pa: 8500, sm: 4 },
  { act: ACT.MULTI, cat: 'Huiles & matières grasses', ref: 'ING-HUI-004', nom: 'Huile de palme rouge',    u: 'L', pa: 1800, sm: 8 },
  { act: ACT.MULTI, cat: 'Huiles & matières grasses', ref: 'ING-HUI-005', nom: 'Margarine 500g',      u: 'kg', pa: 2500, sm: 6 },

  // Conserves & bases
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-001', nom: 'Concentré de tomate 400g', u: 'boîte', pa: 800, sm: 20 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-002', nom: 'Tomate pelée 400g',      u: 'boîte', pa: 900, sm: 15 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-003', nom: 'Haricots rouges 400g',   u: 'boîte', pa: 900, sm: 10 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-004', nom: 'Thon en boîte 155g',     u: 'boîte', pa: 800, sm: 20 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-005', nom: 'Sardines à l\'huile 125g', u: 'boîte', pa: 500, sm: 20 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-006', nom: 'Maïs doux 300g',         u: 'boîte', pa: 900, sm: 10 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-007', nom: 'Mayonnaise 500mL',       u: 'pot',   pa: 2500, sm: 8 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-008', nom: 'Ketchup 1kg',            u: 'kg',    pa: 3500, sm: 6 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-009', nom: 'Moutarde 500g',          u: 'pot',   pa: 2500, sm: 4 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-010', nom: 'Sauce soja 1L',          u: 'L',     pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-011', nom: 'Vinaigre balsamique 500mL', u: 'flacon', pa: 4500, sm: 3 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-012', nom: 'Vinaigre blanc 1L',      u: 'L',     pa: 1000, sm: 5 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-013', nom: 'Bouillon cube volaille (60 pcs)', u: 'boîte', pa: 3000, sm: 5 },
  { act: ACT.MULTI, cat: 'Conserves & bases', ref: 'ING-CON-014', nom: 'Sucre gélifiant',        u: 'kg',    pa: 2000, sm: 3 },
];

// ==============================================================================
// REVENTE (achetés et revendus tels quels)
// ==============================================================================
const REVENTE = [
  // Sodas & softs
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-001', nom: 'Coca-Cola 33cl',            u: 'unité', pa: 350, pv: 700, sm: 60 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-002', nom: 'Coca-Cola 50cl',            u: 'unité', pa: 500, pv: 900, sm: 40 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-003', nom: 'Coca-Cola 1L',              u: 'unité', pa: 900, pv: 1500, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-004', nom: 'Coca-Cola 1.5L',            u: 'unité', pa: 1200, pv: 2000, sm: 25 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-005', nom: 'Coca-Cola Zero 33cl',       u: 'unité', pa: 400, pv: 750, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-006', nom: 'Fanta orange 33cl',         u: 'unité', pa: 350, pv: 700, sm: 50 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-007', nom: 'Fanta cocktail 33cl',       u: 'unité', pa: 350, pv: 700, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-008', nom: 'Fanta citron 33cl',         u: 'unité', pa: 350, pv: 700, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-009', nom: 'Sprite 33cl',               u: 'unité', pa: 350, pv: 700, sm: 40 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-010', nom: 'Top ananas 33cl',           u: 'unité', pa: 300, pv: 600, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-011', nom: 'Top grenadine 33cl',        u: 'unité', pa: 300, pv: 600, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-012', nom: 'Malta Guinness 33cl',       u: 'unité', pa: 400, pv: 800, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-013', nom: 'XXL Energy 50cl',           u: 'unité', pa: 500, pv: 1000, sm: 25 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-014', nom: 'Djino Cola 33cl',           u: 'unité', pa: 300, pv: 600, sm: 30 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-015', nom: 'Eau minérale Tangui 50cl',  u: 'unité', pa: 250, pv: 500, sm: 100 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-016', nom: 'Eau minérale Supermont 50cl', u: 'unité', pa: 250, pv: 500, sm: 80 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-017', nom: 'Eau minérale Vittel 33cl',  u: 'unité', pa: 400, pv: 800, sm: 20 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-018', nom: 'Rani mangue 24cl',          u: 'unité', pa: 500, pv: 1000, sm: 20 },
  { act: ACT.MULTI, cat: 'Sodas & softs (achat)', ref: 'REV-SOD-019', nom: 'Ceres tropical 1L',         u: 'unité', pa: 1500, pv: 2500, sm: 15 },

  // Bières & alcools
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-001', nom: 'Bière Castel 65cl',      u: 'unité', pa: 600, pv: 1200, sm: 50 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-002', nom: 'Bière Beaufort 65cl',    u: 'unité', pa: 550, pv: 1100, sm: 50 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-003', nom: 'Bière "33" Export 65cl', u: 'unité', pa: 550, pv: 1100, sm: 50 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-004', nom: 'Bière Isenbeck 65cl',    u: 'unité', pa: 500, pv: 1000, sm: 40 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-005', nom: 'Guinness Foreign 33cl',  u: 'unité', pa: 700, pv: 1400, sm: 30 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-006', nom: 'Heineken 33cl',          u: 'unité', pa: 800, pv: 1500, sm: 30 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-007', nom: 'Vin rouge maison 75cl',  u: 'unité', pa: 5500, pv: 12000, sm: 15 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-008', nom: 'Vin blanc maison 75cl',  u: 'unité', pa: 5500, pv: 12000, sm: 10 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-009', nom: 'Vin rosé 75cl',          u: 'unité', pa: 5000, pv: 11000, sm: 8 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-010', nom: 'Whisky JB 70cl',         u: 'unité', pa: 15000, pv: 30000, sm: 6 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-011', nom: 'Whisky Jack Daniels 70cl', u: 'unité', pa: 22000, pv: 45000, sm: 4 },
  { act: ACT.MULTI, cat: 'Bières & alcools (achat)', ref: 'REV-BIE-012', nom: 'Vodka Smirnoff 70cl',    u: 'unité', pa: 12000, pv: 25000, sm: 5 },

  // Snacks emballés
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-001', nom: 'Chips Lays nature 70g',           u: 'sachet', pa: 500, pv: 1000, sm: 20 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-002', nom: 'Chips Pringles Original',         u: 'boîte', pa: 2000, pv: 3500, sm: 12 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-003', nom: 'Chocolat Kinder Bueno',           u: 'unité', pa: 600, pv: 1200, sm: 25 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-004', nom: 'Snickers barre',                  u: 'unité', pa: 500, pv: 1000, sm: 25 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-005', nom: 'Twix barre',                      u: 'unité', pa: 500, pv: 1000, sm: 20 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-006', nom: 'Bounty barre',                    u: 'unité', pa: 500, pv: 1000, sm: 15 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-007', nom: 'Kit Kat 4 barres',                u: 'unité', pa: 700, pv: 1500, sm: 15 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-008', nom: 'Oreo original 154g',              u: 'paquet', pa: 800, pv: 1500, sm: 15 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-009', nom: 'TUC crackers salés',              u: 'paquet', pa: 500, pv: 1000, sm: 20 },
  { act: ACT.MULTI, cat: 'Snacks emballés', ref: 'REV-SNA-010', nom: 'Chewing-gum menthe (boîte)',      u: 'boîte', pa: 400, pv: 800, sm: 15 },
];

// ==============================================================================
// CONSOMMABLES (emballages, hygiène, nettoyage)
// ==============================================================================
const CONSOMMABLES = [
  // Emballages
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-001', nom: 'Sac papier kraft petit (paquet 100)',  u: 'paquet', pa: 3500, sm: 5 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-002', nom: 'Sac papier kraft moyen (paquet 100)',  u: 'paquet', pa: 4500, sm: 5 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-003', nom: 'Sac papier kraft grand (paquet 100)',  u: 'paquet', pa: 5500, sm: 4 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-004', nom: 'Boîte burger carton (paquet 100)',     u: 'paquet', pa: 6000, sm: 4 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-005', nom: 'Boîte pizza 26cm (paquet 50)',         u: 'paquet', pa: 4500, sm: 4 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-006', nom: 'Boîte pizza 32cm (paquet 50)',         u: 'paquet', pa: 5500, sm: 3 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-007', nom: 'Barquette alu 500mL avec couvercle (paquet 100)', u: 'paquet', pa: 7500, sm: 4 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-008', nom: 'Gobelet carton 20cl (paquet 50)',      u: 'paquet', pa: 2000, sm: 8 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-009', nom: 'Gobelet carton 33cl (paquet 50)',      u: 'paquet', pa: 2500, sm: 6 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-010', nom: 'Couvercle gobelet (paquet 100)',       u: 'paquet', pa: 1500, sm: 8 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-011', nom: 'Paille papier (paquet 250)',           u: 'paquet', pa: 2500, sm: 6 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-012', nom: 'Serviette papier (paquet 500)',        u: 'paquet', pa: 3000, sm: 8 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-013', nom: 'Sac plastique kraft (100)',            u: 'paquet', pa: 1500, sm: 10 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-014', nom: 'Film alimentaire 300m',                u: 'rouleau', pa: 4500, sm: 3 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-015', nom: 'Papier aluminium 100m',                u: 'rouleau', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-016', nom: 'Papier sulfurisé 50m',                 u: 'rouleau', pa: 2500, sm: 3 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-017', nom: 'Sac sous vide (paquet 100)',           u: 'paquet', pa: 4500, sm: 3 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-018', nom: 'Poche à douille jetable (paquet 100)', u: 'paquet', pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Emballages', ref: 'CON-EMB-019', nom: 'Moule à muffin papier (paquet 500)',   u: 'paquet', pa: 2500, sm: 3 },

  // Ustensiles jetables
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-001', nom: 'Fourchette plastique (paquet 100)', u: 'paquet', pa: 1500, sm: 8 },
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-002', nom: 'Cuillère plastique (paquet 100)',   u: 'paquet', pa: 1500, sm: 8 },
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-003', nom: 'Couteau plastique (paquet 100)',    u: 'paquet', pa: 1500, sm: 6 },
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-004', nom: 'Cure-dents (boîte 500)',            u: 'boîte', pa: 1000, sm: 5 },
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-005', nom: 'Pique en bois brochette (paquet 100)', u: 'paquet', pa: 1500, sm: 8 },
  { act: ACT.MULTI, cat: 'Ustensiles jetables', ref: 'CON-UST-006', nom: 'Bâtonnet remuage café (paquet 500)', u: 'paquet', pa: 1500, sm: 4 },

  // Hygiène
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-001', nom: 'Gants latex jetables M (100)',      u: 'boîte', pa: 4500, sm: 4 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-002', nom: 'Gants vinyle jetables L (100)',     u: 'boîte', pa: 5000, sm: 3 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-003', nom: 'Charlotte cheveux jetable (100)',   u: 'paquet', pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-004', nom: 'Masque chirurgical (boîte 50)',     u: 'boîte', pa: 3000, sm: 4 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-005', nom: 'Tablier plastique jetable (paquet 50)', u: 'paquet', pa: 4500, sm: 3 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-006', nom: 'Savon liquide mains 5L',            u: 'bidon', pa: 5500, sm: 2 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-007', nom: 'Gel hydroalcoolique 1L',            u: 'flacon', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-008', nom: 'Papier toilette (paquet 12)',       u: 'paquet', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Hygiène & protection', ref: 'CON-HYG-009', nom: 'Essuie-tout rouleaux (paquet 6)',   u: 'paquet', pa: 4500, sm: 3 },

  // Nettoyage
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-001', nom: 'Eau de Javel 2L',                              u: 'bidon', pa: 1500, sm: 4 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-002', nom: 'Liquide vaisselle 5L',                         u: 'bidon', pa: 5500, sm: 3 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-003', nom: 'Détergent sol 5L',                             u: 'bidon', pa: 4500, sm: 3 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-004', nom: 'Dégraissant cuisine 5L',                       u: 'bidon', pa: 6500, sm: 2 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-005', nom: 'Éponges à récurer (paquet 10)',                u: 'paquet', pa: 1500, sm: 5 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-006', nom: 'Torchon microfibre (paquet 5)',                u: 'paquet', pa: 3500, sm: 3 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-007', nom: 'Sac poubelle 100L (paquet 50)',                u: 'paquet', pa: 3500, sm: 4 },
  { act: ACT.MULTI, cat: 'Nettoyage', ref: 'CON-NET-008', nom: 'Sac poubelle 50L (paquet 100)',                u: 'paquet', pa: 3000, sm: 4 },

  // Fourniture bureau
  { act: ACT.MULTI, cat: 'Fourniture bureau', ref: 'CON-BUR-001', nom: 'Bloc facturier 50 pages',              u: 'bloc',  pa: 800, sm: 20 },
  { act: ACT.MULTI, cat: 'Fourniture bureau', ref: 'CON-BUR-002', nom: 'Stylo bille bleu (boîte 12)',          u: 'boîte', pa: 2500, sm: 5 },
  { act: ACT.MULTI, cat: 'Fourniture bureau', ref: 'CON-BUR-003', nom: 'Rouleau ticket caisse 57mm (5)',       u: 'paquet', pa: 2500, sm: 10 },
  { act: ACT.MULTI, cat: 'Fourniture bureau', ref: 'CON-BUR-004', nom: 'Ruban adhésif (rouleau)',              u: 'rouleau', pa: 500, sm: 15 },
  { act: ACT.MULTI, cat: 'Fourniture bureau', ref: 'CON-BUR-005', nom: 'Agrafes standard (boîte 5000)',        u: 'boîte', pa: 1500, sm: 3 },
];

// =============================================================================
// GÉNÉRATION EXCEL
// =============================================================================
async function generer() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bistock';
  wb.created = new Date();
  wb.title = 'Catalogue Référence Bistock';

  // Palette : entête doré, bandeaux d'activité colorés
  const COULEUR_ACT = {
    TRAIT: 'FF7C3AED', // violet
    CAN:   'FF059669', // vert
    PAT:   'FFEA580C', // orange
    BUR:   'FFDC2626', // rouge
    MULTI: 'FF64748B', // gris ardoise
  };
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4AF37' } }; // or
  const HEAD_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };

  // -----------------------------------------------
  // Feuille 1 : LISEZ-MOI
  // -----------------------------------------------
  const wsInfo = wb.addWorksheet('LISEZ-MOI', { properties: { tabColor: { argb: 'FFD4AF37' } } });
  wsInfo.columns = [{ width: 4 }, { width: 90 }];
  wsInfo.addRow(['', 'Catalogue Référence — Le Traiteur du Bistrot / Bistock']);
  wsInfo.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF8B6914' } };
  wsInfo.addRow([]);
  const intro = [
    'Ce classeur est une base de travail large pour créer votre catalogue si vous n\'avez pas encore',
    'de fichier client.',
    '',
    '── STRUCTURE DES ONGLETS ──────────────────────────────────────────',
    '  • CATEGORIES     — toutes les catégories possibles par activité (TRAIT, CAN, PAT, BUR, MULTI)',
    '  • PRODUITS_FINIS — produits vendus au client (à préparer / à servir)',
    '  • INGREDIENTS    — matières premières utilisées en cuisine / pâtisserie',
    '  • REVENTE        — produits achetés puis revendus tels quels (sodas, bières, snacks…)',
    '  • CONSOMMABLES   — emballages, ustensiles jetables, hygiène, nettoyage',
    '',
    '── CODES ACTIVITÉ ────────────────────────────────────────────────',
    '  TRAIT  Le Traiteur                        (événementiel — plateaux, buffets, cocktails)',
    '  CAN    La Cantine                          (repas quotidiens — plats du jour, sandwichs)',
    '  PAT    Pâtisserie / Salon / Restaurant     (viennoiseries, gâteaux, restaurant à la carte)',
    '  BUR    237 Bona Burger                     (fast-food — burgers, frites, boissons)',
    '  MULTI  Multi-activités                     (matières partagées : ingrédients, consommables, revente)',
    '',
    '── COLONNES ──────────────────────────────────────────────────────',
    '  Activité         Code de l\'activité concernée (voir ci-dessus)',
    '  Catégorie        Nom de la catégorie (doit exister dans l\'onglet CATEGORIES)',
    '  Référence        Code interne unique (ex: PAT-VIE-001)',
    '  Désignation      Nom commercial affiché',
    '  Unité            pièce, kg, L, portion, plateau, menu…',
    '  Prix achat (FCFA)   Coût d\'achat estimé',
    '  Prix vente (FCFA)   Prix affiché au client',
    '  Temps prépa (min)   Temps que la cuisine met à préparer (0 = pas de production)',
    '  Stock mini          Seuil d\'alerte de stock (avertissement quand le stock passe en dessous)',
    '',
    '── UTILISATION DANS L\'APP ────────────────────────────────────────',
    '  1. Ce fichier est indicatif — ajustez les prix / références selon votre marge et vos usages',
    '  2. Pour importer dans Bistock, utilisez l\'écran "Catalogue → Produits → Importer Excel"',
    '     OU laissez le développeur adapter le fichier au format d\'import attendu',
    '  3. Les prix sont en FCFA — ce sont des ORDRES DE GRANDEUR pour Douala/Yaoundé, à valider',
    '  4. Toutes les données sont libres de modification et suppression',
    '',
    '── LICENCE ──────────────────────────────────────────────────────',
    '  Ce fichier est fourni comme base de travail pour Le Traiteur du Bistrot.',
    '  Généré automatiquement par l\'application Bistock — non exhaustif.',
  ];
  intro.forEach((l) => wsInfo.addRow(['', l]));
  wsInfo.getColumn(2).font = { size: 10 };

  // -----------------------------------------------
  // Fonction helper : construction feuille produits
  // -----------------------------------------------
  function ajouterFeuille(nom, colonnes, lignes, opts = {}) {
    const ws = wb.addWorksheet(nom, { properties: { tabColor: { argb: opts.tabColor || 'FFD4AF37' } } });
    ws.columns = colonnes.map((c) => ({ header: c.header, key: c.key, width: c.width || 15 }));
    ws.getRow(1).eachCell((c) => { c.fill = HEAD_FILL; c.font = HEAD_FONT; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    ws.getRow(1).height = 22;

    for (const l of lignes) {
      const row = ws.addRow(l);
      // Colonne Activité colorée
      const cellAct = row.getCell(1);
      const couleur = COULEUR_ACT[l[colonnes[0].key]] || 'FF64748B';
      cellAct.font = { color: { argb: couleur }, bold: true };
    }
    // Ligne de titre figée
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    // Auto-filter
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };
    return ws;
  }

  // Feuille CATEGORIES
  ajouterFeuille('CATEGORIES', [
    { header: 'Activité',    key: 'act', width: 10 },
    { header: 'Catégorie',   key: 'nom', width: 32 },
    { header: 'Description', key: 'desc', width: 60 },
  ], CATEGORIES.map((c) => ({ act: c.act, nom: c.nom, desc: c.desc })), { tabColor: 'FF64748B' });

  // Feuille PRODUITS_FINIS
  ajouterFeuille('PRODUITS_FINIS', [
    { header: 'Activité',       key: 'act', width: 10 },
    { header: 'Catégorie',      key: 'cat', width: 28 },
    { header: 'Référence',      key: 'ref', width: 16 },
    { header: 'Désignation',    key: 'nom', width: 40 },
    { header: 'Unité',          key: 'u',   width: 12 },
    { header: 'Prix achat FCFA', key: 'pa', width: 14 },
    { header: 'Prix vente FCFA', key: 'pv', width: 14 },
    { header: 'Temps prépa (min)', key: 'tp', width: 14 },
    { header: 'Stock mini',     key: 'sm', width: 10 },
  ], PRODUITS_FINIS.map((p) => ({ act: p.act, cat: p.cat, ref: p.ref, nom: p.nom, u: p.u, pa: p.pa, pv: p.pv, tp: p.tp, sm: p.sm })), { tabColor: 'FFEA580C' });

  // Feuille INGREDIENTS
  ajouterFeuille('INGREDIENTS', [
    { header: 'Activité',       key: 'act', width: 10 },
    { header: 'Catégorie',      key: 'cat', width: 28 },
    { header: 'Référence',      key: 'ref', width: 16 },
    { header: 'Désignation',    key: 'nom', width: 40 },
    { header: 'Unité',          key: 'u',   width: 12 },
    { header: 'Prix achat FCFA', key: 'pa', width: 14 },
    { header: 'Stock mini',     key: 'sm', width: 10 },
  ], INGREDIENTS.map((p) => ({ act: p.act, cat: p.cat, ref: p.ref, nom: p.nom, u: p.u, pa: p.pa, sm: p.sm })), { tabColor: 'FF059669' });

  // Feuille REVENTE
  ajouterFeuille('REVENTE', [
    { header: 'Activité',       key: 'act', width: 10 },
    { header: 'Catégorie',      key: 'cat', width: 28 },
    { header: 'Référence',      key: 'ref', width: 16 },
    { header: 'Désignation',    key: 'nom', width: 40 },
    { header: 'Unité',          key: 'u',   width: 12 },
    { header: 'Prix achat FCFA', key: 'pa', width: 14 },
    { header: 'Prix vente FCFA', key: 'pv', width: 14 },
    { header: 'Stock mini',     key: 'sm', width: 10 },
  ], REVENTE.map((p) => ({ act: p.act, cat: p.cat, ref: p.ref, nom: p.nom, u: p.u, pa: p.pa, pv: p.pv, sm: p.sm })), { tabColor: 'FFDC2626' });

  // Feuille CONSOMMABLES
  ajouterFeuille('CONSOMMABLES', [
    { header: 'Activité',       key: 'act', width: 10 },
    { header: 'Catégorie',      key: 'cat', width: 28 },
    { header: 'Référence',      key: 'ref', width: 16 },
    { header: 'Désignation',    key: 'nom', width: 45 },
    { header: 'Unité',          key: 'u',   width: 12 },
    { header: 'Prix achat FCFA', key: 'pa', width: 14 },
    { header: 'Stock mini',     key: 'sm', width: 10 },
  ], CONSOMMABLES.map((p) => ({ act: p.act, cat: p.cat, ref: p.ref, nom: p.nom, u: p.u, pa: p.pa, sm: p.sm })), { tabColor: 'FF7C3AED' });

  // Écriture
  if (!fs.existsSync(path.dirname(OUTPUT))) fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  await wb.xlsx.writeFile(OUTPUT);
  const stat = fs.statSync(OUTPUT);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   CATALOGUE RÉFÉRENCE GÉNÉRÉ                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  ✓ Fichier    : ${OUTPUT}`);
  console.log(`  ✓ Taille     : ${Math.round(stat.size / 1024)} Ko`);
  console.log(`  ✓ Catégories : ${CATEGORIES.length}`);
  console.log(`  ✓ Produits finis : ${PRODUITS_FINIS.length}`);
  console.log(`  ✓ Ingrédients    : ${INGREDIENTS.length}`);
  console.log(`  ✓ Revente        : ${REVENTE.length}`);
  console.log(`  ✓ Consommables   : ${CONSOMMABLES.length}`);
  console.log(`  ✓ TOTAL éléments : ${CATEGORIES.length + PRODUITS_FINIS.length + INGREDIENTS.length + REVENTE.length + CONSOMMABLES.length}\n`);
}

// Export des données pour permettre à d'autres scripts (ex: generer_imports_bstock.js)
// de réutiliser le catalogue sans dupliquer.
module.exports = { ACT, CATEGORIES, PRODUITS_FINIS, INGREDIENTS, REVENTE, CONSOMMABLES };

// N'exécute la génération que si le script est lancé directement.
if (require.main === module) {
  generer().catch((e) => { console.error('✗', e.message); process.exit(1); });
}
