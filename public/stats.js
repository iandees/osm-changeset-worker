document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/stats/24h');
        const data = await response.json();

        renderEditorsChart(data.top_editors);
        renderMappersChart(data.top_mappers);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
});

function processTimeSeries(data, entityKey, listKey) {
    if (!data || !data[listKey] || data[listKey].length === 0) return { labels: [], datasets: [] };

    const entities = data[listKey];
    const rawData = data.timeSeries;

    // Generate last 24h labels (buckets)
    const labels = [];
    const now = new Date();
    now.setMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 60 * 60 * 1000);
        // Format matches SQLite strftime output: YYYY-MM-DDTHH:00:00Z
        labels.push(d.toISOString().substring(0, 13) + ':00:00Z');
    }

    const datasets = entities.map((entity, index) => {
        // Generate distinct colors using HSL
        const hue = (index * 137.508) % 360; // Golden angle approximation for distribution
        const color = `hsl(${hue}, 70%, 50%)`;

        const entityData = labels.map(label => {
            const record = rawData.find(r => r[entityKey] === entity && r.hour === label);
            return record ? record.count : 0;
        });

        return {
            label: entity,
            data: entityData,
            borderColor: color,
            backgroundColor: color,
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 5
        };
    });

    // Format labels for display (local time)
    const displayLabels = labels.map(l => {
        const d = new Date(l);
        return d.getHours() + ':00';
    });

    return { labels: displayLabels, datasets };
}

function renderEditorsChart(data) {
    const ctx = document.getElementById('editorsChart').getContext('2d');
    const chartData = processTimeSeries(data, 'editor', 'topEditors');

    new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.raw}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Changesets / Hour' }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const datasetIndex = elements[0].datasetIndex;
                    const editor = chartData.datasets[datasetIndex].label;
                    // Pass raw value; app.js handles display formatting and API handles raw values
                    window.location.href = `/?tags=created_by=${encodeURIComponent(editor)}`;
                }
            }
        }
    });
}

function renderMappersChart(data) {
    const ctx = document.getElementById('mappersChart').getContext('2d');
    const chartData = processTimeSeries(data, 'user_name', 'topMappers');

    new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.raw}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Changesets / Hour' }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const datasetIndex = elements[0].datasetIndex;
                    const user = chartData.datasets[datasetIndex].label;
                    window.location.href = `/?user_name=${encodeURIComponent(user)}`;
                }
            }
        }
    });

    // Adjust height for readability
    ctx.canvas.parentNode.style.height = '600px';
}
