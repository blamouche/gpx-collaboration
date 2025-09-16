import type { Feature, FeatureCollection, GeoJsonObject, LineString, Point } from 'geojson';

export type SupportedGeometry = LineString | Point;

export interface CollaborativeFeature
  extends Feature<SupportedGeometry, { kind: 'line' | 'point'; name?: string; [key: string]: unknown }>
{
  id: string;
}

export type FeaturesCollection = FeatureCollection<SupportedGeometry, CollaborativeFeature['properties']> & {
  features: CollaborativeFeature[];
};

export interface ViewState {
  center: [number, number];
  zoom: number;
  bounds?: [[number, number], [number, number]];
  suggestedBy?: number;
  updatedAt: number;
}

export type GeoJsonLike = GeoJsonObject | FeaturesCollection;

export interface AwarenessCursor {
  lat: number;
  lng: number;
  updatedAt: number;
}

export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
}

export interface AwarenessStateFields {
  user: AwarenessUser;
  cursor?: AwarenessCursor;
  focusFeatureId?: string;
}
