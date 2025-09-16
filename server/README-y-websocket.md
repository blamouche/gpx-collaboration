# Serveur WebSocket Yjs

Ce projet utilise le serveur officiel `y-websocket` pour la synchronisation temps réel Yjs.

## Démarrage du serveur WebSocket

```bash
cd server
./start-y-websocket.sh
```
Le serveur écoute par défaut sur le port 1234 (modifiable dans le script).

Les clients doivent se connecter à `ws://<host>:1234` (un document par roomId).

## Intégration
- Le backend Express reste dédié à la gestion des métriques, du registry mémoire et du garbage collection des rooms (voir endpoints à venir).
- Le serveur WebSocket est indépendant et compatible Yjs.

## Prochaines étapes
- Registry mémoire pour rooms
- Garbage collection automatique
- Exposition des métriques sur `/metrics`
