// Utility functions for the OSM changeset worker

/**
 * Format a date as ISO 8601 string
 */
export function formatDateISO(date: Date): string {
  return date.toISOString();
}

/**
 * Parse an ISO 8601 date string
 */
export function parseISODate(dateStr: string): Date | null {
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Validate bounding box coordinates
 */
export function validateBbox(bbox: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): boolean {
  return (
    bbox.minLat >= -90 &&
    bbox.maxLat <= 90 &&
    bbox.minLon >= -180 &&
    bbox.maxLon <= 180 &&
    bbox.minLat <= bbox.maxLat &&
    bbox.minLon <= bbox.maxLon
  );
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError || new Error('Retry failed');
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Safe JSON parsing
 */
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
