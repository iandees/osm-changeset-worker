const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeoHash(lat: number, lon: number, precision: number = 5): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      // Bisect E-W longitude
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        idx = idx * 2 + 1;
        lonMin = lonMid;
      } else {
        idx = idx * 2;
        lonMax = lonMid;
      }
    } else {
      // Bisect N-S latitude
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;

    if (++bit == 5) {
      geohash += BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

function getGeohashDimensions(precision: number): { latHeight: number, lonWidth: number } {
  const totalBits = precision * 5;
  // Longitude bits are the even bits (0, 2, 4...), Latitude are odd (1, 3, 5...)
  const lonBits = Math.ceil(totalBits / 2);
  const latBits = Math.floor(totalBits / 2);

  const latHeight = 180 / Math.pow(2, latBits);
  const lonWidth = 360 / Math.pow(2, lonBits);

  return { latHeight, lonWidth };
}

function getGeohashesAtPrecision(minLon: number, minLat: number, maxLon: number, maxLat: number, precision: number): string[] {
  const geohashes = new Set<string>();

  const { latHeight, lonWidth } = getGeohashDimensions(precision);

  // Start from the center of the bottom-left cell to ensure we pick up the correct cell
  const startLat = minLat + latHeight / 2;
  const startLon = minLon + lonWidth / 2;

  // Iterate through the bbox by stepping one cell size at a time
  for (let lat = startLat; lat < maxLat + latHeight; lat += latHeight) {
    // Stop if we've gone past the top edge of the bbox
    if (lat - latHeight / 2 > maxLat) break;

    for (let lon = startLon; lon < maxLon + lonWidth; lon += lonWidth) {
      // Stop if we've gone past the right edge of the bbox
      if (lon - lonWidth / 2 > maxLon) break;

      // Clamp coordinates to valid ranges for encoding
      const cLat = Math.min(90, Math.max(-90, lat));
      let cLon = lon;
      // Handle longitude wrapping if necessary (though standard bbox usually doesn't wrap)
      if (cLon > 180) cLon -= 360;
      if (cLon < -180) cLon += 360;

      geohashes.add(encodeGeoHash(cLat, cLon, precision));
    }
  }
  return Array.from(geohashes);
}

function getOptimalPrecision(minLon: number, minLat: number, maxLon: number, maxLat: number): number {
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  const maxDim = Math.max(latSpan, lonSpan);

  if (maxDim > 5) return 2;
  if (maxDim > 1) return 3;
  if (maxDim > 0.3) return 4;
  return 5;
}

// Used for INDEXING: Get covering hashes at the optimal precision and lower precisions
export function getCoveringGeohashes(minLon: number, minLat: number, maxLon: number, maxLat: number): string[] {
  const optimalPrecision = getOptimalPrecision(minLon, minLat, maxLon, maxLat);
  const geohashes = new Set<string>();
  for (let p = 2; p <= optimalPrecision; p++) {
    const layerHashes = getGeohashesAtPrecision(minLon, minLat, maxLon, maxLat, p);
    layerHashes.forEach(h => geohashes.add(h));
  }
  return Array.from(geohashes);
}

// Used for QUERYING: Get covering hashes at ALL precisions
// Returns null if too many hashes (implies query area is too large for index)
export function getSearchGeohashes(minLon: number, minLat: number, maxLon: number, maxLat: number): string[] | null {
  const hashes = new Set<string>();
  const MAX_HASHES = 200; // Limit to prevent massive queries

  // Check all precisions we support (2 to 5)
  for (let p = 2; p <= 5; p++) {
    const layerHashes = getGeohashesAtPrecision(minLon, minLat, maxLon, maxLat, p);

    if (hashes.size + layerHashes.length > MAX_HASHES) {
      return null; // Too many hashes, fallback to non-indexed query
    }

    layerHashes.forEach(h => hashes.add(h));
  }

  return Array.from(hashes);
}
