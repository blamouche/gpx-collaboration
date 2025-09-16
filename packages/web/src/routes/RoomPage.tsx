import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import L, { CircleMarker, LeafletMouseEvent, LeafletEventHandlerFn, LatLng } from 'leaflet';
import 'leaflet-geoman-free';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';
import { gpx as gpxToGeoJSON } from 'togeojson';
import togpx from '@tmcw/togpx';
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonObject, LineString, Point } from 'geojson';

import type { AwarenessStateFields, CollaborativeFeature, ViewState } from '../collaboration/types';
import { useRoomConnection } from '../collaboration/useRoomConnection';

const DEFAULT_CENTER: [number, number] = [46.7111, 1.7191];
const DEFAULT_ZOOM = 6;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const LINE_STYLE: L.PathOptions = {
  color: '#1971c2',
  weight: 4,
  opacity: 0.95,
  lineCap: 'round',
  lineJoin: 'round'
};
const POINT_STYLE: L.PathOptions = {
  color: '#ffffff',
  weight: 2,
  opacity: 1,
  fillColor: '#1971c2',
  fillOpacity: 0.95
};

const HIGHLIGHT_WEIGHT = 7;

const throttle = <T extends (...args: never[]) => void>(fn: T, wait: number) => {
  let last = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let trailing: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      last = now;
      fn(...args);
    } else {
      trailing = args;
      if (!timeout) {
        timeout = setTimeout(() => {
          timeout = null;
          last = Date.now();
          if (trailing) {
            fn(...trailing);
            trailing = null;
          }
        }, wait - (now - last));
      }
    }
  };
};

const roundCoordinate = (value: number) => Number(value.toFixed(6));

const latLngToPoint = (latlng: L.LatLng): [number, number] => [roundCoordinate(latlng.lng), roundCoordinate(latlng.lat)];

const geometryToLatLngs = (geometry: LineString | Point) => {
  if (geometry.type === 'LineString') {
    return geometry.coordinates.map(([lng, lat]) => new L.LatLng(lat, lng));
  }
  return [new L.LatLng(geometry.coordinates[1], geometry.coordinates[0])];
};

const createCursorIcon = (name: string, color: string) =>
  L.divIcon({
    className: 'cursor-marker',
    html: `<div style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:${color};">
      <span style="display:inline-flex;width:10px;height:10px;border-radius:999px;background:${color};box-shadow:0 0 0 2px rgba(255,255,255,0.6);"></span>
      <span style="padding:2px 6px;border-radius:999px;background:rgba(255,255,255,0.85);color:#1f2933;">${name}</span>
    </div>`
  });

const normalizeFeature = (feature: CollaborativeFeature): CollaborativeFeature => {
  const geometry = feature.geometry;
  if (geometry.type === 'LineString') {
    geometry.coordinates = geometry.coordinates.map(([lng, lat]) => [roundCoordinate(lng), roundCoordinate(lat)]);
  }
  if (geometry.type === 'Point') {
    geometry.coordinates = [roundCoordinate(geometry.coordinates[0]), roundCoordinate(geometry.coordinates[1])];
  }
  return feature;
};

const ensureFeature = (feature: GeoJsonFeature): CollaborativeFeature[] => {
  const id = nanoid();
  if (feature.geometry?.type === 'LineString') {
    return [
      normalizeFeature({
        ...(feature as GeoJsonFeature<LineString>),
        id,
        properties: {
          kind: 'line',
          name: feature.properties?.name,
          ...feature.properties
        }
      } as CollaborativeFeature)
    ];
  }

  if (feature.geometry?.type === 'Point') {
    return [
      normalizeFeature({
        ...(feature as GeoJsonFeature<Point>),
        id,
        properties: {
          kind: 'point',
          name: feature.properties?.name,
          ...feature.properties
        }
      } as CollaborativeFeature)
    ];
  }

  if (feature.geometry?.type === 'MultiLineString') {
    const multi = feature.geometry.coordinates;
    return multi.map((coords) =>
      normalizeFeature({
        ...(feature as GeoJsonFeature<LineString>),
        geometry: { type: 'LineString', coordinates: coords },
        id: nanoid(),
        properties: {
          kind: 'line',
          name: feature.properties?.name,
          ...feature.properties
        }
      } as CollaborativeFeature)
    );
  }

  if (feature.geometry?.type === 'MultiPoint') {
    const multi = feature.geometry.coordinates;
    return multi.map((coord) =>
      normalizeFeature({
        ...(feature as GeoJsonFeature<Point>),
        geometry: { type: 'Point', coordinates: coord },
        id: nanoid(),
        properties: {
          kind: 'point',
          name: feature.properties?.name,
          ...feature.properties
        }
      } as CollaborativeFeature)
    );
  }

  return [];
};

const buildGeoJsonCollection = (features: CollaborativeFeature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: features.map((feature) => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: { ...feature.properties, id: feature.id },
    id: feature.id
  }))
});

type LayerEventHandlers = {
  onEdit: LeafletEventHandlerFn;
  onVertexAdded: LeafletEventHandlerFn;
  onVertexRemoved: LeafletEventHandlerFn;
  onDragEnd: LeafletEventHandlerFn;
};

type Participant = {
  clientId: number;
  name: string;
  color: string;
  isSelf: boolean;
};

type SelectionState = Map<string, string>;

const getLocalUser = () => {
  if (typeof window === 'undefined') {
    return { id: nanoid(), name: 'Invité', color: '#1971c2' };
  }

  const stored = window.localStorage.getItem('gpx-collab-user');
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { id: string; name: string; color: string };
      if (parsed?.id && parsed?.name && parsed?.color) {
        return parsed;
      }
    } catch (error) {
      window.localStorage.removeItem('gpx-collab-user');
    }
  }

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const hue = Math.floor(Math.random() * 360);
  const color = `hsl(${hue}, 70%, 50%)`;
  const user = { id: nanoid(), name: `Invité-${randomSuffix}`, color };
  window.localStorage.setItem('gpx-collab-user', JSON.stringify(user));
  return user;
};

const getRoomUrl = () => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.href;
};

const RoomPage = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const passcode = searchParams.get('k') ?? undefined;
  const readOnly = searchParams.get('mode') === 'ro';
  const undoOrigin = useMemo(() => Symbol('local-edit'), []);

  const { connection, status, awarenessStates, lastCloseEvent } = useRoomConnection({
    roomId: roomId ?? '',
    passcode,
    readOnly,
    undoOrigin
  });

  const user = useMemo(() => getLocalUser(), []);
  const [features, setFeatures] = useState<CollaborativeFeature[]>([]);
  const [selectionState, setSelectionState] = useState<SelectionState>(new Map());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [latLngIndicator, setLatLngIndicator] = useState<LatLng | null>(null);
  const [sharedView, setSharedView] = useState<ViewState | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.Layer>>(new Map());
  const layerHandlersRef = useRef<Map<string, LayerEventHandlers>>(new Map());
  const highlightsRef = useRef<Map<string, L.Layer>>(new Map());
  const cursorMarkersRef = useRef<Map<number, L.Marker>>(new Map());
  const featureCacheRef = useRef<Map<string, CollaborativeFeature>>(new Map());
  const suppressLocalEventsRef = useRef(false);
  const localSelectionRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = roomId ? `Session GPX • ${roomId}` : 'GPX Collaboration';
    return () => {
      document.title = 'GPX Collaboration';
    };
  }, [roomId]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    connection.awareness.setLocalStateField('user', user);
    return () => {
      connection.awareness.setLocalState(null);
    };
  }, [connection, user]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    const syncSelection = () => {
      const entries = Array.from(connection.selectionMap.entries()) as [string, string][];
      setSelectionState(new Map(entries));
    };

    const observer = () => syncSelection();
    connection.selectionMap.observe(observer);
    syncSelection();
    return () => {
      connection.selectionMap.unobserve(observer);
    };
  }, [connection]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    const syncView = () => {
      const current = connection.viewMap.get('current') as ViewState | undefined;
      setSharedView(current ?? null);
    };
    const observer = () => syncView();
    connection.viewMap.observe(observer);
    syncView();
    return () => {
      connection.viewMap.unobserve(observer);
    };
  }, [connection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !connection || readOnly) {
      return;
    }

    const updateParticipants = () => {
      const list: Participant[] = [];
      awarenessStates.forEach((state, clientId) => {
        if (!state?.user) {
          return;
        }
        list.push({
          clientId,
          name: state.user.name,
          color: state.user.color,
          isSelf: clientId === connection.clientId
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setParticipants(list);
    };

    updateParticipants();
  }, [awarenessStates, connection]);

  const applyBaseStyle = useCallback((layer: L.Layer, feature: CollaborativeFeature) => {
    if ((layer as CircleMarker).setStyle && feature.geometry.type === 'Point') {
      (layer as CircleMarker).setStyle(POINT_STYLE);
      (layer as CircleMarker).setRadius(6);
    }
    if ((layer as L.Polyline).setStyle && feature.geometry.type === 'LineString') {
      (layer as L.Polyline).setStyle(LINE_STYLE);
    }
  }, []);

  const createLayerForFeature = useCallback(
    (feature: CollaborativeFeature) => {
      const map = mapRef.current;
      if (!map) {
        return null;
      }

      let createdLayer: L.Layer | null = null;
      L.geoJSON(feature as GeoJsonObject, {
        style: () => LINE_STYLE,
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { ...POINT_STYLE, radius: 6 })
      }).eachLayer((layer) => {
        createdLayer = layer;
      });

      if (!createdLayer) {
        return null;
      }

      (createdLayer as any).featureId = feature.id;
      (createdLayer as any).feature = feature;
      createdLayer.addTo(map);
      applyBaseStyle(createdLayer, feature);
      map.pm.addLayersToDrawnItems(createdLayer);
      map.pm.setGlobalOptions({ allowSelfIntersection: false });
      return createdLayer;
    },
    [applyBaseStyle]
  );

  const updateLayerGeometry = useCallback(
    (layer: L.Layer, feature: CollaborativeFeature) => {
      if (feature.geometry.type === 'LineString' && layer instanceof L.Polyline) {
        layer.setLatLngs(feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]));
      }
      if (feature.geometry.type === 'Point' && layer instanceof L.CircleMarker) {
        layer.setLatLng(new L.LatLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]));
      }
      (layer as any).feature = feature;
      applyBaseStyle(layer, feature);
    },
    [applyBaseStyle]
  );

  const detachLayerHandlers = useCallback((featureId: string) => {
    const layer = layersRef.current.get(featureId);
    const handlers = layerHandlersRef.current.get(featureId);
    if (layer && handlers) {
      layer.off('pm:edit', handlers.onEdit);
      layer.off('pm:vertexadded', handlers.onVertexAdded);
      layer.off('pm:vertexremoved', handlers.onVertexRemoved);
      layer.off('pm:markerdragend', handlers.onDragEnd);
      layer.off('pm:dragend', handlers.onDragEnd);
      layerHandlersRef.current.delete(featureId);
    }
  }, []);

  const layerToFeature = useCallback(
    (layer: L.Layer, featureId: string, kind: 'line' | 'point'): CollaborativeFeature => {
      const geo = layer.toGeoJSON() as GeoJsonFeature<LineString | Point>;
      const base: CollaborativeFeature = {
        ...(geo as CollaborativeFeature),
        id: featureId,
        properties: {
          kind,
          name: geo.properties?.name,
          ...geo.properties
        }
      };
      return normalizeFeature(base);
    },
    []
  );

  const commitFeatureUpdate = useCallback(
    (feature: CollaborativeFeature) => {
      if (!connection) {
        return;
      }
      const list = connection.features.toJSON() as CollaborativeFeature[];
      const index = list.findIndex((item) => item.id === feature.id);
      if (index === -1) {
        return;
      }
      connection.doc.transact(() => {
        connection.features.delete(index, 1);
        connection.features.insert(index, [feature]);
      }, undoOrigin);
    },
    [connection, undoOrigin]
  );

  const attachLayerHandlers = useCallback(
    (layer: L.Layer, feature: CollaborativeFeature) => {
      const featureId = feature.id;
      detachLayerHandlers(featureId);
      const editHandler = throttle(() => {
        if (!connection) {
          return;
        }
        const updated = layerToFeature(layer, featureId, feature.properties.kind);
        featureCacheRef.current.set(featureId, updated);
        commitFeatureUpdate(updated);
      }, 120);

      const handlers: LayerEventHandlers = {
        onEdit: () => editHandler(),
        onVertexAdded: () => editHandler(),
        onVertexRemoved: () => editHandler(),
        onDragEnd: () => editHandler()
      };

      layer.on('pm:edit', handlers.onEdit);
      layer.on('pm:vertexadded', handlers.onVertexAdded);
      layer.on('pm:vertexremoved', handlers.onVertexRemoved);
      layer.on('pm:markerdragend', handlers.onDragEnd);
      layer.on('pm:dragend', handlers.onDragEnd);

      layerHandlersRef.current.set(featureId, handlers);
    },
    [commitFeatureUpdate, connection, detachLayerHandlers, layerToFeature]
  );

  const syncLayers = useCallback(
    (items: CollaborativeFeature[]) => {
      const map = mapRef.current;
      if (!map) {
        return;
      }
      const seen = new Set<string>();
      items.forEach((feature) => {
        seen.add(feature.id);
        featureCacheRef.current.set(feature.id, feature);
        const existing = layersRef.current.get(feature.id);
        if (existing) {
          updateLayerGeometry(existing, feature);
        } else {
          const newLayer = createLayerForFeature(feature);
          if (newLayer) {
            layersRef.current.set(feature.id, newLayer);
            attachLayerHandlers(newLayer, feature);
          }
        }
      });

      Array.from(layersRef.current.keys()).forEach((featureId) => {
        if (!seen.has(featureId)) {
          const layer = layersRef.current.get(featureId);
          if (layer) {
            detachLayerHandlers(featureId);
            suppressLocalEventsRef.current = true;
            map.removeLayer(layer);
            suppressLocalEventsRef.current = false;
          }
          layersRef.current.delete(featureId);
          featureCacheRef.current.delete(featureId);
        }
      });
    },
    [attachLayerHandlers, createLayerForFeature, detachLayerHandlers, updateLayerGeometry]
  );

  useEffect(() => {
    if (!connection) {
      return;
    }
    const observer = () => {
      const list = connection.features.toJSON() as CollaborativeFeature[];
      setFeatures(list);
      syncLayers(list);
    };
    connection.features.observe(observer);
    observer();
    return () => {
      connection.features.unobserve(observer);
    };
  }, [connection, syncLayers]);

  const refreshSelectionHighlights = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    highlightsRef.current.forEach((layer) => {
      map.removeLayer(layer);
    });
    highlightsRef.current.clear();

    selectionState.forEach((featureId, clientKey) => {
      const baseLayer = layersRef.current.get(featureId);
      const sourceFeature = featureCacheRef.current.get(featureId);
      const participant = awarenessStates.get(Number(clientKey)) as AwarenessStateFields | undefined;
      if (!baseLayer || !participant?.user || !sourceFeature) {
        return;
      }
      const color = participant.user.color;
      let highlight: L.Layer | null = null;
      L.geoJSON(sourceFeature as GeoJsonObject, {
        style: () => ({
          color,
          weight: HIGHLIGHT_WEIGHT,
          opacity: 0.8,
          dashArray: '6,4'
        }),
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, {
            color,
            fillColor: color,
            fillOpacity: 0.3,
            radius: 9,
            opacity: 0.9,
            weight: 3
          })
      }).eachLayer((layer) => {
        highlight = layer;
      });
      if (highlight) {
        highlight!.addTo(map);
        (highlight as any).options.interactive = false;
        highlightsRef.current.set(clientKey, highlight!);
      }
    });
  }, [awarenessStates, selectionState]);

  useEffect(() => {
    refreshSelectionHighlights();
  }, [refreshSelectionHighlights, features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const seen = new Set<number>();

    awarenessStates.forEach((state, clientId) => {
      if (!state?.cursor) {
        return;
      }
      seen.add(clientId);
      const { cursor, user: participant } = state;
      const latlng = new L.LatLng(cursor.lat, cursor.lng);
      let marker = cursorMarkersRef.current.get(clientId);
      if (!marker) {
        marker = L.marker(latlng, {
          icon: createCursorIcon(participant?.name ?? `User-${clientId}`, participant?.color ?? '#ffa94d'),
          interactive: false
        });
        marker.addTo(map);
        cursorMarkersRef.current.set(clientId, marker);
      } else {
        marker.setLatLng(latlng);
      }
    });

    Array.from(cursorMarkersRef.current.entries()).forEach(([clientId, marker]) => {
      if (!seen.has(clientId)) {
        map.removeLayer(marker);
        cursorMarkersRef.current.delete(clientId);
      }
    });
  }, [awarenessStates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !connection) {
      return;
    }

    const handleMouseMove = (event: LeafletMouseEvent) => {
      setLatLngIndicator(event.latlng);
      connection.awareness.setLocalStateField('cursor', {
        lat: roundCoordinate(event.latlng.lat),
        lng: roundCoordinate(event.latlng.lng),
        updatedAt: Date.now()
      });
    };

    const handleMouseOut = () => {
      setLatLngIndicator(null);
      connection.awareness.setLocalStateField('cursor', undefined);
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseOut);

    const container = map.getContainer();

    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDragActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setIsDragActive(true);
    };

    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      if (event.target === container) {
        setIsDragActive(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setIsDragActive(false);
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        handleImportFiles(files);
      }
    };

    container.addEventListener('dragenter', onDragEnter);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseOut);
      connection.awareness.setLocalStateField('cursor', undefined);
      container.removeEventListener('dragenter', onDragEnter);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
    };
  }, [connection, handleImportFiles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !connection) {
      return;
    }

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawPolyline: !readOnly,
      drawCircle: false,
      drawCircleMarker: !readOnly,
      drawPolygon: false,
      drawRectangle: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: !readOnly,
      rotateMode: false,
      editMode: !readOnly,
      measureControl: true
    });

    if (map.pm.setLang) {
      map.pm.setLang('fr');
    }
    map.pm.setPathOptions({ ...LINE_STYLE, fillColor: '#228be6', fillOpacity: 0.4 });

    const handleCreate = (event: any) => {
      if (!connection) {
        return;
      }
      const layer = event.layer as L.Layer;
      if (readOnly) {
        suppressLocalEventsRef.current = true;
        map.removeLayer(layer);
        suppressLocalEventsRef.current = false;
        return;
      }
      const kind: 'line' | 'point' = layer instanceof L.CircleMarker ? 'point' : 'line';
      const feature: CollaborativeFeature = normalizeFeature(
        layerToFeature(layer, nanoid(), kind)
      );
      (layer as any).featureId = feature.id;
      (layer as any).feature = feature;
      featureCacheRef.current.set(feature.id, feature);
      layersRef.current.set(feature.id, layer);
      attachLayerHandlers(layer, feature);
      connection.doc.transact(() => {
        connection.features.push([feature]);
      }, undoOrigin);
      localSelectionRef.current = feature.id;
      connection.selectionMap.set(String(connection.clientId), feature.id);
    };

    const handleRemove = (event: any) => {
      if (!connection || suppressLocalEventsRef.current || readOnly) {
        return;
      }
      const layer = event.layer as L.Layer;
      const featureId: string | undefined = (layer as any).featureId;
      if (!featureId) {
        return;
      }
      const list = connection.features.toJSON() as CollaborativeFeature[];
      const index = list.findIndex((item) => item.id === featureId);
      if (index !== -1) {
        connection.doc.transact(() => {
          connection.features.delete(index, 1);
        }, undoOrigin);
      }
    };

    const handleSelect = (event: any) => {
      if (!connection) {
        return;
      }
      const featureId: string | undefined = (event.layer as any).featureId;
      if (!featureId) {
        return;
      }
      localSelectionRef.current = featureId;
      connection.selectionMap.set(String(connection.clientId), featureId);
    };

    const handleUnselect = (event: any) => {
      if (!connection) {
        return;
      }
      const featureId: string | undefined = (event.layer as any).featureId;
      if (!featureId) {
        return;
      }
      if (localSelectionRef.current === featureId) {
        localSelectionRef.current = null;
        connection.selectionMap.delete(String(connection.clientId));
      }
    };

    map.on('pm:create', handleCreate);
    map.on('pm:remove', handleRemove);
    map.on('pm:select', handleSelect);
    map.on('pm:unselect', handleUnselect);

    return () => {
      map.off('pm:create', handleCreate);
      map.off('pm:remove', handleRemove);
      map.off('pm:select', handleSelect);
      map.off('pm:unselect', handleUnselect);
    };
  }, [attachLayerHandlers, connection, layerToFeature, readOnly, undoOrigin]);

  const handleImportFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!connection) {
        toast.error('Connexion non établie.');
        return;
      }
      if (readOnly) {
        toast.error('Session en lecture seule.');
        return;
      }
      const list = Array.from(files);
      let importedFeatures: CollaborativeFeature[] = [];

      for (const file of list) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`“${file.name}” est trop volumineux (max 10 Mo).`);
          continue;
        }
        try {
          const text = await file.text();
          const parser = new DOMParser();
          const xml = parser.parseFromString(text, 'application/xml');
          if (xml.getElementsByTagName('parsererror').length > 0) {
            throw new Error('GPX invalide');
          }
          const geojson = gpxToGeoJSON(xml) as FeatureCollection;
          geojson.features.forEach((feature) => {
            importedFeatures = importedFeatures.concat(ensureFeature(feature));
          });
        } catch (error) {
          console.error(error);
          toast.error(`Impossible d’importer ${file.name}`);
        }
      }

      if (importedFeatures.length === 0) {
        return;
      }

      connection.doc.transact(() => {
        connection.features.push(importedFeatures);
      }, undoOrigin);
      toast.success(`${importedFeatures.length} élément(s) importé(s).`);
    },
    [connection, readOnly, undoOrigin]
  );

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files?.length) {
        handleImportFiles(files);
      }
    },
    [handleImportFiles]
  );

  const handleExport = useCallback(() => {
    if (!features.length) {
      toast.error('Aucune donnée à exporter.');
      return;
    }
    const collection = buildGeoJsonCollection(features);
    const gpxContent = togpx(collection, { creator: 'GPX Collaboration' });
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${roomId ?? 'gpx'}.gpx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Export GPX généré.');
  }, [features, roomId]);

  const handleCopyLink = useCallback(() => {
    const url = getRoomUrl();
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Lien copié dans le presse-papiers.'))
      .catch(() => toast.error('Impossible de copier le lien.'));
  }, []);

  const toggleDrawLine = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (readOnly) {
      toast.error('Session en lecture seule.');
      return;
    }
    if (map.pm.disableGlobalEditMode) {
      map.pm.disableGlobalEditMode();
    }
    if (map.pm.disableGlobalRemovalMode) {
      map.pm.disableGlobalRemovalMode();
    }
    if (map.pm.disableDraw) {
      map.pm.disableDraw('CircleMarker');
    }
    map.pm.enableDraw('Line', { snapDistance: 20, allowSelfIntersection: false });
  }, [readOnly]);

  const toggleDrawPoint = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (readOnly) {
      toast.error('Session en lecture seule.');
      return;
    }
    if (map.pm.disableGlobalEditMode) {
      map.pm.disableGlobalEditMode();
    }
    if (map.pm.disableGlobalRemovalMode) {
      map.pm.disableGlobalRemovalMode();
    }
    if (map.pm.disableDraw) {
      map.pm.disableDraw('Line');
    }
    map.pm.enableDraw('CircleMarker', { snappable: false });
  }, [readOnly]);

  const toggleEditMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (readOnly) {
      toast.error('Session en lecture seule.');
      return;
    }
    if (map.pm.disableDraw) {
      map.pm.disableDraw('Line');
      map.pm.disableDraw('CircleMarker');
    }
    if (map.pm.globalEditModeEnabled && map.pm.globalEditModeEnabled()) {
      map.pm.disableGlobalEditMode();
    } else {
      map.pm.enableGlobalEditMode({ allowSelfIntersection: false });
    }
  }, [readOnly]);

  const toggleRemovalMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (readOnly) {
      toast.error('Session en lecture seule.');
      return;
    }
    if (map.pm.disableDraw) {
      map.pm.disableDraw('Line');
      map.pm.disableDraw('CircleMarker');
    }
    if (map.pm.globalRemovalModeEnabled && map.pm.globalRemovalModeEnabled()) {
      map.pm.disableGlobalRemovalMode();
    } else {
      map.pm.enableGlobalRemovalMode();
    }
  }, [readOnly]);

  const handleUndo = useCallback(() => {
    if (readOnly) {
      return;
    }
    connection?.undoManager.undo();
  }, [connection, readOnly]);

  const handleRedo = useCallback(() => {
    if (readOnly) {
      return;
    }
    connection?.undoManager.redo();
  }, [connection, readOnly]);

  const focusOnFeatures = useCallback(() => {
    const map = mapRef.current;
    if (!map || features.length === 0) {
      return;
    }
    const collection = L.geoJSON(buildGeoJsonCollection(features));
    const bounds = collection.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1));
    }
  }, [features]);

  const applySharedView = useCallback(() => {
    const map = mapRef.current;
    if (!map || !sharedView) {
      return;
    }
    if (sharedView.bounds) {
      const bounds = L.latLngBounds(
        [sharedView.bounds[0][0], sharedView.bounds[0][1]],
        [sharedView.bounds[1][0], sharedView.bounds[1][1]]
      );
      map.fitBounds(bounds);
    } else {
      map.setView([sharedView.center[0], sharedView.center[1]], sharedView.zoom);
    }
  }, [sharedView]);

  const shareView = useCallback(
    (options?: { silent?: boolean }) => {
      const map = mapRef.current;
      if (!map || !connection) {
        return;
      }
      if (readOnly) {
        if (!options?.silent) {
          toast.error('Session en lecture seule.');
        }
        return;
      }
      const center = map.getCenter();
      const bounds = map.getBounds();
      const state: ViewState = {
        center: [roundCoordinate(center.lat), roundCoordinate(center.lng)],
        zoom: map.getZoom(),
        bounds: [
          [roundCoordinate(bounds.getSouthWest().lat), roundCoordinate(bounds.getSouthWest().lng)],
          [roundCoordinate(bounds.getNorthEast().lat), roundCoordinate(bounds.getNorthEast().lng)]
        ],
        suggestedBy: connection.clientId,
        updatedAt: Date.now()
      };
      connection.doc.transact(() => {
        connection.viewMap.set('current', state);
      }, undoOrigin);
      if (!options?.silent) {
        toast.success('Vue partagée avec la session.');
      }
    },
    [connection, readOnly, undoOrigin]
  );

  const shareCurrentView = useCallback(() => {
    shareView();
  }, [shareView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !connection || readOnly) {
      return;
    }
    const throttledShare = throttle(() => shareView({ silent: true }), 2000);
    const handleMoveEnd = () => {
      throttledShare();
    };
    map.on('moveend', handleMoveEnd);
    return () => {
      map.off('moveend', handleMoveEnd);
    };
  }, [connection, readOnly, shareView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        handleUndo();
        return;
      }
      if ((event.ctrlKey && event.key.toLowerCase() === 'y') || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleDrawLine();
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        toggleDrawPoint();
        return;
      }
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        toggleEditMode();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        toggleRemovalMode();
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      if (event.key.toLowerCase() === 'x') {
        event.preventDefault();
        handleExport();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleExport, handleRedo, handleUndo, toggleDrawLine, toggleDrawPoint, toggleEditMode, toggleRemovalMode]);

  useEffect(() => {
    if (lastCloseEvent?.code === 4003) {
      toast.error('Accès refusé : code secret requis ou invalide.');
    }
  }, [lastCloseEvent]);

  useEffect(() => {
    if (!connection) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const handleRemoveFeature = (event: any) => {
      const featureId: string | undefined = (event.layer as any).featureId;
      if (featureId && selectionState.get(String(connection.clientId)) === featureId) {
        connection.selectionMap.delete(String(connection.clientId));
      }
    };
    map.on('pm:remove', handleRemoveFeature);
    return () => {
      map.off('pm:remove', handleRemoveFeature);
    };
  }, [connection, selectionState]);

  if (!roomId) {
    return (
      <div className="home-container">
        <div className="home-card">
          <h1>Session introuvable</h1>
          <p>Le lien fourni ne correspond à aucune session. Retour à l’accueil.</p>
          <button type="button" onClick={() => navigate('/')}>Retour</button>
        </div>
      </div>
    );
  }

  const suggestedBy = sharedView?.suggestedBy ?? null;
  const suggestedByName = suggestedBy ? awarenessStates.get(suggestedBy)?.user?.name : null;

  return (
    <div className="room-container">
      <div className="map-wrapper">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={2}
          maxZoom={19}
          attributionControl
          style={{ height: '100%', width: '100%' }}
          whenCreated={(map) => {
            mapRef.current = map;
          }}
        >
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
        {isDragActive ? <div className="drag-overlay">Déposez un fichier GPX pour l’importer</div> : null}
      </div>

      <div className="map-overlay">
        <div className="toolbar" role="toolbar" aria-label="Outils de dessin">
          <div className="toolbar-row">
            <button type="button" onClick={toggleDrawLine} title="Dessiner une ligne (D)" disabled={readOnly}>
              Ligne
            </button>
            <button type="button" onClick={toggleDrawPoint} title="Dessiner un point (P)" disabled={readOnly}>
              Point
            </button>
            <button type="button" onClick={toggleEditMode} title="Modifier (E)" disabled={readOnly}>
              Éditer
            </button>
            <button type="button" onClick={toggleRemovalMode} title="Supprimer (Del)" disabled={readOnly}>
              Supprimer
            </button>
          </div>
          <div className="toolbar-row">
            <button type="button" onClick={handleUndo} title="Annuler (Ctrl+Z)" disabled={readOnly}>
              Undo
            </button>
            <button type="button" onClick={handleRedo} title="Rétablir (Ctrl+Y)" disabled={readOnly}>
              Redo
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Importer GPX (G)"
              disabled={readOnly}
            >
              Import GPX
            </button>
            <button type="button" onClick={handleExport} title="Exporter GPX (X)">
              Export GPX
            </button>
          </div>
          <div className="toolbar-row">
            <button type="button" onClick={focusOnFeatures}>Centrer</button>
            <button type="button" onClick={handleCopyLink}>Copier le lien</button>
            <button type="button" onClick={shareCurrentView} disabled={readOnly}>
              Partager ma vue
            </button>
          </div>
        </div>
        <div className="session-banner">
          <span>Session&nbsp;: <strong>{roomId}</strong></span>
          <span>•&nbsp;{status === 'connected' ? 'Connecté' : 'Connexion…'}</span>
          {readOnly ? <span>•&nbsp;Lecture seule</span> : null}
        </div>
      </div>

      <div className="presence-panel" aria-live="polite">
        <div className="presence-card">
          <div className="presence-header">
            <strong>Participants</strong>
            <span>{participants.length}</span>
          </div>
          <div className="presence-list">
            {participants.map((participant) => (
              <div className="presence-item" key={participant.clientId}>
                <span className="avatar" style={{ background: participant.color }}>
                  {participant.name.substring(0, 2).toUpperCase()}
                </span>
                <span>
                  {participant.name}
                  {participant.isSelf ? ' (vous)' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="session-banner">
          <span>Session éphémère&nbsp;— rien n’est sauvegardé.</span>
        </div>
        {suggestedBy && suggestedBy !== connection?.clientId && sharedView ? (
          <div className="view-suggestion">
            <span>Vue proposée par {suggestedByName ?? 'un collaborateur'}</span>
            <button type="button" onClick={applySharedView}>
              Appliquer
            </button>
          </div>
        ) : null}
      </div>

      {latLngIndicator ? (
        <div className="bottom-indicator">
          Lat&nbsp;{latLngIndicator.lat.toFixed(5)} — Lng&nbsp;{latLngIndicator.lng.toFixed(5)}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
    </div>
  );
};

export default RoomPage;
