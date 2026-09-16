# Mise en production — Bistock (Le Traiteur du Bistrot)

Guide pas à pas pour passer de la version test à la version production.
Suivre les étapes **dans l'ordre**. Chaque étape est validée avant de passer à la suivante.

---

## Étape 0 — Prérequis

- [ ] Ordinateur/serveur sur lequel l'app tournera en prod identifié
- [ ] Node.js 18+ installé sur ce serveur (`node --version` pour vérifier)
- [ ] Accès administrateur au dossier du projet
- [ ] Décision prise sur la sauvegarde des données actuelles (voir Étape 1)

---

## Étape 1 — Sauvegarde de la base actuelle (optionnel mais recommandé)

Le script de purge fait déjà un backup automatique, mais un backup manuel avant tout début est prudent.

**Windows PowerShell**, dans le dossier du projet :
```powershell
Copy-Item data\app.db data\app-avant-mise-en-prod.db
```

Vérification :
```powershell
Get-ChildItem data\
```
Tu dois voir `app.db` et `app-avant-mise-en-prod.db`.

- [ ] Backup créé

---

## Étape 2 — Créer le fichier `.env`

Le fichier `.env` contient les secrets qui **ne doivent pas être versionnés** (ils ne le sont pas grâce à `.gitignore`).

### 2.1 — Copier le modèle

```powershell
Copy-Item .env.example .env
```

### 2.2 — Générer une clé SESSION_SECRET aléatoire

Toujours dans PowerShell :
```powershell
[Convert]::ToBase64String((1..48 | %{Get-Random -Max 256}))
```

Tu obtiens une chaîne de 64 caractères ressemblant à :
```
xK9mP+3vLqR8/nJ4hW2sT1yG5eB6cA0dQfE7uZi/OlHnMj+X8kY3wV2rP4sT1hG6=
```

**Copie cette chaîne** (Ctrl+C sur la sélection dans PowerShell).

### 2.3 — Éditer le fichier `.env`

Ouvre `.env` avec un éditeur de texte (Bloc-notes, VS Code, Notepad++…).

Remplace la ligne :
```
SESSION_SECRET=REMPLACEZ_PAR_UNE_CHAINE_ALEATOIRE_LONGUE
```

Par :
```
SESSION_SECRET=xK9mP+3vLqR8/nJ4hW2sT1yG5eB6cA0dQfE7uZi/OlHnMj+X8kY3wV2rP4sT1hG6=
```
(en collant **ta** clé générée à l'étape 2.2)

### 2.4 — Ajuster les autres paramètres si besoin

- `PORT=9000` — port sur lequel le serveur écoute (change seulement si 9000 est déjà pris)
- `NODE_ENV=production` — **laisser sur `production`** pour cacher les stack traces
- `ENTREPRISE_NOM`, `ENTREPRISE_ADRESSE`, `ENTREPRISE_TEL` — utilisés seulement comme fallback si vides dans `/admin/parametres/`

- [ ] `.env` créé et rempli avec une vraie SESSION_SECRET

---

## Étape 3 — Vérifier que la config charge sans erreur

Toujours dans PowerShell :
```powershell
node -e "const c = require('./src/config'); console.log('NODE_ENV:', c.NODE_ENV); console.log('SESSION_SECRET length:', c.SESSION_SECRET.length);"
```

Résultat attendu :
```
NODE_ENV: production
SESSION_SECRET length: 64
```

Si tu vois `NODE_ENV: development` ou une longueur < 32, revenir à l'étape 2.

- [ ] Config validée

---

## Étape 4 — Tester le démarrage du serveur avec le nouveau `.env`

```powershell
npm start
```

Tu dois voir :
```
✓ Serveur lancé sur http://localhost:9000
```

**Sans aucun message d'erreur** ni de warning `SESSION_SECRET utilise la valeur par défaut`.

Ouvre `http://localhost:9000` dans ton navigateur pour vérifier que la page de connexion s'affiche.

Arrête le serveur (`Ctrl+C`) une fois vérifié.

- [ ] Serveur démarre correctement avec le `.env` de prod

---

## Étape 5 — Purge de la base

**Attention** : cette étape est irréversible (mais un backup automatique est fait avant).

### 5.1 — Voir ce qui va être supprimé (simulation)

```powershell
npm run purge:prod
```

Affiche le plan sans rien modifier. Prends le temps de lire :
- Tables transactionnelles à vider (ventes, commandes, achats, distributions, productions…)
- Tables protégées (activités, utilisateurs, paramètres, plan comptable, journaux)

Décide de l'option :

| Option | Effet |
|---|---|
| `npm run purge:prod:go` | Vide juste les transactions. **Garde** clients + fournisseurs + catalogue produits. |
| `node scripts/purge_prod.js --confirm --vider-tiers` | Vide en plus les clients et fournisseurs de test. |
| `node scripts/purge_prod.js --confirm --tout` | **Recommandé pour un vrai démarrage** : vide tout (transactions + tiers + catalogue). |

### 5.2 — Exécuter la purge (option choisie)

Exemple pour un démarrage complet :
```powershell
node scripts/purge_prod.js --confirm --tout
```

Le script :
1. Crée un backup dans `data/backups/avant-purge-prod-YYYYMMDD-HHMMSS.db`
2. Supprime toutes les données de test
3. Réinitialise les compteurs de numérotation (tes futurs tickets/factures repartent à `0001`)

- [ ] Purge exécutée
- [ ] Backup généré (noter le nom du fichier)

---

## Étape 6 — Démarrer en production et sécuriser les comptes

### 6.1 — Redémarrer le serveur

```powershell
npm start
```

Les tables sont maintenant vides (sauf activités, utilisateurs, paramètres, plan comptable).

### 6.2 — Se connecter en DG

Ouvre `http://localhost:9000/comptes/connexion`

Connecte-toi avec le compte DG existant.

### 6.3 — Changer TOUS les mots de passe existants

Les mots de passe seed (`admin2026`, `caisse2026`, etc.) sont publics dans les scripts.

Va dans **Administration → Utilisateurs**, et pour **chaque compte** :
- Clic sur le compte
- Onglet **Sécurité**
- **Réinitialiser le mot de passe** avec une nouvelle valeur forte

### 6.4 — Créer les vrais comptes utilisateurs

Toujours dans **Administration → Utilisateurs**, ajouter les vraies personnes de l'équipe avec leurs rôles réels (DG, SECRETARIAT, DISTRIBUTION, GESTIONNAIRE, CAISSIER, CUISINIER).

Éventuellement **supprimer** les anciens comptes seed (msandra, caiss_pat, mario…) une fois les vrais comptes créés.

### 6.5 — Vérifier les paramètres système

**Administration → Paramètres** — vérifier :
- Identité entreprise (NIU, RCCM, adresse, téléphone, email)
- Coordonnées bancaires
- Codes marchand Mobile Money (Orange, MTN)
- Horaires affichés au client
- Frais de livraison

- [ ] Comptes réels créés
- [ ] Mots de passe seed remplacés
- [ ] Paramètres système vérifiés

---

## Étape 7 — Ajouter les vraies données de production

Selon l'option de purge choisie :

**Si `--tout`** — repartir de zéro sur le catalogue :
- **Administration → Activités** — vérifier que tes 4 activités (ou plus) sont bien configurées
- Pour chaque activité, dans **Catalogue** :
  - Créer les catégories
  - Créer les fournisseurs
  - Ajouter les produits (référence, désignation, prix, stock initial…)
  - Ajouter les suppléments par produit si besoin (canal web)
  - Créer les fiches techniques (cuisine)
- **Ventes → Clients** — ajouter les clients réguliers

**Si `--tout` non choisi** — vérifier que les données existantes sont réelles (pas des exemples de test).

- [ ] Catalogue rempli
- [ ] Premier test : passer une commande / vente réelle → vérifier que tout fonctionne

---

## Étape 8 — Sauvegarde régulière (à mettre en place)

Une fois en prod, sauvegarde recommandée **quotidienne** de `data/app.db`.

Script simple à programmer (Windows : Planificateur de tâches, Linux : cron) :
```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
Copy-Item data\app.db data\backups\prod-$stamp.db
```

- [ ] Sauvegarde automatique planifiée

---

## En cas de problème après la purge

Restaurer le backup :
```powershell
Copy-Item data\backups\avant-purge-prod-YYYYMMDD-HHMMSS.db data\app.db
```
(remplacer par le nom exact du backup généré à l'étape 5.2)

Puis redémarrer le serveur — tout revient à l'état d'avant la purge.
