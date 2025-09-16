// Garbage collector des rooms inactives
// Garbage collector des rooms inactives

const ROOM_TTL_MS = 60 * 60 * 1000; // 60 min
setInterval(() => {
  const now = Date.now();
  const rooms = roomRegistry.getAllRooms();
  Object.entries(rooms).forEach(([roomId, info]) => {
    if (now - info.lastSeen > ROOM_TTL_MS) {
      roomRegistry.removeRoom(roomId);
      console.log(`Room supprimée (TTL):`, roomId);
    }
  });
}, 10 * 60 * 1000); // vérif toutes les 10 min
import * as roomRegistry from './room-registry';

import express from 'express';
import health from './health';
import wsServer from './ws-server';

const app = express();
const PORT = process.env.PORT || 3001;

app.use('/health', health);

app.get('/metrics', (req, res) => {
  const rooms = roomRegistry.getAllRooms();
  const roomCount = Object.keys(rooms).length;
  const clientCount = Object.values(rooms).reduce((acc, info) => acc + info.clientsCount, 0);
  res.json({
    roomCount,
    clientCount,
    rooms: Object.entries(rooms).map(([roomId, info]) => ({
      roomId,
      clientsCount: info.clientsCount,
      lastSeen: info.lastSeen
    }))
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

wsServer.listen(server);
