import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import type { AwarenessStateFields, CollaborativeFeature, ViewState } from './types';

const resolveWebsocketUrl = () => {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:1234/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const path = import.meta.env.VITE_WS_PATH ?? '/ws';
  return `${protocol}//${host}${path.startsWith('/') ? path : `/${path}`}`.replace(/\/$/, '');
};

const ensureStateStructure = (doc: Y.Doc) => {
  const root = doc.getMap('state');

  let features = root.get('features') as Y.Array<CollaborativeFeature> | undefined;
  if (!features) {
    features = new Y.Array<CollaborativeFeature>();
    root.set('features', features);
  }

  let selected = root.get('selectedFeatureIdByClientId') as Y.Map<string> | undefined;
  if (!selected) {
    selected = new Y.Map<string>();
    root.set('selectedFeatureIdByClientId', selected);
  }

  let view = root.get('view') as Y.Map<ViewState> | undefined;
  if (!view) {
    view = new Y.Map<ViewState>();
    root.set('view', view);
  }

  return { root, features, selected, view };
};

export interface UseRoomConnectionOptions {
  roomId: string;
  passcode?: string;
  readOnly?: boolean;
  undoOrigin?: symbol;
}

export interface RoomConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: WebsocketProvider['awareness'];
  features: Y.Array<CollaborativeFeature>;
  selectionMap: Y.Map<string>;
  viewMap: Y.Map<ViewState>;
  undoManager: Y.UndoManager;
  clientId: number;
}

export const useRoomConnection = ({ roomId, passcode, readOnly, undoOrigin }: UseRoomConnectionOptions) => {
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [awarenessStates, setAwarenessStates] = useState<Map<number, AwarenessStateFields>>(new Map());
  const [lastCloseEvent, setLastCloseEvent] = useState<CloseEvent | null>(null);
  const passcodeRef = useRef(passcode);
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    passcodeRef.current = passcode;
    readOnlyRef.current = readOnly;
  }, [passcode, readOnly]);

  useEffect(() => {
    const doc = new Y.Doc();
    const url = resolveWebsocketUrl();

    const params: Record<string, string> = {};
    if (passcodeRef.current) {
      params.k = passcodeRef.current;
    }
    if (readOnlyRef.current) {
      params.mode = 'ro';
    }

    const provider = new WebsocketProvider(url, roomId, doc, {
      params: Object.keys(params).length ? params : undefined,
      connect: true,
      disableBc: false
    });

    const { features, selected, view } = ensureStateStructure(doc);
    const undoManager = new Y.UndoManager(features, {
      trackedOrigins: undoOrigin ? new Set([undoOrigin]) : undefined
    });

    const handleStatus = (event: { status: 'connected' | 'disconnected' }) => {
      setStatus(event.status);
      if (event.status === 'connected') {
        setLastCloseEvent(null);
      }
    };

    const handleConnectionClose = (event: CloseEvent) => {
      setLastCloseEvent(event);
      setStatus('disconnected');
    };

    const pushAwarenessState = () => {
      const states = provider.awareness.getStates() as Map<number, AwarenessStateFields>;
      setAwarenessStates(new Map(states));
    };

    provider.on('status', handleStatus);
    provider.on('connection-close', handleConnectionClose as never);
    provider.awareness.on('update', pushAwarenessState);
    pushAwarenessState();

    setConnection({
      doc,
      provider,
      awareness: provider.awareness,
      features,
      selectionMap: selected,
      viewMap: view,
      undoManager,
      clientId: provider.awareness.clientID
    });

    return () => {
      provider.off('status', handleStatus);
      provider.off('connection-close', handleConnectionClose as never);
      provider.awareness.off('update', pushAwarenessState);
      provider.destroy();
      doc.destroy();
      setConnection(null);
      setStatus('disconnected');
      setAwarenessStates(new Map());
    };
  }, [roomId]);

  return {
    connection,
    status,
    awarenessStates,
    lastCloseEvent
  } as const;
};
