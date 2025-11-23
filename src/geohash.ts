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

function getGeohashesAtPrecision(minLon: number, minLat: number, maxLon: number, maxLat: number, precision: number): string[] {
  const geohashes = new Set<string>();
  
  // Approximate step size in degrees for each precision to ensure coverage
  // Prec 2: ~5.6 deg
  // Prec 3: ~1.4 deg
  // Prec 4: ~0.35 deg
  // Prec 5: ~0.087 deg
  
  let step = 0.02;
  if (precision === 2) step = 2.0;
  else if (precision === 3) step = 0.5;
  else if (precision === 4) step = 0.1;
  else if (precision === 5) step = 0.02;

  for (let lat = minLat; lat < maxLat + step; lat += step) {
    const l = Math.min(lat, maxLat);
    for (let lon = minLon; lon < maxLon + step; lon += step) {
      const n = Math.min(lon, maxLon);
      geohashes.add(encodeGeoHash(l, n, precision));
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

// Used for INDEXING: Get covering hashes at the single optimal precision
export function getCoveringGeohashes(minLon: number, minLat: number, maxLon: number, maxLat: number): string[] {
  const precision = getOptimalPrecision(minLon, minLat, maxLon, maxLat);
  return getGeohashesAtPrecision(minLon, minLat, maxLon, maxLat, precision);
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
