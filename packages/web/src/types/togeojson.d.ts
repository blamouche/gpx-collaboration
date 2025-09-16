declare module 'togeojson' {
  import type { Document } from 'domhandler';
  import type { FeatureCollection } from 'geojson';
  export function gpx(doc: Document): FeatureCollection;
}
