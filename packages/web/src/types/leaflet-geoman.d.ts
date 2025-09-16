import 'leaflet';

declare module 'leaflet' {
  interface Map {
    pm: any;
  }

  interface Layer {
    pm?: any;
    feature?: unknown;
    featureId?: string;
  }
}

declare module 'leaflet-geoman-free';
