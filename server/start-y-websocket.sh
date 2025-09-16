#!/bin/bash
# Lance le serveur officiel y-websocket sur le port 1234 (modifiable)
PORT=1234
npx y-websocket --port $PORT --host 0.0.0.0
