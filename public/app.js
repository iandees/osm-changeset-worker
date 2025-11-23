// OSM Changeset Viewer - Main Application
class ChangesetViewer {
    constructor() {
        this.changesets = [];
        this.filteredChangesets = [];
        this.selectedChangeset = null;
        this.map = null;
        this.markers = {};
        this.osmchaData = null; // Store current OSMCha data
        this.bboxFilter = null; // Store bounding box filter
        this.bboxDrawing = false; // Track if we're in bbox drawing mode
        this.bboxDrawStart = null; // Starting point for bbox drawing
        this.bboxDrawLayer = null; // Layer for drawing bbox preview

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
                        attribution: '© OpenStreetMap contributors'
                    }
                },
                layers: [{
                    id: 'osm',
                    type: 'raster',
                    source: 'osm',
                    minzoom: 0,
                    maxzoom: 19
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

        // Filter out any that don't have = sign
        return pairs.filter(pair => pair.includes('='));
    }

    applyFilters() {
        console.log('Applying filters');

        // Ensure changesets is an array before filtering
        if (!Array.isArray(this.changesets)) {
            console.warn('Changesets is not an array:', this.changesets);
            this.changesets = [];
        }

        // No client-side filters needed anymore - all filtering is done server-side
        this.filteredChangesets = this.changesets;

        console.log('Filtered changesets:', this.filteredChangesets.length);

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

        // Clear OSMCha data when filters are cleared
        this.clearOSMChaData();

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
        header.innerHTML = `Changesets <span style="font-size: 0.875rem; color: #94a3b8; font-weight: 400;">(${this.filteredChangesets.length.toLocaleString()})</span>`;

        console.log('renderChangesets called with', this.filteredChangesets.length, 'changesets');

        if (this.filteredChangesets.length === 0) {
            changesetItems.innerHTML = '<div class="loading">No changesets found</div>';
            return;
        }

        changesetItems.innerHTML = this.filteredChangesets
            .map(cs => this.createChangesetItem(cs))
            .join('');

        console.log('Rendered', this.filteredChangesets.length, 'changeset items');

        // Add click listeners
        changesetItems.querySelectorAll('.changeset-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                this.selectChangeset(this.filteredChangesets[index]);
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
        const features = this.filteredChangesets
            .filter(cs => this.hasBoundingBox(cs))
            .map(cs => ({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [cs.min_lon, cs.min_lat],
                        [cs.max_lon, cs.min_lat],
                        [cs.max_lon, cs.max_lat],
                        [cs.min_lon, cs.max_lat],
                        [cs.min_lon, cs.min_lat]
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
            }));

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
                ]
            }
        });

        console.log('Added map layers');

        // Add click handler
        this.map.on('click', 'changesets-fill', (e) => {
            const feature = e.features[0];
            const changesetId = feature.properties.id;
            const changeset = this.filteredChangesets.find(cs => cs.id === changesetId);
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

        // Add popup on hover
        const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false
        });

        this.map.on('mouseenter', 'changesets-fill', (e) => {
            const feature = e.features[0];
            const coords = e.lngLat;

            popup.setLngLat(coords)
                .setHTML(`
                    <div class="popup-title">Changeset #${feature.properties.id}</div>
                    <div class="popup-detail">👤 ${feature.properties.user_name}</div>
                    <div class="popup-detail">📝 ${feature.properties.num_changes} changes</div>
                    ${feature.properties.comment ?
                        `<div class="popup-detail">"${this.escapeHtml(feature.properties.comment)}"</div>` : ''}
                `)
                .addTo(this.map);
        });

        this.map.on('mouseleave', 'changesets-fill', () => {
            popup.remove();
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

            // If the area is very small (< 0.1 square degrees), add padding
            const minArea = 0.1;
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

                console.log(`Small changeset detected (area: ${area.toFixed(6)}). Adding padding.`);
            } else {
                bounds = [
                    [changeset.min_lon, changeset.min_lat],
                    [changeset.max_lon, changeset.max_lat]
                ];
            }

            this.map.fitBounds(bounds, {
                padding: { top: 50, bottom: 300, left: 50, right: 50 }, // Add bottom padding for panel
                maxZoom: 15
            });
        }

        // Show panel with details
        this.showChangesetDetails(changeset);

        // Fetch and render OSMCha data
        await this.loadOSMChaData(changeset.id);
    }

    async loadOSMChaData(changesetId) {
        try {
            console.log(`Fetching OSMCha data for changeset ${changesetId}`);
            const response = await fetch(`https://osmcha.org/api/v1/changesets/${changesetId}/`);

            if (!response.ok) {
                console.warn(`OSMCha API returned ${response.status} for changeset ${changesetId}`);
                return;
            }

            const data = await response.json();
            console.log('OSMCha data received:', data);

            this.osmchaData = data;
            this.renderOSMChaData();
        } catch (error) {
            console.error('Error fetching OSMCha data:', error);
        }
    }

    renderOSMChaData() {
        // Remove existing OSMCha layers first
        this.clearOSMChaData();

        if (!this.osmchaData || !this.osmchaData.geojson) {
            console.log('No GeoJSON data to render from OSMCha');
            return;
        }

        const geojson = this.osmchaData.geojson;

        // Add source for OSMCha features
        this.map.addSource('osmcha-features', {
            type: 'geojson',
            data: geojson
        });

        console.log('Added OSMCha GeoJSON source with features:', geojson.features?.length || 0);

        // Add layers for different geometry types
        // Points
        this.map.addLayer({
            id: 'osmcha-points',
            type: 'circle',
            source: 'osmcha-features',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': 6,
                'circle-color': '#ef4444',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-opacity': 0.8
            }
        });

        // Lines
        this.map.addLayer({
            id: 'osmcha-lines',
            type: 'line',
            source: 'osmcha-features',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-color': '#ef4444',
                'line-width': 3,
                'line-opacity': 0.8
            }
        });

        // Polygons fill
        this.map.addLayer({
            id: 'osmcha-polygons-fill',
            type: 'fill',
            source: 'osmcha-features',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'fill-color': '#ef4444',
                'fill-opacity': 0.3
            }
        });

        // Polygons outline
        this.map.addLayer({
            id: 'osmcha-polygons-outline',
            type: 'line',
            source: 'osmcha-features',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'line-color': '#ef4444',
                'line-width': 2,
                'line-opacity': 0.8
            }
        });

        console.log('OSMCha layers added to map');

        // Add hover interactions for OSMCha features
        const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false
        });

        ['osmcha-points', 'osmcha-lines', 'osmcha-polygons-fill'].forEach(layerId => {
            this.map.on('mouseenter', layerId, (e) => {
                this.map.getCanvas().style.cursor = 'pointer';
                const feature = e.features[0];
                const props = feature.properties;

                let html = '<div class="popup-title">OSM Feature</div>';
                if (props.osm_id) {
                    html += `<div class="popup-detail">ID: ${props.osm_id}</div>`;
                }
                if (props.name) {
                    html += `<div class="popup-detail">Name: ${this.escapeHtml(props.name)}</div>`;
                }
                if (props.action) {
                    html += `<div class="popup-detail">Action: ${props.action}</div>`;
                }

                popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
            });

            this.map.on('mouseleave', layerId, () => {
                this.map.getCanvas().style.cursor = '';
                popup.remove();
            });
        });
    }

    clearOSMChaData() {
        // Remove OSMCha layers and source
        const layers = ['osmcha-points', 'osmcha-lines', 'osmcha-polygons-fill', 'osmcha-polygons-outline'];

        layers.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

        if (this.map.getSource('osmcha-features')) {
            this.map.removeSource('osmcha-features');
        }

        this.osmchaData = null;
        console.log('Cleared OSMCha data from map');
    }

    showChangesetDetails(changeset) {
        const status = changeset.open ? 'Open' : 'Closed';
        const statusClass = changeset.open ? 'status-open' : 'status-closed';

        const tagRows = Object.entries(changeset.tags || {})
            .map(([key, value]) => `
                <tr>
                    <td style="padding: 4px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 500; color: #334155;">${this.escapeHtml(key)}</td>
                    <td style="padding: 4px 8px; border-bottom: 1px solid #e2e8f0; color: #0f172a;">${this.escapeHtml(value)}</td>
                </tr>
            `).join('');

        const panelContent = document.getElementById('panelContent');
        panelContent.innerHTML = `
            <div class="panel-header">
                <h2 style="margin: 0; font-size: 1.25rem;">Changeset #${changeset.id}</h2>
                <span class="changeset-status ${statusClass}">${status}</span>
                <a href="https://www.openstreetmap.org/changeset/${changeset.id}"
                   target="_blank"
                   class="btn btn-primary" style="margin-left: auto; padding: 0.25rem 0.75rem; font-size: 0.875rem;">
                    View on OpenStreetMap ↗
                </a>
            </div>

            <div class="panel-grid">
                <div class="panel-section">
                    <p>👤 ${this.escapeHtml(changeset.user_name || 'Unknown')}
                       ${changeset.user_id ? `<span style="color: #94a3b8; font-size: 0.875rem;">(ID: ${changeset.user_id})</span>` : ''}</p>
                    <p>📝 ${changeset.num_changes || 0} changes</p>
                    <p>💬 ${changeset.comments_count || 0} comments</p>
                    <p>📅 ${new Date(changeset.created_at).toLocaleString()}</p>
                    <p>🚫 ${changeset.closed_at ? new Date(changeset.closed_at).toLocaleString() : '<span style="color: #94a3b8; font-size: 0.875rem;">(Still open)</span>'}</p>
                </div>

                <div class="panel-section">
                    <h3>Tags</h3>
                    ${tagRows ? `
                        <div style="overflow-x: auto;">
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
                    ` : '<p style="color: #64748b; font-style: italic;">No tags</p>'}
                </div>
            </div>
        `;

        document.getElementById('changesetDetailPanel').classList.add('active');
    }

    closePanel() {
        document.getElementById('changesetDetailPanel').classList.remove('active');

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

        // Clear OSMCha data
        this.clearOSMChaData();
    }

    fitAllChangesets() {
        const changesetsWithBbox = this.filteredChangesets.filter(cs => this.hasBoundingBox(cs));

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

        if (this.map.getLayer('bbox-filter-outline')) {
            this.map.removeLayer('bbox-filter-outline');
        }
        if (this.map.getLayer('bbox-filter')) {
            this.map.removeLayer('bbox-filter');
        }
        if (this.map.getSource('bbox-filter')) {
            this.map.removeSource('bbox-filter');
        }

        if (!this.bboxFilter) return;

        const { minLon, minLat, maxLon, maxLat } = this.bboxFilter;

        // Add bbox layer
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
            id: 'bbox-filter',
            type: 'fill',
            source: 'bbox-filter',
            paint: {
                'fill-color': '#f59e0b',
                'fill-opacity': 0.1
            }
        });

        this.map.addLayer({
            id: 'bbox-filter-outline',
            type: 'line',
            source: 'bbox-filter',
            paint: {
                'line-color': '#f59e0b',
                'line-width': 3
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
