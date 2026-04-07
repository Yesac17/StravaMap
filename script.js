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
const map = L.map('map', {
    center: [44.8765, -91.9207],
    worldCopyJump: true,
    zoom: 7
});


// Add OpenStreetMap tiles Layer
const openStreetMaps = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data © OpenStreetMap contributors'
});

const googleSat = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
maxZoom: 20,
subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const googleHybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
        maxZoom: 20,
        subdomains:['mt0','mt1','mt2','mt3']
});

const googleTerrain = L.tileLayer('http://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',{
        maxZoom: 20,
        subdomains:['mt0','mt1','mt2','mt3']
});

const baseMaps = {
    "OpenStreetMap": openStreetMaps,
    "Google Satellite": googleSat,
    "Google Hybrid": googleHybrid,
    "Google Terrain": googleTerrain
};

L.control.layers(baseMaps).addTo(map);
openStreetMaps.addTo(map);
// ==================== 2. HELPER FUNCTIONS ======================

// Compute squared distance between two points (used for nearest-point lookup)
function distanceSq(a,b) {
            const aLat = a.lat ?? a.latitude;
            const aLon = a.lon ?? a.lng ?? a.longitude;
            const bLat = b.lat ?? b.latitude;
            const bLon = b.lon ?? b.lng ?? b.longitude;
            return (aLat - bLat) ** 2 + (aLon - bLon) ** 2;
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

const routeGroup = L.layerGroup().addTo(map);
const markerGroup = L.layerGroup().addTo(map);

 // --- Hover Marker for synced charts ---
    const hoverMarker = L.circleMarker([0,0], {
        radius: 7,
        color: 'orange',
        fillColor: 'yellow',
        fillOpacity: 0.8,
    })
    .addTo(map)
    .setStyle({ opacity: 0, fillOpacity: 0 });

    let currentCharts = {elevation: null, pace: null, hr: null, cad: null};
    let currentHandlers = {elevation: null, pace: null, hr: null, cad: null};

// ==================== 3. ROUTE LOADING & PROCESSING ====================
const fileInp = document.getElementById('folderInput');
let fileList = [];
let trackDataUpload = null;
let pointDataUpload = null;
fileInp.addEventListener('change', async function(event) {
    // this function handles fileinput when user selects the file input dropdown. 
    // I am implementing multer with my server.js and want to test file upload with that instead.
    // to do this I will need to adjust this function.

    fileList = event.target.files; // FileList object
    if(fileList.length < 2){
            alert("Please upload two files: tracks.geojson and track_points.geojson");
            return;
        }
    const formData = new FormData();

    for (let file of fileList) {
        formData.append("files", file);
    }

    const res = await fetch("http://localhost:3000/upload", {
        method: "POST",
        body: formData
    });

    const data = await res.json();

    const trackData = await fetch(data.trackUrl).then(res => res.json());
    const pointData = await fetch(data.pointUrl).then(res => res.json());

    console.log(data);
    loadRoute(trackData, pointData);
}); 

async function loadSavedRoutes() {
    const res = await fetch("http://localhost:3000/routes");
    const routes = await res.json();

    // loop through routes
    for (const route of routes) {
        const option = document.createElement('option');
        option.value = route.id;
        option.textContent = route.name;
        dropdown.appendChild(option);
    }
}

const dropdown = document.getElementById('route');
loadSavedRoutes();

dropdown.addEventListener('change', async function () {
    const fileInputDiv = document.getElementsByClassName('upload-container')
    routeGroup.clearLayers();
    markerGroup.clearLayers();

    hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    if (hoverMarker.isPopupOpen && hoverMarker.isPopupOpen()) hoverMarker.closePopup();

    // Destroy existing charts if any
    if (currentCharts.elevation) {
        if (currentCharts.elevation.canvas && currentHandlers.elevation?.hide) {
            currentCharts.elevation.canvas.removeEventListener('mouseleave', currentHandlers.elevation.hide);
        }
        currentCharts.elevation.destroy();
        currentCharts.elevation = null;
        currentHandlers.elevation = null;
    }
    if (currentCharts.pace) {
        if (currentCharts.pace.canvas && currentHandlers.pace?.hide) {
            currentCharts.pace.canvas.removeEventListener('mouseleave', currentHandlers.pace.hide);
        }
        currentCharts.pace.destroy();
        currentCharts.pace = null;
        currentHandlers.pace = null;
    }

    if (currentCharts.hr) {
        if (currentCharts.hr.canvas && currentHandlers.hr?.hide) {
            currentCharts.hr.canvas.removeEventListener('mouseleave', currentHandlers.hr.hide);
        }
        currentCharts.hr.destroy();
        currentCharts.hr = null;
        currentHandlers.hr = null;
    }

    if (currentCharts.cad) {
        if (currentCharts.cad.canvas && currentHandlers.cad?.hide) {
            currentCharts.cad.canvas.removeEventListener('mouseleave', currentHandlers.cad.hide);
        }
        currentCharts.cad.destroy();
        currentCharts.cad = null;
        currentHandlers.cad = null;
    }



    // clear stored handlers
    currentHandlers = {elevation: null, pace: null, hr: null, cad: null};

    const selectedValue = dropdown.value;
    if (!selectedValue) return;

    let  tracks, trackPoints; 
    if(selectedValue !== 'file_upload'){
            fileInputDiv[0].style.display = 'none';
            //tracks = `routes/${selectedValue}/tracks.geojson`;
            tracks = "https://cdb-interactivemap.s3.us-east-2.amazonaws.com/routes/tracks.geojson";
            //trackPoints = `routes/${selectedValue}/track_points.geojson`;
            trackPoints = "https://cdb-interactivemap.s3.us-east-2.amazonaws.com/routes/track_points.geojson";

            const [trackData, pointData] = await Promise.all([
                fetch(tracks).then(res => res.json()),
                fetch(trackPoints).then(res => res.json())
            ]);
            loadRoute(trackData, pointData);
    }
    else if(selectedValue === 'file_upload'){
        // I want the file upload option to be invisible unless the dropdown is set to file upload.
        // To do this, I will add an event listener to the dropdown that shows/hides the file input based on the selected value.

        fileInputDiv[0].style.display = 'block';
        // Now if a user selects file upload, the interface appears and they can upload files and then the route will apear.
        // The only issue is if they switch to a different route and then back to file upload, they might expect the previous upload to still be there.
        // But it will be gone since the event listener for file upload only triggers when files are selected and that is what triggers loadRoute.
        // I will fix this by checking if trackDataUpload and pointDataUpload are already defined and if so, call loadRoute with those.
        if(trackDataUpload && pointDataUpload){
            loadRoute(trackDataUpload, pointDataUpload);
        }
    }
});
// Ok now I have adjusted the code to read the uploaded files directly using FileReader and parse them as JSON. Now I will move the route loading logic into a separate function called loadRoute to avoid code duplication.
// Wondering if I need to keep this promise.all here. The answer is no, I can move it into the loadRoute function. I will do that now.

async function loadRoute(trackData, pointData) {
// Did I do this right? I'm pretty sure i dont need this promise.all at all anymore since I used fetch and readFile in the event listener. The answer is 
    // Promise.all([
    //     fetch(tracks).then(res => res.json()),
    //     fetch(trackPoints).then(res => res.json())
    // ]).then(([trackData, pointData]) => {
    // ------ Draw Route Polyline on Map ------
    const polyline = L.geoJSON(trackData, {
            style: { color: 'blue', weight: 4 }            
        }).addTo(routeGroup);


    // ------ Extract Coordinate Data ------
    const coords = pointData.features.map(f => {
            const [lon, lat] = f.geometry.coordinates;
            const ele = f.properties.ele; //* 3.28
            const time = new Date(f.properties.time);
            const hr = extractFromExtension(f.properties.gpxtpx_TrackPointExtension || '', 'hr');
            const cad = extractFromExtension(f.properties.gpxtpx_TrackPointExtension || '', 'cad') * 2; // convert to steps per minute
            const temp = extractFromExtension(f.properties.gpxtpx_TrackPointExtension || '', 'atemp');
            return { lat, lon, ele, time, hr, cad, temp };
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


    let isSyncing = false;

function makeSyncHandlers(sourceChart, targetChart, coords) {
  // clear/hide everything (used by external/onHover and by mouseleave)
  function hideAll() {
    // hide hover marker & popup
    hoverMarker.setStyle({ opacity: 0, fillOpacity: 0 });
    if (hoverMarker.isPopupOpen && hoverMarker.isPopupOpen()) hoverMarker.closePopup();

    // clear tooltips/active elements on both charts and redraw
    try {
      sourceChart.tooltip.setActiveElements([], { x: 0, y: 0 });
    } catch (e) {}
    try {
      targetChart.tooltip.setActiveElements([], { x: 0, y: 0 });
    } catch (e) {}

    try { sourceChart.update(); } catch (e) {}
    try { targetChart.update(); } catch (e) {}
  }

  function syncByDistance(hoveredDist) {
    // find nearest coordinate by distanceMi
    const nearest = coords.reduce((a, b) =>
      Math.abs((a.distanceMi || 0) - hoveredDist) < Math.abs((b.distanceMi || 0) - hoveredDist)
        ? a
        : b
    );

    // update hover marker and popup (bind once)
    hoverMarker.setLatLng([nearest.lat, nearest.lon]);
    hoverMarker.setStyle({ opacity: 1, fillOpacity: 0.8 });
    if (!hoverMarker.getPopup()) hoverMarker.bindPopup('');
    hoverMarker.setPopupContent(`
      <b>Distance:</b> ${nearest.distanceMi.toFixed(2)} mi<br>
      <b>Elevation:</b> ${(nearest.ele * 3.28084).toFixed(0)} ft<br>
      <b>Time:</b> ${nearest.time.toLocaleTimeString()}<br>
      <b>Heart Rate:</b> ${nearest.hr || 'n/a'} bpm<br>
      <b>Cadence:</b> ${nearest.cad || 'n/a'} spm
    `).openPopup();


    // highlight matching index on target chart and show tooltip there
    const matchIndex = targetChart.data.labels.findIndex(l => Math.abs(parseFloat(l) - hoveredDist) < 0.01);
    if (matchIndex === -1) {
      targetChart.tooltip.setActiveElements([], { x: 0, y: 0 });
      targetChart.update();
      return;
    }

    const meta = targetChart.getDatasetMeta(0);
    const element = meta.data[matchIndex];
    if (!element) return;

    const { x, y } = element.getProps(['x', 'y'], true);
    targetChart.tooltip.setActiveElements([{ datasetIndex: 0, index: matchIndex }], { x, y });
    targetChart.update();
  }

  // Chart.js external tooltip handler
  function externalHandler(context) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const tooltip = context.tooltip;
      if (!tooltip || tooltip.opacity === 0) {
        hideAll();
        return;
      }
      const hoveredDist = parseFloat(tooltip.dataPoints[0].label);
      if (Number.isFinite(hoveredDist)) syncByDistance(hoveredDist);
    } finally {
      isSyncing = false;
    }
  }

  // Chart.js onHover handler (event, activeElements, chart)
  function onHoverHandler(event, activeElements, chart) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      if (!activeElements || activeElements.length === 0) {
        hideAll();
        return;
      }
      const idx = activeElements[0].index;
      const hoveredDist = parseFloat(sourceChart.data.labels[idx]);
      if (Number.isFinite(hoveredDist)) syncByDistance(hoveredDist);
    } finally {
      isSyncing = false;
    }
  }

  // expose a hide function for mouseleave
  function hide() {
    if (isSyncing) return;
    isSyncing = true;
    try {
      hideAll();
    } finally {
      isSyncing = false;
    }
  }

  return { external: externalHandler, onHover: onHoverHandler, hide };
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
    // Wondering how to get route name. 
    // the JSON looks like this: "type": "Feature", "properties": { "name": "Turkey", "type": "running" }, "geometry": { "type": "LineString", "coordinates":
    // So I can get it from trackData.features[0]
    document.getElementById("route-name").textContent = trackData.features[0].properties.name || 'Unnamed Route';
    document.getElementById("distance").textContent = (totalDist / 1.609).toFixed(2);
    document.getElementById("elevation").textContent = Math.round(totalElevGain *  3.28);
    document.getElementById("pace").textContent =  `${paceMin}:${paceSec.toFixed(0).padStart(2, '0')}`;

    // Compute average heart rate and cadence
    const hrValues = coords.filter(c => c.hr).map(c => parseInt(c.hr));
    const avgHr = hrValues.reduce((a,b) => a + b, 0) / hrValues.length;
    document.getElementById("heartrate").textContent = avgHr ? Math.round(avgHr) : 'n/a';

    const cadValues = coords.filter(c => c.cad).map(c => parseInt(c.cad));
    const avgCad = cadValues.reduce((a,b) => a + b, 0) / cadValues.length;
    document.getElementById("cadence").textContent = avgCad ? Math.round(avgCad) : 'n/a';

    const hours = Math.floor(totalTimeSec / 3600);
    const minutes = Math.floor((totalTimeSec % 3600) / 60);
    const seconds = Math.round(totalTimeSec % 60);
    const totalTime = `${hours > 0 ? hours + 'h ' : ''}${minutes}m ${seconds}s`;
    document.getElementById("time").textContent = totalTime;

    for (let i = 0; i < coords.length; i++) {
        if (coords[i].temp) {
            coords[i].tempF = (parseFloat(coords[i].temp) * 9/5) + 32;
        }
    }
    const tempValues = coords.filter(c => c.tempF).map(c => c.tempF);
    const avgTemp = tempValues.reduce((a,b) => a + b, 0) / tempValues.length;
    document.getElementById("temperature").textContent = avgTemp ? Math.round(avgTemp) : 'n/a';

    // track_points.geojson has property "time": "2025-05-22T14:30:09Z". 
    // I can use this to get the date and start time of the run. However the time zone is probably UTC so I need to convert it to local time.
    // I will only display the date that the activity started on, so I will only need the data from the first coordinate.
    const startTime = coords[0].time;
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById("date").textContent = startTime.toLocaleDateString(undefined, options);
    
    // Next I wish to display the start time in local time.
    // I will use toLocaleTimeString for this.
    document.getElementById("start-time").textContent = startTime.toLocaleTimeString();

    
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
                .setLatLng([nearest.lat, nearest.lon])
                .setContent( `
                <b>Distance:</b> ${nearest.distanceMi.toFixed(2)} mi<br>
                <b>Elevation:</b> ${elevationFt} ft<br>
                <b>Time:</b> ${timeStr} <br>
                <b>Heart Rate:</b> ${hr || 'n/a'} bpm<br>
                <b>Cadence:</b> ${nearest.cad || 'n/a'} spm
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
            .addTo(markerGroup)
            .bindPopup(`<b>Mile ${mileCount}: ${paceStr}</b>`);

            mileCount++;
        }
    }
    // I have just added a check box in the html
    // I want to link this checkbox to the mile markers so that when the box is checked, the mile markers appear and when it is unchecked, they disappear.
    // To do this, I will add an event listener to the checkbox that toggles the visibility of the markerGroup layer.
    const mileMarkerCheckbox = document.getElementById('mileMarkers'); // This line is doing the following: it is getting the checkbox element from the HTML document by its ID 'mileMarkers' and storing it in the variable mileMarkerCheckbox for later use in the event listener.
    mileMarkerCheckbox.addEventListener('change', function() { // This line is adding an event listener to the mileMarkerCheckbox that listens for the 'change' event, which occurs when the checkbox is checked or unchecked. When the event is triggered, it executes the function that follows.
        if (this.checked) { // This line is checking if the checkbox is currently checked (i.e., if this.checked is true). If it is checked, it executes the code block that follows, which adds the markerGroup layer to the map, making the mile markers visible. If it is not checked, it executes the else block, which removes the markerGroup layer from the map, hiding the mile markers.
            map.addLayer(markerGroup);
        } else {
            map.removeLayer(markerGroup);
        }
    });
    // I would like the checkbox to default to true
    
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

    // -- Heart Rate Chart ---
    const hrData = [];
    const hrLabels = [];
    cumulativeDist = 0;

    for(let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const curr = coords[i];
        const segmentDistKm = haversine(prev,curr)
        cumulativeDist += segmentDistKm;
        if (curr.hr) {
            hrData.push(curr.hr);
            hrLabels.push((cumulativeDist / 1.609).toFixed(2));
        }
    }

    const hrCtx = document.getElementById('heartrateChart').getContext('2d');
    const hrChart = new Chart(hrCtx, {
        type: 'line',
        data: {
            labels: hrLabels,
            datasets: [{
                label: 'Heart Rate (bpm)',
                data: hrData,
                fill: false,
                borderColor: 'red',
                backgroundColor: 'red',
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
                    ticks: {
                        stepSize: 1,
                        beginAtZero: true,
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Heart Rate (bpm)'
                    }
                }
            }
        },
        plugins: [crosshairPlugin]
    });


    // --- Cadence Chart ---
    const cadData = [];
    const cadLabels = [];
    cumulativeDist = 0;
    for(let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const curr = coords[i];
        const segmentDistKm = haversine(prev,curr)
        cumulativeDist += segmentDistKm;
        if (curr.cad) {
            cadData.push(curr.cad);
            cadLabels.push((cumulativeDist / 1.609).toFixed(2));
        }
    }

    const cadCtx = document.getElementById('cadenceChart').getContext('2d');
    const cadChart = new Chart(cadCtx, {
        type: 'line',
        data: {
            labels: cadLabels,
            datasets: [{
                label: 'Cadence (spm)',
                data: cadData,
                fill: false,
                borderColor: 'green',
                backgroundColor: 'green',
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
                    ticks: {
                        stepSize: 1,
                        beginAtZero: true,
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Cadence (spm)'
                    }
                }
            }
        },
        plugins: [crosshairPlugin]
    });

    // To display both charts on the web page, I have to link them via hover sync.
    // Is it possible to just add these two new charts to the same handlers?
    // Below I have handlers1 and handlers2 that link elevationChart and paceChart.
    // If i want these two new charts to link to the already existing charts, I can just






    // // --- Link both charts via hover sync ---
    // elevationChart.options.plugins.tooltip.external = 
    //     handleTooltipSync(elevationChart, paceChart, coords);
    // paceChart.options.onHover = 
    //     handleTooltipSync(paceChart, elevationChart, coords);
    // });

        // create handlers after you construct all charts
    const handlers1 = makeSyncHandlers(elevationChart, paceChart, coords);
    const handlers2 = makeSyncHandlers(paceChart, elevationChart, coords);
    const handlers3 = makeSyncHandlers(hrChart, cadChart, coords);
    const handlers4 = makeSyncHandlers(cadChart, hrChart, coords);

    // Hybrid setup (reliable): one chart uses external, the other uses onHover
    elevationChart.options.plugins.tooltip.external = handlers1.external;
    paceChart.options.onHover = handlers2.onHover;
    hrChart.options.plugins.tooltip.external = handlers3.external;
    cadChart.options.onHover = handlers4.onHover;

    if (elevationChart.canvas) { elevationChart.canvas.addEventListener('mouseleave', handlers1.hide); }
    if (paceChart.canvas) { paceChart.canvas.addEventListener('mouseleave', handlers2.hide); }
    if (hrChart.canvas) { hrChart.canvas.addEventListener('mouseleave', handlers3.hide); }
    if (cadChart.canvas) { cadChart.canvas.addEventListener('mouseleave', handlers4.hide); }

    // store current charts and handlers for later cleanup
    currentCharts.elevation =elevationChart;
    currentCharts.pace = paceChart;
    currentHandlers.elevation = handlers1;
    currentHandlers.pace = handlers2;
    currentCharts.hr = hrChart;
    currentHandlers.hr = handlers3;
    currentCharts.cad = cadChart;
    currentHandlers.cad = handlers4;
}
// what issues are there with this code?
// 1. The file upload logic is a bit clunky since it relies on the user selecting files after choosing the "file upload" option from the dropdown. If they select "file upload" and then select files, it works fine. But if they select "file upload" and then switch to a different route and then back to "file upload", the previously uploaded files are lost and they have to select them again. It would be better if the uploaded files were stored in state and automatically loaded when the user selects "file upload" from the dropdown, without requiring them to re-select the files each time. I have partially addressed this by checking if trackDataUpload and pointDataUpload are already defined when "file upload" is selected, but it could be more robust.
// 2. The sync logic for the charts is a bit complex and relies on custom handlers to synchronize tooltips and hover states between charts. This works but could potentially be simplified or made more robust, especially if more charts are added in the future.
// 3. The code for loading and processing the route data is all contained within the loadRoute function, which is called both when a user selects a route from the dropdown and when they upload files. This works but could potentially be refactored to separate concerns more cleanly, such as having separate functions for loading data, processing data, and rendering charts.
// 4. There is some duplicated code for creating the charts (elevation, pace, heart rate, cadence) that could potentially be abstracted into a helper function to reduce redundancy and improve maintainability.
// 5. The code does not currently handle errors that may occur during file reading, data processing, or chart rendering, which could lead to uncaught exceptions and a poor user experience. Adding try-catch blocks and user-friendly error messages would improve robustness.
// 6. The code assumes that the uploaded files will always be in the correct format and contain the expected properties, which may not always be the case. Adding validation checks for the uploaded data would help prevent errors and improve user feedback.
// 7. The code for calculating pace and smoothing it with a moving average is somewhat complex and may not be immediately clear to other developers. Adding comments or refactoring this logic into a separate function could improve readability.
// 8. The code for handling mile markers and their visibility is functional but could potentially be improved by using a more efficient method for toggling visibility, such as using CSS classes or a dedicated layer group that can be easily shown or hidden without needing to add/remove individual markers from the map.
// Overall, while the code is functional and achieves the desired features, there are several areas where it could be refactored for improved readability, maintainability, and robustness.
// I will stop here for now, but these are some of the issues and potential improvements that could be made to the code.
// The number one priority should be improving the file upload logic to store the uploaded files in state and automatically load them when "file upload" is selected from the dropdown, without requiring the user to re-select the files each time. This would significantly improve the user experience for users who want to upload their own routes.
// An idea I had for accomplishing this is to have a database of routes because currrently it is quite the pain to get a new route in the system.
// I could set up a simple backend with a database to store uploaded routes and their associated data. When a user uploads a route, it would be saved to the database and assigned a unique ID. The frontend could then fetch the list of available routes from the backend, including both pre-loaded routes and user-uploaded routes, and display them in the dropdown. When a user selects a route from the dropdown, the frontend would fetch the corresponding data from the backend using the unique ID and load it into the map and charts. This way, users would only need to upload their route once, and it would be persistently available in the system for future viewing without needing to re-upload files.
// I will do this in the next iteration, but it will require setting up a backend server and database, as well as implementing API endpoints for uploading routes and fetching route data. It will also require changes to the frontend code to interact with the backend API instead of directly loading files from the local filesystem. However, this would provide a much more seamless and user-friendly experience for users who want to upload and view their own routes.
// Also connecting this to garmin or strava APIs would be a great future improvement to allow users to easily import their activities without needing to manually upload files. This would require implementing OAuth authentication with the respective APIs and fetching activity data directly from the user's account, which could then be processed and displayed in the same way as the current file upload functionality. This would further enhance the user experience by providing a more streamlined way to access and visualize their activity data.
// This would be much past the current scope of the project, but it is a natural next step for improving the usability and functionality of the application.

// ok coming back to this a bit later. I have now gotten certified in AWS cloud practioner. now I have some knowledge that might help me.
// first I need to figure out what aws services will be required.
// The list of AWS services that would be helpful for this to work on a basic operational level are:
// 1. AWS S3 - for storing uploaded route files and any associated media (e.g., photos, videos) in a scalable and durable way.
// Breaking down s3 implementation: 
// - Create an S3 bucket to store route files and media.
// The file upload requires two files currently, a tracks.geojson file and a track-points.geojson file.
// how should i navigate this? I could require users to upload a single zip file containing both geojson files, and then the backend can extract the files from the zip and process them. This would simplify the upload process for users and ensure that both required files are provided together.
// would it be easier to initially test if i just manually uploaded an example route, a tracks file and a track-points file, to the s3 bucket and then implemented the backend to read from s3 instead of local files? This would allow me to test the s3 integration without needing to implement the full file upload functionality right away. I could hardcode the S3 bucket name and file keys in the backend for testing purposes, and once that is working, I can then implement the file upload functionality to allow users to upload their own routes to S3.
// how would i accomplish this? 