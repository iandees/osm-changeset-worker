# API Usage Examples

This file contains example API calls for the OSM Changeset Worker API.

Replace `YOUR_WORKER_URL` with your actual Cloudflare Worker URL.

## Get All Recent Changesets

```bash
curl "https://YOUR_WORKER_URL/api/changesets?limit=10"
```

## Get Changesets by User ID

```bash
curl "https://YOUR_WORKER_URL/api/changesets?user_id=123456&limit=20"
```

## Get Changesets in a Date Range

```bash
curl "https://YOUR_WORKER_URL/api/changesets?start_date=2024-01-01T00:00:00Z&end_date=2024-01-31T23:59:59Z&limit=50"
```

## Get Changesets in a Bounding Box

Get changesets that intersect with San Francisco area:

```bash
curl "https://YOUR_WORKER_URL/api/changesets?bbox=-122.5,37.7,-122.4,37.8&limit=25"
```

## Get Changesets with Multiple Filters

```bash
curl "https://YOUR_WORKER_URL/api/changesets?user_id=123456&start_date=2024-01-01T00:00:00Z&bbox=-122.5,37.7,-122.4,37.8&limit=10"
```

## Get a Specific Changeset

```bash
curl "https://YOUR_WORKER_URL/api/changesets/123456789"
```

## Get Database Statistics

```bash
curl "https://YOUR_WORKER_URL/api/stats"
```

## Pagination Example

Get the second page of results (offset by 100):

```bash
curl "https://YOUR_WORKER_URL/api/changesets?limit=100&offset=100"
```

## Using with jq for Pretty Output

```bash
curl "https://YOUR_WORKER_URL/api/changesets?limit=5" | jq '.'
```

## Filter by Recent Activity

Get changesets from the last hour:

```bash
DATE=$(date -u -d '1 hour ago' '+%Y-%m-%dT%H:%M:%SZ')
curl "https://YOUR_WORKER_URL/api/changesets?start_date=$DATE&limit=50"
```

## JavaScript/Node.js Example

```javascript
const fetch = require('node-fetch');

async function getRecentChangesets() {
  const response = await fetch('https://YOUR_WORKER_URL/api/changesets?limit=10');
  const data = await response.json();
  
  console.log(`Found ${data.features.length} changesets`);
  
  data.features.forEach(feature => {
    const props = feature.properties;
    console.log(`Changeset ${props.id} by ${props.user}: ${props.tags.comment || 'No comment'}`);
  });
}

getRecentChangesets();
```

## Python Example

```python
import requests

def get_recent_changesets():
    url = 'https://YOUR_WORKER_URL/api/changesets'
    params = {'limit': 10}
    
    response = requests.get(url, params=params)
    data = response.json()
    
    print(f"Found {len(data['features'])} changesets")
    
    for feature in data['features']:
        props = feature['properties']
        comment = props['tags'].get('comment', 'No comment')
        print(f"Changeset {props['id']} by {props['user']}: {comment}")

get_recent_changesets()
```

## Response Format

All changeset queries return data in GeoJSON format:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": 123456789,
      "geometry": {
        "type": "Polygon",
        "coordinates": [[...]]
      },
      "properties": {
        "id": 123456789,
        "created_at": "2024-01-01T12:00:00Z",
        "closed_at": "2024-01-01T12:30:00Z",
        "open": false,
        "user": "mapper_name",
        "uid": 123456,
        "bbox": [-122.5, 37.7, -122.4, 37.8],
        "num_changes": 50,
        "comments_count": 2,
        "tags": {
          "comment": "Fixed some roads",
          "created_by": "iD 2.0",
          "imagery_used": "Bing"
        }
      }
    }
  ]
}
```
