# GPX Collaboration – Serveur temps réel Yjs

## Fonctionnalités
- **Synchronisation Yjs** : serveur officiel `y-websocket` sur `/ws`, un document par roomId
- **Registry mémoire** : roomId → {doc, clientsCount, lastSeen} (interne, non exposé)
- **Garbage Collection** : suppression automatique des rooms après 60 min d’inactivité
- **Métriques** : endpoint `/metrics` (nombre de rooms, clients, liste des rooms)

---

## Démarrage

### 1. Serveur WebSocket Yjs
```bash
cd server
./start-y-websocket.sh
```
- Par défaut, écoute sur le port 1234
- Les clients Yjs doivent se connecter à `ws://localhost:1234/<roomId>`

### 2. Backend Express
```bash
pnpm --filter server start
```
- Expose `/metrics` sur le port 3001

---

## Test de la synchronisation Yjs
- Connectez plusieurs clients Yjs à la même roomId
- Les modifications sont synchronisées en temps réel

## Test du garbage collector
- Attendez 60 min sans activité sur une room
- La room est supprimée automatiquement (log côté backend)

## Accès aux métriques
- Rendez-vous sur `http://localhost:3001/metrics`
- Réponse JSON :
  ```json
  {
    "roomCount": 1,
    "clientCount": 2,
    "rooms": [
      { "roomId": "abc", "clientsCount": 2, "lastSeen": 1694870000000 }
    ]
  }
  ```

---

## Dépendances principales
- [y-websocket](https://github.com/yjs/y-websocket)
- [yjs](https://github.com/yjs/yjs)
- [express](https://expressjs.com/)

---

## Notes
- Le registry mémoire est interne, non exposé par API.
- Le serveur WebSocket Yjs est indépendant du backend Express.
- Pour tester la synchro, utilisez un client Yjs compatible (exemple : [yjs-demos](https://github.com/yjs/yjs-demos)).
