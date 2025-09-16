// Registry mémoire pour rooms Yjs
// roomId → { doc, clientsCount, lastSeen }

export type RoomInfo = {
  doc: unknown; // Peut être un Y.Doc ou autre selon usage
  clientsCount: number;
  lastSeen: number; // timestamp ms
};

const rooms: Record<string, RoomInfo> = {};

export function getRoom(roomId: string): RoomInfo | undefined {
  return rooms[roomId];
}

export function setRoom(roomId: string, info: RoomInfo) {
  rooms[roomId] = info;
}

export function removeRoom(roomId: string) {
  delete rooms[roomId];
}

export function getAllRooms(): Record<string, RoomInfo> {
  return rooms;
}

export function updateLastSeen(roomId: string) {
  if (rooms[roomId]) {
    rooms[roomId].lastSeen = Date.now();
  }
}

export function updateClientsCount(roomId: string, count: number) {
  if (rooms[roomId]) {
    rooms[roomId].clientsCount = count;
  }
}
