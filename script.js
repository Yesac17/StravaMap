/**
 * Author: Casey DeBoth
 * ===============================================
 * Interactive Route Map + Elevation & Pace Charts
 * ===============================================
 * - Loads GeoJSON route and trackpoint data
 * - Displays Leaflet map centered on Menomonie
 * - Computes total distance, elevation, and pace
 * - Builds synced elevation and pace charts
 * - Shows popups and mile markers on the map
 */


// ==================== 1. MAP INITIALIZATION ====================

const map = L.map('map').setView([44.8765, -91.9207], 13);

// Add OpenStreetMap tiles Layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);

// ==================== 2. HELPER FUNCTIONS ======================

// Compute squared distance between two points (used for nearest-point lookup)
function distanceSq(a,b) {
            return (a.lat - b.lat) ** 2 + (a.lon - b.lng) ** 2;
        }

 // Great-circle distance using the Haversine formula (returns km)
function haversine(p1, p2) {
    const R = 6371; //Earth radius in km
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lon - p1.lon);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // in km
}

// Extract numeric data from <gpxtpx:...> tags (ex. heart rate)
function extractFromExtension(xmlStr, tag) {
        const match = xmlStr.match(new RegExp(`<gpxtpx:${tag}>(\\d+)</gpxtpx:${tag}>`));
        return match ? match[1]: null;
}


// ==================== 3. LOAD and Process GeoJSON Data ====================
const dropdown = document.getElementById('colorSelect');
Promise.all([
    fetch('routes/tracks.geojson').then(res => res.json()),
    fetch('routes/track_points.geojson').then(res => res.json())
]).then(([trackData, pointData]) => {

    // ------ Draw Route Polyline on Map ------
    const polyline = L.geoJSON(trackData, {
            style: { color: 'blue', weight: 4 }            
        }).addTo(map);


    // ------ Extract Coordinate Data ------
    const coords = pointData.features.map(f => {
            const [lon, lat] = f.geometry.coordinates;
            const ele = f.properties.ele; //* 3.28
            const time = new Date(f.properties.time);
            const hr = extractFromExtension(f.properties.gpxtpx_TrackPointExtension || '', 'hr');
            return { lat, lon, ele, time, hr};
    });

    // Compute Cumulative Distance (in miles)
    let cumDist = 0;
    for (let i = 0; i < coords.length; i++) {
                if(i > 0) {
                    cumDist += haversine(coords[i-1], coords[i]) / 1.609;
                }
                coords[i].distanceMi = cumDist;
    }

// ==================== 4. Map Interactions ====================

    // --- Hover Marker for synced charts ---
    const hoverMarker = L.circleMarker([0,0], {
        radius: 7,
        color: 'orange',
        fillColor: 'yellow',
        fillOpacity: 0.8,
    })
    .addTo(map)
    .setStyle({ opacity: 0, fillOpacity: 0 });


    // --- Sync Tooltip Handler for Charts ---
    function handleTooltipSync(sourceChart, targetChart, coords) {
        return function(context) {
            const tooltip = context.tooltip;

            // When mouse leaves chart, hide everything
            if (tooltip.opacity === 0) {
                hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
                hoverMarker.closePopup();
                targetChart.setActiveElements([]);
                targetChart.tooltip.setActiveElements([], {x: 0, y: 0});
                targetChart.update();
                return;
            }

            // Match hovered distance to map coordinate
            const hoveredDist = parseFloat(tooltip.dataPoints[0].label);
            let nearest = coords.reduce((a,b) =>
                Math.abs((a.distanceMi || 0) - hoveredDist) < 
                Math.abs((b.distanceMi || 0) - hoveredDist) ? a : b
            );

            // Update hover marker position and popup
            hoverMarker.setLatLng([nearest.lat, nearest.lon]);
            hoverMarker.setStyle({ opacity: 1, fillOpacity: 0.8});

            const elevationFt = (nearest.ele * 3.28084).toFixed(0);
            const timeStr = nearest.time.toLocaleTimeString();
            const hr = nearest.hr;

            if (!hoverMarker.getPopup()) {
                hoverMarker.bindPopup('');
            }
            hoverMarker
                .setPopupContent(`
                    <b>Elevation:</b> ${elevationFt} ft<br>
                    <b>Time:</b> ${timeStr} <br>
                    <b>Heart Rate:</b> ${hr || 'n/a'} bpm`
                ).openPopup();
            
            // Highlight corresponding point on target chart
            const matchIndex = targetChart.data.labels.findIndex(
                l => Math.abs(parseFloat(l) - hoveredDist) < 0.01
            );

            if (matchIndex !== -1) {
                targetChart.setActiveElements([{ datasetIndex: 0, index: matchIndex }]);
                targetChart.tooltip.setActiveElements([{ datasetIndex: 0, index: matchIndex }]);
                if (targetChart.options.plugins.tooltip.external) {
                    targetChart.options.plugins.tooltip.external({
                        tooltip: targetChart.tooltip,
                        chart: targetChart
                    });
                }
                targetChart.update();
            }

        }
    }

    // --- Compute total stats (distance, elevation, pace) ---
    let totalDist = 0;
    let totalElevGain = 0;
    for (let i = 1; i < coords.length; i++) {
        totalDist += haversine(coords[i-1],coords[i]);
        const gain = coords[i].ele - coords[i - 1].ele;
        if (!isNaN(gain) && gain > 0) { // ~2 inches
            totalElevGain += gain;
        }
    }

    const totalTimeSec = (coords.at(-1).time - coords[0].time) / 1000;
    const avgPace = totalTimeSec / 60 / (totalDist / 1.609);
    const paceMin = Math.floor(avgPace);
    const paceDec = avgPace - paceMin;
    const paceSec = paceDec * 60;

    // Update HTML Stats
    document.getElementById("distance").textContent = (totalDist / 1.609).toFixed(2);
    document.getElementById("elevation").textContent = Math.round(totalElevGain *  3.28);
    document.getElementById("pace").textContent =  `${paceMin}:${paceSec.toFixed(0).padStart(2, '0')}`;

    
    // --- Map Popups on Click ---
    const popup = L.popup();
    // question.
    polyline.on('mousemove', function(e) {
            const latlng = e.latlng;

            // find nearest coordinate
            let nearest = coords.reduce((a, b) =>
                distanceSq(a, latlng) < distanceSq(b, latlng) ? a : b
            );

            const elevationFt = (nearest.ele * 3.28084).toFixed(0);
            const timeStr = nearest.time.toLocaleTimeString();
            const hr = nearest.hr;

            popup
                .setLatLng(latlng)
                .setContent( `
                <b>Distance:</b> ${nearest.distanceMi.toFixed(2)} mi<br>
                <b>Elevation:</b> ${elevationFt} ft<br>
                <b>Time:</b> ${timeStr} <br>
                <b>Heart Rate:</b> ${hr || 'n/a'} bpm
                `)
                .openOn(map);
    });

    polyline.on('mousedown', function(e) {
        map.closePopup();
    });

    // Mile Markers (with per mile pace popup))
    let dist = 0;
    let mileCount = 1;
    let lastMileTime = coords[0].time;

    for(let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const curr = coords[i];
        dist += haversine(prev,curr); //km

        if (dist >= mileCount * 1.60934) { //every mile
            const elapsed = (curr.time - lastMileTime) / 1000;
            lastMileTime = curr.time;

            const paceMin = Math.floor(elapsed / 60);
            const paceSec = Math.round(elapsed % 60);
            const paceStr = `${paceMin}:${paceSec.toString().padStart(2, '0')}`;

            L.marker([curr.lat, curr.lon], {
                icon: L.divIcon({
                    className: 'mile-marker',
                    html: `<div class="mile-label">${mileCount}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            })
            .addTo(map)
            .bindPopup(`<b>Mile ${mileCount}: ${paceStr}</b>`);

            mileCount++;
        }
    }
    
    polyline.bringToFront();
    map.fitBounds(coords.map(c => [c.lat, c.lon]));


    // ==================== 5. BUILD CHARTS ====================

    // Crosshair plugin for synced charts

    const crosshairPlugin = {
        id: 'crosshairLine',
        // question.
        afterDatasetsDraw: function(chart, args, options) {
            const {ctx, tooltip, chartArea} = chart;
            // console.log("Tooltip:", tooltip);
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                const x = tooltip._active[0].element.x;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    // --- Elevation Chart ---
    let distance = 0;
    const elevationData = [];
    const labels = [];

    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i - 1];
        const curr = coords[i];

        // add distance between points
        distance += haversine(prev, curr);

        // Add elevation point
        elevationData.push(curr.ele * 3.28084); // convert m to ft
        labels.push((distance / 1.609).toFixed(2)); // distance in mi
    }

    const elevationCtx = document.getElementById('elevationChart').getContext('2d');
    const elevationChart = new Chart(elevationCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Elevation (ft)',
                data: elevationData,
                fill: true,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 8,
            }]
        },
        options: {
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {display: false},
                crosshairLine: true
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (mi)'
                    },
                    type: 'linear',
                    min: 0,
                    max: Math.round(totalDist / 1.609), 
                    ticks: {
                        stepSize: 1,  // <-- show ticks at every 1 unit (e.g., every whole mile)
                        beginAtZero: true,
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Elevation (ft)'
                    }
                }
            }
        },
        plugins: [crosshairPlugin]
    });
   

    // --- Pace Chart ---

    const paceData = [];
    const paceLabels = [];
    let cumulativeDist = 0;

    for(let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const curr = coords[i];
        const segmentDistKm = haversine(prev,curr)
        cumulativeDist += segmentDistKm;

        const timeDiffSec = (curr.time - prev.time) / 1000;
        const paceMinPerKm = (timeDiffSec / 60) / segmentDistKm;
        const paceMinPerMi = paceMinPerKm * 1.609;

        // Filter out extreme paces from GPS noise
        if (paceMinPerMi < 20 && paceMinPerMi > 3) {
            paceData.push(paceMinPerMi);
            paceLabels.push((cumulativeDist / 1.609).toFixed(2));
        }
    }

    // Smooth pace data with moving average over 5 second window
    const smoothedPace =[];
    const timeWindow = 15; // seconds
    smoothedPace.push(paceData[0]); // first point unchanged
    for(let i = 1; i < paceData.length; i++) {
        let sum = 0;
        let count = 0;
        let baseTime = coords[i+1]?.time;

        for (let j = i; j >= 0; j--) {
            if (!baseTime || (baseTime - coords[j].time) /1000 > timeWindow) break; 
            
            sum += paceData[j];
            count++;
        }

        smoothedPace.push(sum / count);
    }


    const paceCtx = document.getElementById('paceChart').getContext('2d');
    const paceChart = new Chart(paceCtx, {
        type: 'line',
        data: {
            labels: paceLabels,
            datasets: [{
                label: 'Pace (min/mi)',
                data: smoothedPace,
                fill: false,
                borderColor: 'orange',
                backgroundColor: 'orange',
                borderWidth: 1.5,
                tension: 0.3,
                pointRadius: 0,
            }]
        },
        options: {
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {display: false},
                crosshairLine: true
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (mi)'
                    },
                    type: 'linear',
                    min: 0,
                    // max: Math.round(totalDist / 1.609), 
                    ticks: {
                        stepSize: 1,  // <-- show ticks at every 1 unit (e.g., every whole mile)
                        beginAtZero: true,
                    },
                    grid: {
                        drawTicks: true,
                        drawOnChartArea: true
                    }
                },
                y: {
                    min: 6,
                    max: 10,
                    reverse: true,
                    title: {
                        display: true,
                        text: 'Pace (min/mi)'
                    }
                }
            },
            backgroundColor: 'white',
        },
        plugins: [crosshairPlugin]
    });
    // --- Link both charts via hover sync ---
    elevationChart.options.plugins.tooltip.external = 
        handleTooltipSync(elevationChart, paceChart, coords);
    paceChart.options.plugins.tooltip.external = 
        handleTooltipSync(paceChart, elevationChart, coords);
})
