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
        this.adiffData = null; // Store adiff GeoJSON data
        this.adiffPopup = null; // Currently open adiff popup
        this.focusedIndex = -1; // Track focused changeset in list
        this.readChangesets = new Set(); // Track read changesets
        this.initialChangesetId = null; // Track initial changeset from URL

        this.init();
    }

    async init() {
        this.loadReadStatus();
        this.initMap();
        this.initEventListeners();
        this.loadFiltersFromUrl();
        await this.loadChangesets('initial');
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
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

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

        // Pagination buttons
        document.getElementById('loadMoreBtn').addEventListener('click', () => {
            this.loadChangesets('older');
        });

        document.getElementById('loadNewBtn').addEventListener('click', () => {
            this.loadChangesets('newer');
        });
    }

    handleKeyboardShortcuts(e) {
        // Ignore if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        switch (e.key) {
            case 'j':
                this.moveFocus(1);
                break;
            case 'k':
                this.moveFocus(-1);
                break;
            case '/':
                e.preventDefault();
                const usernameInput = document.getElementById('username');
                if (usernameInput) {
                    usernameInput.focus();
                    usernameInput.select();
                }
                break;
            case 'r':
                if (this.focusedIndex >= 0 && this.focusedIndex < this.changesets.length) {
                    this.toggleReadStatus(this.changesets[this.focusedIndex]);
                }
                break;
            case '?':
                this.toggleHelpPopup();
                break;
        }
    }

    toggleHelpPopup() {
        let popup = document.getElementById('keyboard-help-popup');
        if (popup) {
            popup.remove();
            return;
        }

        popup = document.createElement('div');
        popup.id = 'keyboard-help-popup';
        popup.className = 'help-popup';
        popup.innerHTML = `
            <div class="help-popup-content">
                <h3>Keyboard Shortcuts</h3>
                <ul class="shortcut-list">
                    <li><span class="key">j</span> <span class="desc">Select next changeset</span></li>
                    <li><span class="key">k</span> <span class="desc">Select previous changeset</span></li>
                    <li><span class="key">/</span> <span class="desc">Focus username search</span></li>
                    <li><span class="key">r</span> <span class="desc">Toggle read/unread status</span></li>
                    <li><span class="key">?</span> <span class="desc">Show this help</span></li>
                </ul>
                <button class="close-help-btn">Close</button>
            </div>
        `;

        document.body.appendChild(popup);

        popup.querySelector('.close-help-btn').addEventListener('click', () => {
            popup.remove();
        });

        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.remove();
            }
        });
    }

    moveFocus(delta) {
        if (this.changesets.length === 0) return;

        const prevIndex = this.focusedIndex;

        // Initialize focus if none
        if (this.focusedIndex === -1) {
            this.focusedIndex = delta > 0 ? 0 : this.changesets.length - 1;
        } else {
            this.focusedIndex += delta;
        }

        // Clamp index
        if (this.focusedIndex < 0) this.focusedIndex = 0;
        if (this.focusedIndex >= this.changesets.length) this.focusedIndex = this.changesets.length - 1;

        if (this.focusedIndex === prevIndex) return;

        this.updateFocusVisuals();
        this.selectChangeset(this.changesets[this.focusedIndex]);
    }

    updateFocusVisuals() {
        const items = document.querySelectorAll('.changeset-item');
        items.forEach((item, index) => {
            if (index === this.focusedIndex) {
                item.classList.add('focused');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                item.classList.remove('focused');
            }
        });
    }

    async loadChangesets(mode = 'initial') {
        // mode: 'initial', 'newer', 'older'
        const username = document.getElementById('username').value.trim();
        const tagsInput = document.getElementById('tags').value.trim();
        const bboxSizeMin = document.getElementById('bboxSizeMin').value.trim();
        const bboxSizeMax = document.getElementById('bboxSizeMax').value.trim();

        try {
            const changesetItems = document.getElementById('changesetItems');
            const loadMoreBtn = document.getElementById('loadMoreBtn');
            const loadNewBtn = document.getElementById('loadNewBtn');
            const loadMoreContainer = document.getElementById('loadMoreContainer');
            const loadNewContainer = document.getElementById('loadNewContainer');

            if (mode === 'initial') {
                changesetItems.innerHTML = '<div class="loading">Loading changesets...</div>';
                loadMoreContainer.style.display = 'none';
                loadNewContainer.style.display = 'none';
                this.changesets = [];
            } else if (mode === 'older') {
                loadMoreBtn.textContent = 'Loading...';
                loadMoreBtn.disabled = true;
            } else if (mode === 'newer') {
                loadNewBtn.textContent = 'Loading...';
                loadNewBtn.disabled = true;
            }

            // Build query parameters
            const params = new URLSearchParams();

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

            // Parse tags input
            if (tagsInput) {
                const tagPairs = this.parseTagsInput(tagsInput);
                tagPairs.forEach(pair => {
                    params.append('tags', pair);
                });
            }

            // Add pagination params
            if (mode === 'initial' && this.initialChangesetId) {
                // Anchor the list around the selected changeset so the
                // surrounding entries are chronologically adjacent.
                params.set('before_id', this.initialChangesetId + 1);
            } else if (mode === 'older' && this.changesets.length > 0) {
                const oldestId = this.changesets[this.changesets.length - 1].id;
                params.set('before_id', oldestId);
            } else if (mode === 'newer' && this.changesets.length > 0) {
                const newestId = this.changesets[0].id;
                params.set('after_id', newestId);
            }

            // Update RSS Link (only for base filters)
            if (mode === 'initial') {
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
                // Only replace state if we are just reloading, push if it's a new filter action
                // But here we don't know easily. Let's assume pushState for now unless it's a reload.
                // For simplicity, just replaceState to avoid cluttering history with every filter change?
                // The original code had a replaceUrl param.
                window.history.replaceState({}, '', newUrl);
            }

            const queryString = params.toString();
            const url = `/api/changesets?${queryString}`;
            console.log('Fetching from:', url);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Process new changesets
            let newChangesets = [];
            if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
                newChangesets = data.features.map(feature => {
                    const cs = feature.properties;
                    if (feature.geometry && feature.geometry.type === 'Polygon') {
                        const coords = feature.geometry.coordinates[0];
                        const lons = coords.map(c => c[0]);
                        const lats = coords.map(c => c[1]);
                        cs.min_lon = Math.min(...lons);
                        cs.max_lon = Math.max(...lons);
                        cs.min_lat = Math.min(...lats);
                        cs.max_lat = Math.max(...lats);
                    }
                    if (cs.user && !cs.user_name) cs.user_name = cs.user;
                    if (cs.uid && !cs.user_id) cs.user_id = cs.uid;
                    return cs;
                });
            } else if (Array.isArray(data)) {
                newChangesets = data;
            }

            console.log(`Loaded ${newChangesets.length} changesets (mode: ${mode})`);

            if (mode === 'initial') {
                this.changesets = newChangesets;
                // Show load more if we got a full page (assuming default limit 25)
                loadMoreContainer.style.display = newChangesets.length >= 25 ? 'block' : 'none';
                // Always show load new container, but maybe hide button if no new ones?
                // Actually, "Load New" is always valid to check for updates.
                loadNewContainer.style.display = 'block';
            } else if (mode === 'older') {
                if (newChangesets.length > 0) {
                    this.changesets = [...this.changesets, ...newChangesets];
                } else {
                    loadMoreBtn.textContent = 'No more changesets';
                    setTimeout(() => {
                        loadMoreBtn.textContent = 'Load More';
                        loadMoreContainer.style.display = 'none';
                    }, 2000);
                }
                loadMoreBtn.disabled = false;
                loadMoreBtn.textContent = 'Load More';
            } else if (mode === 'newer') {
                if (newChangesets.length > 0) {
                    // Prepend new changesets
                    this.changesets = [...newChangesets, ...this.changesets];
                } else {
                    loadNewBtn.textContent = 'No new changesets';
                    setTimeout(() => {
                        loadNewBtn.textContent = 'Load New Changesets';
                    }, 2000);
                }
                loadNewBtn.disabled = false;
                loadNewBtn.textContent = 'Load New Changesets';
            }

            // Handle initial changeset permalink (only on initial load)
            if (mode === 'initial' && this.initialChangesetId) {
                const found = this.changesets.find(cs => cs.id === this.initialChangesetId);
                if (found) {
                    setTimeout(() => this.selectChangeset(found), 100);
                } else {
                    // Changeset didn't match the current filters — fetch it
                    // individually and prepend so the user can still see it.
                    try {
                        const res = await fetch(`/api/changesets/${this.initialChangesetId}`);
                        if (res.ok) {
                            const feature = await res.json();
                            const cs = feature.properties;
                            if (feature.geometry && feature.geometry.type === 'Polygon') {
                                const coords = feature.geometry.coordinates[0];
                                const lons = coords.map(c => c[0]);
                                const lats = coords.map(c => c[1]);
                                cs.min_lon = Math.min(...lons);
                                cs.max_lon = Math.max(...lons);
                                cs.min_lat = Math.min(...lats);
                                cs.max_lat = Math.max(...lats);
                            }
                            if (cs.user && !cs.user_name) cs.user_name = cs.user;
                            if (cs.uid && !cs.user_id) cs.user_id = cs.uid;

                            this.changesets.unshift(cs);
                            setTimeout(() => this.selectChangeset(cs), 100);
                        }
                    } catch (e) {
                        console.error('Failed to fetch initial changeset', e);
                    }
                }
                this.initialChangesetId = null;
            }

            // Render
            this.renderChangesets(mode === 'newer'); // Pass true to maintain scroll position if newer
            this.renderMap();
            this.updateFilterSummary();

            if (mode === 'initial') {
                // Scroll down to hide the load new button
                const listContainer = document.querySelector('.changeset-list');
                if (loadNewContainer && listContainer) {
                    // Use setTimeout to ensure layout is complete
                    setTimeout(() => {
                        listContainer.scrollTop = loadNewContainer.offsetHeight;
                    }, 0);
                }
            }

        } catch (error) {
            console.error('Error loading changesets:', error);
            if (mode === 'initial') {
                this.changesets = [];
                document.getElementById('changesetItems').innerHTML =
                    '<div class="error">Failed to load changesets. Please try again.</div>';
            }
        }
    }

    loadFiltersFromUrl() {
        // Check for permalink in path
        const pathMatch = window.location.pathname.match(/\/changeset\/(\d+)/);
        if (pathMatch) {
            this.initialChangesetId = parseInt(pathMatch[1]);
            console.log('Initial changeset ID from URL:', this.initialChangesetId);
        }

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
    }

    parseTagsInput(input) {
        // Parse tags input supporting quoted values for spaces
        // Examples:
        //   comment=test created_by=iD  ->  ["comment=test", "created_by=iD"]
        //   created_by="iD 2.37.3"      ->  ["created_by=iD 2.37.3"]
        //   comment=test key="value with spaces" other=simple  ->  ["comment=test", "key=value with spaces", "other=simple"]
        //   key!=value                  ->  ["key!=value"]
        //   key~value                   ->  ["key~value"]

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

        // Filter out any that don't have a valid operator (=, !=, ~)
        return pairs.filter(pair => pair.includes('=') || pair.includes('~'));
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

    loadReadStatus() {
        try {
            const stored = localStorage.getItem('osm_changeset_viewer_read');
            if (stored) {
                this.readChangesets = new Set(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load read status', e);
        }
    }

    saveReadStatus() {
        try {
            localStorage.setItem('osm_changeset_viewer_read', JSON.stringify([...this.readChangesets]));
        } catch (e) {
            console.error('Failed to save read status', e);
        }
    }

    markAsRead(changeset) {
        if (!changeset || this.readChangesets.has(changeset.id)) return;
        this.readChangesets.add(changeset.id);
        this.saveReadStatus();
        this.updateReadVisuals(changeset.id);
    }

    toggleReadStatus(changeset) {
        if (!changeset) return;
        if (this.readChangesets.has(changeset.id)) {
            this.readChangesets.delete(changeset.id);
        } else {
            this.readChangesets.add(changeset.id);
        }
        this.saveReadStatus();
        this.updateReadVisuals(changeset.id);
    }

    updateReadVisuals(id) {
        const item = document.querySelector(`.changeset-item[data-id="${id}"]`);
        if (item) {
            if (this.readChangesets.has(id)) {
                item.classList.add('read');
            } else {
                item.classList.remove('read');
            }
        }
    }

    renderChangesets(maintainScroll = false) {
        const changesetItems = document.getElementById('changesetItems');
        const listContainer = document.querySelector('.changeset-list');

        // Capture scroll position and height before update
        const previousScrollHeight = listContainer.scrollHeight;
        const previousScrollTop = listContainer.scrollTop;

        // Reset focus when list reloads (only if not maintaining scroll/prepending?)
        // If we are loading newer items, the indices shift.
        // If we are loading older items, the indices stay same (0 is still 0).
        // But if we prepend, index 0 becomes index N.
        // For simplicity, let's reset focus if we are doing a full reload,
        // but try to keep it if we are just appending/prepending?
        // Actually, re-rendering everything invalidates the DOM elements, so we lose focus anyway.
        // We would need to find the previously selected ID and re-highlight it.

        // Update the header with count
        const header = document.getElementById('changesetListHeader');
        header.innerHTML = `Changesets <span class="header-count">(${this.changesets.length.toLocaleString()})</span>`;

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
                this.focusedIndex = index; // Update focus on click
                this.updateFocusVisuals();
                this.selectChangeset(this.changesets[index]);
            });
        });

        // Restore selection visual state
        if (this.selectedChangeset) {
            const item = document.querySelector(`.changeset-item[data-id="${this.selectedChangeset.id}"]`);
            if (item) {
                item.classList.add('active');
                // Update focusedIndex to match new position
                const newIndex = this.changesets.findIndex(cs => cs.id === this.selectedChangeset.id);
                if (newIndex !== -1) {
                    this.focusedIndex = newIndex;
                }
            }
        }

        // Restore scroll position if needed
        if (maintainScroll) {
             const newScrollHeight = listContainer.scrollHeight;
             listContainer.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
        }
    }

    createChangesetItem(changeset) {
        const statusClass = changeset.open ? 'status-open' : 'status-closed';
        const status = changeset.open ? 'Open' : 'Closed';
        const readClass = this.readChangesets.has(changeset.id) ? 'read' : '';
        const comment = changeset.tags?.comment || '';
        const commentHtml = comment ?
            `<div class="changeset-comment">"${this.escapeHtml(comment)}"</div>` : '';

        const date = new Date(changeset.created_at);
        const timeAgo = this.getTimeAgo(date);

        return `
            <div class="changeset-item ${readClass}" data-id="${changeset.id}">
                <div class="changeset-header">
                    <span class="changeset-id">#${changeset.id}</span>
                    <span class="changeset-status ${statusClass}">${status}</span>
                </div>
                <div class="changeset-user"><i class="ph ph-user" title="User"></i> ${this.escapeHtml(changeset.user_name || 'Unknown')}</div>
                <div class="changeset-meta">
                    <span><i class="ph ph-pencil-simple" title="Changes count"></i> ${changeset.num_changes || 0} changes</span>
                    <span><i class="ph ph-clock" title="Time ago"></i> ${timeAgo}</span>
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
        // Update URL to permalink
        const params = new URLSearchParams(window.location.search);
        const newUrl = `/changeset/${changeset.id}?${params.toString()}`;
        window.history.pushState({}, '', newUrl);

        // Mark as read when selected
        this.markAsRead(changeset);

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

        // Sync focusedIndex if selection didn't come from keyboard/list click
        const index = this.changesets.findIndex(cs => cs.id === changeset.id);
        if (index !== -1 && index !== this.focusedIndex) {
            this.focusedIndex = index;
            this.updateFocusVisuals();
        }

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
        this.adiffData = geojson;

        // Pre-process features to identify untagged nodes
        geojson.features.forEach(f => {
            let hasTags = false;
            if (f.properties.tags) {
                let tags = f.properties.tags;
                if (typeof tags === 'string') {
                    try { tags = JSON.parse(tags); } catch(e) {}
                }
                if (tags && Object.keys(tags).length > 0) {
                    hasTags = true;
                }
            }
            f.properties.hasTags = hasTags;
        });

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

        // Process features to highlight geometry changes
        const processedFeatures = [];
        const modifiedWays = {};

        geojson.features.forEach(f => {
            const p = f.properties;
            if (p.changeType === 'modify' && f.geometry.type === 'LineString') {
                if (!modifiedWays[p.id]) modifiedWays[p.id] = {};
                modifiedWays[p.id][p.version] = f;
            } else {
                processedFeatures.push(f);
            }
        });

        Object.keys(modifiedWays).forEach(id => {
            const pair = modifiedWays[id];
            if (pair.old && pair.new) {
                const oldCoords = pair.old.geometry.coordinates;
                const newCoords = pair.new.geometry.coordinates;

                const oldSegments = [];
                for (let i = 0; i < oldCoords.length - 1; i++) {
                    oldSegments.push([oldCoords[i], oldCoords[i+1]]);
                }
                const newSegments = [];
                for (let i = 0; i < newCoords.length - 1; i++) {
                    newSegments.push([newCoords[i], newCoords[i+1]]);
                }

                const oldSegStrings = new Set(oldSegments.map(s => JSON.stringify(s)));
                const newSegStrings = new Set(newSegments.map(s => JSON.stringify(s)));

                const unchangedCoords = newSegments.filter(s => oldSegStrings.has(JSON.stringify(s)));
                const changedNewCoords = newSegments.filter(s => !oldSegStrings.has(JSON.stringify(s)));
                const changedOldCoords = oldSegments.filter(s => !newSegStrings.has(JSON.stringify(s)));

                const isGeometryChanged = changedNewCoords.length > 0 || changedOldCoords.length > 0;

                if (isGeometryChanged) {
                    if (unchangedCoords.length > 0) {
                        processedFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'MultiLineString', coordinates: unchangedCoords },
                            properties: { ...pair.new.properties, diffStatus: 'unchanged' }
                        });
                    }
                    if (changedNewCoords.length > 0) {
                        processedFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'MultiLineString', coordinates: changedNewCoords },
                            properties: { ...pair.new.properties, diffStatus: 'changed' }
                        });
                    }
                    if (changedOldCoords.length > 0) {
                        processedFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'MultiLineString', coordinates: changedOldCoords },
                            properties: { ...pair.old.properties, diffStatus: 'changed' }
                        });
                    }
                } else {
                    processedFeatures.push(pair.old);
                    processedFeatures.push(pair.new);
                }
            } else {
                if (pair.old) processedFeatures.push(pair.old);
                if (pair.new) processedFeatures.push(pair.new);
            }
        });

        // Add source
        this.map.addSource('adiff', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: processedFeatures
            }
        });

        // Add line layer
        this.map.addLayer({
            id: 'adiff-lines',
            type: 'line',
            source: 'adiff',
            filter: ['!=', ['geometry-type'], 'Point'],
            paint: {
                'line-width': [
                    'case',
                    ['==', ['get', 'diffStatus'], 'unchanged'],
                    2,
                    4
                ],
                'line-color': [
                    'case',
                    ['==', ['get', 'diffStatus'], 'unchanged'],
                    '#94a3b8', // Grey for unchanged parts
                    [
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
                    ]
                ],
                'line-opacity': [
                    'case',
                    ['==', ['get', 'diffStatus'], 'unchanged'],
                    0.3,
                    0.8
                ]
            }
        });

        // Add point layer
        this.map.addLayer({
            id: 'adiff-points',
            type: 'circle',
            source: 'adiff',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': [
                    'case',
                    ['boolean', ['get', 'hasTags'], false],
                    5,
                    3 // Smaller for untagged
                ],
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
                'circle-opacity': [
                    'case',
                    ['boolean', ['get', 'hasTags'], false],
                    1,
                    0.5 // Less opaque for untagged
                ],
                'circle-stroke-width': [
                    'case',
                    ['boolean', ['get', 'hasTags'], false],
                    1,
                    0 // No stroke for untagged
                ],
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

        // Close any open adiff popup
        try {
            if (this.adiffPopup) {
                this.adiffPopup.remove();
                this.adiffPopup = null;
            }
        } catch (e) {
            console.warn('Failed to remove adiff popup', e);
        }

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

        let tags = {};
        if (props.tags) {
            if (typeof props.tags === 'string') {
                try { tags = JSON.parse(props.tags); } catch(e) {}
            } else {
                tags = props.tags;
            }
        }

        let tagsHtml = '';
        let metadataHtml = '';

        // If modify, try to find the other version to diff
        if (props.changeType === 'modify' && this.adiffData) {
            const currentVersion = props.version; // 'new' or 'old'
            const otherVersion = currentVersion === 'new' ? 'old' : 'new';

            const otherFeature = this.adiffData.features.find(f =>
                f.properties.id === props.id &&
                f.properties.type === props.type &&
                f.properties.version === otherVersion
            );

            if (otherFeature) {
                let otherTags = otherFeature.properties.tags;
                if (typeof otherTags === 'string') {
                    try { otherTags = JSON.parse(otherTags); } catch(e) {}
                } else if (!otherTags) {
                    otherTags = {};
                }

                const oldTags = currentVersion === 'new' ? otherTags : tags;
                const newTags = currentVersion === 'new' ? tags : otherTags;

                tagsHtml = this.generateTagDiffHtml(oldTags, newTags);

                // Generate metadata diff
                const oldProps = currentVersion === 'new' ? otherFeature.properties : props;
                const newProps = currentVersion === 'new' ? props : otherFeature.properties;
                metadataHtml = this.generateMetadataDiff(oldProps, newProps);
            } else {
                tagsHtml = this.generateTagsTable(tags);
                metadataHtml = this.generateMetadata(props);
            }
        } else {
            tagsHtml = this.generateTagsTable(tags);
            metadataHtml = this.generateMetadata(props);
        }

        const changeClass = this.getChangeClass(props.changeType, props.version);

        const content = `
            <div class="popup-content">
                <h3>${props.type}/${props.id}</h3>
                <div class="popup-meta">
                    <span class="change-type ${changeClass}">${props.changeType}</span>
                    ${props.version ? `<span class="version-text">(${props.version})</span>` : ''}
                </div>
                ${metadataHtml}
                ${tagsHtml ? `<div class="popup-tags">${tagsHtml}</div>` : ''}
            </div>
        `;

        // Remove existing popup if present
        if (this.adiffPopup) {
            try { this.adiffPopup.remove(); } catch (e) { /* ignore */ }
            this.adiffPopup = null;
        }

        this.adiffPopup = new maplibregl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(content)
            .addTo(this.map);
    }

    generateTagsTable(tags) {
        if (Object.keys(tags).length === 0) return '';
        let html = '<table class="popup-table">';
        for (const [k, v] of Object.entries(tags)) {
            html += `<tr><td>${this.escapeHtml(k)}</td><td>${this.formatTagValue(v, k)}</td></tr>`;
        }
        html += '</table>';
        return html;
    }

    generateTagDiffHtml(oldTags, newTags) {
        const allKeys = new Set([...Object.keys(oldTags), ...Object.keys(newTags)]);
        if (allKeys.size === 0) return '';

        let html = '<table class="popup-table">';
        const sortedKeys = Array.from(allKeys).sort();

        for (const key of sortedKeys) {
            const oldVal = oldTags[key];
            const newVal = newTags[key];

            if (oldVal === newVal) {
                // Unchanged
                html += `<tr><td class="version-text">${this.escapeHtml(key)}</td><td class="version-text">${this.formatTagValue(newVal, key)}</td></tr>`;
            } else if (oldVal === undefined) {
                // Added
                html += `<tr class="diff-add"><td>+ ${this.escapeHtml(key)}</td><td>${this.formatTagValue(newVal, key)}</td></tr>`;
            } else if (newVal === undefined) {
                // Deleted
                html += `<tr class="diff-del"><td>- ${this.escapeHtml(key)}</td><td>${this.formatTagValue(oldVal, key)}</td></tr>`;
            } else {
                // Modified
                html += `<tr class="diff-mod"><td class="diff-mod-key">~ ${this.escapeHtml(key)}</td><td><span class="diff-old-val">${this.formatTagValue(oldVal, key)}</span> <span class="diff-new-val">${this.formatTagValue(newVal, key)}</span></td></tr>`;
            }
        }
        html += '</table>';
        return html;
    }

    getChangeClass(type, version) {
        if (type === 'create') return 'text-create';
        if (type === 'delete') return 'text-delete';
        if (type === 'modify') return version === 'new' ? 'text-modify-new' : 'text-modify-old';
        return '';
    }

    // Deprecated: kept for reference if needed, but replaced by getChangeClass
    getChangeColor(type, version) {
        if (type === 'create') return '#10b981';
        if (type === 'delete') return '#ef4444';
        if (type === 'modify') return version === 'new' ? '#3b82f6' : '#f59e0b';
        return '#333';
    }

    generateMetadata(props) {
        let html = '<div class="popup-metadata">';

        if (props.user) {
            const userLink = props.uid ?
                `<a href="https://www.openstreetmap.org/user/${encodeURIComponent(props.user)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(props.user)}</a>` :
                this.escapeHtml(props.user);
            html += `<div><strong>User:</strong> ${userLink}</div>`;
        }

        if (props.timestamp) {
            const date = new Date(props.timestamp);
            html += `<div><strong>Time:</strong> ${date.toLocaleString()}</div>`;
        }

        if (props.changeset) {
            html += `<div><strong>Changeset:</strong> <a href="https://www.openstreetmap.org/changeset/${props.changeset}" target="_blank" rel="noopener noreferrer">${props.changeset}</a></div>`;
        }

        html += '</div>';
        return html;
    }

    generateMetadataDiff(oldProps, newProps) {
        let html = '<div class="popup-metadata">';

        // User comparison
        if (oldProps.user !== newProps.user) {
            const oldUserLink = oldProps.uid ?
                `<a href="https://www.openstreetmap.org/user/${encodeURIComponent(oldProps.user)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(oldProps.user)}</a>` :
                this.escapeHtml(oldProps.user);
            const newUserLink = newProps.uid ?
                `<a href="https://www.openstreetmap.org/user/${encodeURIComponent(newProps.user)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(newProps.user)}</a>` :
                this.escapeHtml(newProps.user);
            html += `<div><strong>User:</strong> <span class="diff-old-val">${oldUserLink}</span> → <span class="diff-new-val">${newUserLink}</span></div>`;
        } else if (newProps.user) {
            const userLink = newProps.uid ?
                `<a href="https://www.openstreetmap.org/user/${encodeURIComponent(newProps.user)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(newProps.user)}</a>` :
                this.escapeHtml(newProps.user);
            html += `<div><strong>User:</strong> ${userLink}</div>`;
        }

        // Timestamp comparison
        if (oldProps.timestamp !== newProps.timestamp) {
            const oldDate = new Date(oldProps.timestamp);
            const newDate = new Date(newProps.timestamp);
            html += `<div><strong>Time:</strong> <span class="diff-old-val">${oldDate.toLocaleString()}</span> → <span class="diff-new-val">${newDate.toLocaleString()}</span></div>`;
        } else if (newProps.timestamp) {
            const date = new Date(newProps.timestamp);
            html += `<div><strong>Time:</strong> ${date.toLocaleString()}</div>`;
        }

        // Changeset comparison
        if (oldProps.changeset !== newProps.changeset) {
            html += `<div><strong>Changeset:</strong> <span class="diff-old-val"><a href="https://www.openstreetmap.org/changeset/${oldProps.changeset}" target="_blank" rel="noopener noreferrer">${oldProps.changeset}</a></span> → <span class="diff-new-val"><a href="https://www.openstreetmap.org/changeset/${newProps.changeset}" target="_blank" rel="noopener noreferrer">${newProps.changeset}</a></span></div>`;
        } else if (newProps.changeset) {
            html += `<div><strong>Changeset:</strong> <a href="https://www.openstreetmap.org/changeset/${newProps.changeset}" target="_blank" rel="noopener noreferrer">${newProps.changeset}</a></div>`;
        }

        html += '</div>';
        return html;
    }

    showChangesetDetails(changeset) {
        const status = changeset.open ? 'Open' : 'Closed';
        const statusClass = changeset.open ? 'status-open' : 'status-closed';

        const createdBy = changeset.tags && changeset.tags['created_by'];
        const createdByHtml = createdBy ? `
            <p><i class="ph ph-wrench" title="Editor"></i> ${this.escapeHtml(createdBy)}
               <button class="filter-tag-btn btn-filter-inline" title="Filter by this editor" data-tag="created_by=${this.escapeHtml(createdBy)}"><i class="ph ph-magnifying-glass"></i></button>
            </p>` : '';

        const comment = changeset.tags?.comment || '';

        const tagRows = Object.entries(changeset.tags || {})
            .map(([key, value]) => `
                <tr>
                    <td>${this.escapeHtml(key)}</td>
                    <td>${this.formatTagValue(value, key)}</td>
                </tr>
            `).join('');

        const panelContent = document.getElementById('panelContent');
        panelContent.innerHTML = `
            <div class="panel-header">
                <div class="panel-title-row">
                    <h2>Changeset #${changeset.id}</h2>
                    <span class="changeset-status ${statusClass}">${status}</span>
                </div>
                <div class="panel-links">
                    <a href="https://www.openstreetmap.org/changeset/${changeset.id}"
                       target="_blank"
                       class="panel-link" title="View on OpenStreetMap">
                        View on OSM <i class="ph ph-arrow-square-out"></i>
                    </a>
                    <a href="https://osmcha.org/changesets/${changeset.id}"
                       target="_blank"
                       class="panel-link" title="View on OSMCha">
                        View on OSMCha <i class="ph ph-arrow-square-out"></i>
                    </a>
                </div>
            </div>

            <div class="panel-grid">
                <div class="panel-section">
                    ${comment ? `<div class="panel-comment">${this.escapeHtml(comment)}</div>` : ''}
                    <p><i class="ph ph-user" title="User"></i> ${this.escapeHtml(changeset.user_name || 'Unknown')}
                       <button class="filter-user-btn btn-filter-inline" title="Filter by this user" data-username="${this.escapeHtml(changeset.user_name || '')}"><i class="ph ph-magnifying-glass"></i></button>
                       ${changeset.user_id ? `<span class="user-id">(ID: ${changeset.user_id})</span>` : ''}</p>
                    ${createdByHtml}
                    <p><i class="ph ph-pencil-simple" title="Changes count"></i> ${changeset.num_changes || 0} changes</p>
                    <p><i class="ph ph-chat-circle" title="Comments count"></i> ${changeset.comments_count || 0} comments</p>
                    <p><i class="ph ph-calendar" title="Created at"></i> ${new Date(changeset.created_at).toLocaleString()}</p>
                    <p><i class="ph ph-prohibit" title="Closed at"></i> ${changeset.closed_at ? new Date(changeset.closed_at).toLocaleString() : '<span class="status-text-muted">(Still open)</span>'}</p>
                </div>

                <div class="panel-section">
                    <details>
                        <summary class="tags-summary">Tags</summary>
                        ${tagRows ? `
                            <div class="tags-table-container">
                                <table class="tags-table">
                                    <thead>
                                        <tr style="background-color: #f1f5f9;">
                                            <th>Key</th>
                                            <th>Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tagRows}
                                    </tbody>
                                </table>
                            </div>
                        ` : '<p class="no-tags">No tags</p>'}
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

        // Revert URL to base
        const params = new URLSearchParams(window.location.search);
        const newUrl = `/?${params.toString()}`;
        window.history.pushState({}, '', newUrl);

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

    formatTagValue(text, key) {
        if (!text) return '';

        // Normalize newlines: replace &#10; and &#13; with actual newlines
        const normalizedText = text.replace(/&#10;/g, '\n').replace(/&#13;/g, '\r');

        // Handle Wikidata
        if (key && (key === 'wikidata' || key.endsWith(':wikidata'))) {
            if (/^Q\d+$/.test(normalizedText)) {
                const url = `https://www.wikidata.org/wiki/${normalizedText}`;
                return `<a href="${url}" target="_blank" rel="nofollow noreferrer">${this.escapeHtml(normalizedText)}</a>`;
            }
        }

        // Handle Wikipedia
        if (key && (key === 'wikipedia' || key.endsWith(':wikipedia'))) {
            const match = normalizedText.match(/^([a-z-]+):(.+)$/);
            if (match) {
                const lang = match[1];
                const article = match[2];
                const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`;
                return `<a href="${url}" target="_blank" rel="nofollow noreferrer">${this.escapeHtml(normalizedText)}</a>`;
            }
        }

        // Simple regex for URLs starting with http/https
        const urlRegex = /(https?:\/\/[^\s]+)/g;

        return normalizedText.split(urlRegex).map(part => {
            if (part.match(/^https?:\/\//)) {
                // It's a URL
                const url = this.escapeHtml(part);
                return `<a href="${url}" target="_blank" rel="nofollow noreferrer">${url}</a>`;
            } else {
                // It's regular text
                return this.escapeHtml(part).replace(/\n/g, '<br>');
            }
        }).join('');
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

        // Update summary display
        if (filters.length > 0) {
            summary.innerHTML = filters.join('');
        } else {
            summary.innerHTML = '<span class="empty-filters">No filters applied</span>';
        }
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ChangesetViewer();
});
