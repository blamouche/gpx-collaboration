
import * as React from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import './App.css';

interface HomeProps {
  navigate: (path: string) => void;
}

function Home({ navigate }: HomeProps) {
  const [joinSlug, setJoinSlug] = React.useState('');

  const handleCreate = () => {
    const slug = Math.random().toString(36).substring(2, 8);
    navigate(`/r/${slug}`);
  };

  const handleJoin = () => {
    if (joinSlug.trim()) {
      navigate(`/r/${joinSlug.trim()}`);
    }
  };

  return (
    <div className="home-container">
      <h1>Accueil GPX Collaboration</h1>
      <p>Créez ou rejoignez une session pour éditer des tracés GPX en temps réel.</p>
      <button onClick={handleCreate}>Créer une session</button>
      <div className="home-actions">
        <input
          type="text"
          placeholder="Entrer le code de session"
          value={joinSlug}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJoinSlug(e.target.value)}
        />
        <button onClick={handleJoin} disabled={!joinSlug.trim()}>
          Rejoindre
        </button>
      </div>
    </div>
  );
}

interface RoomProps {
  roomId: string;
}

function Room({ roomId }: RoomProps) {
  const [copied, setCopied] = React.useState(false);
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const [participants, setParticipants] = React.useState(1);
  const [connected, setConnected] = React.useState(false);
  const [hoverLatLng, setHoverLatLng] = React.useState<{ lat: number; lng: number } | null>(null);
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);
  const [geolocationError, setGeolocationError] = React.useState<string | null>(null);
  const [historyState, setHistoryState] = React.useState({ canUndo: false, canRedo: false });
  const [leafletUnavailable, setLeafletUnavailable] = React.useState(false);
  const [editorUnavailable, setEditorUnavailable] = React.useState(false);
  const mapContainerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const drawnItemsRef = React.useRef<any>(null);
  const isRestoringRef = React.useRef(false);
  const leafletRef = React.useRef<any | null>(null);
  const historyRef = React.useRef<{
    undoStack: GeoJSON.FeatureCollection[];
    redoStack: GeoJSON.FeatureCollection[];
  }>({ undoStack: [], redoStack: [] });

  const getLeaflet = React.useCallback(() => {
    if (leafletRef.current) {
      return leafletRef.current;
    }
    if (typeof window === 'undefined') {
      return null;
    }
    const leaflet = (window as Window & { L?: any }).L ?? null;
    if (leaflet) {
      leafletRef.current = leaflet;
    }
    return leaflet;
  }, []);

  const updateHistoryState = React.useCallback(() => {
    const history = historyRef.current;
    setHistoryState({
      canUndo: history.undoStack.length > 1,
      canRedo: history.redoStack.length > 0,
    });
  }, []);

  const captureSnapshot = React.useCallback(() => {
    if (isRestoringRef.current) return;
    const drawnItems = drawnItemsRef.current;
    if (!drawnItems) return;
    const snapshot = drawnItems.toGeoJSON() as GeoJSON.FeatureCollection;
    const history = historyRef.current;
    history.undoStack.push(snapshot);
    history.redoStack = [];
    updateHistoryState();
  }, [updateHistoryState]);

  const restoreSnapshot = React.useCallback((snapshot: GeoJSON.FeatureCollection) => {
    const drawnItems = drawnItemsRef.current;
    const leaflet = leafletRef.current ?? getLeaflet();
    if (!drawnItems || !leaflet) return;
    isRestoringRef.current = true;
    try {
      drawnItems.clearLayers();
      leaflet.geoJSON(snapshot).eachLayer((layer: any) => {
        drawnItems.addLayer(layer);
      });
    } finally {
      isRestoringRef.current = false;
    }
  }, [getLeaflet]);

  const handleUndo = React.useCallback(() => {
    const history = historyRef.current;
    if (history.undoStack.length <= 1) {
      return;
    }
    const current = history.undoStack.pop();
    if (!current) {
      return;
    }
    history.redoStack.push(current);
    const previous = history.undoStack[history.undoStack.length - 1];
    if (previous) {
      restoreSnapshot(previous);
    }
    updateHistoryState();
  }, [restoreSnapshot, updateHistoryState]);

  const handleRedo = React.useCallback(() => {
    const history = historyRef.current;
    if (!history.redoStack.length) {
      return;
    }
    const snapshot = history.redoStack.pop();
    if (!snapshot) {
      return;
    }
    history.undoStack.push(snapshot);
    restoreSnapshot(snapshot);
    updateHistoryState();
  }, [restoreSnapshot, updateHistoryState]);

  const requestLocation = React.useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeolocationError('La géolocalisation n’est pas disponible sur ce navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setGeolocationError(null);
        setUserLocation(coords);
        const map = mapRef.current;
        if (map) {
          const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 0;
          const targetZoom = Math.max(currentZoom || 0, 13);
          if (typeof map.flyTo === 'function') {
            map.flyTo(coords, targetZoom, { duration: 0.75 });
          } else if (typeof map.setView === 'function') {
            map.setView(coords, targetZoom);
          }
        }
      },
      (error) => {
        setGeolocationError(error.message);
      },
      { enableHighAccuracy: true }
    );
  }, []);

  React.useEffect(() => {
    if (!roomId) return;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('ws://localhost:1234', roomId, doc);
    const awareness = provider.awareness;
    const updateCount = () => {
      setParticipants(Array.from(awareness.getStates().values()).length);
    };
    const updateStatus = (event: { status: string }) => {
      setConnected(event.status === 'connected');
    };
    provider.on('status', updateStatus);
    awareness.on('change', updateCount);
    updateCount();
    return () => {
      awareness.off('change', updateCount);
      provider.off('status', updateStatus);
      provider.destroy();
    };
  }, [roomId]);

  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }
    const leaflet = getLeaflet();
    if (!leaflet) {
      setLeafletUnavailable(true);
      return;
    }
    setLeafletUnavailable(false);
    leafletRef.current = leaflet;

    const map = leaflet.map(mapContainerRef.current, {
      preferCanvas: true,
      center: [48.8566, 2.3522],
      zoom: 5,
    });
    if (map.zoomControl && typeof map.zoomControl.setPosition === 'function') {
      map.zoomControl.setPosition('topright');
    }
    mapRef.current = map;

    leaflet
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      })
      .addTo(map);

    const drawnItems = leaflet.featureGroup();
    drawnItems.addTo(map);
    drawnItemsRef.current = drawnItems;

    if (map.pm && typeof map.pm.addControls === 'function') {
      setEditorUnavailable(false);
      map.pm.setGlobalOptions({
        layerGroup: drawnItems,
        continueDrawing: false,
      });
      if (typeof map.pm.setPathOptions === 'function') {
        map.pm.setPathOptions({
          color: '#1d4ed8',
          weight: 3,
        });
      }
      map.pm.addControls({
        position: 'topleft',
        drawCircle: false,
        drawCircleMarker: false,
        drawRectangle: false,
        drawPolygon: false,
        drawText: false,
        cutPolygon: false,
        dragMode: false,
        rotateMode: false,
        drawMarker: true,
        drawPolyline: true,
        editMode: true,
        removalMode: true,
      });
    } else {
      setEditorUnavailable(true);
    }

    historyRef.current = {
      undoStack: [drawnItems.toGeoJSON() as GeoJSON.FeatureCollection],
      redoStack: [],
    };
    updateHistoryState();

    const handleMouseMove = (event: any) => {
      if (event && event.latlng) {
        setHoverLatLng({ lat: event.latlng.lat, lng: event.latlng.lng });
      }
    };

    const handleLayerChange = () => {
      captureSnapshot();
    };

    map.on('mousemove', handleMouseMove);
    if (map.pm) {
      map.on('pm:create', handleLayerChange);
      map.on('pm:remove', handleLayerChange);
      map.on('pm:drawend', handleLayerChange);
    }
    if (typeof drawnItems.on === 'function') {
      drawnItems.on('pm:edit', handleLayerChange);
      drawnItems.on('pm:dragend', handleLayerChange);
    }

    requestLocation();

    return () => {
      map.off('mousemove', handleMouseMove);
      if (map.pm) {
        map.off('pm:create', handleLayerChange);
        map.off('pm:remove', handleLayerChange);
        map.off('pm:drawend', handleLayerChange);
      }
      if (typeof drawnItems.off === 'function') {
        drawnItems.off('pm:edit', handleLayerChange);
        drawnItems.off('pm:dragend', handleLayerChange);
      }
      setHoverLatLng(null);
      map.remove();
      mapRef.current = null;
      drawnItemsRef.current = null;
    };
  }, [captureSnapshot, getLeaflet, requestLocation, updateHistoryState]);

  const handleCopy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const latLngLabel = hoverLatLng
    ? `${hoverLatLng.lat.toFixed(5)}°, ${hoverLatLng.lng.toFixed(5)}°`
    : 'Survolez la carte pour afficher les coordonnées';

  const statusMessages: { text: string; className?: string }[] = [];
  if (userLocation) {
    statusMessages.push({
      text: `Ma position : ${userLocation.lat.toFixed(5)}°, ${userLocation.lng.toFixed(5)}°`,
      className: 'latlng-display',
    });
  }
  if (geolocationError) {
    statusMessages.push({ text: geolocationError, className: 'geo-error' });
  }
  if (leafletUnavailable) {
    statusMessages.push({
      text: 'Leaflet n’est pas chargé. Les fonctionnalités cartographiques sont indisponibles.',
      className: 'geo-error',
    });
  } else if (editorUnavailable) {
    statusMessages.push({
      text: 'Outils d’édition Leaflet-Geoman indisponibles.',
      className: 'geo-error',
    });
  }

  return (
    <div className="room-container">
      <div ref={mapContainerRef} className="map-container" />

      <div className="room-overlay room-overlay--top-left">
        <h1>Session : {roomId}</h1>
        <div className="room-status">
          <span>Connexion Yjs : {connected ? '✅ Connecté' : '❌ Déconnecté'}</span>
          <span>Participants : <strong>{participants}</strong></span>
        </div>
        <div className="room-toolbar">
          <button onClick={handleCopy}>Copier l’URL de la session</button>
          {copied && <span style={{ color: '#16a34a', alignSelf: 'center' }}>Copié !</span>}
        </div>
      </div>

      <div className="room-overlay room-overlay--top-right">
        <div className="room-toolbar">
          <button onClick={handleUndo} disabled={!historyState.canUndo}>
            Annuler
          </button>
          <button onClick={handleRedo} disabled={!historyState.canRedo}>
            Rétablir
          </button>
          <button className="secondary" onClick={requestLocation}>
            Centrer sur ma position
          </button>
        </div>
      </div>

      <div className="room-overlay room-overlay--bottom-left">
        <span className="latlng-display">{latLngLabel}</span>
      </div>

      {statusMessages.length > 0 && (
        <div className="room-overlay room-overlay--bottom-right">
          {statusMessages.map((message, index) => (
            <span key={index} className={message.className ?? ''}>
              {message.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [currentPath, setCurrentPath] = React.useState(() => {
    if (typeof window === 'undefined') {
      return '/';
    }
    return window.location.pathname || '/';
  });

  const navigate = React.useCallback((path: string) => {
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
    }
    setCurrentPath(path);
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const isRoomPath = /^\/r\/[^/]+$/.test(currentPath);
    if (!isRoomPath && currentPath !== '/') {
      window.history.replaceState({}, '', '/');
      setCurrentPath('/');
    }
  }, [currentPath]);

  const matchRoom = currentPath.match(/^\/r\/([^/]+)$/);
  if (matchRoom) {
    return <Room roomId={matchRoom[1]} />;
  }

  return <Home navigate={navigate} />;
}

export default App;
