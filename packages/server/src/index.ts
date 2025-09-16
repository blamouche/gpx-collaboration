import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import type { IncomingMessage } from 'http';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Awareness } from 'y-protocols/awareness';
import { docs as yDocs, getYDoc, setupWSConnection } from 'y-websocket/bin/utils.js';
import * as Y from 'yjs';

const PORT = Number.parseInt(process.env.PORT ?? '1234', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const ROOM_TTL_MINUTES = Number.parseInt(process.env.ROOM_TTL_MINUTES ?? '60', 10);
const ROOM_CREATION_THROTTLE_MS = Number.parseInt(process.env.ROOM_CREATION_THROTTLE_MS ?? '3000', 10);
const WS_PATH = process.env.WS_PATH ?? '/ws';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const ROOM_TTL_MS = ROOM_TTL_MINUTES * 60 * 1000;

const logger = pino({ level: LOG_LEVEL });

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true
    })
  );
}

app.use(pinoHttp({ logger }));

interface RoomContext {
  doc: Y.Doc;
  awareness: Awareness;
  connections: Set<WebSocket>;
  createdAt: number;
  lastActive: number;
  passcode?: string;
  cleanupTimer?: NodeJS.Timeout | null;
}

const rooms = new Map<string, RoomContext>();
const roomCreationRate = new Map<string, number>();
let totalRoomsCreated = 0;

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const normalizedWsPath = normalizePath(WS_PATH);
const wsPathSegments = normalizedWsPath.split('/').filter(Boolean);

const abortUpgrade = (socket: any, statusCode: number, message: string) => {
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  } catch (error) {
    logger.warn({ err: error }, 'failed to write abort response');
  }
  socket.destroy();
};

const cleanupRoom = (roomId: string) => {
  const context = rooms.get(roomId);
  if (!context) {
    return;
  }
  logger.info({ roomId }, 'destroying inactive room');
  context.cleanupTimer = null;
  try {
    context.awareness.destroy();
  } catch (error) {
    logger.warn({ err: error, roomId }, 'failed to destroy awareness');
  }
  try {
    context.doc.destroy();
  } catch (error) {
    logger.warn({ err: error, roomId }, 'failed to destroy ydoc');
  }
  rooms.delete(roomId);
  if ((yDocs as Map<string, { doc: Y.Doc }>).has(roomId)) {
    (yDocs as Map<string, { doc: Y.Doc }>).delete(roomId);
  }
};

const scheduleCleanup = (roomId: string) => {
  const context = rooms.get(roomId);
  if (!context) {
    return;
  }
  if (context.cleanupTimer) {
    clearTimeout(context.cleanupTimer);
  }
  const timeout = setTimeout(() => cleanupRoom(roomId), ROOM_TTL_MS);
  timeout.unref?.();
  context.cleanupTimer = timeout;
};

const extractIp = (req: IncomingMessage) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return req.socket.remoteAddress ?? 'unknown';
};

const canCreateRoom = (ip: string) => {
  const last = roomCreationRate.get(ip) ?? 0;
  const now = Date.now();
  if (now - last < ROOM_CREATION_THROTTLE_MS) {
    return false;
  }
  roomCreationRate.set(ip, now);
  return true;
};

const ensureRoomContext = (roomId: string, passcode?: string) => {
  let context = rooms.get(roomId);
  if (context) {
    return context;
  }
  const doc = getYDoc(roomId);
  const awareness = (doc as unknown as { awareness?: Awareness }).awareness ?? new Awareness(doc);
  (doc as unknown as { awareness?: Awareness }).awareness = awareness;
  context = {
    doc,
    awareness,
    connections: new Set<WebSocket>(),
    createdAt: Date.now(),
    lastActive: Date.now(),
    passcode,
    cleanupTimer: null
  };
  rooms.set(roomId, context);
  totalRoomsCreated += 1;
  return context;
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

app.get('/metrics', (_req, res) => {
  res.type('text/plain').send(
    `rooms_active ${rooms.size}\nrooms_total_created ${totalRoomsCreated}\nrooms_waiting_cleanup ${Array.from(rooms.values()).filter((room) => room.cleanupTimer).length}\n`
  );
});

app.get('/', (_req, res) => {
  res.json({
    message: 'GPX Collaboration realtime server',
    wsPath: normalizedWsPath
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host;
  if (!host) {
    abortUpgrade(socket, 400, 'Bad Request');
    return;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url ?? '/', `http://${host}`);
  } catch (error) {
    logger.warn({ err: error }, 'failed to parse ws url');
    abortUpgrade(socket, 400, 'Bad Request');
    return;
  }

  const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
  const pathMatches = wsPathSegments.every((segment, index) => pathSegments[index] === segment);
  if (!pathMatches) {
    abortUpgrade(socket, 404, 'Not Found');
    return;
  }

  const roomSegment = pathSegments[wsPathSegments.length];
  if (!roomSegment) {
    abortUpgrade(socket, 400, 'Room Required');
    return;
  }

  const roomId = decodeURIComponent(roomSegment).trim();
  if (!/^[a-zA-Z0-9-_]{3,64}$/.test(roomId)) {
    abortUpgrade(socket, 400, 'Invalid Room');
    return;
  }

  const passcodeParam = requestUrl.searchParams.get('k') ?? undefined;
  const sanitizedPasscode = passcodeParam ? passcodeParam.slice(0, 128) : undefined;
  const readOnly = requestUrl.searchParams.get('mode') === 'ro';

  const ip = extractIp(req);
  let context = rooms.get(roomId);
  if (!context) {
    if (!canCreateRoom(ip)) {
      abortUpgrade(socket, 429, 'Rate Limit');
      return;
    }
    context = ensureRoomContext(roomId, sanitizedPasscode);
    logger.info({ roomId }, 'created room');
  } else if (context.passcode && context.passcode !== sanitizedPasscode) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.close(4003, 'passcode-required');
    });
    return;
  } else if (!context.passcode && sanitizedPasscode) {
    context.passcode = sanitizedPasscode;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const room = rooms.get(roomId);
    if (!room) {
      ws.close(1011, 'room-missing');
      return;
    }

    room.connections.add(ws);
    room.lastActive = Date.now();
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    setupWSConnection(ws, req, {
      docName: roomId,
      gc: true,
      awareness: room.awareness,
      pingTimeout: 30000,
      maxDebounceTime: 1000,
      readOnly
    });

    ws.on('close', () => {
      const current = rooms.get(roomId);
      if (!current) {
        return;
      }
      current.connections.delete(ws);
      current.lastActive = Date.now();
      if (current.connections.size === 0) {
        scheduleCleanup(roomId);
      }
    });
  });
});

server.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT, wsPath: normalizedWsPath }, 'server listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'graceful shutdown');
  server.close(() => {
    logger.info('http server closed');
    rooms.forEach((_value, key) => cleanupRoom(key));
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
