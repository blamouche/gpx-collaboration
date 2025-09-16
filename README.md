# GPX Collaboration

Application complète permettant la création, l’édition et la co-édition de traces GPX en temps réel. Le projet est organisé en monorepo PNPM avec un client React/Leaflet et un serveur Node.js basé sur Yjs et `y-websocket`.

## Fonctionnalités principales

- **Sessions éphémères** partagées via une URL unique (`/r/:roomId`).
- **Collaboration temps réel** grâce à Yjs : curseurs, sélection des entités et undo/redo synchronisés.
- **Édition cartographique** avec Leaflet et Leaflet-Geoman (traces, points, suppression, mesure, centrage).
- **Import/Export GPX** côté client (`togeojson` → `@tmcw/togpx`).
- **Présence** : avatars colorés, nombre de participants, curseurs distants.
- **Aucun stockage persistant** : les documents sont conservés en mémoire et détruits 60 minutes après la déconnexion du dernier client (valeur configurable).

## Structure du dépôt

```
packages/
  server/   # Serveur Node.js + WebSocket (TypeScript)
  web/      # Frontend Vite + React + Leaflet (TypeScript)
```

## Prérequis

- Node.js 18+
- PNPM 8+

## Installation

```bash
pnpm install
```

## Démarrage en développement

Lancer simultanément le serveur et le client :

```bash
pnpm dev
```

Par défaut :

- Serveur HTTP/WebSocket sur `http://localhost:1234`
- Client Vite sur `http://localhost:5173`

## Build

```bash
pnpm build
```

Le serveur compilé est généré dans `packages/server/dist`, le client statique dans `packages/web/dist`.

## Scripts utiles

| Commande              | Description                                  |
| --------------------- | -------------------------------------------- |
| `pnpm dev`            | Lance serveur + frontend en mode développement |
| `pnpm build`          | Build complet serveur + frontend             |
| `pnpm lint`           | Lint de tous les packages                     |
| `pnpm typecheck`      | Vérification TypeScript                       |
| `pnpm --filter server start` | Démarre le serveur construit (`node dist/index.js`) |

## Variables d’environnement

### Serveur (`packages/server`)

| Variable | Description | Défaut |
| --- | --- | --- |
| `PORT` | Port HTTP/WebSocket | `1234` |
| `HOST` | Adresse d’écoute | `0.0.0.0` |
| `ROOM_TTL_MINUTES` | Temps d’inactivité avant destruction d’une room | `60` |
| `ROOM_CREATION_THROTTLE_MS` | Anti-spam création (ms) | `3000` |
| `WS_PATH` | Chemin WebSocket (ex: `/ws`) | `/ws` |
| `LOG_LEVEL` | Niveau de log Pino | `info` |
| `CORS_ORIGINS` | Origines HTTP autorisées (séparées par `,`) | *(désactivé par défaut)* |

### Frontend (`packages/web` via `.env` ou variables Vite)

| Variable | Description | Défaut |
| --- | --- | --- |
| `VITE_WS_URL` | URL WebSocket complète (ex: `ws://localhost:1234/ws`) | construit automatiquement depuis `window.location` |
| `VITE_WS_PATH` | Chemin WS si différent (`/ws`) | `/ws` |
| `VITE_SERVER_PROXY` | Proxy Vite pour `/health`/`/metrics` | *(désactivé)* |
| `VITE_WEB_PORT` | Port du serveur Vite | `5173` |

## Notes de sécurité & fonctionnement

- Les documents Yjs sont conservés uniquement en mémoire. Lorsqu’une room reste vide pendant `ROOM_TTL_MINUTES`, le serveur détruit la room et libère la mémoire.
- Option de lecture seule : ajouter `?mode=ro` à l’URL de session pour rejoindre sans droits d’édition.
- Passcode optionnel : ajouter `?k=secret` lors de la première connexion d’une room pour la protéger ; les connexions suivantes doivent fournir la même valeur.
- Les fichiers GPX importés sont limités à 10 Mo et validés côté client.

## Tests manuels recommandés

1. Créer une session depuis l’accueil et vérifier la redirection.
2. Ouvrir la même URL dans deux navigateurs : vérifier curseurs, sélection et édition partagée.
3. Importer un fichier `.gpx` et constater la synchronisation instantanée.
4. Modifier une trace (déplacement de vertex) et observer la mise à jour en temps réel.
5. Exporter la session et ouvrir le fichier dans un outil tiers pour validation.
6. Fermer toutes les fenêtres, attendre le TTL, puis reconnecter pour constater la recréation de room.

## Licence

Projet d’exemple pour démonstration technique. Aucune licence explicite fournie.
