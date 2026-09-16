# Système Intelligent de Gestion des Stocks — Version Node.js

Portage complet du projet Django initial vers **Node.js + Express + SQLite + EJS**, préservant toutes les fonctionnalités : gestion catalogue, caisse, stocks, intelligence (prévisions ML, ABC, réappro) et analytics.

## Stack technique

- **Backend** : Node.js 18+, Express 4
- **Base de données** : SQLite (via `better-sqlite3`)
- **Templates** : EJS avec partials header/sidebar/footer
- **Auth** : `express-session` + `bcryptjs` + rôles Admin/Gestionnaire/Caissier
- **PDF factures** : `pdfkit`
- **ML** : implémentation pure JS (régression linéaire, Pareto ABC, point de commande)
- **UI** : Bootstrap 5 + Bootstrap Icons + Chart.js (CDN)

## Installation rapide (Windows)

Double-cliquer sur `start.bat` — le script installe les dépendances, initialise la base avec données de démo, puis démarre le serveur.

Ouvrir ensuite http://localhost:9000

## Installation manuelle

```bash
# 1. Installer Node.js 18+ (https://nodejs.org)

# 2. Installer les dépendances
npm install

# 3. Créer le fichier .env
cp .env.example .env      # Linux/Mac
copy .env.example .env    # Windows

# 4. Initialiser la base SQLite + données de démonstration (4 mois de ventes)
npm run setup

# 5. Démarrer le serveur
npm start
```

## Comptes de démonstration

| Rôle           | Login          | Mot de passe |
|----------------|----------------|--------------|
| Administrateur | `admin`        | `admin123`   |
| Gestionnaire   | `gestionnaire` | `gestion123` |
| Caissier       | `caissier`     | `caisse123`  |

## Fonctionnalités portées

### accounts (utilisateurs et rôles)
- Login / logout avec sessions
- 3 rôles : Admin, Gestionnaire, Caissier
- CRUD utilisateurs (admin uniquement)
- Profil personnel

### produits (catalogue)
- CRUD produits avec image, référence auto (`P0001`, `P0002`, …)
- Catégories avec icône métier automatique et couleur
- Fournisseurs avec délai de livraison
- Recherche, filtres catégorie/fournisseur/état
- Détail produit avec historique mouvements

### stocks
- Mouvements : entrée / sortie / ajustement / retour / perte
- Historique groupé par jour
- **Alertes automatiques** : rupture (CRITIQUE) et seuil bas (ALERTE)
- **Inventaires physiques** : création, saisie ligne par ligne (AJAX), validation avec ajustements auto
- Vue « état du stock » avec valorisation

### ventes
- **Caisse** tactile : recherche produit, panier, remise, TVA optionnelle, modes de paiement
- Création rapide de clients (particuliers ou entreprises avec NIU/RCCM)
- Validation atomique de la vente (transaction) : décrémente stock, crée mouvements, alerte si seuil
- **Facture PDF** générée avec `pdfkit` (design bleu marine / or fidèle à l'original)
- Historique ventes filtrable par statut de paiement / mode
- Clients : CRUD, endpoint AJAX de création

### intelligence
Réimplémentation pure JS des trois algorithmes originaux Python :

- **Prévisions de ventes** : régression linéaire sur 90 jours d'historique, horizon 30 jours, fourchettes basse/haute (± 1.96 σ), fallback moyenne mobile si données insuffisantes, saisonnalité hebdomadaire, R² et MAE
- **Classification ABC (Pareto)** : tri par CA cumulé, A = 0-80%, B = 80-95%, C = 95-100%, comparaison période N vs N-1, top catégories/fournisseurs, concentration
- **Recommandations réappro** : point de commande dynamique `D × L + SS`, groupé par fournisseur, urgence calculée

### analytics
- Dashboard avec 4 KPI + 3 graphiques Chart.js (ventes 30j, top produits, répartition catégories)
- Exports CSV Power BI : ventes détaillées, photo du stock

## Structure du projet

```
gestion_stocks_node/
├── src/
│   ├── server.js         # Point d'entrée Express
│   ├── config.js         # Variables (.env)
│   ├── db.js             # Instance better-sqlite3
│   ├── helpers.js        # Formatage, roles, enrichissement, mouvement
│   └── algorithmes.js    # ML pur JS (prévision, ABC, réappro)
├── routes/
│   ├── accounts.js
│   ├── produits.js
│   ├── stocks.js
│   ├── ventes.js
│   ├── intelligence.js
│   └── analytics.js
├── views/
│   ├── partials/         # header, sidebar, footer
│   ├── accounts/
│   ├── produits/
│   ├── stocks/
│   ├── ventes/
│   ├── intelligence/
│   └── analytics/
├── public/
│   ├── css/app.css       # Design system (bleu marine + or)
│   └── js/modals.js
├── scripts/
│   ├── init_db.js        # Création du schéma SQLite
│   └── seed_data.js      # Données de démo (produits, ventes 4 mois)
├── data/                 # app.db (créée à l'init)
└── package.json
```

## Correspondance des URL Django → Node

| Django (namespace)                          | Node (Express)                       |
|---------------------------------------------|--------------------------------------|
| `accounts:login`                            | `GET /comptes/connexion`             |
| `accounts:liste`                            | `GET /comptes/utilisateurs`          |
| `analytics:dashboard`                       | `GET /tableau-de-bord/`              |
| `produits:liste`                            | `GET /produits/`                     |
| `produits:categorie_liste`                  | `GET /produits/categories/`          |
| `produits:fournisseur_liste`                | `GET /produits/fournisseurs/`        |
| `stocks:mouvements`                         | `GET /stocks/mouvements/`            |
| `stocks:alertes`                            | `GET /stocks/alertes/`               |
| `stocks:inventaire_liste`                   | `GET /stocks/inventaires/`           |
| `ventes:caisse`                             | `GET /ventes/caisse/`                |
| `ventes:enregistrer`                        | `POST /ventes/enregistrer/`          |
| `ventes:facture_pdf`                        | `GET /ventes/:id/facture.pdf`        |
| `intelligence:previsions`                   | `GET /intelligence/previsions/`      |
| `intelligence:abc`                          | `GET /intelligence/classification-abc/` |
| `intelligence:recommandations`              | `GET /intelligence/recommandations/` |
| `analytics:export_ventes`                   | `GET /tableau-de-bord/export/ventes.csv` |

## Choix techniques

- **`better-sqlite3`** (synchrone) plutôt que `sqlite3` : simplifie le code, transactions atomiques natives, très performant pour applications mono-serveur.
- **EJS avec partials** plutôt que layout engine : pas de middleware supplémentaire, syntaxe familière proche du HTML.
- **Réimplémentation ML** en JS pur : évite d'embarquer numpy/pandas/scikit-learn ; régression linéaire par moindres carrés, calcul de R², écart-type des résidus pour la fourchette de confiance.
- **Sessions Express** avec cookies HTTP-only, secret configurable via `SESSION_SECRET`.

## Modifications par rapport à Django

- L'admin Django (`/admin/`) n'existe pas : tout se fait par l'interface utilisateur ou les scripts.
- Pagination : simplifiée (limites LIMIT SQL) car SQLite reste très rapide sur les volumes visés (< 100k lignes).
- Le champ `photo` utilisateur est stocké sous `/public/uploads/avatars/`, `image` produit sous `/public/uploads/produits/`.
- Le fuseau horaire est celui du serveur (via `datetime('now')` SQLite).

## Développement

```bash
npm run dev       # Redémarrage automatique (Node --watch)
npm run init-db   # Recréer le schéma
npm run seed      # Regénérer les données de démo
```

## Licence

Projet académique — Université de Douala, Faculté des Sciences, Licence Pro LIDA.
