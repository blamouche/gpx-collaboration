import { WebSocketServer } from 'ws';
import * as http from 'http';
import { setupWSConnection } from 'y-websocket/bin/utils';

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, ws => {
      setupWSConnection(ws, request);
    });
  }
});

export default server;
