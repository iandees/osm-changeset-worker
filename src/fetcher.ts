// Fetch and parse OSM changeset replication data
import { XMLParser } from 'fast-xml-parser';
import type { Changeset, OsmApiChangeset, ReplicationState } from './types';
import { retry } from './utils';

const OSM_REPLICATION_BASE_URL = 'https://planet.openstreetmap.org/replication/changesets';

/**
 * Get the current replication state from OSM
 */
export async function fetchReplicationState(sequenceNumber: number): Promise<{
  sequenceNumber: number;
  timestamp: string
} | null> {
  const path = getReplicationPath(sequenceNumber);
  const stateUrl = `${OSM_REPLICATION_BASE_URL}/${path}.state.txt`;

  try {
    const response = await fetch(stateUrl);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    // Changeset replication uses a YAML-style format with 'last_run' and 'sequence'
    const timestampMatch = text.match(/last_run:\s*(.+)/);
    const seqMatch = text.match(/sequence:\s*(\d+)/);

    if (timestampMatch && seqMatch) {
      return {
        sequenceNumber: parseInt(seqMatch[1]),
        timestamp: timestampMatch[1].trim()
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching replication state:', error);
    return null;
  }
}

/**
 * Fetch changeset data from OSM replication feed
 */
export async function fetchChangesets(sequenceNumber: number): Promise<Changeset[]> {
  const path = getReplicationPath(sequenceNumber);
  const changesetUrl = `${OSM_REPLICATION_BASE_URL}/${path}.osm.gz`;

  try {
    // Use retry logic for network requests
    return await retry(async () => {
      const response = await fetch(changesetUrl);
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`No changeset file found for sequence ${sequenceNumber} (tried ${changesetUrl})`);
          return [];
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Decompress gzip data
      const compressedData = await response.arrayBuffer();
      const decompressedData = await decompressGzip(compressedData);
      const xmlText = new TextDecoder().decode(decompressedData);

      return parseChangesetsXml(xmlText);
    }, 2, 2000); // 2 retries with 2 second initial delay
  } catch (error) {
    console.error('Error fetching changesets:', error);
    return [];
  }
}

/**
 * Decompress gzip data using DecompressionStream
 */
async function decompressGzip(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Response(data).body;
  if (!stream) {
    throw new Error('Failed to create stream from data');
  }

  const decompressedStream = stream.pipeThrough(
    new DecompressionStream('gzip')
  );

  const response = new Response(decompressedStream);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Parse OSM XML changesets
 */
export function parseChangesetsXml(xmlText: string): Changeset[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false
  });

  const parsed = parser.parse(xmlText);

  if (!parsed.osm || !parsed.osm.changeset) {
    return [];
  }

  // Handle single changeset or array of changesets
  const changesets = Array.isArray(parsed.osm.changeset)
    ? parsed.osm.changeset
    : [parsed.osm.changeset];

  return changesets.map((cs: OsmApiChangeset) => convertChangeset(cs));
}

/**
 * Convert OSM API changeset format to our internal format
 */
function convertChangeset(apiChangeset: OsmApiChangeset): Changeset {
  const tags: Record<string, string> = {};

  if (apiChangeset.tag) {
    const tagArray = Array.isArray(apiChangeset.tag)
      ? apiChangeset.tag
      : [apiChangeset.tag];

    tagArray.forEach(tag => {
      tags[tag.k] = tag.v;
    });
  }

  return {
    id: parseInt(apiChangeset.id),
    created_at: apiChangeset.created_at,
    closed_at: apiChangeset.closed_at,
    open: apiChangeset.open === 'true',
    user_id: apiChangeset.uid ? parseInt(apiChangeset.uid) : undefined,
    user_name: apiChangeset.user,
    min_lat: apiChangeset.min_lat ? parseFloat(apiChangeset.min_lat) : undefined,
    max_lat: apiChangeset.max_lat ? parseFloat(apiChangeset.max_lat) : undefined,
    min_lon: apiChangeset.min_lon ? parseFloat(apiChangeset.min_lon) : undefined,
    max_lon: apiChangeset.max_lon ? parseFloat(apiChangeset.max_lon) : undefined,
    num_changes: apiChangeset.num_changes ? parseInt(apiChangeset.num_changes) : 0,
    comments_count: apiChangeset.comments_count ? parseInt(apiChangeset.comments_count) : 0,
    tags
  };
}

/**
 * Convert sequence number to replication path format
 * Example: 5123456 -> "005/123/456"
 */
function getReplicationPath(sequenceNumber: number): string {
  const padded = sequenceNumber.toString().padStart(9, '0');
  return `${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6, 9)}`;
}

/**
 * Get the latest sequence number from OSM
 */
export async function getLatestSequenceNumber(): Promise<number | null> {
  try {
    const response = await fetch(`${OSM_REPLICATION_BASE_URL}/state.txt`);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    // Changeset replication uses a YAML-style format with 'sequence'
    const match = text.match(/sequence:\s*(\d+)/);

    if (match) {
      return parseInt(match[1]);
    }
    return null;
  } catch (error) {
    console.error('Error fetching latest sequence number:', error);
    return null;
  }
}
