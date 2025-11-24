// OSM Changeset Viewer - Main Application
class ChangesetViewer {
    constructor() {
        this.changesets = [];
        this.selectedChangeset = null;
        this.map = null;
        this.markers = {};
        this.bboxFilter = null; // Store bounding box filter
        this.bboxDrawing = false; // Track if we're in bbox drawing mode
        this.bboxDrawStart = null; // Starting point for bbox drawing
        this.bboxDrawLayer = null; // Layer for drawing bbox preview
        this.adiffActive = false; // Track if adiff is loaded

        this.init();
    }

    async init() {
        this.initMap();
        this.initEventListeners();
        this.loadFiltersFromUrl();
        await this.loadChangesets(true);
        this.updateFilterSummary();
    }

    initMap() {
        // Initialize MapLibre GL map
        this.map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                sources: {
                    'osm': {
                        type: 'raster',
                        tiles: [
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        ],
                        tileSize: 256,
                        maxzoom: 19,
                        attribution: '© OpenStreetMap contributors'
                    }
                },
                layers: [{
                    id: 'osm',
                    type: 'raster',
                    source: 'osm',
                    minzoom: 0,
                    maxzoom: 22
                }]
            },
            center: [0, 20],
            zoom: 2
        });

        this.map.addControl(new maplibregl.NavigationControl(), 'top-left');
        this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    }

    initEventListeners() {
        // Filter buttons
        document.getElementById('applyFilters').addEventListener('click', () => {
            console.log('Apply Filters clicked');
            this.loadChangesets(); // Reload data with new filters
        });

        document.getElementById('clearFilters').addEventListener('click', () => {
            this.clearFilters();
        });

        // Map controls
        document.getElementById('refreshData').addEventListener('click', () => {
            this.loadChangesets();
        });

        document.getElementById('fitBounds').addEventListener('click', () => {
            this.fitAllChangesets();
        });

        // Bounding box controls
        document.getElementById('drawBbox').addEventListener('click', () => {
            this.toggleBboxDrawing();
        });

        document.getElementById('useMapBounds').addEventListener('click', () => {
            this.setBboxFromMap();
        });

        document.getElementById('clearBbox').addEventListener('click', () => {
            this.clearBboxFilter();
        });

        // Bbox input changes
        ['bboxMinLon', 'bboxMinLat', 'bboxMaxLon', 'bboxMaxLat'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                this.updateBboxFromInputs();
            });
        });

        // Filters toggle
        document.getElementById('filtersToggle').addEventListener('click', () => {
            this.toggleFilters();
        });

        document.getElementById('filtersHeader').addEventListener('click', (e) => {
            // Only toggle if clicking on the header itself, not on child elements
            if (e.target === document.getElementById('filtersHeader') ||
                e.target.tagName === 'H2' ||
                e.target.classList.contains('filters-summary')) {
                this.toggleFilters();
            }
        });

        // Panel close
        document.getElementById('closePanel').addEventListener('click', () => {
            this.closePanel();
        });

        // Enter key on inputs
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadChangesets(); // Reload data with new filters
            }
        });

        // Tags input enter key
        document.getElementById('tags').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadChangesets();
            }
        });

        // Also trigger on limit change
        document.getElementById('limit').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadChangesets();
            }
        });
    }

    async loadChangesets(replaceUrl = false) {
        const limit = document.getElementById('limit').value;
        const username = document.getElementById('username').value.trim();
        const tagsInput = document.getElementById('tags').value.trim();
        const bboxSizeMin = document.getElementById('bboxSizeMin').value.trim();
        const bboxSizeMax = document.getElementById('bboxSizeMax').value.trim();

        try {
            const changesetItems = document.getElementById('changesetItems');
            changesetItems.innerHTML = '<div class="loading">Loading changesets...</div>';

            // Build query parameters
            const params = new URLSearchParams();
            params.set('limit', limit);

            if (username) {
                params.set('user_name', username);
            }

            // Add bounding box filter if set
            if (this.bboxFilter) {
                const { minLon, minLat, maxLon, maxLat } = this.bboxFilter;
                const f = (n) => n.toFixed(5);
                params.set('bbox', `${f(minLon)},${f(minLat)},${f(maxLon)},${f(maxLat)}`);
            }

            // Add bbox size filters
            if (bboxSizeMin) {
                params.set('bbox_size_min', bboxSizeMin);
            }
            if (bboxSizeMax) {
                params.set('bbox_size_max', bboxSizeMax);
            }

            // Parse tags input - format: key=value or key="value with spaces"
            if (tagsInput) {
                const tagPairs = this.parseTagsInput(tagsInput);
                tagPairs.forEach(pair => {
                    params.append('tags', pair);
                });
            }

            // Update RSS Link
            const rssParams = new URLSearchParams(params);
            const rssLink = document.getElementById('rssLink');
            if (rssLink) {
                const protocol = window.location.protocol;
                const host = window.location.host;
                rssLink.href = `${protocol}//${host}/api/changesets.rss?${rssParams.toString()}`;
            }

            // Update Browser URL
            const queryString = params.toString();
            const newUrl = `${window.location.pathname}?${queryString}`;
            if (replaceUrl) {
                window.history.replaceState({}, '', newUrl);
            } else {
                window.history.pushState({}, '', newUrl);
            }

            const url = `/api/changesets?${queryString}`;
            console.log('Fetching from:', url);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Received data:', data);

            // Check if the API returned GeoJSON FeatureCollection format
            let changesets = [];
            if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
                // Extract changeset data from GeoJSON features
                changesets = data.features.map(feature => {
                    const cs = feature.properties;
                    // Add bbox coordinates if they exist
                    if (feature.geometry && feature.geometry.type === 'Polygon') {
                        const coords = feature.geometry.coordinates[0];
                        const lons = coords.map(c => c[0]);
                        const lats = coords.map(c => c[1]);
                        cs.min_lon = Math.min(...lons);
                        cs.max_lon = Math.max(...lons);
                        cs.min_lat = Math.min(...lats);
                        cs.max_lat = Math.max(...lats);
                    }
                    // Map 'user' and 'uid' to 'user_name' and 'user_id' for consistency
                    if (cs.user && !cs.user_name) {
                        cs.user_name = cs.user;
                    }
                    if (cs.uid && !cs.user_id) {
                        cs.user_id = cs.uid;
                    }
                    return cs;
                });
            } else if (Array.isArray(data)) {
                // Plain array format
                changesets = data;
            }

            this.changesets = changesets;
            console.log('Loaded changesets:', this.changesets.length);

            this.applyFilters();

            // Update filter summary after loading changesets
            this.updateFilterSummary();
        } catch (error) {
            console.error('Error loading changesets:', error);
            this.changesets = [];
            document.getElementById('changesetItems').innerHTML =
                '<div class="error">Failed to load changesets. Please try again.</div>';
        }
    }

    loadFiltersFromUrl() {
        const params = new URLSearchParams(window.location.search);

        if (params.has('user_name')) {
            document.getElementById('username').value = params.get('user_name');
        }

        if (params.has('tags')) {
            const tags = params.getAll('tags');
            const formattedTags = tags.map(tag => {
                const parts = tag.split('=');
                if (parts.length >= 2) {
                    const key = parts[0];
                    const value = parts.slice(1).join('=');
                    if (value.includes(' ')) {
                        return `${key}="${value}"`;
                    }
                }
                return tag;
            });
            document.getElementById('tags').value = formattedTags.join(' ');
        }

        if (params.has('bbox')) {
            const bboxParts = params.get('bbox').split(',');
            if (bboxParts.length === 4) {
                const [minLon, minLat, maxLon, maxLat] = bboxParts.map(parseFloat);
                if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
                    this.setBboxFilter(minLon, minLat, maxLon, maxLat);
                }
            }
        }

        if (params.has('bbox_size_min')) {
            document.getElementById('bboxSizeMin').value = params.get('bbox_size_min');
        }

        if (params.has('bbox_size_max')) {
            document.getElementById('bboxSizeMax').value = params.get('bbox_size_max');
        }

        if (params.has('limit')) {
            document.getElementById('limit').value = params.get('limit');
        }
    }

    parseTagsInput(input) {
        // Parse tags input supporting quoted values for spaces
        // Examples:
        //   comment=test created_by=iD  ->  ["comment=test", "created_by=iD"]
        //   created_by="iD 2.37.3"      ->  ["created_by=iD 2.37.3"]
        //   comment=test key="value with spaces" other=simple  ->  ["comment=test", "key=value with spaces", "other=simple"]
        //   key!=value                  ->  ["key!=value"]

        const pairs = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < input.length; i++) {
            const char = input[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ' ' && !inQuotes) {
                if (current.trim()) {
                    pairs.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }

        // Add the last pair if there is one
        if (current.trim()) {
            pairs.push(current.trim());
        }

        // Filter out any that don't have a valid operator (=, !=)
        return pairs.filter(pair => pair.includes('='));
    }

    applyFilters() {
        console.log('Applying filters');

        // Ensure changesets is an array before filtering
        if (!Array.isArray(this.changesets)) {
            console.warn('Changesets is not an array:', this.changesets);
            this.changesets = [];
        }

        console.log('Changesets:', this.changesets.length);

        this.renderChangesets();
        this.renderMap();
    }

    clearFilters() {
        document.getElementById('username').value = '';
        document.getElementById('tags').value = '';
        document.getElementById('limit').value = '100';
        document.getElementById('bboxSizeMin').value = '';
        document.getElementById('bboxSizeMax').value = '';

        // Clear bounding box filter
        this.clearBboxFilter();

        // Reload with cleared filters
        this.loadChangesets();
    }

    hasBoundingBox(changeset) {
        return changeset.min_lat != null &&
               changeset.max_lat != null &&
               changeset.min_lon != null &&
               changeset.max_lon != null;
    }

    renderChangesets() {
        const changesetItems = document.getElementById('changesetItems');

        // Update the header with count
        const header = document.getElementById('changesetListHeader');
        header.innerHTML = `Changesets <span style="font-size: 0.875rem; color: #94a3b8; font-weight: 400;">(${this.changesets.length.toLocaleString()})</span>`;

        console.log('renderChangesets called with', this.changesets.length, 'changesets');

        if (this.changesets.length === 0) {
            changesetItems.innerHTML = '<div class="loading">No changesets found</div>';
            return;
        }

        changesetItems.innerHTML = this.changesets
            .map(cs => this.createChangesetItem(cs))
            .join('');

        console.log('Rendered', this.changesets.length, 'changeset items');

        // Add click listeners
        changesetItems.querySelectorAll('.changeset-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                this.selectChangeset(this.changesets[index]);
            });
        });
    }

    createChangesetItem(changeset) {
        const statusClass = changeset.open ? 'status-open' : 'status-closed';
        const status = changeset.open ? 'Open' : 'Closed';
        const comment = changeset.tags?.comment || '';
        const commentHtml = comment ?
            `<div class="changeset-comment">"${this.escapeHtml(comment)}"</div>` : '';

        const date = new Date(changeset.created_at);
        const timeAgo = this.getTimeAgo(date);

        return `
            <div class="changeset-item" data-id="${changeset.id}">
                <div class="changeset-header">
                    <span class="changeset-id">#${changeset.id}</span>
                    <span class="changeset-status ${statusClass}">${status}</span>
                </div>
                <div class="changeset-user">👤 ${this.escapeHtml(changeset.user_name || 'Unknown')}</div>
                <div class="changeset-meta">
                    <span>📝 ${changeset.num_changes || 0} changes</span>
                    <span>🕐 ${timeAgo}</span>
                </div>
                ${commentHtml}
            </div>
        `;
    }

    renderMap() {
        console.log('renderMap called');

        // Clear existing markers and layers
        Object.values(this.markers).forEach(marker => marker.remove());
        this.markers = {};

        // Remove existing layers and sources
        if (this.map.getLayer('changesets-fill')) {
            this.map.removeLayer('changesets-fill');
        }
        if (this.map.getLayer('changesets-outline')) {
            this.map.removeLayer('changesets-outline');
        }
        if (this.map.getSource('changesets')) {
            this.map.removeSource('changesets');
        }

        // Create GeoJSON features for changesets with bounding boxes
        const features = this.changesets
            .filter(cs => this.hasBoundingBox(cs))
            .map(cs => {
                // Ensure bbox has minimum size for visibility
                let { min_lon, min_lat, max_lon, max_lat } = cs;
                const width = max_lon - min_lon;
                const height = max_lat - min_lat;

                // If bbox is very small (e.g. single node), add padding
                // 0.0002 degrees is roughly 20 meters, visible at high zoom
                const minSize = 0.0002;

                if (width < minSize || height < minSize) {
                    const centerLon = (min_lon + max_lon) / 2;
                    const centerLat = (min_lat + max_lat) / 2;
                    const halfSize = Math.max(width, height, minSize) / 2;

                    min_lon = centerLon - halfSize;
                    max_lon = centerLon + halfSize;
                    min_lat = centerLat - halfSize;
                    max_lat = centerLat + halfSize;
                }

                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [min_lon, min_lat],
                            [max_lon, min_lat],
                            [max_lon, max_lat],
                            [min_lon, max_lat],
                            [min_lon, min_lat]
                        ]]
                    },
                    properties: {
                        id: cs.id,
                        user_name: cs.user_name,
                        num_changes: cs.num_changes,
                        open: cs.open,
                        comment: cs.tags?.comment || ''
                    },
                    id: cs.id // Promote ID for feature state
                };
            });

        console.log('Created', features.length, 'GeoJSON features for map');

        if (features.length === 0) {
            console.log('No features to render on map');
            return;
        }

        // Add source
        this.map.addSource('changesets', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: features
            },
            promoteId: 'id'
        });

        console.log('Added GeoJSON source to map');

        // Add fill layer
        this.map.addLayer({
            id: 'changesets-fill',
            type: 'fill',
            source: 'changesets',
            layout: {
                visibility: this.adiffActive ? 'none' : 'visible'
            },
            paint: {
                'fill-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    '#f59e0b', // Selected color (amber)
                    ['case',
                        ['get', 'open'],
                        '#10b981',  // green for open
                        '#2563eb'   // blue for closed
                    ]
                ],
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'adiffLoaded'], false],
                    0, // Transparent if adiff loaded
                    ['boolean', ['feature-state', 'selected'], false],
                    0.6,
                    0.3
                ]
            }
        });

        // Add outline layer
        this.map.addLayer({
            id: 'changesets-outline',
            type: 'line',
            source: 'changesets',
            layout: {
                visibility: this.adiffActive ? 'none' : 'visible'
            },
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    '#d97706', // Darker amber for outline
                    ['case',
                        ['get', 'open'],
                        '#10b981',  // green for open
                        '#2563eb'   // blue for closed
                    ]
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    3,
                    2
                ],
                'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'adiffLoaded'], false],
                    0, // Hide original outline if adiff loaded
                    1
                ]
            }
        });

        console.log('Added map layers');

        // Add click handler
        this.map.on('click', 'changesets-fill', (e) => {
            if (this.adiffActive) return;

            const feature = e.features[0];
            const changesetId = feature.properties.id;
            const changeset = this.changesets.find(cs => cs.id === changesetId);
            if (changeset) {
                this.selectChangeset(changeset);
            }
        });

        // Change cursor on hover
        this.map.on('mouseenter', 'changesets-fill', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });
        this.map.on('mouseleave', 'changesets-fill', () => {
            this.map.getCanvas().style.cursor = '';
        });

        console.log('Map rendering complete');
    }

    async selectChangeset(changeset) {
        // Deselect previous
        if (this.selectedChangeset && this.map.getSource('changesets')) {
            this.map.setFeatureState(
                { source: 'changesets', id: this.selectedChangeset.id },
                { selected: false }
            );
        }

        // Clear previous adiff visualization
        this.clearAdiff();

        this.selectedChangeset = changeset;

        // Select new
        if (this.selectedChangeset && this.map.getSource('changesets')) {
            this.map.setFeatureState(
                { source: 'changesets', id: this.selectedChangeset.id },
                { selected: true }
            );
        }

        // Update UI
        document.querySelectorAll('.changeset-item').forEach(item => {
            item.classList.remove('active');
        });
        const item = document.querySelector(`[data-id="${changeset.id}"]`);
        if (item) {
            item.classList.add('active');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Zoom to changeset on map
        if (this.hasBoundingBox(changeset)) {
            // Calculate the area of the bounding box
            const width = changeset.max_lon - changeset.min_lon;
            const height = changeset.max_lat - changeset.min_lat;
            const area = width * height;

            // If the area is very small (< 0.00001 square degrees), add padding
            const minArea = 0.00001;
            let bounds;

            if (area < minArea) {
                // Add padding to make the changeset visible
                const padding = Math.sqrt(minArea) / 2; // Distribute padding evenly
                const centerLon = (changeset.min_lon + changeset.max_lon) / 2;
                const centerLat = (changeset.min_lat + changeset.max_lat) / 2;

                bounds = [
                    [centerLon - padding, centerLat - padding],
                    [centerLon + padding, centerLat + padding]
                ];

                console.log(`Small changeset detected (area: ${area.toFixed(6)}). Added padding and new bounds is ${JSON.stringify(bounds)}.`);
            } else {
                bounds = [
                    [changeset.min_lon, changeset.min_lat],
                    [changeset.max_lon, changeset.max_lat]
                ];
            }

            this.map.fitBounds(bounds, {
                padding: { top: 50, bottom: 50, left: 50, right: 50 },
                maxZoom: 22,
                duration: 250,
            });
        }

        // Show panel with details
        this.showChangesetDetails(changeset);

        // Load and render adiff
        this.loadAdiff(changeset.id);
    }

    async loadAdiff(changesetId) {
        try {
            const response = await fetch(`/api/changesets/${changesetId}/adiff`);
            if (!response.ok) {
                console.warn('Failed to fetch adiff');
                return;
            }
            const geojson = await response.json();
            this.renderAdiff(geojson);
        } catch (error) {
            console.error('Error loading adiff:', error);
        }
    }

    renderAdiff(geojson) {
        if (!this.map) return;

        this.adiffActive = true;

        // Hide other changesets
        if (this.map.getLayer('changesets-fill')) {
            this.map.setLayoutProperty('changesets-fill', 'visibility', 'none');
        }
        if (this.map.getLayer('changesets-outline')) {
            this.map.setLayoutProperty('changesets-outline', 'visibility', 'none');
        }

        // Set feature state to hide fill/outline of selected changeset
        if (this.selectedChangeset && this.map.getSource('changesets')) {
            this.map.setFeatureState(
                { source: 'changesets', id: this.selectedChangeset.id },
                { selected: true, adiffLoaded: true }
            );
        }

        // Add source
        this.map.addSource('adiff', {
            type: 'geojson',
            data: geojson
        });

        // Add line layer
        this.map.addLayer({
            id: 'adiff-lines',
            type: 'line',
            source: 'adiff',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-width': 4,
                'line-color': [
                    'match',
                    ['get', 'changeType'],
                    'create', '#10b981', // Green
                    'delete', '#ef4444', // Red
                    'modify', [
                        'match',
                        ['get', 'version'],
                        'new', '#3b82f6', // Blue
                        '#f59e0b' // Orange
                    ],
                    '#888888' // Default
                ],
                'line-opacity': 0.8
            }
        });

        // Add point layer
        this.map.addLayer({
            id: 'adiff-points',
            type: 'circle',
            source: 'adiff',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': 5,
                'circle-color': [
                    'match',
                    ['get', 'changeType'],
                    'create', '#10b981',
                    'delete', '#ef4444',
                    'modify', [
                        'match',
                        ['get', 'version'],
                        'new', '#3b82f6',
                        '#f59e0b'
                    ],
                    '#888888'
                ],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff'
            }
        });

        // Add click handlers for popups
        this._boundOnAdiffClick = this.onAdiffFeatureClick.bind(this);
        this.map.on('click', 'adiff-lines', this._boundOnAdiffClick);
        this.map.on('click', 'adiff-points', this._boundOnAdiffClick);

        // Cursor handling
        this.map.on('mouseenter', 'adiff-lines', () => this.map.getCanvas().style.cursor = 'pointer');
        this.map.on('mouseleave', 'adiff-lines', () => this.map.getCanvas().style.cursor = '');
        this.map.on('mouseenter', 'adiff-points', () => this.map.getCanvas().style.cursor = 'pointer');
        this.map.on('mouseleave', 'adiff-points', () => this.map.getCanvas().style.cursor = '');

        // Add dotted bbox for selected changeset
        if (this.selectedChangeset && this.hasBoundingBox(this.selectedChangeset)) {
            const cs = this.selectedChangeset;
            let { min_lon, min_lat, max_lon, max_lat } = cs;
            const width = max_lon - min_lon;
            const height = max_lat - min_lat;
            const minSize = 0.0002;

            if (width < minSize || height < minSize) {
                const centerLon = (min_lon + max_lon) / 2;
                const centerLat = (min_lat + max_lat) / 2;
                const halfSize = Math.max(width, height, minSize) / 2;
                min_lon = centerLon - halfSize;
                max_lon = centerLon + halfSize;
                min_lat = centerLat - halfSize;
                max_lat = centerLat + halfSize;
            }

            this.map.addSource('selected-bbox', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [min_lon, min_lat],
                            [max_lon, min_lat],
                            [max_lon, max_lat],
                            [min_lon, max_lat],
                            [min_lon, min_lat]
                        ]]
                    }
                }
            });

            this.map.addLayer({
                id: 'selected-bbox-outline',
                type: 'line',
                source: 'selected-bbox',
                paint: {
                    'line-color': '#d97706',
                    'line-width': 2,
                    'line-dasharray': [2, 2]
                }
            });
        }
    }

    clearAdiff() {
        if (!this.map) return;

        this.adiffActive = false;

        // Show other changesets
        if (this.map.getLayer('changesets-fill')) {
            this.map.setLayoutProperty('changesets-fill', 'visibility', 'visible');
        }
        if (this.map.getLayer('changesets-outline')) {
            this.map.setLayoutProperty('changesets-outline', 'visibility', 'visible');
        }

        if (this._boundOnAdiffClick) {
            this.map.off('click', 'adiff-lines', this._boundOnAdiffClick);
            this.map.off('click', 'adiff-points', this._boundOnAdiffClick);
            this._boundOnAdiffClick = null;
        }

        // Reset feature state - only reset adiffLoaded, preserve selected state
        if (this.selectedChangeset && this.map.getSource('changesets')) {
            this.map.setFeatureState(
                { source: 'changesets', id: this.selectedChangeset.id },
                { adiffLoaded: false }
            );
        }

        if (this.map.getLayer('adiff-points')) {
            this.map.removeLayer('adiff-points');
        }
        if (this.map.getLayer('adiff-lines')) {
            this.map.removeLayer('adiff-lines');
        }
        if (this.map.getSource('adiff')) {
            this.map.removeSource('adiff');
        }

        // Remove bbox
        if (this.map.getLayer('selected-bbox-outline')) {
            this.map.removeLayer('selected-bbox-outline');
        }
        if (this.map.getSource('selected-bbox')) {
            this.map.removeSource('selected-bbox');
        }
    }

    onAdiffFeatureClick(e) {
        const feature = e.features[0];
        const props = feature.properties;

        let tagsHtml = '';
        if (props.tags) {
            let tags = props.tags;
            if (typeof tags === 'string') {
                try { tags = JSON.parse(tags); } catch(e) {}
            }

            if (Object.keys(tags).length > 0) {
                tagsHtml = '<table style="width:100%; font-size: 0.8rem; border-collapse: collapse;">';
                for (const [k, v] of Object.entries(tags)) {
                    tagsHtml += `<tr><td style="font-weight:bold; padding-right:5px; vertical-align: top;">${this.escapeHtml(k)}</td><td style="word-break: break-word;">${this.escapeHtml(v)}</td></tr>`;
                }
                tagsHtml += '</table>';
            }
        }

        const changeColor = this.getChangeColor(props.changeType, props.version);

        const content = `
            <div style="font-size: 0.9rem; max-width: 300px;">
                <h3 style="margin: 0 0 5px 0; font-size: 1rem;">${props.type}/${props.id}</h3>
                <div style="margin-bottom: 8px;">
                    <span style="font-weight: bold; text-transform: capitalize; color: ${changeColor}">${props.changeType}</span>
                    ${props.version ? `<span style="color: #666;">(${props.version})</span>` : ''}
                </div>
                ${tagsHtml ? `<div style="margin-top: 5px; border-top: 1px solid #eee; padding-top: 5px;">${tagsHtml}</div>` : ''}
            </div>
        `;

        new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(content)
            .addTo(this.map);
    }

    getChangeColor(type, version) {
        if (type === 'create') return '#10b981';
        if (type === 'delete') return '#ef4444';
        if (type === 'modify') return version === 'new' ? '#3b82f6' : '#f59e0b';
        return '#333';
    }

    showChangesetDetails(changeset) {
        const status = changeset.open ? 'Open' : 'Closed';
        const statusClass = changeset.open ? 'status-open' : 'status-closed';

        const createdBy = changeset.tags && changeset.tags['created_by'];
        const createdByHtml = createdBy ? `
            <p>🛠️ ${this.escapeHtml(createdBy)}
               <button class="filter-tag-btn" title="Filter by this editor" data-tag="created_by=${this.escapeHtml(createdBy)}" style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 0.875rem;">🔍</button>
            </p>` : '';

        const comment = changeset.tags?.comment || '';

        const tagRows = Object.entries(changeset.tags || {})
            .map(([key, value]) => `
                <tr>
                    <td style="padding: 4px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 500; color: #334155;">${this.escapeHtml(key)}</td>
                    <td style="padding: 4px 8px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${this.escapeHtml(value)}</td>
                </tr>
            `).join('');

        const panelContent = document.getElementById('panelContent');
        panelContent.innerHTML = `
            <div class="panel-header" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <div style="display: flex; align-items: center; width: 100%; justify-content: space-between;">
                    <h2 style="margin: 0; font-size: 1.25rem;">Changeset #${changeset.id}</h2>
                    <span class="changeset-status ${statusClass}">${status}</span>
                </div>
                <div style="display: flex; gap: 12px; font-size: 0.8rem;">
                    <a href="https://www.openstreetmap.org/changeset/${changeset.id}"
                       target="_blank"
                       style="color: #94a3b8; text-decoration: none; display: flex; align-items: center; gap: 2px;">
                        View on OSM ↗
                    </a>
                    <a href="https://osmcha.org/changesets/${changeset.id}"
                       target="_blank"
                       style="color: #94a3b8; text-decoration: none; display: flex; align-items: center; gap: 2px;">
                        View on OSMCha ↗
                    </a>
                </div>
            </div>

            <div class="panel-grid">
                <div class="panel-section">
                    ${comment ? `<div style="background: #f8fafc; padding: 8px; border-radius: 4px; border: 1px solid #e2e8f0; margin-bottom: 12px; font-style: italic;">${this.escapeHtml(comment)}</div>` : ''}
                    <p>👤 ${this.escapeHtml(changeset.user_name || 'Unknown')}
                       <button class="filter-user-btn" title="Filter by this user" data-username="${this.escapeHtml(changeset.user_name || '')}" style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 0.875rem;">🔍</button>
                       ${changeset.user_id ? `<span style="color: #94a3b8; font-size: 0.875rem;">(ID: ${changeset.user_id})</span>` : ''}</p>
                    ${createdByHtml}
                    <p>📝 ${changeset.num_changes || 0} changes</p>
                    <p>💬 ${changeset.comments_count || 0} comments</p>
                    <p>📅 ${new Date(changeset.created_at).toLocaleString()}</p>
                    <p>🚫 ${changeset.closed_at ? new Date(changeset.closed_at).toLocaleString() : '<span style="color: #94a3b8; font-size: 0.875rem;">(Still open)</span>'}</p>
                </div>

                <div class="panel-section">
                    <details>
                        <summary style="cursor: pointer; font-weight: 600; color: #475569; user-select: none;">Tags</summary>
                        ${tagRows ? `
                            <div style="overflow-x: auto; margin-top: 8px;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem; text-align: left;">
                                    <thead>
                                        <tr style="background-color: #f1f5f9;">
                                            <th style="padding: 8px; border-bottom: 2px solid #cbd5e1; width: 30%;">Key</th>
                                            <th style="padding: 8px; border-bottom: 2px solid #cbd5e1;">Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tagRows}
                                    </tbody>
                                </table>
                            </div>
                        ` : '<p style="color: #64748b; font-style: italic; margin-top: 8px;">No tags</p>'}
                    </details>
                </div>
            </div>
        `;

        // Add event listener for username filter button
        const filterUserBtn = panelContent.querySelector('.filter-user-btn');
        if (filterUserBtn) {
            filterUserBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const username = e.currentTarget.dataset.username;
                if (username) {
                    document.getElementById('username').value = username;
                    this.loadChangesets();

                    // Ensure filters are visible
                    const filtersDiv = document.querySelector('.filters');
                    if (filtersDiv.classList.contains('collapsed')) {
                        this.toggleFilters();
                    }
                }
            });
        }

        // Add event listener for created_by filter button
        const filterTagBtn = panelContent.querySelector('.filter-tag-btn');
        if (filterTagBtn) {
            filterTagBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const tagFilter = e.currentTarget.dataset.tag;
                if (tagFilter) {
                    const tagInput = document.getElementById('tags');

                    // Format the tag filter (quote value if it has spaces)
                    const parts = tagFilter.split('=');
                    const key = parts[0];
                    const val = parts.slice(1).join('=');
                    const formattedFilter = val.includes(' ') ? `${key}="${val}"` : tagFilter;

                    // Append or set
                    const currentVal = tagInput.value.trim();
                    if (currentVal && !currentVal.includes(formattedFilter)) {
                        tagInput.value = currentVal + ' ' + formattedFilter;
                    } else if (!currentVal) {
                        tagInput.value = formattedFilter;
                    }

                    this.loadChangesets();

                    // Ensure filters are visible
                    const filtersDiv = document.querySelector('.filters');
                    if (filtersDiv.classList.contains('collapsed')) {
                        this.toggleFilters();
                    }
                }
            });
        }

        document.getElementById('changesetDetailPanel').classList.add('active');
    }

    closePanel() {
        document.getElementById('changesetDetailPanel').classList.remove('active');

        // Clear adiff visualization first, while selectedChangeset is still valid
        this.clearAdiff();

        // Deselect on map
        if (this.selectedChangeset && this.map.getSource('changesets')) {
            this.map.setFeatureState(
                { source: 'changesets', id: this.selectedChangeset.id },
                { selected: false }
            );
        }
        this.selectedChangeset = null;

        // Remove active class from list
        document.querySelectorAll('.changeset-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    fitAllChangesets() {
        const changesetsWithBbox = this.changesets.filter(cs => this.hasBoundingBox(cs));

        if (changesetsWithBbox.length === 0) {
            return;
        }

        const bounds = changesetsWithBbox.reduce((bounds, cs) => {
            return bounds.extend([
                [cs.min_lon, cs.min_lat],
                [cs.max_lon, cs.max_lat]
            ]);
        }, new maplibregl.LngLatBounds());

        this.map.fitBounds(bounds, { padding: 50 });
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };

        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
            }
        }

        return 'just now';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Bounding Box Drawing Methods
    toggleBboxDrawing() {
        if (this.bboxDrawing) {
            this.cancelBboxDrawing();
        } else {
            this.startBboxDrawing();
        }
    }

    startBboxDrawing() {
        this.bboxDrawing = true;
        this.bboxDrawStart = null;

        // Update button appearance
        const drawBtn = document.getElementById('drawBbox');
        drawBtn.textContent = 'Click map to start box';
        drawBtn.style.background = '#ef4444';
        drawBtn.style.color = 'white';

        // Change cursor
        this.map.getCanvas().style.cursor = 'crosshair';

        // Add map event listeners for drawing
        this.map.once('click', this.onBboxDrawStart.bind(this));

        console.log('Bbox drawing mode activated');
    }

    onBboxDrawStart(e) {
        if (!this.bboxDrawing) return;

        this.bboxDrawStart = e.lngLat;

        // Update instruction
        document.getElementById('drawBbox').textContent = 'Click map to finish box';

        // Add mousemove listener to show preview
        // Store bound function to remove it later
        this._boundOnBboxDrawMove = this.onBboxDrawMove.bind(this);
        this.map.on('mousemove', this._boundOnBboxDrawMove);

        // Add click listener to finish drawing
        this.map.once('click', this.onBboxDrawEnd.bind(this));
    }

    onBboxDrawMove(e) {
        if (!this.bboxDrawStart) return;

        const start = this.bboxDrawStart;
        const end = e.lngLat;

        // Create bbox preview
        const minLon = Math.min(start.lng, end.lng);
        const maxLon = Math.max(start.lng, end.lng);
        const minLat = Math.min(start.lat, end.lat);
        const maxLat = Math.max(start.lat, end.lat);

        // Remove old preview layer
        if (this.map.getLayer('bbox-preview-outline')) {
            this.map.removeLayer('bbox-preview-outline');
        }
        if (this.map.getLayer('bbox-preview')) {
            this.map.removeLayer('bbox-preview');
        }
        if (this.map.getSource('bbox-preview')) {
            this.map.removeSource('bbox-preview');
        }

        // Add new preview layer
        this.map.addSource('bbox-preview', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [minLon, minLat],
                        [maxLon, minLat],
                        [maxLon, maxLat],
                        [minLon, maxLat],
                        [minLon, minLat]
                    ]]
                }
            }
        });

        this.map.addLayer({
            id: 'bbox-preview',
            type: 'fill',
            source: 'bbox-preview',
            paint: {
                'fill-color': '#ef4444',
                'fill-opacity': 0.2
            }
        });

        this.map.addLayer({
            id: 'bbox-preview-outline',
            type: 'line',
            source: 'bbox-preview',
            paint: {
                'line-color': '#ef4444',
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }

    onBboxDrawEnd(e) {
        if (!this.bboxDrawStart) return;

        // Remove mousemove listener
        if (this._boundOnBboxDrawMove) {
            this.map.off('mousemove', this._boundOnBboxDrawMove);
            this._boundOnBboxDrawMove = null;
        }

        const start = this.bboxDrawStart;
        const end = e.lngLat;

        const minLon = Math.min(start.lng, end.lng);
        const maxLon = Math.max(start.lng, end.lng);
        const minLat = Math.min(start.lat, end.lat);
        const maxLat = Math.max(start.lat, end.lat);

        // Set the bounding box filter
        this.setBboxFilter(minLon, minLat, maxLon, maxLat);

        // Clean up drawing state
        this.cancelBboxDrawing();
    }

    cancelBboxDrawing() {
        this.bboxDrawing = false;
        this.bboxDrawStart = null;

        // Reset button appearance
        const drawBtn = document.getElementById('drawBbox');
        drawBtn.textContent = '📍 Draw Bounding Box on Map';
        drawBtn.style.background = '';
        drawBtn.style.color = '';

        // Reset cursor
        this.map.getCanvas().style.cursor = '';

        // Remove listeners if active
        if (this._boundOnBboxDrawMove) {
            this.map.off('mousemove', this._boundOnBboxDrawMove);
            this._boundOnBboxDrawMove = null;
        }

        // Remove preview layers
        if (this.map.getLayer('bbox-preview-outline')) {
            this.map.removeLayer('bbox-preview-outline');
        }
        if (this.map.getLayer('bbox-preview')) {
            this.map.removeLayer('bbox-preview');
        }
        if (this.map.getSource('bbox-preview')) {
            this.map.removeSource('bbox-preview');
        }

        console.log('Bbox drawing mode cancelled');
    }

    setBboxFromMap() {
        if (!this.map) return;

        const bounds = this.map.getBounds();
        const minLon = bounds.getWest();
        const minLat = bounds.getSouth();
        const maxLon = bounds.getEast();
        const maxLat = bounds.getNorth();

        this.setBboxFilter(minLon, minLat, maxLon, maxLat);
    }

    setBboxFilter(minLon, minLat, maxLon, maxLat) {
        this.bboxFilter = { minLon, minLat, maxLon, maxLat };

        // Update input fields
        document.getElementById('bboxMinLon').value = minLon.toFixed(4);
        document.getElementById('bboxMinLat').value = minLat.toFixed(4);
        document.getElementById('bboxMaxLon').value = maxLon.toFixed(4);
        document.getElementById('bboxMaxLat').value = maxLat.toFixed(4);

        // Update display
        this.updateBboxDisplay();

        // Show clear button
        document.getElementById('clearBbox').style.display = 'block';

        // Render bbox on map
        this.renderBboxOnMap();

        this.updateFilterSummary();

        console.log('Bbox filter set:', this.bboxFilter);
    }

    updateBboxFromInputs() {
        const minLon = parseFloat(document.getElementById('bboxMinLon').value);
        const minLat = parseFloat(document.getElementById('bboxMinLat').value);
        const maxLon = parseFloat(document.getElementById('bboxMaxLon').value);
        const maxLat = parseFloat(document.getElementById('bboxMaxLat').value);

        if (!isNaN(minLon) && !isNaN(minLat) && !isNaN(maxLon) && !isNaN(maxLat)) {
            this.bboxFilter = { minLon, minLat, maxLon, maxLat };
            this.updateBboxDisplay();
            this.renderBboxOnMap();
            document.getElementById('clearBbox').style.display = 'block';
            this.updateFilterSummary();
        }
    }

    updateBboxDisplay() {
        const display = document.getElementById('bboxDisplay');

        if (this.bboxFilter) {
            const { minLon, minLat, maxLon, maxLat } = this.bboxFilter;
            display.innerHTML = `<span class="bbox-coords">${minLon.toFixed(4)}, ${minLat.toFixed(4)} to ${maxLon.toFixed(4)}, ${maxLat.toFixed(4)}</span>`;
        } else {
            display.innerHTML = '<span class="bbox-placeholder">Draw on map or enter coordinates</span>';
        }
    }

    renderBboxOnMap() {
        // Remove old bbox layer
        if (!this.map) return;

        // Wait for map style to load before adding sources/layers
        if (!this.map.loaded()) {
            this.map.once('load', () => this.renderBboxOnMap());
            return;
        }

        // Clean up existing layers
        if (this.map.getLayer('bbox-filter-outline')) {
            this.map.removeLayer('bbox-filter-outline');
        }
        if (this.map.getLayer('bbox-filter')) {
            this.map.removeLayer('bbox-filter');
        }
        if (this.map.getSource('bbox-filter')) {
            this.map.removeSource('bbox-filter');
        }
        if (this.map.getLayer('bbox-mask')) {
            this.map.removeLayer('bbox-mask');
        }
        if (this.map.getSource('bbox-mask')) {
            this.map.removeSource('bbox-mask');
        }

        if (!this.bboxFilter) return;

        const { minLon, minLat, maxLon, maxLat } = this.bboxFilter;

        // Add mask layer (darken outside)
        this.map.addSource('bbox-mask', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [ // World boundary (CCW)
                            [-180, -90],
                            [180, -90],
                            [180, 90],
                            [-180, 90],
                            [-180, -90]
                        ],
                        [ // Hole (BBox) - CW
                            [minLon, minLat],
                            [minLon, maxLat],
                            [maxLon, maxLat],
                            [maxLon, minLat],
                            [minLon, minLat]
                        ]
                    ]
                }
            }
        });

        this.map.addLayer({
            id: 'bbox-mask',
            type: 'fill',
            source: 'bbox-mask',
            paint: {
                'fill-color': '#000000',
                'fill-opacity': 0.5
            }
        });

        // Add bbox outline layer
        this.map.addSource('bbox-filter', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [minLon, minLat],
                        [maxLon, minLat],
                        [maxLon, maxLat],
                        [minLon, maxLat],
                        [minLon, minLat]
                    ]]
                }
            }
        });

        this.map.addLayer({
            id: 'bbox-filter-outline',
            type: 'line',
            source: 'bbox-filter',
            paint: {
                'line-color': '#ef4444',
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }

    clearBboxFilter() {
        this.bboxFilter = null;

        // Clear input fields
        document.getElementById('bboxMinLon').value = '';
        document.getElementById('bboxMinLat').value = '';
        document.getElementById('bboxMaxLon').value = '';
        document.getElementById('bboxMaxLat').value = '';

        // Update display
        this.updateBboxDisplay();

        // Hide clear button
        document.getElementById('clearBbox').style.display = 'none';

        // Remove bbox from map
        if (this.map.getLayer('bbox-filter-outline')) {
            this.map.removeLayer('bbox-filter-outline');
        }
        if (this.map.getLayer('bbox-filter')) {
            this.map.removeLayer('bbox-filter');
        }
        if (this.map.getSource('bbox-filter')) {
            this.map.removeSource('bbox-filter');
        }
        if (this.map.getLayer('bbox-mask')) {
            this.map.removeLayer('bbox-mask');
        }
        if (this.map.getSource('bbox-mask')) {
            this.map.removeSource('bbox-mask');
        }

        // Update filter summary
        this.updateFilterSummary();

        console.log('Bbox filter cleared');
    }

    // Filter UI Methods
    toggleFilters() {
        const filtersDiv = document.querySelector('.filters');
        filtersDiv.classList.toggle('collapsed');
    }

    updateFilterSummary() {
        const summary = document.getElementById('filtersSummary');
        const filters = [];

        // Check username filter
        const username = document.getElementById('username').value.trim();
        if (username) {
            filters.push(`<span class="filter-tag">👤 ${this.escapeHtml(username)}</span>`);
        }

        // Check tags filter
        const tags = document.getElementById('tags').value.trim();
        if (tags) {
            filters.push(`<span class="filter-tag">🏷️ ${this.escapeHtml(tags)}</span>`);
        }

        // Check bbox filter
        if (this.bboxFilter) {
            filters.push(`<span class="filter-tag">📍 BBox</span>`);
        }

        // Check bbox size filters
        const bboxSizeMin = document.getElementById('bboxSizeMin').value.trim();
        if (bboxSizeMin) {
            filters.push(`<span class="filter-tag">📏 Min: ${bboxSizeMin}</span>`);
        }

        const bboxSizeMax = document.getElementById('bboxSizeMax').value.trim();
        if (bboxSizeMax) {
            filters.push(`<span class="filter-tag">📏 Max: ${bboxSizeMax}</span>`);
        }

        // Check limit (only show if not default)
        const limit = document.getElementById('limit').value;
        if (limit !== '100') {
            filters.push(`<span class="filter-tag">Limit: ${limit}</span>`);
        }

        // Update summary display
        if (filters.length > 0) {
            summary.innerHTML = filters.join('');
        } else {
            summary.innerHTML = '<span style="color: #94a3b8; font-style: italic;">No filters applied</span>';
        }
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ChangesetViewer();
});
