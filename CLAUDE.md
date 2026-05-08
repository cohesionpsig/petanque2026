# petanque2026 — Documentation pour Claude Code

## Vue d'ensemble

Application web de gestion de tournoi de pétanque. Interface publique (classements, tableau, pronostics) + panneau admin protégé par mot de passe. Déployée sur Vercel, backend Firebase Firestore en temps réel.

## Architecture

Fichier unique : **`index.html`** (CSS inline + JS vanilla inline, ~3100 lignes)

| Section (lignes approx.) | Rôle |
|---|---|
| 1–538 | CSS complet |
| 539–904 | HTML (structure, modales, onglets) |
| 907–928 | Config Firebase (dev / prod) |
| 930–954 | Constantes et état global |
| 956–988 | Listeners Firestore temps réel |
| 990–1054 | Calcul local des données (classements, standings) |
| 1056–1196 | UI Core (tabs, modales, toast, helpers) |
| 1197–1905 | Opérations Firebase (CRUD) + logique admin |
| 1906–2050 | Système de votes (pronostics) |
| 2051–3051 | Fonctions `render*()` — génération du DOM |
| 3052–3133 | Mises à jour optimistes (score preview) |

## Environnements Firebase

La sélection dev/prod se fait automatiquement selon `window.location.hostname` :

| Environnement | Condition | Projet Firebase |
|---|---|---|
| **Production** | `petanque2026.vercel.app` | `petanque2026-6ddba` |
| **Dev / Preview** | tout autre hostname (localhost, preview Vercel) | `petanque2026-dev` |

Ne jamais tester en production — utiliser localhost ou une preview Vercel.

## Collections Firestore

### `config` (document unique : `main`)
```
tournoiDemarre: boolean
inscriptionsOuvertes: boolean
maintenanceMode: boolean
prixParPersonne: number
```

### `equipes`
```
nom: string          — nom de l'équipe
j1: string           — joueur 1
j2: string           — joueur 2
poule: string        — lettre A-H (vide si non assigné)
statut: string       — 'pending' (en attente) ou absent (validé)
```

### `matchs` (phase de poule)
```
poule: string        — lettre A-H
eq1: string          — id équipe 1
eq2: string          — id équipe 2
score1: number
score2: number
joue: boolean
```

### `tableau` (phase finale)
```
round: string        — 'QF' | 'SF' | 'F' | 'B3'
eq1: string | null
eq2: string | null
score1: number
score2: number
joue: boolean
ordre: number
```

### `consolation` (repêchage)
Même structure que `tableau`.

### `pronostics`
```
question: string
choix: string[]      — liste des options
reponse: string | null  — réponse correcte (null = pas encore révélée)
```

### `votes`
```
pronosticId: string
equipeId: string
choix: string
```

## Logique métier clé

### Classement de poule (`computeStandings`)
Tri par ordre de priorité :
1. Points (victoire = 2 pts, nul = 1 pt, défaite = 0 pt)
2. Différence de buts (pf - pc)
3. Buts marqués (pf)

### Cycle de vie du tournoi
1. **Inscriptions** — équipes soumises avec statut `pending`
2. **Validation admin** — l'admin valide ou supprime les équipes en attente
3. **Tirage au sort** — attribution des poules (A-H), génération des matchs de poule
4. **Phase de poule** — saisie des scores match par match
5. **Génération du tableau** — les 1ers et 2e de chaque poule + barrage passent en phase finale
6. **Phase finale** — QF → SF → F, avec bracket consolation pour les éliminés

### Barrage (5 poules → 10 qualifiés)
Quand le nombre de poules est impair, un round de barrage est généré entre les meilleurs 2e pour équilibrer le tableau final.

## Accès admin

Deux niveaux d'accès via mot de passe (onglet Admin) :
- **Admin complet** (`ADMIN_PWD`) — toutes les opérations
- **Saisie scores uniquement** (`SCORE_PWD`) — les sections `.score-only-hide` sont masquées

⚠️ Les mots de passe sont en clair dans le JS — à sécuriser (voir TODO sécurité).

## Flux de données

Firestore → `liveData` (via `onSnapshot`) → `_scheduleRebuild()` (debounce 80ms) → `rebuildCurrentData()` → `currentData` → `applyData()` → `render*()`

Les renders reconstruisent le DOM entièrement à chaque mise à jour. Pas de diff/virtual DOM.

## Conventions de développement

- Tout le code reste dans `index.html` (pas de fichiers séparés pour l'instant)
- Pas de build tool, pas de bundler — fichier servi tel quel par Vercel
- Langue de l'interface : **français**
- Commits en français
- Pas de commentaires sauf logique non-évidente

## Déploiement

Push sur `main` → déploiement automatique Vercel en production.
Toute autre branche → preview Vercel (utilise Firebase dev).

## Points d'attention

- Ne jamais modifier les scores directement en Firestore sans passer par l'UI — les standings sont calculés localement à partir des matchs
- Les équipes `statut: 'pending'` ne participent pas aux calculs de classement
- `myEquipeId` (localStorage) identifie l'équipe de l'utilisateur courant pour les pronostics
- Le debounce de 80ms dans `_scheduleRebuild` évite les re-renders multiples quand plusieurs collections Firestore se mettent à jour simultanément
