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

const mileMarkerCheckbox = document.getElementById('mileMarkers');

function createPlayControls({ handlePlaybackButton, cyclePlaybackSpeed }) {
    const controlsButton = L.control({ position: "bottomleft" });

    controlsButton.onAdd = function () {
        console.log("play controls added");

        const div = L.DomUtil.create("div", "leaflet-control playback-controls");

        const mainBtn = L.DomUtil.create("button", "playback-btn", div);
        mainBtn.id = "playbackMainBtn";
        mainBtn.textContent = "▶";

        const speedBtn = L.DomUtil.create("button", "playback-btn", div);
        speedBtn.id = "speedBtn";
        speedBtn.textContent = "1x";

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        L.DomEvent.on(mainBtn, "click", handlePlaybackButton);
        L.DomEvent.on(speedBtn, "click", cyclePlaybackSpeed);

        return div;
    };

    return controlsButton;
}

function createCenterButton(handleCenterButton) {
    const centerButton = L.control({ position: "topleft" });

    centerButton.onAdd = function () {
        console.log("center button added");

        const div = L.DomUtil.create("div", "leaflet-control center-button");

        const btn = L.DomUtil.create("button", "center-btn", div);
        btn.id = "centerBtn";
        btn.textContent = "📍";

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        L.DomEvent.on(btn, "click", handleCenterButton);

        return div;
    };

    return centerButton;
}

let playControl = null;
let centerControl = null;
let playbackState = "stopped";
let playbackSpeed = 1;
const speeds = [1, 2, 4, 8, 16];
let speedIndex = 0;
let animationFrame = null;


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

function stopPlaybackAnimation() {
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    playbackState = "stopped";
}

// ==================== 3. ROUTE LOADING & PROCESSING ====================
const fileInp = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const loginStatus = document.getElementById("loginStatus");
let fileList = [];
let trackDataUpload = null;
let pointDataUpload = null;

function setUploadStatus(message) {
    uploadStatus.textContent = message;
}

async function waitForRoute(routeId) {
    const maxAttempts = 15;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        setUploadStatus(`Processing route... ${attempt}/${maxAttempts}`);
        
        const res = await fetch("https://qrbnhc4see.execute-api.us-east-2.amazonaws.com/routes",{
            headers: {
                Authorization: `Bearer ${localStorage.getItem("id_token")}`,
            }
        });
        const routes = await res.json();


        if(routes.some(r => r.route_id === routeId)){
            return true;
        }
        await new Promise(r => setTimeout(r, 1000));            
    }

    return false;
}

async function getFileHash(file) {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));

    return hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
}


fileInp.addEventListener('change', async function(event) {  
    // this function handles fileinput. 
    fileList = event.target.files; // Get the FileList from the input event
    if (!fileList.length || !fileList[0].name.toLowerCase().endsWith('.gpx')){
            alert("Please upload gpx file(s).");
            return;
        }
    try{
        fileInp.disabled = true;
        setUploadStatus("Checking for duplicates...");
        const fileHash = await getFileHash(fileList[0]);
        console.log("File Hash: ", fileHash);
        const res = await fetch("https://lai886clh5.execute-api.us-east-2.amazonaws.com/uploadURL", { // Send the FormData to the server using fetch API
            method: "POST",
            headers: {
                Authorization: `Bearer ${localStorage.getItem("id_token")}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ fileName: fileList[0].name, fileHash: fileHash })
        });
        setUploadStatus("Requesting upload permission...");

        if (!res.ok) {
            const errorText = await res.text();
            console.error("Upload URL request failed:", res.status, errorText);
            throw new Error("Failed to create upload URL");
        }


        const { duplicate, uploadUrl, key, routeId } = await res.json();
        console.log("Presigned Key: ", key);

        if (duplicate) {
            setUploadStatus("This route has already been uploaded.");
            return;
        }

        setUploadStatus("Uploading GPX to S3...");

        const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "application/gpx+xml"
            },
            body: fileList[0]
        })

        if(!uploadRes.ok) throw new Error("Failed to upload file");

        setUploadStatus("Upload complete. Processing route...");

        const routeName = fileList[0].name
            .replace(/\.gpx$/i, "")
            .replace(/_/g, " ");

        const ready = await waitForRoute(routeId);

        if (ready) {
            setUploadStatus("Route ready. Refreshing...");
            sessionStorage.setItem("newRouteId", routeId);
            window.location.reload();
        } else {
            setUploadStatus("Still processing, try refreshing.");
        }

    } catch (err) {
        console.error("Error uploading file: ", err);
        setUploadStatus("Upload failed! Please try again.");
        alert("Failed upload.");
    }finally{
        fileInp.disabled = false;
    }
}); 

async function loadSavedRoutes() {
    console.log("loadSavedRoutes called");
    const res = await fetch("https://qrbnhc4see.execute-api.us-east-2.amazonaws.com/routes", {
        headers: {
            Authorization: `Bearer ${localStorage.getItem("id_token")}`
        }
    });

    if (!res.ok) {
        console.error("Failed to load routes:", res.status, await res.text());
        return;
    }

    const routes = await res.json();

    for (const route of routes) {
          const option = document.createElement('option');
          option.value = route.route_id; 
          option.textContent = route.name;
          dropdown.appendChild(option);
    }

    const newRouteId = sessionStorage.getItem("newRouteId");

    if (newRouteId) {
        sessionStorage.removeItem("newRouteId");
        dropdown.value = newRouteId;
        dropdown.dispatchEvent(new Event("change"));
    }
}

async function loadDemoRoute() {
    const res = await fetch("https://018mwnj2g2.execute-api.us-east-2.amazonaws.com/demo-route");

    if (!res.ok) {
        console.error("Failed to load demo route:", res.status, await res.text());
        return;
    }

    const route = await res.json();

    const [trackData, pointData] = await Promise.all([
        fetch(route.trackUrl).then(res => res.json()),
        fetch(route.pointUrl).then(res => res.json())
    ]);

    loadRoute(trackData, pointData);
}

const dropdown = document.getElementById('route');
const deleteButton = document.getElementById('deleteRoute');

const token = localStorage.getItem("id_token");
if(!token){
    loadDemoRoute();
    // if the user is not logged in, then load the demo route and do not show the dropdown or delete button.
    document.getElementById('deleteRoute').style.display = 'none';
    document.getElementById('route-selection').style.display = 'none';
    setLoginStatus("Log in to view and upload your own routes!");
    document.getElementById('loginStatus').style.display = "block";
    mileMarkerCheckbox.checked = false;
    map.removeLayer(markerGroup); // defaulting to no mile markers because it makes the snowman look nice.
}
else{
    document.getElementById('loginStatus').style.display = "none";
    loadSavedRoutes();
}


dropdown.addEventListener('change', async function () {
    stopPlaybackAnimation();
    const fileInputDiv = document.getElementsByClassName('upload-container')
    routeGroup.clearLayers();
    markerGroup.clearLayers();
    fileInputDiv[0].style.display = 'none';

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

    map.center = [44.8765, -91.9207];
    map.zoom = 7;

    // if the selected value is not file upload, then fetch the route data from the server and load the route.
    // if the selected value is file upload, then show the file upload interface and wait for the user to upload files. 
    if(selectedValue !== 'file_upload'){
            const res = await fetch(`https://5pouy6pdgh.execute-api.us-east-2.amazonaws.com/routes/${selectedValue}`,{
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("id_token")}`
                }
            });
            
            if (!res.ok) {
                console.error("Failed to fetch route by id:", res.status, await res.text());
                return;
            }

            const route = await res.json();

            const tracks = route.trackUrl;
            const trackPoints = route.pointUrl;

            if (!tracks || !trackPoints) {
                console.error("Missing track URL or point URL:", route);
                return;
            }


            const [trackData, pointData] = await Promise.all([
                fetch(tracks).then(res => res.json()),
                fetch(trackPoints).then(res => res.json())
            ]);
            loadRoute(trackData, pointData);
    }
    // Once the files are uploaded, load the route using the uploaded data
    else if(selectedValue === 'file_upload'){
        fileInputDiv[0].style.display = 'block'; // show file upload interface if file upload is selected
    }
});

deleteButton.addEventListener('click', async function() {
    const selectedValue = dropdown.value;
    if (!selectedValue) {
        alert("Please select a route to delete.");
        return;
    } else if (selectedValue === 'file_upload') {
        alert("Cannot delete 'File Upload' option. Please select a saved route to delete.");
        return;
    } else if(confirm("Are you sure you want to delete this route? This action cannot be undone.")) {
        await deleteRoute(selectedValue);
        console.log("waiting");
        window.location.reload();
    }
    
});

async function deleteRoute(routeId) {
    const res = await fetch(`https://4aliv9sulf.execute-api.us-east-2.amazonaws.com/routes/${routeId}`, { method: "DELETE" });
    const data = await res.json();
    if(!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete route");
    }
    return data;
}


async function loadRoute(trackData, pointData) {
    playbackState = "stopped";
    const polyline = L.geoJSON(trackData, {
            style: { color: 'black', weight: 4 }            
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

    // ------ Map Control Buttons ------

    // Center Map on Route

    function handleCenterButton() {
        map.fitBounds(coords.map(c => [c.lat, c.lon]));
    }

    if(centerControl) {
        map.removeControl(centerControl);
    }

    centerControl = createCenterButton(handleCenterButton);
    centerControl.addTo(map);

    // Route Playback
    let playbackIndex = 0;

    // creating playback circle
    const playbackMarker = L.circleMarker([coords[0].lat, coords[0].lon], {
        radius: 5,
        color: 'green',
        fillColor: 'green',
        fillOpacity: 0,
        opacity: 0
    }).addTo(routeGroup);

    // creating playback trail
    let playbackTrail = L.polyline([], {
        color: "blue",
        weight: 5
    }).addTo(routeGroup);

    // 
    function startPlayback() {
        if (animationFrame) return;

        playbackState = "playing";
        updatePlaybackButton();

        playbackMarker.setStyle({ opacity: 1, fillOpacity: 1 });
        playbackTrail.bringToFront();

        let lastTime = null;

        function animate(timeStamp) {
            if (!lastTime) lastTime = timeStamp;

            const elapsed = timeStamp - lastTime;
            lastTime = timeStamp;

            playbackIndex += (elapsed / 30) * playbackSpeed;

            if (playbackIndex >= coords.length - 1) {
                playbackIndex = coords.length - 1;

                const last = coords[coords.length - 1];

                playbackMarker.setLatLng([last.lat, last.lon]);

                const fullTrail = coords.map(p => [p.lat, p.lon]);
                playbackTrail.setLatLngs(fullTrail);

                playbackState = "finished";
                animationFrame = null;
                updatePlaybackButton();
                return;
            }

            const i = Math.floor(playbackIndex);
            const t = playbackIndex - i;

            const p1 = coords[i];
            const p2 = coords[i+1];

            const lat = p1.lat + (p2.lat - p1.lat) * t;
            const lon = p1.lon + (p2.lon - p1.lon) * t;

            playbackMarker.setLatLng([lat, lon]);

            map.panTo([lat, lon], { animate: true });

            const traveledCoords = coords
                .slice(0, i + 1)
                .map(p => [p.lat, p.lon]);

            traveledCoords.push([lat, lon]);
            playbackTrail.setLatLngs(traveledCoords);

            animationFrame = requestAnimationFrame(animate);
        }
        animationFrame = requestAnimationFrame(animate);
    }

    function pausePlayback() {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
            playbackState = "paused";
            updatePlaybackButton();
        }
    }

    function resetPlayback() {
        pausePlayback();
        playbackState = "stopped";
        playbackIndex = 0;

        playbackMarker.setLatLng([coords[0].lat, coords[0].lon]);
        playbackTrail.setLatLngs([]);
        playbackMarker.setStyle({ opacity: 0, fillOpacity: 0 });

        updatePlaybackButton();
    }

    function updatePlaybackButton() {
        const btn = document.getElementById("playbackMainBtn");
        if(!btn) return;

        if(playbackState === "playing") {
            btn.textContent = "⏸";
        } else if (playbackState === "finished") {
            btn.textContent = "⟲";
        } else {
            btn.textContent = "▶";
        }

    }

    function handlePlaybackButton() {
    if (playbackState === "playing") {
        pausePlayback();
    } else if (playbackState === "finished") {
        resetPlayback();
        startPlayback();
    } else {
        // stopped or paused
        startPlayback();
    }
}

    function cyclePlaybackSpeed() {
        speedIndex = (speedIndex + 1) % speeds.length;
        playbackSpeed = speeds[speedIndex];
        updateSpeedButton();
    }

    function updateSpeedButton() {
        const btn = document.getElementById("speedBtn");
        if (!btn) return;

        btn.textContent = `${playbackSpeed}x`;
    }

    if (playControl) {
        map.removeControl(playControl);
    }
    playControl = createPlayControls({handlePlaybackButton, cyclePlaybackSpeed});
    playControl.addTo(map);
    updatePlaybackButton();
    updateSpeedButton();
    

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
    // currently pop ups appear if the route is moused over, but i think that is too annoying. I want to change it so that the popups only appear when the route is clicked, and disappear when the mouse is clicked anywhere else on the map.
    // to do this I will 
    polyline.on('click', function(e) {
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
    mileMarkerCheckbox.addEventListener('change', function() { // This line is adding an event listener to the mileMarkerCheckbox that listens for the 'change' event, which occurs when the checkbox is checked or unchecked. When the event is triggered, it executes the function that follows.
        if (this.checked) { // This line is checking if the checkbox is currently checked (i.e., if this.checked is true). If it is checked, it executes the code block that follows, which adds the markerGroup layer to the map, making the mile markers visible. If it is not checked, it executes the else block, which removes the markerGroup layer from the map, hiding the mile markers.
            map.addLayer(markerGroup);
        } else {
            map.removeLayer(markerGroup);
        }
    });
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
                    min: 4,
                    max: 11,
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

// ==================== 4. LOG IN ====================

function login() {
  const domain = "https://us-east-2knwe4xhwf.auth.us-east-2.amazoncognito.com";
  const clientId = "5b7rkt6tvt4uf83vpn6pu08rf";
  const redirectUri = "https://d2c9sqoatsu7vi.cloudfront.net";

  const url =
    `${domain}/login?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&scope=openid+email+profile` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  window.location.href = url;
}

function logout() {
  localStorage.removeItem("id_token");
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");

  const domain = "https://us-east-2knwe4xhwf.auth.us-east-2.amazoncognito.com";
  const clientId = "5b7rkt6tvt4uf83vpn6pu08rf";
  const logoutUri = "https://d2c9sqoatsu7vi.cloudfront.net";

  window.location.href =
    `${domain}/logout?` +
    `client_id=${clientId}` +
    `&logout_uri=${encodeURIComponent(logoutUri)}`;
}

function getCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("code");
}

async function exchangeCodeForTokens(code) {
  const domain = "https://us-east-2knwe4xhwf.auth.us-east-2.amazoncognito.com";
  const clientId = "5b7rkt6tvt4uf83vpn6pu08rf";
  const redirectUri = "https://d2c9sqoatsu7vi.cloudfront.net";

  const response = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: {
        "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri
    })
  });

  

  const data = await response.json();
  console.log("Token response:", data);

  if (data.id_token) {
    localStorage.setItem("id_token", data.id_token);
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);

    window.history.replaceState({}, document.title, "/");
  }
}

function setLoginStatus(message) {
    loginStatus.textContent = message;
}

const authCode = getCodeFromUrl();

if (authCode) {
    exchangeCodeForTokens(authCode);
}

// what issues are there with this code?
// 2. The sync logic for the charts is a bit complex and relies on custom handlers to synchronize tooltips and hover states between charts. This works but could potentially be simplified or made more robust, especially if more charts are added in the future.
// 3. The code for loading and processing the route data is all contained within the loadRoute function, which is called both when a user selects a route from the dropdown and when they upload files. This works but could potentially be refactored to separate concerns more cleanly, such as having separate functions for loading data, processing data, and rendering charts.
// 4. There is some duplicated code for creating the charts (elevation, pace, heart rate, cadence) that could potentially be abstracted into a helper function to reduce redundancy and improve maintainability.
// 5. The code does not currently handle errors that may occur during file reading, data processing, or chart rendering, which could lead to uncaught exceptions and a poor user experience. Adding try-catch blocks and user-friendly error messages would improve robustness.
// 6. The code assumes that the uploaded files will always be in the correct format and contain the expected properties, which may not always be the case. Adding validation checks for the uploaded data would help prevent errors and improve user feedback.
// 7. The code for calculating pace and smoothing it with a moving average is somewhat complex and may not be immediately clear to other developers. Adding comments or refactoring this logic into a separate function could improve readability.
// 8. The code for handling mile markers and their visibility is functional but could potentially be improved by using a more efficient method for toggling visibility, such as using CSS classes or a dedicated layer group that can be easily shown or hidden without needing to add/remove individual markers from the map.
// Im sure there are plenty more issues.
