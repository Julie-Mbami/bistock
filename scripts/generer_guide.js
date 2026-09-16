// Génération du guide utilisateur détaillé : docs/Guide_Utilisation.doc + .pdf
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT_DIR = path.join(__dirname, '..', 'docs');
const SCREENS_DIR = path.join(OUT_DIR, 'screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function screenPath(fichier) {
  const p = path.join(SCREENS_DIR, fichier);
  return fs.existsSync(p) ? p : null;
}

// Lit les dimensions natives d'un PNG (sans lib externe) : offset 16 = width, 20 = height, big-endian
function pngDimensions(cheminPng) {
  const buf = fs.readFileSync(cheminPng);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Calcule les dimensions cibles d'une image pour rentrer dans une boîte (largeur/hauteur max)
// en préservant le ratio d'aspect. Si le ratio est trop haut, on limite d'abord par la hauteur.
function tailleContrainte(cheminPng, maxW, maxH) {
  const { w, h } = pngDimensions(cheminPng);
  const ratio = w / h;
  // Cas image extrêmement haute (>3x) : on la traite en priorité par la hauteur, en gardant un min de largeur lisible
  if (h / w > 3) {
    // On garde toute la largeur autorisée mais on plafonne la hauteur à maxH
    return { w: maxW, h: maxH, tronquee: true };
  }
  // Cas normal : contrainte par largeur OU hauteur, on prend la plus stricte
  let W = maxW;
  let H = W / ratio;
  if (H > maxH) { H = maxH; W = H * ratio; }
  return { w: Math.round(W), h: Math.round(H), tronquee: false };
}

// ============================================================================
// STRUCTURE DÉTAILLÉE DU GUIDE
// ============================================================================
const guide = {
  titre: 'Guide d\'utilisation complet',
  sousTitre: 'Bistock (Billing & Stock) — Système de gestion pour Le Traiteur du Bistrot',
  version: 'Version 1.2 · Juillet 2026 · Bistock + Canal en ligne, suppléments, import Excel massif, permissions granulaires',
  chapitres: [
    // ==========================================================
    { titre: '1. Introduction et vue d\'ensemble', sections: [
      { h: 'À qui s\'adresse ce guide ?',
        p: [
          'Ce guide est destiné à tous les utilisateurs du système de gestion Le Traiteur du Bistrot : la Direction Générale (Mme Sandra), le personnel de secrétariat, le responsable de la distribution (Nestor), les gestionnaires de stock par activité, ainsi que les caissiers.',
          'Chaque section explique de manière progressive comment utiliser un module précis, en partant de la connexion jusqu\'aux fonctionnalités les plus avancées comme le rapport mensuel ou le journal d\'audit.',
          'Les identifiants de test fournis en annexe permettent d\'expérimenter chaque rôle avant la mise en production.',
        ],
      },
      { h: 'Qu\'est-ce que Le Traiteur du Bistrot SUARL ?',
        p: [
          'Le Traiteur du Bistrot SUARL est une entreprise camerounaise 100 % agroalimentaire basée à Douala, quartier Bonapriso, dont le siège est situé rue Bâti bois (BP 434 Douala).',
          'L\'entreprise regroupe 4 activités complémentaires mais parfaitement cloisonnées sur le plan comptable et logistique : deux orientées B2B (commande sur devis pour clients professionnels et particuliers) et deux orientées B2C (vente comptoir/caisse).',
          'Le NIU M011300044639Y et le RCCM RC/DLA/2013/B/514 identifient l\'entité juridique. La banque partenaire est SGC Douala Bonanjo (compte 06010429558 55).',
        ],
      },
      { h: 'Les 4 activités en détail',
        tableau: {
          colonnes: ['Code', 'Activité', 'Type de vente', 'Modèle économique', 'Rôle du stock'],
          lignes: [
            ['TRAIT', 'Le Traiteur', 'B2B événementiel', 'Devis → validation → livraison → facture', 'Ingrédients + plats préparés sur commande'],
            ['CAN', 'La Cantine', 'B2B récurrent', 'Commandes journalières livrées en boîte', 'Ingrédients bruts + repas quotidiens en barquette'],
            ['PAT', 'Pâtisserie / Salon', 'B2C comptoir', 'Vente immédiate au comptoir', 'Pâtisseries fabriquées + boissons + plats simples'],
            ['BUR', '237 Bona Burger', 'B2C fast-food', 'Vente à emporter/consommation sur place', 'Burgers, pizzas, boissons'],
          ],
        },
        p2: [
          'Chaque activité possède son propre catalogue produits, ses propres fournisseurs, ses propres clients et ses propres statistiques financières. La Direction Générale voit la consolidation.',
          'Une seule instance de l\'application gère tout : c\'est ce qu\'on appelle un système multi-activités cloisonné.',
        ],
      },
      { h: 'Les 6 rôles et les 13 utilisateurs',
        p: [
          'Le système distingue **6 rôles fonctionnels** répartis sur les personnes de l\'entreprise. Chaque rôle a un modèle de permissions par défaut (paramétrable individuellement par la DG).',
        ],
        tableau: {
          colonnes: ['Personne / Compte', 'Rôle système', 'Périmètre', 'Mission principale'],
          lignes: [
            ['Mme Sandra', 'DG', 'Toutes activités', 'Pilotage global, validation des décisions sensibles, consolidation financière, administration système'],
            ['Sandra', 'SECRETARIAT', 'Traiteur + Cantine', 'Saisie proformas B2B, suivi commercial, encaissements, relances clients'],
            ['Nestor NGUEMA', 'DISTRIBUTION', 'Achats + Distribution', 'Réception physique des achats, préparation des distributions vers les activités'],
            ['Mario ONANA', 'GESTIONNAIRE', 'Le Traiteur', 'Gestion stock Traiteur, catalogue, inventaires, réceptions, validation des sorties production'],
            ['Mariano FOUDA', 'GESTIONNAIRE', 'La Cantine', 'Gestion stock Cantine, catalogue, inventaires, réceptions, validation des sorties production'],
            ['Floriane RAMY', 'GESTIONNAIRE', 'Pâtisserie', 'Gestion stock Pâtisserie, catalogue, inventaires, validation des sorties production'],
            ['Nikolas KAMGA', 'GESTIONNAIRE', '237 Bona Burger', 'Gestion stock Bona Burger, catalogue, inventaires, validation des sorties production'],
            ['Caissier Pâtisserie', 'CAISSIER', 'Pâtisserie', 'Encaissements comptoir, ouverture/clôture caisse'],
            ['Caissier Bona Burger', 'CAISSIER', 'Bona Burger', 'Encaissements comptoir, ouverture/clôture caisse'],
            ['Chef Cuisinier Traiteur', 'CUISINIER', 'Le Traiteur', 'Recettes, ordres de production, alerte gestionnaire sur ingrédients manquants'],
            ['Chef Cuisinier Cantine', 'CUISINIER', 'La Cantine', 'Recettes, ordres de production, alerte gestionnaire sur ingrédients manquants'],
            ['Chef Pâtissier', 'CUISINIER', 'Pâtisserie', 'Recettes, ordres de production, alerte gestionnaire sur ingrédients manquants'],
            ['Chef Cuisinier Bona Burger', 'CUISINIER', '237 Bona Burger', 'Recettes, ordres de production, alerte gestionnaire sur ingrédients manquants'],
          ],
        },
        p2: [
          'Les 4 comptes cuisiniers et les 2 comptes caissiers sont livrés en placeholders : la DG peut les renommer avec les vrais noms du personnel dans **Administration → Utilisateurs → Modifier**.',
          'Chaque utilisateur ne voit que les menus adaptés à son rôle. Un caissier ne peut pas ouvrir le journal d\'audit ; un gestionnaire ne peut pas modifier les activités ; un cuisinier ne peut pas encaisser une vente.',
          'Les permissions sont contrôlées côté serveur : impossible de contourner en manipulant l\'URL.',
        ],
      },
      { h: 'Concepts clés à retenir',
        p: [
          'Trois concepts structurants pour comprendre le fonctionnement du système :',
          '',
          '1. **Cloisonnement par activité** : chaque produit, chaque client, chaque commande appartient à une activité et une seule. Un produit "Coca-Cola 50cl" existe séparément dans Bona Burger et dans la Pâtisserie. Les stocks sont indépendants, les prix peuvent différer.',
          '',
          '2. **Chaîne de valeur produit** : Achat → Distribution → Réception → (Production éventuelle) → Vente. Chaque étape génère un mouvement de stock tracé.',
          '',
          '3. **Fiche technique = recette** : quand un plat est fabriqué en cuisine à partir de plusieurs ingrédients, une fiche technique en décrit la composition. Elle sert aux ordres de production, pas aux ventes directes.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '2. Démarrage et navigation', sections: [
      { h: 'Prérequis techniques',
        p: [
          'Le système fonctionne sur Windows, macOS ou Linux avec Node.js 18 ou supérieur installé.',
          'Le fichier de base de données est data/app.db (SQLite). Aucun serveur externe n\'est nécessaire, tout est local.',
          'Le navigateur recommandé est Chrome, Edge ou Firefox à jour. L\'interface est optimisée pour un écran 1440×900 minimum.',
        ],
      },
      { h: 'Démarrer le serveur',
        p: [
          'Ouvrez un terminal PowerShell dans le dossier du projet.',
          'Exécutez la commande : npm start',
          'Le serveur affiche : "Serveur démarré sur http://localhost:9000".',
          'Laissez le terminal ouvert pendant toute l\'utilisation. Fermer le terminal arrête le serveur.',
          'En production, un service Windows peut être configuré pour lancer le serveur automatiquement au démarrage.',
        ],
      },
      { h: 'Se connecter',
        p: [
          'Ouvrez votre navigateur à l\'adresse http://localhost:9000 (ou l\'adresse IP du serveur sur le réseau local).',
          'La page de connexion affiche deux champs : nom d\'utilisateur et mot de passe.',
          'Saisissez vos identifiants et cliquez sur "Se connecter".',
          'En cas d\'erreur "Identifiants incorrects", vérifiez la casse (msandra ≠ MSANDRA) et l\'absence d\'espaces avant/après.',
          'Une fois connecté, votre tableau de bord personnalisé s\'affiche automatiquement.',
        ],
        img: '01_connexion.png',
        capture: 'Écran de connexion épuré : logo, formulaire, bouton principal.',
      },
      { h: 'Comprendre la barre latérale',
        p: [
          'La barre latérale gauche est votre menu principal. Elle est organisée en sections (Tableau de bord, Vente, Catalogue, Stocks, Cuisine, Commandes B2B, Administration...) qui apparaissent selon votre rôle et l\'activité active.',
          'En haut, un bloc coloré indique l\'activité en cours (Le Traiteur / La Cantine / Pâtisserie / Bona Burger). Cliquez dessus pour basculer entre les activités auxquelles vous avez accès.',
          'Les badges rouges à droite de certains liens signalent des éléments qui demandent votre attention (ex : "3" à côté de "Réceptions à traiter" ou "5" à côté de "Factures à relancer").',
        ],
      },
      { h: 'Basculer entre activités',
        p: [
          'Certains rôles ont accès à plusieurs activités : la DG voit les 4, Sandra Secrétariat voit Traiteur + Cantine, Nestor voit toutes les activités pour les distributions.',
          'Pour changer d\'activité : cliquez sur le bloc coloré en haut de la sidebar. Un dropdown s\'affiche avec les activités disponibles.',
          'Après bascule, tous les écrans se rechargent avec les données de la nouvelle activité. La caisse remplace les commandes B2B (ou l\'inverse) selon le type d\'activité.',
        ],
      },
      { h: 'Se déconnecter',
        p: [
          'Cliquez sur votre nom en haut à droite (ou l\'icône profil), puis "Se déconnecter".',
          'À la fin d\'une journée, il est important de se déconnecter pour éviter qu\'une autre personne n\'agisse sous votre compte.',
          'Le système enregistre chaque action dans le journal d\'audit avec l\'identité de l\'utilisateur — ne partagez jamais vos identifiants.',
        ],
      },
      { h: 'Conventions d\'interface',
        p: [
          '**Confirmations par modale** — Toutes les actions destructives (suppression d\'un produit, d\'une catégorie, d\'un utilisateur, annulation d\'une commande, refus de production) déclenchent une petite fenêtre de confirmation superposée. Deux boutons : « Annuler » et « Supprimer » (en rouge). Aucune page intermédiaire, aucun rechargement inutile.',
          '',
          '**Toasts en haut à droite** — Après une action réussie (produit créé, import validé, vente enregistrée), un petit bandeau vert s\'affiche 3 secondes puis disparaît tout seul.',
          '',
          '**Pagination intelligente** — Les listes longues (produits, ventes, journal d\'audit) sont paginées par 25 lignes. Les numéros de page utilisent des ellipses (« 1 · 2 · … · 8 · 9 ») pour rester lisibles sur les gros historiques. Aucun sélecteur de taille — la pagination est fixe.',
          '',
          '**Puce d\'activité** — La puce colorée en haut à droite (au lieu du bloc en haut de sidebar sur les versions antérieures) sert à basculer entre activités pour les rôles transverses.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '3. Le catalogue produits — le socle de tout', sections: [
      { h: 'Pourquoi le catalogue est central',
        p: [
          'Sans catalogue produit renseigné, aucun autre module ne fonctionne : pas de vente, pas de commande, pas d\'inventaire, pas de production.',
          'Le catalogue liste chaque article physique manipulé par l\'activité : que ce soit un produit à vendre (Coca-Cola, Burger), une matière première (Farine, Steak haché), ou un consommable (barquettes, nappes).',
          'Chaque produit a une référence unique (ex : PAT-007, BUR-023), une désignation, une catégorie, un fournisseur potentiel, un prix d\'achat et un prix de vente.',
        ],
      },
      { h: 'Les 4 types de produits (déduction automatique)',
        p: [
          'Le système classe automatiquement chaque produit dans un des 4 types, en fonction de son usage réel. Vous n\'avez rien à cocher — la classification se fait toute seule.',
        ],
        tableau: {
          colonnes: ['Badge', 'Nom', 'Critère de détection', 'Exemples concrets'],
          lignes: [
            ['🔥', 'Produit fini', 'Possède une fiche technique active', 'Bona Classic Burger, Croissant beurre, Buffet Prestige'],
            ['🧺', 'Ingrédient', 'Référencé dans au moins une fiche technique', 'Pain hamburger, Steak haché 125g, Salade laitue, Farine, Beurre'],
            ['🥤', 'Revente directe', 'Prix de vente > 0 et non-ingrédient', 'Coca-Cola 50cl, Eau minérale, Vin en bouteille'],
            ['📦', 'Consommable', 'Ni ingrédient, ni vendable, ni utilisé', 'Nappes de table, chaises Chiavari, vaisselle, papier caisse'],
          ],
        },
        p2: [
          'Le badge apparaît partout où le produit est affiché : liste, détail, état du stock, mouvements. Il vous permet en un coup d\'œil de savoir ce qu\'est ce produit.',
          'Un produit peut changer de type automatiquement : si vous créez une fiche technique pour un produit, il devient "Produit fini". Si vous supprimez sa fiche, il redevient "Revente" ou "Consommable" selon son prix.',
        ],
      },
      { h: 'Créer un produit manuellement',
        p: [
          'Menu Catalogue → Produits → Cliquez sur "Nouveau produit" en haut à droite.',
          'Le formulaire vous demande :',
          '',
          '• **Référence** : générée automatiquement (BUR-024, PAT-015...). Vous pouvez la modifier si vous avez un système de codification interne.',
          '• **Désignation** : nom clair et unique dans l\'activité (ex : "Café expresso 20cl"). C\'est ce nom qui apparaît sur les tickets et factures.',
          '• **Catégorie** : sélectionnez dans le dropdown. Si vous voulez une nouvelle catégorie, créez-la d\'abord via Menu → Catégories.',
          '• **Fournisseur habituel** : optionnel. Pratique pour les commandes de réapprovisionnement automatique.',
          '• **Prix d\'achat unitaire** : en FCFA, sans décimales. Sert au calcul de la valeur du stock et de la marge.',
          '• **Prix de vente** : en FCFA. Mettre 0 si ce n\'est pas un produit vendu (ingrédient).',
          '• **Stock actuel** : quantité déjà présente si vous initialisez le catalogue avec du stock existant. Sinon 0.',
          '• **Stock minimum (seuil d\'alerte)** : dès que le stock descend à ce niveau, une alerte est levée.',
          '• **Stock maximum** : plafond conseillé (pour éviter le sur-stockage). Mettre 0 pour désactiver la gestion de stock (utile pour un service comme "Livraison").',
          '• **Unité de vente** : "pièce", "kg", "litre", "carton"... Cohérente avec les fiches techniques et les inventaires.',
          '• **Description** : optionnelle, pour les précisions internes.',
          '• **Actif** : décochez pour retirer temporairement le produit du catalogue sans le supprimer (ex : rupture longue de fournisseur).',
          '',
          'Cliquez sur "Créer" pour valider.',
        ],
      },
      { h: 'Importer plusieurs produits depuis Excel',
        p: [
          'Si vous devez saisir 50 produits ou plus, la saisie manuelle est fastidieuse. L\'import Excel est fait pour ça.',
          '',
          '**Étape 1 : télécharger le modèle**',
          'Sur la liste des produits, cliquez "Import Excel". Cliquez "Télécharger le modèle Excel" — un fichier .xlsx s\'ouvre.',
          '',
          '**Étape 2 : remplir le fichier**',
          'Le modèle contient une ligne d\'en-tête et 1-2 lignes d\'exemple (à supprimer avant l\'import). Remplissez une ligne par produit :',
          '',
          '• Colonne A : Référence (peut être vide pour auto-génération)',
          '• Colonne B : Désignation (obligatoire)',
          '• Colonne C : Catégorie (créée automatiquement si absente)',
          '• Colonne D : Fournisseur (doit exister)',
          '• Colonnes E-I : Prix, stocks, unité',
          '• Colonne J : Description',
          '• Colonne K : Actif (Oui/Non)',
          '',
          'L\'unité et le statut Actif utilisent des listes déroulantes intégrées au fichier Excel.',
          '',
          '**Étape 3 : uploader le fichier**',
          'Retournez sur "Import Excel" et téléversez votre fichier rempli. Le système affiche un **aperçu ligne par ligne** avec les erreurs éventuelles (référence dupliquée, catégorie invalide...).',
          '',
          '**Étape 4 : confirmer**',
          'Après vérification, cliquez "Valider et importer". Les produits sont créés en une transaction (tout ou rien : si une ligne échoue, aucune n\'est importée).',
        ],
      },
      { h: 'Filtrer et rechercher',
        p: [
          'La liste des produits offre plusieurs outils de recherche :',
          '',
          '• **Onglets de type** en haut de page : Tous / Produits finis / Ingrédients / Revente / Consommables. Chaque onglet affiche son compteur.',
          '• **Recherche libre** : saisissez du texte, la recherche se fait sur la désignation et la référence.',
          '• **Filtre catégorie** : dropdown avec toutes les catégories de l\'activité.',
          '• **Filtre état stock** : Tous / En alerte / En rupture.',
          '',
          'Vous pouvez combiner plusieurs filtres. Le nombre de résultats est affiché.',
        ],
        img: '10_produits_bur.png',
        capture: 'Catalogue avec badges de type, onglets de filtre, tableau paginé.',
      },
      { h: 'Modifier un produit existant',
        p: [
          'Cliquez sur la désignation d\'un produit dans la liste, ou sur l\'icône œil (voir), pour ouvrir son détail.',
          'Le détail affiche toutes les infos + l\'historique des 20 derniers mouvements de stock du produit.',
          'Bouton "Modifier" en haut à droite (visible si vous avez les droits).',
          'Le formulaire est le même que la création. Modifiez ce qui doit l\'être et validez.',
        ],
      },
      { h: 'Supprimer un produit',
        p: [
          'Depuis le détail ou la liste, icône poubelle rouge.',
          'La suppression est bloquée si le produit est lié à des ventes ou mouvements de stock existants (protection contre la perte d\'historique).',
          'Dans ce cas, décochez plutôt "Actif" pour le retirer sans casser l\'historique.',
        ],
      },
      { h: 'Gestion des catégories',
        p: [
          'Menu Catalogue → Catégories.',
          'Une catégorie regroupe des produits similaires (ex : "Boissons", "Pâtisseries", "Ingrédients traiteur"). Sert au filtrage et aux statistiques.',
          'Chaque catégorie affiche le nombre de produits, la valeur stock totale et le CA du mois généré par ces produits.',
          'Créer une catégorie : bouton "Nouvelle catégorie" avec nom et description.',
          'Supprimer : uniquement possible si aucun produit n\'y est rattaché.',
        ],
      },
      { h: 'Gestion des fournisseurs',
        p: [
          'Menu Catalogue → Fournisseurs.',
          'Chaque fournisseur a une raison sociale, un contact, un téléphone, un email, une adresse et un délai de livraison moyen.',
          'La liste affiche : nombre de produits fournis, valeur stock associée, nombre d\'alertes en cours.',
          'Cliquer sur un fournisseur ouvre son détail avec la liste des produits qu\'il fournit et l\'historique des dernières réceptions.',
          'Import Excel possible pour importer tous vos fournisseurs d\'un coup.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '4. Fiches techniques (recettes cuisine)', sections: [
      { h: 'À quoi sert une fiche technique ?',
        p: [
          'La fiche technique est la **carte d\'identité culinaire** d\'un plat. Elle liste tous les ingrédients nécessaires et leurs quantités précises pour fabriquer une portion.',
          'Exemple concret : la fiche du "Bona Classic Burger" indique qu\'il faut 1 pain hamburger + 1 steak haché 125g + 1 tranche de fromage cheddar + 0,03 litre de sauce + 0,15 unité de salade + 0,05 kg de tomate + 0,03 kg d\'oignon.',
          'Son unique rôle est de servir aux **ordres de production** : quand la cuisine décide de fabriquer 50 burgers, le système multiplie chaque quantité par 50 pour calculer exactement les besoins en ingrédients et faire les sorties de stock.',
          '',
          '**Ce que la fiche technique NE fait PAS** : elle ne décrémente pas les ingrédients à chaque vente. Un burger vendu décrémente seulement le stock du produit fini "Burger", pas ses ingrédients. Ceux-ci ont déjà été consommés en amont lors de la production.',
        ],
      },
      { h: 'Analogie simple',
        p: [
          'Imaginez une boulangerie. Le matin, le boulanger fait 200 croissants avec 15 kg de farine, 8 kg de beurre, 4 kg de sucre. Ces ingrédients disparaissent du stock (sortie). En échange, 200 croissants entrent dans le stock des produits vendables (entrée).',
          'Ensuite, la vendeuse au comptoir vend des croissants un par un. Chaque vente sort un croissant du stock des croissants — pas de la farine.',
          'C\'est exactement le fonctionnement du système : fiche technique = recette de fabrication ; ordre de production = "on fabrique X portions" ; vente = "on écoule les portions".',
        ],
      },
      { h: 'Créer une fiche technique — pas à pas',
        p: [
          '**Étape 1 : identifier le produit fini**',
          'Le produit doit déjà exister au catalogue. Si non, créez-le d\'abord (ex : "Bona Classic Burger", prix vente 3500 FCFA, unité "pièce", stock maximum 0 car il est fabriqué à la demande).',
          '',
          '**Étape 2 : ouvrir sa fiche technique**',
          'Deux chemins possibles :',
          '• Depuis la liste des produits, cliquez sur l\'icône presse-papier bleue (📋) sur la ligne du produit.',
          '• Depuis le détail du produit, cliquez le bouton "Fiche technique" en haut à droite.',
          '',
          '**Étape 3 : ajouter les ingrédients**',
          'Cliquez "Ajouter à la recette" pour chaque ingrédient.',
          'Sur la nouvelle ligne :',
          '• Sélectionnez l\'ingrédient dans le dropdown (uniquement les produits de la même activité sont proposés)',
          '• Saisissez la quantité par portion, dans l\'unité de stock de l\'ingrédient',
          '',
          'Exemple concret pour un burger :',
          '• Pain hamburger : 1 (car stocké à la pièce)',
          '• Steak haché 125g : 1 (car stocké à la pièce)',
          '• Fromage cheddar tranche : 1 (car stocké à la tranche)',
          '• Sauce burger 5L : 0.03 (car stockée au litre, on met 30 ml)',
          '• Salade laitue 200g : 0.15 (car stockée à l\'unité de 200g, on met 30g)',
          '',
          '**Étape 4 : créer un ingrédient à la volée**',
          'Si un ingrédient n\'existe pas encore au catalogue, cliquez "Nouvel ingrédient" (bouton vert). Une modale s\'ouvre : nom, unité, prix d\'achat, stock initial. Validez, l\'ingrédient est créé et ajouté automatiquement à la recette.',
          '',
          '**Étape 5 : vérifier la marge**',
          'Le panneau à droite affiche en temps réel :',
          '• Prix de vente du produit fini',
          '• Coût matière calculé (somme des quantités × prix d\'achat)',
          '• Marge brute',
          '• Taux de marge en pourcentage (coloré vert si ≥40%, or si ≥20%, rouge sinon)',
          '',
          '**Étape 6 : enregistrer**',
          'Cliquez "Enregistrer la fiche" en bas du panneau récapitulatif. La fiche est sauvée.',
          'Le produit fini reçoit immédiatement le badge 🔥 "Produit fini" ; les ingrédients ajoutés reçoivent le badge 🧺 "Ingrédient".',
        ],
        img: '11_fiche_technique.png',
        capture: 'Vue fiche technique : bannière pédagogique en haut expliquant la recette avec les vraies quantités, tableau d\'ingrédients dynamique, panneau marge à droite.',
      },
      { h: 'Import Excel des fiches en masse',
        p: [
          'Si vous avez 30 recettes à saisir (menu complet), l\'import Excel est bien plus rapide.',
          '',
          '**Format du fichier :** une ligne par ingrédient (pas une ligne par recette).',
          '',
          '| Produit fini | Ingrédient | Quantité | Unité si nouveau | Prix achat si nouveau |',
          '|---|---|---|---|---|',
          '| Bona Classic Burger | Pain hamburger | 1 | pièce | 150 |',
          '| Bona Classic Burger | Steak haché 125g | 1 | pièce | 500 |',
          '| Bona Classic Burger | Fromage cheddar tranche | 1 | pièce | 80 |',
          '| Bona Cheese Burger | Pain hamburger | 1 | | |',
          '| Bona Cheese Burger | Fromage cheddar tranche | 2 | | |',
          '',
          'Vous répétez le nom du produit fini sur plusieurs lignes pour construire sa recette.',
          'Si un ingrédient n\'existe pas encore, il est créé automatiquement dans une catégorie "Ingrédients" avec l\'unité et le prix indiqués sur cette ligne (colonnes D et E utiles seulement au premier passage).',
          '',
          '**Menu Catalogue → Produits → bouton "Import fiches techniques"**.',
          'Téléchargez le modèle, remplissez-le, uploadez → aperçu → validez.',
          'Les fiches existantes sont écrasées et remplacées par le nouveau contenu du fichier.',
        ],
      },
      { h: 'Modifier une fiche existante',
        p: [
          'Rouvrez la fiche technique du produit. Ajoutez, modifiez, supprimez des ingrédients.',
          'Cliquez "Enregistrer la fiche" pour appliquer.',
          'Attention : modifier une fiche impacte les prochaines productions, pas les précédentes (les historiques restent intacts).',
        ],
      },
      { h: 'Désactiver une fiche',
        p: [
          'Décochez "Fiche active" en haut du panneau paramètres.',
          'Effet : la recette ne sera plus proposée dans les nouveaux ordres de production, mais reste consultable et pourra être réactivée.',
          'Utile pour retirer temporairement un plat de la carte sans perdre sa recette.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '5. Achats et distributions', sections: [
      { h: 'Comprendre le circuit d\'approvisionnement',
        p: [
          'Le circuit d\'approvisionnement suit une chaîne précise à 3 étapes, avec des acteurs et responsabilités bien définis :',
          '',
          '**Étape 1 : ACHAT** — effectué par Mme Sandra ou son secrétariat.',
          'Elle passe des commandes groupées auprès des fournisseurs (souvent multi-activités). Une seule facture fournisseur peut couvrir plusieurs activités (ex : commande de fromage pour Bona Burger + Pâtisserie).',
          '',
          '**Étape 2 : DISTRIBUTION** — Nestor est le responsable.',
          'Il reçoit physiquement les marchandises, les pré-affecte à chaque activité selon la commande initiale, puis prépare et remet les distributions aux gestionnaires.',
          '',
          '**Étape 3 : RÉCEPTION** — chaque gestionnaire confirme dans son activité.',
          'Il compte la quantité réellement reçue, signale les écarts éventuels (casse au transport, manquant fournisseur...) et valide. Cette validation déclenche l\'entrée en stock.',
          '',
          'Ce circuit garantit la traçabilité : chaque entrée en stock est reliée à un bon d\'achat, un bon de distribution et une réception validée par une personne identifiée.',
        ],
      },
      { h: 'Saisir un bon d\'achat (Sandra)',
        p: [
          '**Menu Achats → Nouveau bon d\'achat.**',
          '',
          '**Champs à remplir :**',
          '• Date d\'achat (par défaut aujourd\'hui)',
          '• Fournisseur : sélection dans la liste (créez-le d\'abord si absent via Catalogue → Fournisseurs) ou saisie libre pour un achat ponctuel (marché, artisan)',
          '• Numéro de facture fournisseur : optionnel, pour classer',
          '• Mode de paiement (Espèces / Virement / Chèque)',
          '• Notes libres',
          '',
          '**Ajouter des lignes :**',
          'Une ligne = un article acheté.',
          '• Désignation (texte libre, ex : "Farine boulangère 25kg")',
          '• Quantité et prix unitaire',
          '• Activité pressentie : à quelle activité (Traiteur, Cantine, PAT, BUR) cette ligne doit-elle être distribuée ?',
          '',
          '**Astuce : distribution immédiate**',
          'Si vous connaissez déjà l\'affectation exacte, cochez "Créer et distribuer immédiatement" en bas du formulaire.',
          'Effet : la distribution vers chaque activité concernée est générée automatiquement en statut "Remise" (prête à être réceptionnée). Nestor est court-circuité, ce qui est utile pour les achats simples.',
        ],
      },
      { h: 'Préparer une distribution (Nestor)',
        p: [
          '**Menu Distribution → Bons de distribution → Nouvelle distribution.**',
          '',
          '**Écran matriciel** :',
          'Une ligne par ligne d\'achat non encore distribuée. Les colonnes représentent les activités.',
          'Sur chaque ligne, un badge "Restant à distribuer" indique combien il reste à répartir.',
          '',
          '**Saisir les quantités par activité** :',
          'Pour chaque ligne, indiquez combien envoyer à chaque activité. La somme est vérifiée en temps réel.',
          '',
          '**Créer** :',
          'Cliquez "Créer les distributions". Une distribution est générée par activité concernée (donc si vous distribuez à 3 activités, 3 bons créés).',
          '',
          '**Statuts d\'une distribution** :',
          '• PREPAREE : préparée par Nestor, pas encore remise physiquement',
          '• REMISE : physiquement transportée vers l\'activité, en attente de confirmation gestionnaire',
          '• RECEPTIONNEE : le gestionnaire a confirmé, stock mis à jour',
          '',
          '**Marquer comme remise** : quand Nestor porte physiquement les marchandises, il passe la distribution de PREPAREE à REMISE (bouton "Marquer remise").',
        ],
      },
      { h: 'Réceptionner (Gestionnaire)',
        p: [
          '**Menu Stocks → Réceptions à traiter** (visible si vous avez au moins une distribution en attente).',
          '',
          '**Écran de la liste** :',
          '• Onglets "À traiter" (les REMISE) / "En préparation" (les PREPAREE, en attente que Nestor les remette) / "Déjà traitées" (historique)',
          '• Chaque distribution affiche : N°, date, activité, nombre de lignes, auteur (Nestor)',
          '',
          '**Ouvrir un bon** :',
          'Cliquez sur la ligne d\'une distribution REMISE.',
          '',
          'Un tableau détaille chaque produit distribué :',
          '• Colonne N° et Achat d\'origine (utile pour disambiguïser les produits similaires)',
          '• Désignation',
          '• **Quantité annoncée** (ce que Nestor a marqué)',
          '• **Quantité reçue réellement** (à saisir par vous)',
          '• Motif d\'écart (obligatoire si quantité reçue ≠ quantité annoncée)',
          '• Checkbox "Vérifié" à cocher sur chaque ligne',
          '',
          '**Cas d\'écart** :',
          'Exemples : "6 paquets manquants (livreur)", "1 sac déchiré à l\'arrivée", "Fournisseur a envoyé moins".',
          'Le motif est obligatoire pour éviter les écarts non justifiés. Il est conservé dans le journal d\'audit.',
          '',
          '**Valider** :',
          'Cliquez "Confirmer la réception" en bas.',
          'Effet immédiat : entrée en stock de chaque produit avec la quantité réellement reçue. Les alertes de stock bas sont automatiquement recalculées.',
        ],
        img: '41_receptions.png',
        capture: 'Écran de réception avec tableau détaillé, checkboxes de vérification, champs de saisie quantité et motif.',
      },
      { h: 'Historique des distributions',
        p: [
          '**Menu Distribution → Bons de distribution** liste toutes les distributions passées.',
          'Filtres possibles : par activité, par statut, par plage de dates.',
          'Cliquer sur un bon ouvre son détail avec les lignes et l\'historique des changements de statut.',
          '',
          'Le PDF de la distribution est téléchargeable pour archive papier.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '6. Production en cuisine', sections: [
      { h: 'Pourquoi la production est une étape à part',
        p: [
          'La production répond à un besoin de traçabilité culinaire précis : quand la cuisine transforme des ingrédients bruts en plats vendables, il faut savoir exactement combien d\'ingrédients ont été consommés et combien de plats ont été produits.',
          '',
          'Sans ce niveau de suivi, il devient impossible de :',
          '• Détecter les vols ou pertes en cuisine (les ingrédients sortent-ils vers les plats ou disparaissent-ils ailleurs ?)',
          '• Calculer un rendement réel (avec X kg de farine, combien de croissants sortent effectivement ?)',
          '• Analyser la marge par plat (coût matière effectif vs prix de vente)',
          '',
          'Le module Production apporte tout cela.',
        ],
      },
      { h: 'Qui fait quoi — workflow en 3 étapes',
        p: [
          'La production est un processus contradictoire : le cuisinier connaît la recette et sait ce qu\'il faut faire, mais c\'est le gestionnaire qui garde la clé du stock. Le système matérialise cette double responsabilité en 3 statuts successifs.',
        ],
        tableau: {
          colonnes: ['Statut', 'Action', 'Rôle responsable', 'Effet stock'],
          lignes: [
            ['BROUILLON', 'Le cuisinier saisit sa demande de production (recette + quantité voulue)', 'CUISINIER', 'Aucun — juste une demande'],
            ['EN_COURS', 'Le gestionnaire valide la sortie physique des ingrédients de son stock', 'GESTIONNAIRE', 'Les ingrédients sortent du stock'],
            ['TERMINEE', 'Le cuisinier confirme que la production est achevée', 'CUISINIER', 'Le produit fini entre en stock'],
          ],
        },
        p2: [
          'Si le gestionnaire refuse la demande (ingrédients absents, priorité autre), la production passe en ANNULEE avec un motif transmis au cuisinier.',
          'Le cuisinier reçoit une notification (badge en haut de la sidebar) dès qu\'un gestionnaire a validé ou refusé une de ses demandes.',
          'Ce circuit garantit qu\'aucun ingrédient ne sort du stock sans validation du gestionnaire, et qu\'aucun plat fini n\'entre en stock sans confirmation du cuisinier.',
        ],
      },
      { h: 'Créer un ordre de production — pas à pas',
        p: [
          '**Menu Cuisine → Ordres de production → Nouvel ordre de production.**',
          '',
          '**Étape 1 : choisir le produit à fabriquer**',
          'Le dropdown liste uniquement les produits ayant une fiche technique active. Si un plat n\'apparaît pas, créez d\'abord sa fiche.',
          'Chaque option montre le stock actuel du produit fini (ex : "Bona Classic Burger — stock actuel : 12 burger").',
          '',
          '**Étape 2 : saisir la quantité**',
          'Combien de portions à fabriquer ? (ex : 50 burgers, 200 croissants, 30 boîtes de repas)',
          '',
          '**Étape 3 : vérifier les besoins en ingrédients**',
          'Dès que la quantité est saisie, un tableau s\'affiche avec :',
          '• Chaque ingrédient de la recette',
          '• Quantité nécessaire (calculée automatiquement)',
          '• Stock actuel disponible',
          '• État : ✓ Suffisant (vert) ou ✗ Manque X (rouge)',
          '',
          'Exemple pour 50 burgers :',
          '• Pain hamburger : besoin 50, dispo 180 → OK',
          '• Steak haché 125g : besoin 50, dispo 155 → OK',
          '• Fromage cheddar tranche : besoin 50, dispo 40 → **Manque 10 tranches !**',
          '',
          '**Étape 4 : consulter le coût matière**',
          'Le panneau récapitulatif affiche le coût matière estimé (basé sur les prix d\'achat des ingrédients).',
          '',
          '**Étape 5 : lancer la production**',
          'Si tous les stocks sont suffisants, le bouton "Lancer la production" est vert et actif.',
          'Cliquez → la production est enregistrée avec un numéro (ex : FAB-BUR-2026-0015), les ingrédients sont sortis du stock, et le produit fini est entré au stock.',
          '',
          '**Cas de stock insuffisant** :',
          'Une alerte rouge s\'affiche : "Stock insuffisant pour 3 ingrédients".',
          'Le bouton "Lancer la production" est désactivé.',
          'Vous pouvez cocher "Forcer la production (stocks négatifs autorisés)" — utile en cas d\'erreur d\'inventaire ou d\'urgence — mais cela crée des stocks négatifs à corriger ensuite via un inventaire.',
        ],
        img: '13_nouvelle_production.png',
        capture: 'Formulaire de production : sélection produit et quantité en haut, tableau des besoins d\'ingrédients avec état en temps réel, panneau récap avec coût matière et bouton d\'action.',
      },
      { h: 'Consulter les productions passées',
        p: [
          '**Menu Cuisine → Ordres de production** liste tous les ordres passés.',
          '',
          'Trois KPIs en haut sur les 30 derniers jours :',
          '• Nombre de productions',
          '• Quantité totale produite (unités toutes recettes)',
          '• Coût matière consommé total',
          '',
          'Le tableau affiche chaque ordre avec numéro, date, produit fabriqué, quantité, coût matière, auteur.',
          '',
          'Cliquer sur un ordre ouvre son détail avec la liste complète des mouvements de stock générés (les sorties d\'ingrédients + l\'entrée du produit fini).',
          '',
          'Le PDF du bon de fabrication est téléchargeable — utile pour archive papier ou audit qualité.',
        ],
        img: '12_productions.png',
        capture: 'Liste des ordres de production avec KPIs 30j et tableau historique.',
      },
      { h: 'Rendement et pertes',
        p: [
          'Pour calculer votre rendement réel :',
          '1. Faites un inventaire physique avant la production (Menu Stocks → Inventaires)',
          '2. Lancez l\'ordre de production',
          '3. En fin de journée, faites un nouvel inventaire',
          '',
          'Si les ingrédients sortis correspondent bien à la quantité de plats produits, votre rendement est optimal. Sinon, l\'écart peut indiquer : pertes de cuisson normales, gaspillage, ou vol.',
          '',
          'Le rapport mensuel automatique remonte ces informations pour la DG.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '7. Gestion des stocks', sections: [
      { h: 'Vue d\'ensemble',
        p: [
          'Le module Stocks agrège toutes les informations concernant les mouvements d\'articles : ce qui rentre (via distributions ou productions), ce qui sort (via ventes ou productions), ce qui reste (état actuel), et les anomalies (alertes, écarts d\'inventaire).',
          '',
          'Un gestionnaire ou la DG utilisent ce module pour :',
          '• Vérifier la disponibilité d\'un produit avant une commande',
          '• Consulter la valeur totale du stock immobilisé',
          '• Analyser les rotations et repérer les produits dormants',
          '• Enquêter sur une anomalie (produit disparu, chiffre bizarre)',
        ],
      },
      { h: 'État du stock — la vue synthétique',
        p: [
          '**Menu Stocks → État du stock.**',
          '',
          'Le bandeau supérieur affiche 3 chiffres clés :',
          '• Valeur totale immobilisée (somme de tous les stocks × leurs prix d\'achat)',
          '• Nombre de produits en rupture (stock à 0)',
          '• Nombre de produits en alerte (stock ≤ seuil minimum)',
          '',
          'Les onglets par type filtrent la vue :',
          '• Tous les produits',
          '• 🔥 Produits finis (uniquement les plats fabriqués)',
          '• 🧺 Ingrédients (matières premières)',
          '• 🥤 Revente directe (canettes, bouteilles...)',
          '• 📦 Consommables',
          '',
          'Chaque ligne du tableau affiche :',
          '• Référence + Désignation + Badge type',
          '• Catégorie',
          '• Prix d\'achat unitaire',
          '• Stock actuel',
          '• Valeur (stock × prix)',
          '• État visuel : OK (vert) / Alerte (or) / Rupture (rouge)',
          '',
          'Cliquer sur un produit ouvre son détail avec l\'historique des 20 derniers mouvements.',
        ],
        img: '14_etat_stock.png',
        capture: 'Vue état du stock avec onglets par type, tableau détaillé, valeur totale immobilisée.',
      },
      { h: 'Historique des mouvements',
        p: [
          '**Menu Stocks → Mouvements.**',
          '',
          'Cette vue liste **chaque entrée et chaque sortie** de stock, avec une catégorisation automatique par source :',
        ],
        tableau: {
          colonnes: ['Badge', 'Signification', 'Créé automatiquement par'],
          lignes: [
            ['🚚 Réception distribution', 'Entrée en stock via un bon de distribution', 'Confirmation de réception (gestionnaire)'],
            ['🔥 Production cuisine', 'Sortie ingrédient ou entrée produit fini', 'Ordre de production'],
            ['✅ Vente / Livraison', 'Sortie via vente B2C ou livraison B2B', 'Encaissement caisse ou livraison commande'],
            ['🔄 Ajustement', 'Ajustement manuel (perte, casse, retour, correction)', 'Saisie manuelle ou validation d\'inventaire'],
          ],
        },
        p2: [
          '**Filtres** :',
          '• Onglets par source en haut',
          '• Recherche libre',
          '• Filtre par type (Entrée, Sortie, Ajustement...)',
          '',
          '**Groupement par jour** :',
          'Les mouvements sont regroupés par jour pour lisibilité. En-tête de chaque groupe : date + résumé (entrées / sorties / ajustements du jour).',
          '',
          'Cliquer sur un mouvement ouvre son détail avec toutes les métadonnées.',
        ],
        img: '15_mouvements.png',
        capture: 'Mouvements groupés par jour avec badges colorés indiquant la source.',
      },
      { h: 'Créer un mouvement manuel',
        p: [
          '**Menu Stocks → Nouveau mouvement** (visible pour gestionnaires et DG).',
          '',
          'Utilisé pour :',
          '• Perte / casse (produit tombé, périmé)',
          '• Retour client (retour d\'une vente)',
          '• Ajustement d\'inventaire (correction ponctuelle)',
          '• Ajout initial de stock (mise en service)',
          '',
          '**Champs** :',
          '• Produit (dropdown)',
          '• Type : Entrée / Sortie / Ajustement positif / Ajustement négatif / Retour / Perte',
          '• Quantité',
          '• Motif (obligatoire pour éviter les mouvements non justifiés)',
          '• Référence document optionnelle',
          '',
          'La validation met à jour immédiatement le stock actuel du produit.',
        ],
      },
      { h: 'Inventaires physiques',
        p: [
          '**Menu Stocks → Inventaires.**',
          '',
          'Un inventaire physique consiste à compter tous les articles réellement présents dans le local, et à comparer avec le stock théorique du système.',
          '',
          '**Créer un inventaire :**',
          '• Cliquez "Nouvel inventaire"',
          '• Nommez-le (ex : "Inventaire mensuel juillet 2026")',
          '• Choisissez éventuellement une catégorie à inventorier (ex : uniquement les boissons)',
          '• Cliquez Créer → l\'inventaire est en statut "En cours"',
          '',
          '**Saisir les quantités physiques :**',
          '• Chaque produit du périmètre s\'affiche avec son stock théorique',
          '• Saisissez la quantité physiquement comptée à côté',
          '• L\'écart est calculé et affiché en temps réel',
          '',
          '**Valider l\'inventaire :**',
          '• Après avoir compté tous les articles, bouton "Valider l\'inventaire"',
          '• Le système génère automatiquement les mouvements d\'ajustement pour corriger les écarts',
          '• Le stock actuel de chaque produit est mis à jour',
          '• L\'inventaire passe en statut "Validé" (verrouillé)',
          '',
          'Bonnes pratiques :',
          '• Faire un inventaire mensuel complet',
          '• Faire un inventaire tournant hebdomadaire par catégorie',
          '• Justifier les gros écarts en notes',
        ],
      },
      { h: 'Alertes stock',
        p: [
          '**Menu Stocks → Alertes.**',
          '',
          'Deux niveaux automatiquement générés :',
          '• **CRITIQUE** — stock à 0 (rupture)',
          '• **ALERTE** — stock ≤ seuil minimum (approvisionnement à prévoir)',
          '',
          'Cliquez "Marquer vue" pour retirer une alerte de la liste (elle sera regénérée si le stock reste bas).',
          '',
          'Les alertes non traitées apparaissent aussi dans le tableau de bord de chaque gestionnaire et un compteur global s\'affiche en tête de la sidebar.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '8. Ventes B2C (Caisse Pâtisserie / Bona Burger)', sections: [
      { h: 'Contexte',
        p: [
          'Les activités Pâtisserie et Bona Burger fonctionnent en mode B2C classique : le client vient au comptoir, choisit ses articles, paie et repart.',
          '',
          'Le système remplace la caisse enregistreuse traditionnelle par une interface tactile web qui :',
          '• Décrémente automatiquement le stock à chaque vente',
          '• Enregistre le mode de paiement (Espèces, Carte, Orange Money, MTN)',
          '• Imprime un ticket 80mm sur imprimante thermique',
          '• Alimente les statistiques de vente en temps réel',
          '',
          'Chaque caissier a sa propre session (ouverture/clôture de caisse) pour la traçabilité comptable.',
        ],
      },
      { h: 'Une journée type d\'un caissier',
        p: [
          '**07h30 — Ouverture de la caisse**',
          '',
          'À l\'arrivée le matin, la caissière compte les billets et pièces déjà présents dans la caisse (le "fond de caisse", généralement 10 000 à 20 000 FCFA pour rendre la monnaie).',
          '',
          '1. Elle se connecte avec ses identifiants (ex : caiss_bur / caisse2026)',
          '2. Menu État de caisse → Ouvrir une nouvelle caisse',
          '3. Saisit le montant du fond (ex : 15 000)',
          '4. Valide → une session est ouverte, numérotée CLO-BUR-2026-0025',
          '',
          '**Journée — Encaissements**',
          '',
          'Pour chaque client :',
          '1. Menu Vente → Caisse',
          '2. Clic sur chaque produit désiré → ajouté au panier à droite',
          '3. Ajuste les quantités avec les boutons + et –',
          '4. Sélectionne le mode de paiement (Espèces par défaut)',
          '5. Saisit le montant reçu (ex : le client donne 5 000 pour un ticket de 3 500)',
          '6. La monnaie s\'affiche : 1 500 FCFA à rendre',
          '7. Optionnel : associe un client existant ou crée-en un rapide',
          '8. Valide → vente enregistrée, ticket imprimé',
          '',
          'Le stock est automatiquement décrémenté. Le CA du jour, le nombre de tickets et le panier moyen sont mis à jour en temps réel dans le tableau de bord.',
          '',
          '**21h15 — Clôture de la caisse**',
          '',
          'En fin de service :',
          '1. Menu État de caisse → Clôturer la caisse',
          '2. L\'écran affiche 4 blocs : Espèces / Carte / Orange Money / MTN Mobile Money',
          '3. Pour chaque bloc, le montant théorique attendu est affiché (calculé par le système : fond + toutes les ventes du mode)',
          '4. La caissière compte physiquement les espèces et saisit le montant réel',
          '5. Pour les modes électroniques, elle vérifie via son application marchand',
          '6. L\'écart s\'affiche en temps réel : vert si équilibré, or si excédent, rouge si manquant',
          '7. En cas d\'écart, elle saisit le motif dans les observations (ex : "Erreur de rendu monnaie sur ticket X")',
          '8. Valide → clôture enregistrée, PDF de rapport téléchargeable',
        ],
      },
      { h: 'Interface de caisse en détail',
        p: [
          '**Colonne gauche — Catalogue** :',
          'Les produits vendables (avec prix > 0) sont affichés en vignettes cliquables. Les produits en rupture sont grisés.',
          'Recherche rapide par nom en haut.',
          'Filtre par catégorie (Boissons, Pâtisseries, Plats...).',
          '',
          '**Colonne droite — Panier** :',
          'Chaque ligne = un article du panier. Boutons + / – pour ajuster la quantité. Corbeille pour retirer.',
          'Champ "Remise" pour appliquer une remise sur l\'ensemble du panier.',
          'Case à cocher "TVA 19,25%" pour émettre un ticket avec TVA (utile pour clients qui demandent une facture).',
          'Sous-total, remise, TVA et Net à payer calculés en temps réel.',
          '',
          '**Bloc paiement** :',
          '4 gros boutons pour le mode : ESPÈCES / CARTE / ORANGE / MTN',
          'Champ "Montant reçu" avec calculatrice',
          'Affichage automatique de la monnaie',
          'Bouton "Client" pour associer un client fidèle',
          'Bouton "Valider" en vert vif',
        ],
        img: '17_caisse.png',
        capture: 'Interface tactile : catalogue en vignettes à gauche, panier à droite avec récapitulatif financier, boutons de mode de paiement colorés.',
      },
      { h: 'Impression du ticket 80mm',
        p: [
          'Le ticket est optimisé pour imprimantes thermiques standards (80mm de large).',
          '',
          'Contenu :',
          '• En-tête : nom de l\'entreprise en gros + adresse + tél + NIU',
          '• Nom de l\'activité',
          '• Numéro de ticket (ex : TIC-BUR-2026-0342)',
          '• Date et heure précises',
          '• Caissier (nom)',
          '• Client si associé',
          '• Chaque ligne : désignation + qté × prix + total',
          '• Sous-total, remise, TVA, NET À PAYER (en gros)',
          '• Mode de paiement, montant reçu, monnaie rendue',
          '• Mentions légales (RCCM, article CGI TVA)',
          '• Remerciement',
          '',
          'Le ticket s\'imprime automatiquement en fin de vente si vous avez confirmé "Imprimer le ticket" dans la modale.',
          'Vous pouvez aussi le réimprimer depuis Vente → Historique des ventes → icône reçu.',
        ],
      },
      { h: 'Historique des ventes',
        p: [
          '**Menu Vente → Historique des ventes.**',
          '',
          'Toutes les ventes de l\'activité sur les 3 derniers mois, ordre chronologique inverse.',
          'Filtres : recherche libre, mode de paiement, statut (payé/impayé).',
          '',
          'Chaque ligne affiche : N° ticket, date, caissier, client, mode, montant, statut.',
          'Icônes actions : voir détail, ticket 80mm PDF, facture A4 PDF.',
          '',
          'La facture A4 est utile quand un client demande une facture formelle pour sa comptabilité (généralement les entreprises qui viennent au comptoir).',
        ],
      },
      { h: 'Gérer les clients de la caisse',
        p: [
          '**Menu Vente → Clients.**',
          '',
          'Utile pour les clients réguliers (bureaux, restaurants voisins qui commandent souvent...).',
          'Créer un client : nom, type (Particulier/Entreprise), téléphone, email, adresse.',
          'Pour les entreprises : NIU et RCCM apparaissent sur les factures.',
          'Import Excel possible pour importer une base client existante.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '9. Commandes B2B (Traiteur / Cantine)', sections: [
      { h: 'Vue d\'ensemble du workflow',
        p: [
          'Contrairement aux activités B2C où le client paie et repart avec son achat, les activités B2B (Traiteur pour événementiel, Cantine pour repas quotidiens) suivent un processus commercial en plusieurs étapes.',
          '',
          'Le système modélise ce processus par des changements de statut successifs, avec des documents commerciaux générés à chaque étape.',
        ],
      },
      { h: 'Les 6 statuts d\'une commande',
        tableau: {
          colonnes: ['Statut', 'Étape', 'Document généré', 'Actions possibles'],
          lignes: [
            ['PROFORMA', '1. Devis émis', 'PRO-TRAIT-2026-0042', 'Modifier, valider (transformer en BC), annuler'],
            ['VALIDE', '2. Bon de commande', 'BC-TRAIT-2026-0042', 'Encaisser acomptes, livrer, annuler'],
            ['EN_PRODUCTION', '3. En cuisine (optionnel)', '—', 'Livrer, annuler'],
            ['LIVREE', '4. Marchandises remises', 'BL-TRAIT-2026-0042 (sans prix)', 'Émettre facture'],
            ['FACTUREE', '5. Facture émise', 'FAC-TRAIT-2026-0042', 'Encaisser (solde) → passe à PAYEE quand tout est reçu'],
            ['PAYEE', '6. Soldée', '—', 'Consultation uniquement (verrouillée)'],
          ],
        },
        p2: [
          'Statut ANNULEE possible à tout moment sauf après paiement complet.',
        ],
      },
      { h: 'Règle métier importante : solde avant livraison',
        p: [
          '**Par défaut, la livraison n\'est autorisée que lorsque le client a intégralement payé.**',
          '',
          'Cette règle protège la trésorerie de l\'entreprise. Elle est visible dans l\'interface : quand une commande est en statut VALIDE mais non soldée, le bouton "Livrer" est verrouillé (cadenas), et un panneau indique "Reste X FCFA à encaisser avant livraison".',
          '',
          '**Exception : livraison à crédit autorisée par la DG**',
          '',
          'Uniquement la Direction Générale peut autoriser une exception. Dans ce cas :',
          '1. Le bouton "Autoriser une livraison à crédit" apparaît sur le détail de la commande (visible pour la DG uniquement)',
          '2. Un formulaire s\'ouvre avec un champ "Motif" obligatoire (minimum 10 caractères)',
          '3. La DG écrit un motif circonstancié (ex : "Client Hôtel Sawa depuis 5 ans, paiement à 30j convenu par contrat annuel signé le 15/03/2026")',
          '4. Elle confirme → la commande passe en LIVREE, un bon de livraison est émis, mais le solde reste dû',
          '',
          'Le motif est automatiquement ajouté aux notes de la commande avec l\'identité de la DG, l\'horodatage et le montant restant. Il est aussi enregistré dans le journal d\'audit sous l\'action LIVRAISON_CREDIT.',
          '',
          'Cette exception justifie l\'existence du système de relances : ce sont les créances issues de livraisons à crédit qui font l\'objet des relances J+7, J+15, J+30.',
        ],
      },
      { h: 'Créer un proforma — pas à pas',
        p: [
          '**Contexte** : un client (Hôtel Sawa) vous appelle pour un mariage de 200 personnes le 15/08/2026. Il vous demande un devis.',
          '',
          '**Menu Commandes B2B → Nouveau proforma.**',
          '',
          '**Bloc "Client et paramètres"** :',
          '• Client : sélectionnez "Hôtel Sawa" dans le dropdown (créez-le d\'abord si absent via Vente → Clients)',
          '• Mode de paiement : Virement bancaire',
          '• Livraison prévue : 15/08/2026',
          '• Échéance paiement : 10/08/2026 (soit 5 jours avant la livraison, pour laisser le temps au virement)',
          '• Taux TVA : 19,25 % (par défaut Cameroun)',
          '',
          '**Bloc "Lignes"** :',
          'Ajoutez chaque prestation :',
          '• Ligne 1 : "Buffet Prestige (par personne)" — 200 personnes × 15 000 FCFA = 3 000 000',
          '• Ligne 2 : "Vin rouge bouteille" — 30 bouteilles × 6 000 = 180 000',
          '• Ligne 3 : "Location vaisselle porcelaine" — 200 sets × 1 500 = 300 000',
          '',
          'La colonne "Total" est calculée automatiquement. Vous pouvez appliquer une remise par ligne (%).',
          '',
          '**Bloc "Récapitulatif" (à droite)** :',
          '• Sous-total HT : 3 480 000',
          '• Remise globale : possibilité de saisir un montant fixe (ex : 100 000 pour geste commercial)',
          '• TVA (19,25%) : 650 130',
          '• **Total TTC : 4 030 130 FCFA**',
          '',
          '**Notes internes** :',
          'Champ libre pour noter des précisions (contact sur place, adresse de livraison précise, préférences alimentaires...).',
          '',
          '**Valider** :',
          'Cliquez "Créer le proforma". Un numéro est généré : PRO-TRAIT-2026-0042.',
          'Vous êtes redirigé vers le détail de la commande.',
          '',
          '**Envoyer le PDF au client** :',
          'Sur le détail, cliquez sur l\'icône PDF à côté de "Proforma émis" dans le bloc Progression.',
          'Un PDF professionnel se télécharge : en-tête entreprise avec NIU/RCCM, bloc client, tableau des lignes, totaux, montant en toutes lettres (obligatoire OHADA), coordonnées bancaires pour virement, cadre "Bon pour accord" pour signature client.',
          '',
          'Envoyez-le par email ou remettez-le en main propre au client.',
        ],
        img: '21_nouveau_proforma.png',
        capture: 'Formulaire proforma avec bloc client, lignes dynamiques, panneau récap en temps réel.',
      },
      { h: 'Blocage jours fériés — spécifique Cantine',
        p: [
          'La Cantine ne livre pas le week-end ni les jours fériés camerounais (Nouvel An, Fête du Travail, Ascension, Aïd al-Fitr, Aïd al-Adha, Assomption, Fête Nationale, Nativité, Noël...).',
          '',
          '**Blocage à la création** :',
          'Si vous choisissez une date de livraison qui tombe un jour non ouvré, un avertissement rouge apparaît immédiatement sous le champ de date : "Livraison Cantine impossible le [date] : jour férié (Fête Nationale)". Le formulaire est refusé côté serveur.',
          '',
          '**Panneau informatif** :',
          'Dans le récapitulatif, un encart bleu liste tous les jours fériés de l\'année en cours pour votre référence rapide.',
          '',
          '**Blocage à la livraison** :',
          'Même règle pour le clic "Livrer" : si aujourd\'hui est un jour non ouvré, la livraison est refusée.',
          '',
          '**Portée** : cette règle s\'applique uniquement à l\'activité Cantine (code CAN). Le Traiteur reste libre car les événements traiteur ont souvent lieu le week-end.',
        ],
      },
      { h: 'Suivre une commande — le détail',
        p: [
          '**Cliquer sur un numéro de commande dans la liste ouvre son détail.**',
          '',
          'La page est organisée en 2 colonnes :',
          '',
          '**Colonne gauche** :',
          '• **Progression visuelle** : les 5 étapes du workflow avec badges verts pour celles franchies, badge orange pour l\'étape actuelle, gris pour les suivantes. Chaque étape franchie a un lien PDF.',
          '• **Détail lignes** : tableau des produits commandés avec quantités et prix.',
          '• **Historique des encaissements** : tous les reçus émis, avec date, mode, référence, montant, icône vers PDF, icône vers pièce justificative (si attachée).',
          '• **Historique des relances** (si commande impayée) : niveaux envoyés, dates, canaux, notes.',
          '',
          '**Colonne droite** :',
          '• **Actions contextuelles** : boutons qui varient selon le statut',
          '• **État financier** : total, réglé, reste dû, statut de paiement coloré',
          '• **Bloc client** : contact et coordonnées',
          '• **Dates clés** : création, livraison prévue, livraison réelle, échéance',
        ],
      },
      { h: 'Encaisser un règlement',
        p: [
          'Une commande peut recevoir plusieurs paiements (acompte + solde par exemple).',
          '',
          '**Depuis le détail de la commande**, cliquez "Enregistrer un règlement".',
          '',
          '**Formulaire** :',
          '• **Montant** : par défaut le reste dû, mais vous pouvez saisir un montant partiel',
          '• **Mode de paiement** : selon ce que le client a choisi (Virement / Chèque)',
          '• **Référence** : n° du chèque ou référence du virement',
          '• **Pièce justificative** : uploadez un scan / photo du chèque, un avis de virement (facultatif, JPG/PNG/PDF max 5 Mo)',
          '• **Notes** : ex "Chèque remis en banque le 12/07, disponible J+2"',
          '',
          '**À la validation** :',
          '• Un reçu numéroté est créé (ex : REC-TRAIT-2026-0089)',
          '• Le PDF du reçu est disponible immédiatement',
          '• Le solde de la commande est mis à jour',
          '• Si le total est atteint, la commande passe automatiquement en statut PAYEE',
          '',
          'La pièce justificative est accessible dans l\'historique des paiements, une icône colorée (📄 PDF ou 🖼️ image) permet de la consulter d\'un clic.',
        ],
      },
      { h: 'Émettre la facture finale',
        p: [
          'Après livraison, le bouton "Émettre la facture" apparaît dans le détail de la commande.',
          '',
          'Un clic génère un numéro de facture (FAC-TRAIT-2026-0042) et bascule la commande en statut FACTUREE.',
          '',
          'Le PDF de la facture est immédiatement disponible. Il contient toutes les mentions légales OHADA, le montant en lettres, les coordonnées bancaires, un espace pour signature du gérant.',
          '',
          'La facture est le document définitif à envoyer au client pour sa comptabilité.',
        ],
      },
      { h: 'Page dédiée "Factures à encaisser"',
        p: [
          '**Menu Commandes B2B → Factures à encaisser.**',
          '',
          'Cette page est orientée recouvrement pour Sandra Secrétariat.',
          '',
          '**4 KPIs en tête** :',
          '• Factures impayées (nombre + montant total dû)',
          '• Factures en retard (échéance dépassée)',
          '• Acomptes reçus (paiements partiels)',
          '• Factures soldées',
          '',
          '**Onglets de filtre** :',
          '• Impayées / En retard / À échoir / Acomptes / Soldées',
          '',
          '**Tableau** : chaque ligne affiche N° facture, client + contact, date d\'émission, échéance avec badge de retard, total, déjà payé, reste dû, bouton "Encaisser".',
          '',
          '**Encaissement rapide** : le bouton "Encaisser" ouvre une modale d\'encaissement sans quitter la page — parfait pour traiter rapidement plusieurs paiements d\'affilée.',
        ],
        img: '22_factures_encaisser.png',
        capture: 'Page dédiée avec KPIs recouvrement en tête, onglets de filtre, tableau avec bouton d\'action par ligne.',
      },
    ]},

    // ==========================================================
    { titre: '10. Relances de paiement automatiques', sections: [
      { h: 'Le système de relance progressif',
        p: [
          'Quand une facture reste impayée après son échéance, le système passe à la vitesse supérieure avec des relances progressives.',
          '',
          'Trois niveaux de gravité, calculés automatiquement en fonction du nombre de jours de retard :',
        ],
        tableau: {
          colonnes: ['Niveau', 'Retard', 'Ton', 'Références légales'],
          lignes: [
            ['J+7', 'À partir de 7 jours', 'Rappel amical (probable oubli)', '—'],
            ['J+15', 'À partir de 15 jours', 'Rappel ferme + pénalités 1,5%/mois', '—'],
            ['J+30', 'À partir de 30 jours', 'Mise en demeure formelle', 'Art. 1153 Code Civil OHADA'],
          ],
        },
      },
      { h: 'Consulter les relances à faire',
        p: [
          '**Menu Commandes B2B → Factures à relancer.**',
          '',
          'Le système analyse en temps réel toutes les factures FACTUREE non soldées, calcule leur retard, et propose le niveau de relance approprié.',
          '',
          '**4 KPIs par tranche de retard** :',
          '• Non échues ou < 7j (aucune action)',
          '• Retard 7-14 jours (J+7 à envoyer)',
          '• Retard 15-29 jours (J+15 à envoyer)',
          '• Retard 30 jours et + (J+30 mise en demeure)',
          '',
          '**Tableau priorisé** :',
          'Trié par retard décroissant. Chaque ligne affiche :',
          '• Numéro facture + date d\'émission',
          '• Client + contact (téléphone visible)',
          '• Échéance et retard en jours (badge coloré)',
          '• Reste dû (rouge)',
          '• Dernière relance envoyée (si existante)',
          '• Bouton d\'action recommandée coloré selon le niveau',
        ],
        img: '23_relances.png',
        capture: 'Page relances avec KPIs par tranche, tableau priorisé, contacts clients accessibles.',
      },
      { h: 'Envoyer une relance — pas à pas',
        p: [
          '**Étape 1 : cliquer sur le bouton d\'action**',
          'Le bouton indique déjà le niveau recommandé, ex : "Rappel amical (J+7)".',
          '',
          '**Étape 2 : prévisualiser le courrier**',
          'Cliquez d\'abord sur "Aperçu PDF" pour voir le courrier qui sera généré. Vous pouvez ainsi vérifier son contenu avant tout envoi.',
          '',
          '**Étape 3 : ouvrir la modale d\'enregistrement**',
          'Depuis la page, cliquez sur le bouton coloré du niveau proposé.',
          '',
          '**Étape 4 : choisir le canal**',
          'Dropdown : Imprimée / remise en main propre — Email — Téléphone — SMS.',
          'Le canal Email est le plus commun pour J+7 ; Téléphone convient pour J+15 (contact personnel) ; Imprimée est requis pour J+30 (preuve juridique).',
          '',
          '**Étape 5 : ajouter des notes**',
          'Champ libre pour tracer le contexte de la relance : "Client a promis de payer sous 3 jours", "Injoignable au téléphone", "Contact avec Mme Ngo qui va relancer sa direction financière"...',
          '',
          '**Étape 6 : générer le PDF officiel**',
          'Bouton "Ouvrir le PDF" dans la modale : un courrier officiel se génère avec en-tête entreprise, adresse client, titre en majuscules (PREMIER RAPPEL / DEUXIÈME RAPPEL / MISE EN DEMEURE DE PAYER), corps du texte progressif selon le niveau, encadré récapitulatif financier, coordonnées bancaires rappelées, formule de politesse adaptée, cadre signature LE GÉRANT.',
          '',
          '**Étape 7 : imprimer / envoyer**',
          'Imprimez le PDF pour envoi postal ou remise en main propre. Ou envoyez le PDF en pièce jointe d\'un email.',
          '',
          '**Étape 8 : confirmer l\'enregistrement**',
          'Cliquez "Enregistrer la relance" dans la modale. La relance est tracée dans l\'historique de la commande avec sa date, son niveau, son canal, ses notes, et son auteur.',
        ],
      },
      { h: 'Historique des relances par commande',
        p: [
          'Sur le détail d\'une commande impayée, le bloc "Relances de paiement" affiche toutes les relances déjà envoyées.',
          '',
          'Pour chaque relance :',
          '• Badge niveau (bleu J7 / or J15 / rouge J30)',
          '• Date et heure',
          '• Canal utilisé',
          '• Envoyée par (nom)',
          '• Notes',
          '• Icône PDF pour ré-imprimer le courrier',
          '• Icône poubelle (DG uniquement) pour supprimer une relance envoyée par erreur',
          '',
          'Si le client paie, les relances ne sont pas supprimées — elles restent pour trace historique.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '11. État de caisse quotidien', sections: [
      { h: 'Objectif et importance',
        p: [
          'L\'état de caisse (anciennement « clôture de caisse ») est l\'acte comptable quotidien qui certifie que l\'argent physiquement présent en caisse correspond aux enregistrements du système.',
          '',
          'Sans état de caisse rigoureux, impossible de :',
          '• Détecter un vol interne',
          '• Justifier un manquant auprès du DG',
          '• Faire des remises en banque documentées',
          '• Répondre à un contrôle fiscal',
          '',
          'Le système impose une session de caisse par jour et par caissier, avec ouverture (fond initial) et clôture (décompte final + écart déclaré).',
          '',
          '**Règle importante** : seul le caissier qui a **ouvert** la caisse peut la **clôturer**. Ceci évite qu\'un collègue ferme par inadvertance la session d\'un autre et garantit la traçabilité individuelle.',
        ],
      },
      { h: 'Ouvrir sa caisse le matin',
        p: [
          '**Prérequis** : être connecté en tant que caissier (caiss_pat ou caiss_bur).',
          '',
          '**Menu État de caisse → Ouvrir une nouvelle caisse.**',
          '',
          '**Formulaire** :',
          '• Un seul champ : Montant du fond initial (FCFA)',
          '• Comptez physiquement les billets et pièces déjà dans le tiroir-caisse',
          '• Saisissez le total (ex : 15 000)',
          '',
          '**Astuce** : par convention, chaque caisse démarre avec un fond de 10 000 à 20 000 FCFA pour pouvoir rendre la monnaie aux premiers clients. Ce fond ne doit pas varier d\'un jour à l\'autre — il est constant.',
          '',
          'Validez. Une session est créée avec un numéro (CLO-BUR-2026-0025) et associée à votre compte. Vous êtes maintenant "en session".',
          '',
          '**Attention** : un seul caissier peut avoir une session ouverte à la fois par activité. Si vous partagez le poste avec un(e) collègue, la personne suivante attend que vous clôturiez votre session.',
        ],
      },
      { h: 'Interface pendant la journée',
        p: [
          '**Menu État de caisse** affiche votre session en cours avec :',
          '• Numéro et heure d\'ouverture',
          '• Fond initial',
          '• Nombre de ventes déjà effectuées',
          '• CA théorique cumulé',
          '• Répartition par mode de paiement (Espèces / Carte / Orange / MTN) mise à jour en temps réel',
          '• Bouton bien visible "Clôturer maintenant"',
          '',
          'Vous pouvez consulter cet écran à tout moment sans clôturer — il ne se referme que si vous cliquez explicitement sur "Clôturer".',
        ],
      },
      { h: 'Clôturer sa caisse le soir — pas à pas',
        p: [
          '**Étape 1 : cliquez "Clôturer la caisse"** (menu Clôtures ou bouton dans la session en cours).',
          '',
          '**Étape 2 : décompte des espèces**',
          '',
          'C\'est l\'étape la plus importante.',
          '',
          '• Le système affiche le montant théorique attendu en caisse : Fond initial + Total des ventes payées en espèces',
          '  Ex : 15 000 (fond) + 285 000 (ventes espèces) = **300 000 FCFA attendus**',
          '',
          '• Vous videz le tiroir-caisse et comptez physiquement tous les billets et pièces.',
          '  Ex : vous trouvez 299 500 FCFA',
          '',
          '• Vous saisissez ce montant dans le champ "Comptage réel"',
          '',
          '• L\'écart s\'affiche immédiatement : -500 FCFA (manquant, rouge)',
          '',
          '**Étape 3 : confirmation des modes électroniques**',
          '',
          'Pour Carte, Orange Money, MTN : le système affiche le total théorique.',
          'Vous ouvrez votre application marchand (SGBC pour la carte, OM Marchand, MTN MoMo Merchant) et vérifiez que les totaux correspondent.',
          'Si tout va bien, laissez les valeurs telles quelles. Si écart, ajustez et notez le motif.',
          '',
          '**Étape 4 : justifier les écarts**',
          '',
          'Le champ Observations est obligatoire dès qu\'il y a un écart > 500 FCFA.',
          'Exemples de motifs légitimes :',
          '• "Erreur de rendu de monnaie sur ticket TIC-BUR-2026-0342 (constaté trop tard)"',
          '• "Client parti avant vérification, monnaie surrendue de 200 FCFA"',
          '• "Billet de 500 FCFA collé au fond du tiroir non compté au premier passage"',
          '',
          'Ces observations sont importantes pour l\'audit et pour analyser les récurrences.',
          '',
          '**Étape 5 : confirmer la clôture**',
          '',
          'Cliquez "Confirmer la clôture". Une confirmation vous demande "Cette action est définitive. Confirmer ?".',
          '',
          'Une fois validée, la clôture est enregistrée en statut CLOTUREE. Le PDF officiel est téléchargeable avec :',
          '• En-tête entreprise',
          '• Tableau détaillé par mode de paiement (théorique / compté / écart)',
          '• Total recette journée en gros',
          '• Mention "MANQUANT" ou "EXCÉDENT" en rouge/orange si écart',
          '• Observations',
          '• Cadres signatures Caissier + Direction',
          '',
          'Imprimez ce PDF, faites-le signer par la Direction avant remise en banque des espèces.',
        ],
        img: '19_clotures.png',
        capture: 'Écran de clôture avec 4 blocs (Espèces / Carte / Orange / MTN), théorique/compté/écart par ligne, panneau récap.',
      },
      { h: 'Historique des états de caisse',
        p: [
          'Le menu État de caisse affiche l\'historique complet des sessions passées (par défaut celles du caissier connecté ; la DG voit toutes).',
          '',
          'Chaque ligne : N° session, caissier, ouverture, clôture, total espèces, écart coloré, statut, lien PDF.',
          'Cliquer sur une ligne ouvre le détail avec la liste des ventes de la session et le tableau récapitulatif par mode de paiement.',
          '',
          '**Mode de paiement Carte de crédit** : depuis juillet 2026, le mode « Carte de crédit » est disponible en complément d\'Espèces, Orange Money et MTN. Utile pour les clients qui règlent au TPE bancaire.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '12. Rapport mensuel et pilotage DG', sections: [
      { h: 'Le tableau de bord Direction Générale',
        p: [
          '**Menu Tableau de bord** (accessible immédiatement après connexion en tant que DG).',
          '',
          'Le dashboard est la vue quotidienne de Mme Sandra pour piloter l\'ensemble de l\'entreprise.',
          '',
          '**Sélecteur de période** en haut :',
          '• Aujourd\'hui / 7 derniers jours / 30 derniers jours / Ce mois / Mois précédent / Année en cours',
          '• Plage personnalisée : deux champs date début et date fin',
          '',
          'Tout ce qui suit est recalculé selon la période sélectionnée.',
          '',
          '**4 KPIs consolidés** :',
          '• CA aujourd\'hui',
          '• CA de la période sélectionnée (avec évolution % vs période précédente)',
          '• Valeur totale des stocks (immobilisation)',
          '• Nombre d\'alertes stock',
          '',
          '**Performance par activité** :',
          'Une carte par activité (4 cartes) avec sa couleur d\'identification :',
          '• CA du jour et du mois',
          '• Valeur stock',
          '• Nombre d\'alertes',
          '• Montant en attente d\'encaissement (uniquement pour B2B)',
          '',
          '**Graphique évolution CA** :',
          'Courbe multi-couleurs sur la période choisie. Chaque courbe = une activité. Les activités B2C utilisent leurs ventes (encaissement immédiat), les B2B utilisent leurs paiements réels (date d\'encaissement effectif).',
        ],
        img: '02_dashboard_dg.png',
        capture: 'Dashboard DG : 4 KPI cards en tête, cartes par activité, graphique linéaire d\'évolution.',
      },
      { h: 'Générer le rapport mensuel PDF',
        p: [
          '**Menu Administration → Rapport mensuel.**',
          '',
          '**Étape 1 : choisir le mois analysé**',
          'Sélecteur "mois" natif (ex : "2026-06" pour juin 2026). Par défaut : le mois précédent.',
          '',
          '**Étape 2 : consulter la preview**',
          'Le système calcule et affiche à l\'écran :',
          '• 4 KPIs synthèse (CA total, transactions, impayés, achats)',
          '• Tableau performance par activité (avec évolution vs mois précédent)',
          '• Top 10 produits vendus',
          '• Top 10 clients B2B (par encaissements réels)',
          '• Écarts de caisse >100 FCFA du mois',
          '',
          '**Étape 3 : télécharger le PDF**',
          'Bouton "Télécharger PDF" en haut à droite → rapport professionnel 3 pages :',
          '',
          '**Page 1** — Synthèse',
          '• Titre confidentiel Direction Générale',
          '• 4 cases KPI colorées',
          '• Tableau performance par activité avec ligne TOTAL doré',
          '',
          '**Page 2** — Top ventes',
          '• Top 10 produits',
          '• Top 10 clients B2B',
          '',
          '**Page 3** — Points d\'attention',
          '• Écarts de caisse détaillés',
          '• Situation des créances par activité',
          '• Alertes stock',
          '• Signature LA DIRECTION GÉNÉRALE',
          '',
          'Ce PDF est prêt pour votre réunion mensuelle de direction ou pour transmission au comptable.',
        ],
        img: '03_rapport_mensuel.png',
        capture: 'Preview rapport mensuel avec sélecteur de mois et tous les blocs analytiques.',
      },
      { h: 'Comprendre les tableaux de bord des autres rôles',
        p: [
          '**Dashboard Secrétariat (Sandra)** :',
          'Focus commercial B2B. Bandeau d\'alerte pour relances à faire, KPIs par activité B2B, top 8 factures à relancer, dernières commandes créées.',
          '',
          '**Dashboard Distribution (Nestor)** :',
          'Focus logistique. Achats à distribuer, distributions préparées et remises, alertes stock par activité, écarts de réception détectés.',
          '',
          '**Dashboard Gestionnaire (Mario/Mariano/Floriane/Nikolas)** :',
          'Focus opérationnel stock de l\'activité. Réceptions à traiter, alertes stock, valeur stock, mouvements du jour, prévisions de rupture à 7 jours, top 5 des produits consommés.',
          '',
          '**Dashboard Caissier (caiss_pat/caiss_bur)** :',
          'Focus vente du jour. CA, nombre de tickets, ticket moyen, répartition par mode de paiement, clôture ouverte ou fermée.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '13. Administration système (DG uniquement)', sections: [
      { h: 'Gérer les utilisateurs',
        p: [
          '**Menu Administration → Utilisateurs.**',
          '',
          'La liste affiche tous les comptes avec leurs rôles, activités principales et statuts (actif/inactif).',
          '',
          '**Créer un utilisateur** :',
          'Cliquez "Nouvel utilisateur". Formulaire :',
          '• Nom d\'utilisateur (sans espace, unique)',
          '• Mot de passe et confirmation',
          '• Titre (M. / Mme / Mlle)',
          '• Prénom, nom, email, téléphone',
          '• Rôle : DG / SECRETARIAT / DISTRIBUTION / GESTIONNAIRE / CAISSIER / CUISINIER',
          '• Activité principale (obligatoire pour GESTIONNAIRE, CAISSIER et CUISINIER)',
          '• Photo optionnelle',
          '',
          '**Modifier un utilisateur** :',
          'Cliquez sur la ligne d\'un utilisateur. Trois onglets :',
          '',
          '1. **Identité** : modifier les champs de base',
          '2. **Activités** : cocher/décocher les activités accessibles. Une étoile désigne l\'activité principale (celle sélectionnée par défaut au login)',
          '3. **Permissions** : ajuster finement les droits par fonctionnalité et par activité, avec possibilité de "surcharges" par rapport au rôle',
          '',
          '**Import Excel des utilisateurs** :',
          'Sur la liste, bouton "Import Excel". Utile pour importer 20+ collaborateurs. Les mots de passe sont chiffrés à l\'import.',
        ],
        img: '06_utilisateurs.png',
        capture: 'Liste des utilisateurs avec rôles et activités, bouton Import Excel.',
      },
      { h: 'Permissions granulaires par fonctionnalité',
        p: [
          'Bistock utilise un modèle **rôle + surcharges** pour les permissions.',
          '',
          '**Le principe** : chaque rôle (DG, SECRETARIAT, etc.) a un jeu de permissions par défaut. Sur la fiche d\'un utilisateur, l\'onglet **Permissions** permet de cocher/décocher fonctionnalité par fonctionnalité, et activité par activité.',
          '',
          'Les fonctionnalités contrôlées incluent, entre autres :',
          '  • **dashboard.lire** — voir le tableau de bord',
          '  • **catalogue.lire / ecrire / supprimer** — gestion du catalogue produit',
          '  • **stocks.lire / ajuster / inventaire** — mouvements de stock',
          '  • **ventes.encaisser / historique** — caisse et historique',
          '  • **caisse.ouvrir / etat.lire / etat.detail / etat.pdf** — sessions de caisse et rapports',
          '  • **commandes.creer / valider / facturer** — workflow B2B',
          '  • **production.creer / valider / annuler** — ordres de cuisine',
          '  • **compta.consulter / tva / plan_comptable / exports** — comptabilité OHADA',
          '  • **magasin.lire** — accès aux distributions inter-activités',
          '  • **analytics.exporter** — export des rapports agrégés',
          '  • **admin.utilisateurs / activites / journal_audit** — administration système',
          '',
          '**Exemple concret** : par défaut un caissier voit le tableau de bord. Si vous ne voulez pas qu\'il voie les KPIs financiers, décochez **dashboard.lire** sur son compte. Il ne verra plus le menu et l\'URL directe sera bloquée côté serveur.',
          '',
          '**Interactif** : cocher "Global" (activité toutes) grise les cases par activité. Décocher "Global" les réactive. Chaque case est indépendante.',
          '',
          '**Sécurité** : les permissions sont vérifiées côté serveur avant chaque affichage de menu et avant chaque action. Impossible de contourner en manipulant l\'URL — la route renvoie un 403.',
        ],
      },
      { h: 'Paramètres système',
        p: [
          '**Menu Administration → Paramètres système.**',
          '',
          'Cette page centralise tous les paramètres qui apparaissent sur vos documents PDF (proforma, factures, tickets, rapports).',
          '',
          '**Section Identité de l\'entreprise** :',
          '• Raison sociale (LE TRAITEUR DU BISTROT SUARL)',
          '• Adresse (Rue Bâti bois, Bonapriso - BP: 434 Douala, Cameroun)',
          '• Téléphone ((237) 699 69 59 69 / 699 97 20 48)',
          '• Email (bistrolatin97@yahoo.fr)',
          '• NIU (M011300044639Y) et RCCM (RC/DLA/2013/B/514) — obligatoires sur les factures pour les entreprises immatriculées',
          '',
          '**Section Modalités de paiement** :',
          'Deux sous-blocs :',
          '',
          '• **Virement bancaire** : nom banque (SGC Douala Bonanjo), n° compte / RIB / IBAN (06010429558 55), code SWIFT/BIC',
          '',
          '• **Chèque** : libellé "à l\'ordre de..." (LE TRAITEUR DU BISTROT SUARL)',
          '',
          'Ces coordonnées apparaissent automatiquement sur les proformas et factures dont le mode de paiement est virement ou chèque.',
          '',
          '**Section Devise et fiscalité** :',
          '• Devise (FCFA)',
          '• Taux TVA par défaut (19,25 % Cameroun)',
          '',
          '**Section Règles commerciales** :',
          '• Délai de paiement B2B par défaut (30 jours)',
          '• Remise max sans validation DG (10 %)',
        ],
        img: '05_parametres.png',
        capture: 'Paramètres système organisés en sections thématiques.',
      },
      { h: 'Journal d\'audit',
        p: [
          '**Menu Administration → Journal d\'audit.**',
          '',
          'Cette page trace toutes les opérations sensibles réalisées dans le système. Elle est essentielle pour :',
          '• La conformité (contrôles fiscaux, audits internes)',
          '• La détection d\'anomalies (qui a modifié quoi ?)',
          '• Les enquêtes en cas de disparition de stock ou d\'argent',
          '',
          '**Actions tracées automatiquement** :',
          '',
          '**Utilisateurs** : création, suppression, changement de rôle, changement d\'activité, modification des permissions',
          '',
          '**Activités** : création, modification, activation/désactivation',
          '',
          '**Catalogue** : suppression produit / catégorie / fournisseur / client',
          '',
          '**Commandes B2B** : annulation, facturation, livraison à crédit (avec motif), paiement enregistré, relance envoyée, relance supprimée',
          '',
          '**Achats / Distributions** : annulation, réception avec écart',
          '',
          '**Caisse** : ouverture, clôture, écart de caisse >500 FCFA',
          '',
          '**Paramètres** : modification (avec diff avant/après)',
          '',
          '**KPIs en tête** : nombre d\'actions aujourd\'hui / 7 jours / 30 jours / résultats affichés',
          '',
          '**Filtres cumulables** :',
          '• Type d\'action (dropdown avec les 30+ actions)',
          '• Utilisateur',
          '• Plage de dates',
          '• Case à cocher "Actions critiques uniquement" — met en avant les actions à haute sensibilité (suppression utilisateur, annulation vente, écart >500 FCFA, livraison à crédit...)',
          '',
          '**Tableau détaillé** : date, utilisateur, activité concernée, action (badge coloré si critique), entité affectée, détails.',
          '',
          '**Export CSV** : bouton pour exporter jusqu\'à 5000 entrées pour analyse externe (Excel, comptable).',
        ],
        img: '04_journal_audit.png',
        capture: 'Journal d\'audit avec KPIs, filtres, tableau détaillé horodaté.',
      },
      { h: 'Gestion des activités (100 % dynamique)',
        p: [
          '**Menu Administration → Activités.**',
          '',
          'Vue de haut niveau sur les activités : nombre d\'utilisateurs, nombre de produits, CA total.',
          '',
          '**Créer une nouvelle activité** — utile si l\'entreprise ouvre un nouveau pôle (ex : pizzeria, food truck, boutique en ligne dédiée). Champs :',
          '  • Code (2-10 lettres majuscules, ex : PIZ)',
          '  • Nom (ex : Pizzeria Bonapriso)',
          '  • Type (B2B_COMMANDE ou B2C_CAISSE)',
          '  • Couleur et icône (pour la puce de sélection)',
          '',
          '**Auto-provisionnement comptable** : à la création, le système ouvre automatiquement les comptes OHADA (5711 caisse, 701 ventes, etc.) et le journal comptable spécifique à la nouvelle activité. Aucune saisie manuelle nécessaire côté comptabilité — vous pouvez commencer à vendre immédiatement.',
          '',
          '**Modifier** : changer nom, couleur, icône, type.',
          '',
          '**Activer/Désactiver** : bouton dédié. Une activité désactivée n\'apparaît plus dans les menus mais son historique est conservé et reste consultable par la DG.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '14. Scénarios métier complets', sections: [
      { h: 'Scénario 1 — Une journée type de la Pâtisserie',
        p: [
          '**06h30** — Ouverture de la boutique.',
          'Floriane (gestionnaire) arrive. Elle allume l\'ordinateur, se connecte (floriane / pat2026).',
          '',
          '**06h35** — Menu Tableau de bord.',
          'Elle consulte les alertes stock : "Beurre plaque 500g" en alerte (2 restants sur seuil 5).',
          'Elle note qu\'il faudra en demander à la prochaine distribution.',
          '',
          '**06h45** — Menu Cuisine → Ordres de production.',
          'Elle prépare la production du matin :',
          '• 80 croissants beurre → besoin 6,4 kg de farine, 4 kg de beurre, 1,2 kg de sucre',
          '• 60 pains au chocolat → besoin 4,8 kg de farine, 3 kg de beurre, 1,8 kg de chocolat',
          '',
          'Elle vérifie les stocks : tout est OK. Elle lance les 2 ordres FAB-PAT-2026-0087 et FAB-PAT-2026-0088.',
          'Les ingrédients sortent automatiquement du stock, les 140 pâtisseries entrent dans le stock des produits finis.',
          '',
          '**07h00** — Ouverture de la caisse.',
          'La caissière (caiss_pat) se connecte et ouvre sa session avec 12 000 FCFA de fond.',
          '',
          '**07h15 à 20h00** — Encaissement continu.',
          'Environ 25-40 tickets par jour. Chaque vente décrémente le stock des produits finis et enregistre le paiement.',
          'À midi, alerte : "Éclair café / chocolat" passe en rupture. Floriane relance une production.',
          '',
          '**20h15** — Fermeture.',
          'La caissière clôture. Total espèces : 87 500 attendus, elle compte 87 200 (-300 écart). Elle note "Rendu erroné identifié en fin de service" en observations.',
          'Elle valide, imprime le PDF, le donne à Floriane qui contresigne.',
          '',
          '**20h30** — Floriane fait le point.',
          'Menu Rapport mensuel → aperçu → elle voit que la journée a rapporté 92 000 FCFA net (avec les autres modes de paiement). Le top produit est le croissant (25 vendus).',
          'Elle prépare la commande d\'ingrédients à envoyer à Sandra pour demain.',
        ],
      },
      { h: 'Scénario 2 — Un événement Traiteur de A à Z',
        p: [
          '**Lundi J-30** — Appel d\'un client.',
          'Hôtel Sawa demande un devis pour un cocktail de 150 personnes le 15/08/2026.',
          '',
          'Sandra Sec ouvre l\'application, bascule sur Le Traiteur, menu Nouveau proforma.',
          'Elle sélectionne le client Hôtel Sawa (déjà en base), livraison prévue 15/08, échéance paiement 10/08, mode virement.',
          'Elle ajoute les lignes :',
          '• Cocktail dînatoire × 150 personnes × 8 500 = 1 275 000',
          '• Vin rouge × 40 bouteilles × 6 000 = 240 000',
          '• Location vaisselle × 200 × 1 200 = 240 000',
          '',
          'Sous-total 1 755 000, TVA 337 838, TTC 2 092 838.',
          'Elle crée le proforma PRO-TRAIT-2026-0045.',
          'Elle télécharge le PDF et l\'envoie par email au client.',
          '',
          '**Mardi J-29** — Le client accepte.',
          'Il retourne le proforma signé "Bon pour accord".',
          'Sandra ouvre la commande PRO-TRAIT-2026-0045, clique "Client a validé → Bon de commande".',
          'La commande passe en statut VALIDE, un numéro BC-TRAIT-2026-0045 est généré.',
          '',
          '**Mercredi J-28** — Acompte de 50%.',
          'Le client fait un virement de 1 046 419 FCFA.',
          'Sandra vérifie sur son relevé SGBC, puis dans l\'application menu Factures à encaisser → clique "Encaisser" sur la commande.',
          'Elle saisit 1 046 419, mode Virement, référence "VIR-SAWA-20260716", et attache l\'avis de virement en PDF.',
          'Un reçu REC-TRAIT-2026-0088 est créé.',
          '',
          '**J-5 (10/08)** — Solde attendu.',
          'Le solde n\'est pas encore payé. Aucune relance n\'est nécessaire car pas encore d\'échéance dépassée.',
          '',
          '**J-3 (12/08)** — Solde reçu.',
          'Deuxième virement de 1 046 419. Sandra l\'enregistre → la commande passe automatiquement en statut PAYEE (soldée).',
          '',
          '**J (15/08)** — Livraison.',
          'La cuisine a préparé les 150 cocktails et le personnel de service livre à l\'hôtel.',
          'Sandra ouvre la commande, clique "Livrer et émettre le BL" → un bon de livraison BL-TRAIT-2026-0045 est généré (sans les prix visibles).',
          'Le livreur imprime le BL, le fait signer par le responsable de l\'hôtel à la réception.',
          'Le stock des produits Traiteur est décrémenté.',
          '',
          '**J+1 (16/08)** — Facture définitive.',
          'Sandra clique "Émettre la facture" → FAC-TRAIT-2026-0045 est généré.',
          'Elle envoie le PDF au client pour sa comptabilité.',
          '',
          '**Fin du mois** — Rapport DG.',
          'Mme Sandra génère le rapport mensuel d\'août 2026. Hôtel Sawa apparaît en top 3 des clients B2B avec 2 092 838 FCFA de CA.',
        ],
      },
      { h: 'Scénario 3 — Détection d\'un vol via journal',
        p: [
          '**Contexte** : sur le dashboard, la DG remarque que le stock de "Steak haché 125g" à Bona Burger a baissé plus vite que d\'habitude.',
          '',
          '**Étape 1** : Menu Stocks → Mouvements → filtre par produit "Steak haché 125g" sur les 30 derniers jours.',
          'Elle voit toutes les sorties. Deux catégories dominent : Production cuisine (justifiées par les burgers fabriqués) et une sortie type Ajustement de type PERTE.',
          '',
          '**Étape 2** : elle clique sur la sortie Ajustement suspecte. Détail : "50 steaks — motif : Périmés". Signée par Nikolas le 12/07.',
          '',
          '**Étape 3** : elle croise avec les productions du 10-13/07. Elles semblent cohérentes avec la baisse de stock hors ajustement.',
          '',
          '**Étape 4** : elle vérifie dans le journal d\'audit → aucun événement inhabituel enregistré à cette date par Nikolas.',
          '',
          '**Étape 5** : elle demande à Nikolas de justifier — il fournit une photo des steaks périmés jetés (bon exemple de bonne pratique).',
          '',
          '**Conclusion** : pas de vol, la perte de 50 unités est justifiée. Mais la traçabilité a permis en 15 minutes de comprendre.',
          '',
          'Si à l\'inverse Nikolas n\'avait pas de justification, la DG aurait pu enquêter plus loin (caméras, questionnement équipe...).',
        ],
      },
    ]},

    // ==========================================================
    { titre: '15. FAQ, astuces et dépannage', sections: [
      { h: 'Je ne peux pas me connecter',
        p: [
          '• Vérifiez la casse du nom d\'utilisateur (msandra ≠ MSANDRA)',
          '• Vérifiez qu\'il n\'y a pas d\'espaces avant/après le mot de passe',
          '• Assurez-vous que le serveur est démarré (npm start)',
          '• Testez avec le compte de démonstration : caiss_bur / caisse2026',
          '• En dernier recours, contactez la DG pour réinitialiser votre mot de passe',
        ],
      },
      { h: 'Je ne vois pas certains menus',
        p: [
          'Les menus dépendent de :',
          '• Votre rôle (DG / SECRETARIAT / DISTRIBUTION / GESTIONNAIRE / CAISSIER / CUISINIER)',
          '• L\'activité active (la caisse est visible uniquement sur les activités B2C)',
          '• Vos permissions individuelles (personnalisables par la DG)',
          '',
          'Si un menu manque, vérifiez d\'abord l\'activité active. Si le problème persiste, la DG peut ajuster vos droits dans Administration → Utilisateurs → onglet Permissions.',
        ],
      },
      { h: 'Le stock devient négatif',
        p: [
          'Cela peut arriver si :',
          '• Vous avez coché "Forcer la production" alors que les ingrédients étaient insuffisants',
          '• Un mouvement d\'ajustement a été mal saisi',
          '',
          'Solutions :',
          '• Vérifiez le stock physique réel',
          '• Faites un mouvement d\'ajustement positif (Menu Stocks → Nouveau mouvement)',
          '• Ou lancez un inventaire complet pour repartir sur des bases saines',
        ],
      },
      { h: 'Un produit n\'apparaît pas à la caisse',
        p: [
          'Vérifiez que le produit :',
          '• A un prix de vente > 0',
          '• Est marqué "Actif"',
          '• A un stock actuel > 0 (ou stock_maximum = 0 pour un service illimité)',
          '• Appartient bien à l\'activité active',
          '',
          'Si c\'est un plat qui doit être fabriqué, lancez d\'abord un ordre de production.',
        ],
      },
      { h: 'Comment gérer un remboursement client ?',
        p: [
          'Pour un remboursement partiel/total après vente :',
          '',
          '**Cas B2C (caisse)** :',
          '• Il n\'y a pas d\'annulation directe d\'un ticket',
          '• Créez un mouvement de stock type RETOUR avec motif "Retour client vente TIC-BUR-2026-XXXX"',
          '• Comptabilisez le remboursement dans la clôture de caisse du jour (dans les observations)',
          '',
          '**Cas B2B (commande)** :',
          '• Si la commande n\'est pas encore soldée, ajustez la ligne concernée en modifiant la commande (si statut PROFORMA) ou créez un avoir en notes',
          '• Contactez la DG pour un remboursement d\'acompte via virement inverse',
        ],
      },
      { h: 'Comment sauvegarder les données ?',
        p: [
          'Le fichier data/app.db contient TOUTES vos données. Sa sauvegarde régulière est vitale.',
          '',
          '**Méthode simple** :',
          '• Copiez data/app.db sur une clé USB à la fin de chaque journée',
          '• Ou synchronisez le dossier avec un cloud (OneDrive, Dropbox, Google Drive)',
          '',
          '**Méthode avancée** :',
          '• Créez un script batch Windows qui copie automatiquement la base tous les soirs',
          '• Conservez au moins 30 jours de sauvegardes',
        ],
      },
      { h: 'Combien de temps pour l\'installation initiale ?',
        p: [
          'Après clonage/copie du projet :',
          '',
          '1. Installer Node.js (5 min)',
          '2. npm install (5-15 min selon connexion)',
          '3. npm run setup (30 secondes) → crée la base avec toutes les données de démo',
          '4. npm start → serveur prêt',
          '',
          'Compter 30-45 minutes pour une installation propre + configuration paramètres.',
        ],
      },
      { h: 'Comment ajuster la TVA pour une commande spécifique ?',
        p: [
          'Sur le formulaire proforma, le champ "Taux TVA (%)" est modifiable ligne par ligne.',
          'Le taux par défaut est celui configuré dans Administration → Paramètres système (19,25 % pour le Cameroun).',
          'Pour un client exonéré (ONG, ambassade), mettez 0.',
        ],
      },
      { h: 'Comment gérer plusieurs livraisons pour une même commande ?',
        p: [
          'Le système ne gère pas nativement les livraisons partielles.',
          '',
          'Contournement : créez une commande par livraison, ou décomposez en plusieurs proformas si le client accepte.',
          'Une amélioration future pourrait ajouter des BL multiples par commande.',
        ],
      },
      { h: 'Peut-on travailler à plusieurs simultanément ?',
        p: [
          'Oui, le système est multi-utilisateur en temps réel.',
          '',
          'Le caissier de Bona Burger, la gestionnaire de la Pâtisserie et Mme Sandra peuvent utiliser l\'application en même temps sur des ordinateurs différents du même réseau local.',
          '',
          'Il suffit qu\'ils accèdent à http://ADRESSE_IP_SERVEUR:9000 depuis leur poste.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '16. Canal en ligne — Site public de commande /commander/', sections: [
      { h: 'À quoi ça sert ?',
        p: [
          'Le canal en ligne est un mini site web public accessible sans mot de passe à l\'adresse **/commander/**. Il permet à vos clients de :',
          '• Parcourir votre catalogue par catégorie (avec recherche instantanée)',
          '• Ajouter des produits au panier, y compris des suppléments choisis',
          '• Passer une commande sans créer de compte (nom + téléphone + adresse suffisent)',
          '• Payer par Orange Money, MTN Mobile Money ou en espèces à la livraison',
          '• Suivre l\'état de leur commande via un lien unique reçu par SMS/WhatsApp',
          '',
          'Vos caissiers voient ces commandes arriver en temps réel dans le menu **Ventes → Commandes en ligne** et les traitent comme n\'importe quelle vente comptoir.',
        ],
      },
      { h: 'Activer et configurer le canal',
        p: [
          '**Administration → Paramètres → Canal client en ligne** :',
          '',
          '• **web_canal_actif** : 1 pour activer, 0 pour désactiver (mode maintenance)',
          '• **web_activites_ids** : liste des ID d\'activités visibles en ligne, séparés par virgule (ex : "3,4" pour Pâtisserie et Bona Burger)',
          '• **web_frais_livraison** : montant fixe ajouté au total (ex : 1000)',
          '• **web_horaires** : texte libre affiché aux clients (ex : "Lun-Ven 8h-22h")',
          '• **web_orange_code** : code marchand Orange Money (affiché au moment du paiement)',
          '• **web_mtn_code** : code marchand MTN MoMo (idem)',
          '• **web_note_moyenne** / **web_nb_avis** : preuve sociale affichée en page d\'accueil',
          '',
          'Un produit apparaît sur le canal en ligne uniquement si :',
          '  1. Il est **actif** dans le catalogue',
          '  2. Il a un **prix > 0**',
          '  3. Il appartient à une activité listée dans `web_activites_ids`',
          '',
          '**Bon à savoir** : un produit peut apparaître même en rupture de stock. Le client peut toujours commander ; le caissier verra alors un badge « 🔥 À produire » et pourra envoyer l\'ordre en cuisine.',
        ],
      },
      { h: 'Parcours client sur /commander/',
        p: [
          '**1. Page d\'accueil** — Affiche les statistiques de confiance (note moyenne, nombre d\'avis), les horaires et un bouton d\'entrée dans le catalogue.',
          '',
          '**2. Catalogue** — Vignettes des produits par catégorie, recherche par nom en temps réel, badge « Personnalisable » sur les produits ayant des suppléments.',
          '',
          '**3. Fiche produit (modale)** — Description détaillée, image, prix. Si le produit a des suppléments (ex : Bacon +500, Cheddar +300, Frites +1000), le client coche les cases voulues avant d\'ajouter au panier.',
          '',
          '**4. Panier** — Liste des articles avec leurs suppléments choisis, boutons +/- pour ajuster la quantité, bouton "Retirer" par ligne et "Vider le panier". Total et frais de livraison calculés en direct.',
          '',
          '**5. Checkout** — Trois étapes en cartes visibles :',
          '  • Étape 1 : mode de paiement (Orange Money, MTN, Espèces à la livraison)',
          '  • Étape 2 : informations client (nom, téléphone, WhatsApp, adresse de livraison)',
          '  • Étape 3 : confirmation et validation',
          '  → Le code marchand Orange/MTN s\'affiche immédiatement quand le client sélectionne le mode correspondant.',
          '',
          '**6. Suivi** — Après validation, le client reçoit un lien de suivi unique avec le statut en temps réel (BROUILLON → EN CUISINE → PRÊTE → LIVRÉE) et un bouton WhatsApp pour joindre l\'entreprise.',
        ],
      },
      { h: 'Suppléments par produit — comment les créer',
        p: [
          '**Menu Catalogue → Produits → Modifier le produit → onglet Suppléments.**',
          '',
          'Pour chaque supplément :',
          '  • **Nom** : libellé affiché au client (ex : « Bacon supplémentaire »)',
          '  • **Prix** : montant à ajouter au prix de base (ex : 500)',
          '  • **Actif** : à décocher pour retirer temporairement',
          '',
          'Le nombre de suppléments par produit est illimité — utile pour un burger qui peut recevoir 5-10 options, ou une pâtisserie personnalisable.',
          '',
          'Côté client, les suppléments apparaissent en cases à cocher dans la modale produit. Le prix du panier est recalculé instantanément à chaque coche/décoche.',
          '',
          '**Traçabilité** : chaque supplément choisi est stocké dans la table `ligne_commande_web_supplement`, visible sur la fiche commande côté caissier. La cuisine sait exactement quoi ajouter.',
        ],
      },
      { h: 'Traiter les commandes en ligne côté caissier',
        p: [
          '**Menu Ventes → Commandes en ligne** :',
          '',
          'Liste triée par date (plus récentes en haut). Filtres : statut, activité, période.',
          'Chaque ligne : n° commande, date, client, montant, statut, mode de paiement, activité.',
          '',
          'Clic sur une commande → **fiche détaillée** avec :',
          '  • Coordonnées client (nom, téléphone, WhatsApp cliquable, adresse)',
          '  • Mode de paiement choisi',
          '  • Lignes de commande avec quantité, prix et **suppléments détaillés**',
          '  • Frais de livraison, total',
          '  • Badge stock par ligne : ✅ Dispo · 🔥 À produire (X manquants) · ⌛ En cuisine · ✅ Produite',
          '  • Bouton **« Envoyer en cuisine »** : crée les ordres de production BROUILLON pour tout ce qui manque',
          '  • Bouton **« Facturer »** : valide la vente, débite le stock, imprime le ticket',
          '',
          '**Workflow type** :',
          '  1. Nouvelle commande arrive → caissier ouvre la fiche',
          '  2. Si des articles manquent → « Envoyer en cuisine » → cuisinier reçoit ses ordres',
          '  3. Cuisinier finalise ses productions → statut passe à « Produite »',
          '  4. Caissier « Facturer » → génère le ticket, appelle le client pour livraison',
        ],
      },
      { h: 'Notifications WhatsApp',
        p: [
          'Un bouton WhatsApp flottant est présent sur toutes les pages publiques. Il pointe vers le numéro configuré dans **Administration → Paramètres → ent_whatsapp**.',
          '',
          'Utile pour les clients qui ont une question avant de commander, ou pour signaler un souci après commande. Le message pré-rempli mentionne le numéro de commande si le client est sur la page de suivi.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '17. Import Excel massif du catalogue', sections: [
      { h: 'Pourquoi imposer un import Excel ?',
        p: [
          'Saisir plusieurs centaines de produits, catégories et fournisseurs à la main est fastidieux et sujet aux erreurs. L\'import Excel permet à la DG de préparer sereinement toutes les données hors ligne (dans Excel ou LibreOffice) puis de les charger en une seule opération.',
          '',
          'Trois types d\'import sont disponibles, chacun avec son modèle : **Produits**, **Catégories** et **Fournisseurs**. Tous fonctionnent sur le même principe : télécharger un modèle → remplir → téléverser → vérifier l\'aperçu → valider.',
        ],
      },
      { h: 'Fichiers de référence livrés dans docs/import_bstock/',
        p: [
          'Le dossier **docs/import_bstock/** contient un jeu complet de fichiers prêts à l\'import, produits automatiquement par le script `scripts/generer_imports_bstock.js`. Ces fichiers servent de socle si vous n\'avez pas encore votre propre catalogue.',
          '',
          '**Contenu** (2 fichiers par activité + 1 mode d\'emploi) :',
          '  • 01_categories_TRAIT.xlsx · 30 catégories',
          '  • 01_categories_CAN.xlsx · 26 catégories',
          '  • 01_categories_PAT.xlsx · 34 catégories',
          '  • 01_categories_BUR.xlsx · 30 catégories',
          '  • 02_produits_TRAIT.xlsx · 245 produits (finis + ingrédients + revente + consommables)',
          '  • 02_produits_CAN.xlsx · 244 produits',
          '  • 02_produits_PAT.xlsx · 293 produits',
          '  • 02_produits_BUR.xlsx · 263 produits',
          '  • LISEZ-MOI.txt · procédure complète',
          '',
          'Total : **120 catégories et plus de 1 000 produits** prêts à importer.',
        ],
      },
      { h: 'Procédure d\'import (à répéter pour chaque activité)',
        p: [
          '**Étape 1 — Se placer sur la bonne activité**',
          '',
          'L\'import se fait toujours dans le contexte d\'une activité. La DG (msandra) doit basculer sur l\'activité concernée grâce à la puce en haut à droite de l\'écran (TRAIT / CAN / PAT / BUR).',
          '',
          '**Étape 2 — Importer les catégories D\'ABORD**',
          '',
          'Menu **Catalogue → Catégories → Importer Excel**.',
          '  1. Téléverser `01_categories_<CODE>.xlsx`',
          '  2. L\'app affiche un aperçu ligne par ligne avec badges (OK / Doublon / Erreur)',
          '  3. Cliquer **« Valider et importer »**',
          '',
          '**Étape 3 — Importer les produits ENSUITE**',
          '',
          'Menu **Catalogue → Produits → Importer Excel**.',
          '  1. Téléverser `02_produits_<CODE>.xlsx`',
          '  2. Vérifier l\'aperçu — chaque ligne montre son statut',
          '  3. Cliquer **« Valider et importer »**',
          '',
          '**Étape 4 — Basculer sur l\'activité suivante et recommencer.**',
          '',
          'Compter environ 10 minutes par activité (surtout le temps de basculement + le temps d\'aperçu). L\'import lui-même est instantané.',
        ],
      },
      { h: 'Format attendu (si vous préparez vos propres fichiers)',
        p: [
          '**Fichier Catégories** — colonnes exactes :',
          '  • Nom * (obligatoire)',
          '  • Description',
          '',
          '**Fichier Produits** — colonnes exactes :',
          '  • Référence (facultatif — auto-générée si vide, ex: PRO-0001)',
          '  • Désignation * (obligatoire)',
          '  • Catégorie * (obligatoire — doit exister ou sera créée)',
          '  • Fournisseur (nom exact d\'un fournisseur existant, sinon vide)',
          '  • Prix achat (FCFA) — nombre sans espace ni décimale',
          '  • Prix vente (FCFA)',
          '  • Stock actuel',
          '  • Stock minimum',
          '  • Stock maximum',
          '  • Unité — à choisir dans la liste : pièce, kg, g, litre, ml, carton, paquet, sac, sachet, plaque, barquette, bouteille',
          '  • Description',
          '  • Actif — "Oui" ou "Non"',
          '',
          'La première feuille du fichier est lue par le parseur. Vous pouvez ajouter d\'autres feuilles (notes, instructions) sans impact.',
          '',
          '**Astuce** : téléchargez le modèle vide via `Catalogue → Produits → Importer Excel → Télécharger le modèle` pour partir d\'une base propre avec les listes déroulantes déjà configurées.',
        ],
      },
      { h: 'Détection automatique des doublons',
        p: [
          'L\'import détecte deux types de doublons pour éviter d\'écraser ou de dupliquer vos données :',
          '',
          '• **Doublon existant** — une désignation identique (insensible à la casse et aux accents) existe déjà dans la base. La ligne est **ignorée** silencieusement.',
          '• **Doublon dans le fichier** — la même désignation apparaît plusieurs fois dans votre Excel. Seule la première occurrence est importée.',
          '',
          'L\'aperçu affiche clairement chaque badge doublon, avec le nom de l\'enregistrement existant en tooltip. Vous savez à l\'avance ce qui sera ignoré avant de valider.',
          '',
          'Aucune donnée n\'est jamais écrasée par un import — il ne fait qu\'ajouter.',
        ],
      },
      { h: 'Régénérer les fichiers de référence',
        p: [
          'Les fichiers de référence sont produits par deux scripts complémentaires :',
          '',
          '• `scripts/generer_catalogue_reference.js` — définit les 435 éléments du catalogue de référence (à modifier si besoin d\'ajouter/enlever des produits ou d\'ajuster les prix)',
          '• `scripts/generer_imports_bstock.js` — utilise les données du script précédent pour générer les 8 fichiers Excel importables',
          '',
          'Après modification du premier, relancer :',
          '',
          '  `node scripts/generer_imports_bstock.js`',
          '',
          'Les nouveaux fichiers sont écrits dans **docs/import_bstock/**.',
        ],
      },
    ]},

    // ==========================================================
    { titre: '18. Annexe — Comptes et identifiants de démonstration', sections: [
      { h: 'Tous les comptes créés à l\'installation',
        p: [
          'Ces comptes sont automatiquement créés par le script d\'installation (npm run setup).',
          'En production, changez tous les mots de passe et supprimez les comptes non utilisés.',
        ],
        tableau: {
          colonnes: ['Nom d\'utilisateur', 'Mot de passe', 'Rôle', 'Périmètre'],
          lignes: [
            ['msandra', 'admin2026', 'DG', 'Toutes activités + Administration'],
            ['sandra', 'secret2026', 'SECRETARIAT', 'Traiteur + Cantine (B2B)'],
            ['nestor', 'dist2026', 'DISTRIBUTION', 'Achats et distributions transversales'],
            ['mario', 'trait2026', 'GESTIONNAIRE', 'Le Traiteur'],
            ['mariano', 'can2026', 'GESTIONNAIRE', 'La Cantine'],
            ['floriane', 'pat2026', 'GESTIONNAIRE', 'Pâtisserie'],
            ['nikolas', 'bur2026', 'GESTIONNAIRE', '237 Bona Burger'],
            ['caiss_pat', 'caisse2026', 'CAISSIER', 'Caisse Pâtisserie'],
            ['caiss_bur', 'caisse2026', 'CAISSIER', 'Caisse Bona Burger'],
            ['cuis_trait', 'cuisine2026', 'CUISINIER', 'Cuisine Traiteur (à renommer)'],
            ['cuis_can', 'cuisine2026', 'CUISINIER', 'Cuisine Cantine (à renommer)'],
            ['cuis_pat', 'cuisine2026', 'CUISINIER', 'Cuisine Pâtisserie (à renommer)'],
            ['cuis_bur', 'cuisine2026', 'CUISINIER', 'Cuisine Bona Burger (à renommer)'],
          ],
        },
      },
      { h: 'Coordonnées entreprise pré-configurées',
        tableau: {
          colonnes: ['Paramètre', 'Valeur'],
          lignes: [
            ['Raison sociale', 'LE TRAITEUR DU BISTROT SUARL'],
            ['Adresse', 'Rue Bâti bois, Bonapriso - BP: 434 Douala, Cameroun'],
            ['Téléphone', '(237) 699 69 59 69 / 699 97 20 48'],
            ['Email', 'bistrolatin97@yahoo.fr'],
            ['NIU', 'M011300044639Y'],
            ['RCCM', 'RC/DLA/2013/B/514'],
            ['Banque', 'SGC Douala Bonanjo'],
            ['N° de compte', '06010429558 55'],
            ['Chèque à l\'ordre de', 'LE TRAITEUR DU BISTROT SUARL'],
            ['TVA', '19,25 % (Cameroun)'],
            ['Devise', 'FCFA'],
          ],
        },
      },
      { h: 'Commandes de maintenance',
        p: [
          'Toutes ces commandes s\'exécutent dans le terminal PowerShell depuis le dossier du projet :',
          '',
          '• **npm start** — Démarre le serveur (à laisser tourner)',
          '• **npm run dev** — Démarre en mode développement avec redémarrage auto',
          '• **npm run setup** — Réinitialise la base et crée les données de démo (⚠ efface tout)',
          '• **npm run seed** — Recrée les utilisateurs, produits et clients (sans effacer la base)',
          '• **npm run seed:test** — Ajoute achats, distributions, commandes, ventes, clôtures et fiches techniques',
          '• **npm run guide** — Régénère ce guide utilisateur',
          '• **npm run capturer** — Capture automatique des écrans (nécessite serveur démarré + puppeteer)',
          '• **npm run guide:complet** — Enchaîne capturer + guide',
        ],
      },
    ]},
  ],
};

// ============================================================================
// GÉNÉRATION HTML (Word)
// ============================================================================
function genererHTML() {
  const parts = [];
  parts.push('<!DOCTYPE html><html><head><meta charset="UTF-8">');
  parts.push('<title>Guide d\'utilisation — Bistock · Le Traiteur du Bistrot</title>');
  parts.push(`<style>
    @page { size: A4; margin: 2cm; }
    body { font-family: Calibri, Arial, sans-serif; color: #1a202c; line-height: 1.5; font-size: 11pt; }
    h1.titre { font-size: 32pt; color: #1e3a8a; text-align: center; margin: 60pt 0 10pt; letter-spacing: 1pt; }
    p.sous-titre { text-align: center; font-size: 14pt; color: #64748b; margin: 0 0 20pt; }
    p.version { text-align: center; color: #94a3b8; font-size: 10pt; }
    h2.chapitre { color: #1e3a8a; border-bottom: 3pt solid #CA8A04; padding-bottom: 8pt; margin-top: 30pt; font-size: 20pt; page-break-before: always; }
    h2.chapitre:first-of-type { page-break-before: auto; }
    h3.section { color: #1e3a8a; font-size: 14pt; margin-top: 18pt; margin-bottom: 8pt; border-left: 4pt solid #CA8A04; padding-left: 10pt; page-break-after: avoid; }
    p { margin: 6pt 0; text-align: justify; page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 10pt; page-break-inside: avoid; }
    th { background: #1e3a8a; color: #fff; padding: 8pt; text-align: left; border: 1pt solid #1e3a8a; font-weight: bold; }
    td { padding: 6pt 8pt; border: 1pt solid #cbd5e1; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .capture { background: #fef3c7; border-left: 4pt solid #CA8A04; padding: 10pt 14pt; margin: 12pt 0; border-radius: 4pt; font-style: italic; color: #78350f; }
    .capture strong { color: #78350f; font-style: normal; }
    .fig { margin: 14pt 0; text-align: center; page-break-inside: avoid; }
    .fig .cadre { display: inline-block; overflow: hidden; border: 1pt solid #cbd5e1; border-radius: 4pt; max-width: 15cm; max-height: 9cm; }
    .fig img { display: block; border: 0; }
    .fig .legende { font-style: italic; color: #64748b; font-size: 9pt; margin-top: 4pt; }
    .fig .note-tronque { display: block; font-size: 8pt; color: #94a3b8; margin-top: 2pt; }
    .toc { background: #f1f5f9; padding: 20pt; border-radius: 8pt; margin: 30pt 0; }
    .toc h2 { color: #1e3a8a; margin-top: 0; font-size: 16pt; }
    .toc ol li { padding: 4pt 0; }
    .footer { text-align: center; color: #94a3b8; font-size: 9pt; margin-top: 40pt; border-top: 1pt solid #cbd5e1; padding-top: 10pt; }
  </style></head><body>`);

  // Page de garde
  parts.push('<div style="text-align: center; padding-top: 120pt;">');
  parts.push('<div style="font-size: 12pt; color: #CA8A04; letter-spacing: 4pt; margin-bottom: 20pt;">LE TRAITEUR DU BISTROT SUARL</div>');
  parts.push(`<h1 class="titre">${guide.titre}</h1>`);
  parts.push(`<p class="sous-titre">${guide.sousTitre}</p>`);
  parts.push('<hr style="width: 60pt; border: 2pt solid #CA8A04; margin: 20pt auto;">');
  parts.push(`<p class="version">${guide.version}</p>`);
  parts.push('<div style="margin-top: 200pt; color: #64748b; font-size: 10pt;">Douala, Cameroun · Bonapriso</div>');
  parts.push('</div>');
  parts.push('<div style="page-break-after: always;"></div>');

  // Sommaire
  parts.push('<div class="toc"><h2>Sommaire</h2><ol>');
  for (const chap of guide.chapitres) parts.push(`<li>${chap.titre}</li>`);
  parts.push('</ol></div>');

  // Chapitres
  for (const chap of guide.chapitres) {
    parts.push(`<h2 class="chapitre">${chap.titre}</h2>`);
    for (const sec of chap.sections) {
      parts.push(`<h3 class="section">${sec.h}</h3>`);
      if (sec.p) for (const p of sec.p) parts.push(`<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`);
      if (sec.tableau) {
        parts.push('<table>');
        parts.push('<tr>' + sec.tableau.colonnes.map(c => `<th>${c}</th>`).join('') + '</tr>');
        for (const ligne of sec.tableau.lignes) {
          parts.push('<tr>' + ligne.map(v => `<td>${v}</td>`).join('') + '</tr>');
        }
        parts.push('</table>');
      }
      if (sec.p2) for (const p of sec.p2) parts.push(`<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`);
      if (sec.img && screenPath(sec.img)) {
        const cheminImg = screenPath(sec.img);
        const imgBuf = fs.readFileSync(cheminImg);
        const base64 = imgBuf.toString('base64');
        // Contrainte : max 14 cm × 8,5 cm (528 × 320 px à 96 DPI) — laisse marge pour légende
        const MAX_W_PX = 528, MAX_H_PX = 320;
        const tc = tailleContrainte(cheminImg, MAX_W_PX, MAX_H_PX);
        // Attributs HTML width/height explicites (Word les respecte, contrairement à max-width/max-height CSS)
        // Pour les images très hautes (tronquée=true), on force la boîte à recadrer via overflow:hidden
        const styleImg = tc.tronquee
          ? `width: ${MAX_W_PX}px; height: auto;`  // affichage pleine largeur, la boîte cadre coupe
          : `width: ${tc.w}px; height: ${tc.h}px;`;
        const styleCadre = `width: ${tc.w}px; height: ${tc.h}px;`;
        const noteTronque = tc.tronquee
          ? `<span class="note-tronque">↕ Capture pleine page — recadrée en haut. Ouvrir l'application pour la vue complète.</span>`
          : '';
        parts.push(`<div class="fig">
          <div class="cadre" style="${styleCadre}">
            <img src="data:image/png;base64,${base64}" alt="${sec.capture || sec.img}" width="${tc.w}" height="${tc.h}" style="${styleImg}">
          </div>
          <div class="legende">${sec.capture || ''}</div>
          ${noteTronque}
        </div>`);
      } else if (sec.capture) {
        parts.push(`<div class="capture"><strong>📷 Capture d'écran :</strong> ${sec.capture}</div>`);
      }
    }
  }

  parts.push(`<div class="footer">Guide généré automatiquement — Le Traiteur du Bistrot SUARL — ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>`);
  parts.push('</body></html>');
  return parts.join('\n');
}

// ============================================================================
// GÉNÉRATION PDF
// ============================================================================
function genererPDF(cheminSortie) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(fs.createWriteStream(cheminSortie));

  const NAVY = '#1e3a8a', GOLD = '#CA8A04', MUTED = '#64748b', TEXT = '#1a202c';
  const PAGE_W = doc.page.width - 100;

  function checkPage(needed = 100) {
    if (doc.y + needed > doc.page.height - 60) doc.addPage();
  }
  function ecrireParagraphe(txt) {
    // Retire les marqueurs **gras**, écrit en un seul bloc pour éviter les superpositions
    const clean = txt.replace(/\*\*(.+?)\*\*/g, '$1');
    doc.font('Helvetica').fontSize(11).fillColor(TEXT).text(clean, { align: 'justify' });
  }

  // Page de garde
  doc.font('Helvetica').fontSize(10).fillColor(GOLD).text('LE TRAITEUR DU BISTROT SUARL', { align: 'center', characterSpacing: 3 });
  doc.moveDown(4);
  doc.font('Helvetica-Bold').fontSize(30).fillColor(NAVY).text(guide.titre, { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(14).fillColor(MUTED).text(guide.sousTitre, { align: 'center' });
  doc.moveDown(1);
  const y0 = doc.y;
  doc.moveTo((doc.page.width - 60) / 2, y0).lineTo((doc.page.width + 60) / 2, y0).strokeColor(GOLD).lineWidth(2).stroke();
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(10).fillColor('#94a3b8').text(guide.version, { align: 'center' });
  doc.moveDown(15);
  doc.fontSize(10).fillColor(MUTED).text('Douala, Cameroun · Bonapriso', { align: 'center' });

  // Sommaire
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text('Sommaire');
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(11).fillColor(TEXT);
  for (const chap of guide.chapitres) {
    doc.text(chap.titre, { indent: 10 });
    doc.moveDown(0.3);
  }

  // Chapitres
  for (const chap of guide.chapitres) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(chap.titre);
    doc.moveTo(50, doc.y + 4).lineTo(50 + PAGE_W, doc.y + 4).strokeColor(GOLD).lineWidth(2).stroke();
    doc.moveDown(1);

    for (const sec of chap.sections) {
      checkPage(80);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(sec.h);
      doc.moveDown(0.5);

      if (sec.p) {
        for (const p of sec.p) {
          if (!p) { doc.moveDown(0.3); continue; }
          checkPage(30);
          ecrireParagraphe(p);
          doc.moveDown(0.3);
        }
      }

      if (sec.tableau) {
        checkPage(80);
        const t = sec.tableau;
        const colW = PAGE_W / t.colonnes.length;
        let yStart = doc.y;
        doc.rect(50, yStart, PAGE_W, 22).fill(NAVY);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff');
        for (let i = 0; i < t.colonnes.length; i++) {
          doc.text(t.colonnes[i], 55 + i * colW, yStart + 7, { width: colW - 10 });
        }
        let yLigne = yStart + 22;
        doc.font('Helvetica').fontSize(9).fillColor(TEXT);
        for (const ligne of t.lignes) {
          let hMax = 18;
          for (let i = 0; i < ligne.length; i++) {
            const h = doc.heightOfString(String(ligne[i]), { width: colW - 10 });
            if (h + 8 > hMax) hMax = h + 8;
          }
          if (yLigne + hMax > doc.page.height - 60) { doc.addPage(); yLigne = 50; }
          doc.rect(50, yLigne, PAGE_W, hMax).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          for (let i = 0; i < ligne.length; i++) {
            doc.text(String(ligne[i]), 55 + i * colW, yLigne + 4, { width: colW - 10 });
          }
          yLigne += hMax;
        }
        doc.y = yLigne + 10;
      }

      if (sec.p2) {
        for (const p of sec.p2) {
          if (!p) { doc.moveDown(0.3); continue; }
          checkPage(30);
          ecrireParagraphe(p);
          doc.moveDown(0.3);
        }
      }

      if (sec.img && screenPath(sec.img)) {
        try {
          const imgPath = screenPath(sec.img);
          // Zone maximale pour une image : 420pt de large × 300pt de haut
          const MAX_W = 420, MAX_H = 300;
          const tc = tailleContrainte(imgPath, MAX_W, MAX_H);
          const espaceNecessaire = tc.h + 40;
          if (doc.y + espaceNecessaire > doc.page.height - 60) doc.addPage();
          const xCentre = 50 + (PAGE_W - tc.w) / 2;
          if (tc.tronquee) {
            // Image très haute : on la place dans une zone clippée pour ne montrer que le haut
            const { w: nativeW, h: nativeH } = pngDimensions(imgPath);
            // On affiche à MAX_W de large ; hauteur affichée native = MAX_W × nativeH/nativeW
            const hAffichee = MAX_W * nativeH / nativeW;
            doc.save();
            doc.rect(xCentre, doc.y, tc.w, tc.h).clip();
            doc.image(imgPath, xCentre, doc.y, { width: tc.w, height: hAffichee });
            doc.restore();
            // Bordure autour du cadre visible
            doc.rect(xCentre, doc.y, tc.w, tc.h).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.y += tc.h + 4;
            doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED)
              .text('↕ Capture pleine page — recadrée en haut', 50, doc.y, { align: 'center', width: PAGE_W });
            doc.moveDown(0.3);
          } else {
            doc.image(imgPath, xCentre, doc.y, { width: tc.w, height: tc.h });
            doc.rect(xCentre, doc.y, tc.w, tc.h).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
            doc.y += tc.h + 8;
          }
          if (sec.capture) {
            doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text(sec.capture, 50, doc.y, { align: 'center', width: PAGE_W });
            doc.moveDown(0.5);
          }
          doc.moveDown(0.5);
        } catch (e) { console.warn('   ! ' + sec.img + ' : ' + e.message); }
      } else if (sec.capture) {
        checkPage(50);
        const yC = doc.y;
        const hCapture = doc.heightOfString(sec.capture, { width: PAGE_W - 40 }) + 26;
        doc.rect(50, yC, PAGE_W, hCapture).fill('#fef3c7');
        doc.rect(50, yC, 4, hCapture).fill(GOLD);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#78350f').text('📷 CAPTURE D\'ÉCRAN', 65, yC + 6);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#78350f').text(sec.capture, 65, yC + 20, { width: PAGE_W - 30 });
        doc.y = yC + hCapture + 8;
      }

      doc.moveDown(0.5);
    }
  }

  // Numérotation pages
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (i === 0) continue;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `Page ${i + 1} / ${range.count}   ·   Guide d'utilisation — Le Traiteur du Bistrot`,
      50, doc.page.height - 40, { align: 'center', width: PAGE_W },
    );
  }

  doc.end();
}

// ============================================================================
// MAIN
// ============================================================================
console.log('→ Génération du guide utilisateur détaillé...');
const html = genererHTML();
const cheminDoc = path.join(OUT_DIR, 'Guide_Utilisation.doc');
const cheminPdf = path.join(OUT_DIR, 'Guide_Utilisation.pdf');
fs.writeFileSync(cheminDoc, '﻿' + html, 'utf8');
console.log('   ✓ Word (HTML) : ' + cheminDoc);
genererPDF(cheminPdf);
console.log('   ✓ PDF         : ' + cheminPdf);
const nbCaptures = fs.existsSync(SCREENS_DIR) ? fs.readdirSync(SCREENS_DIR).filter(f => f.endsWith('.png')).length : 0;
console.log(`\n${nbCaptures} capture(s) d'écran intégrée(s).`);
if (nbCaptures === 0) {
  console.log('   Pour ajouter les captures : démarrez le serveur (npm start), puis npm run capturer.');
}
console.log('\nOuvrez le fichier .doc dans Word et "Enregistrer sous..." → .docx pour un fichier Word natif.\n');
