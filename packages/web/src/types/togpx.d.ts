declare module 'togpx' {
  import type { GeoJSON } from 'geojson';

  function togpx(geojson: GeoJSON, options?: { creator?: string }): string;
  export default togpx;
}
