// Create a map centered on Menomonie
const map = L.map('map').setView([44.8765, -91.9207], 13);

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'Map data © OpenStreetMap contributors'
}).addTo(map);

// Add a marker for campus
// L.marker([44.871793, -91.922295]).addTo(map)
//   .bindPopup('Monkey Manor')
//   .openPopup();

function distanceSq(a,b) {
            return (a.lat - b.lat) ** 2 + (a.lon - b.lng) ** 2;
        }

function haversine(p1, p2) {
    const R = 6371; //Earth radius in km
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lon - p1.lon);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // in km
}

function extractFromExtension(xmlStr, tag) {
        const match = xmlStr.match(new RegExp(`<gpxtpx:${tag}>(\\d+)</gpxtpx:${tag}>`));
        return match ? match[1]: null;
}


Promise.all([
    fetch('routes/tracks.geojson').then(res => res.json()),
    fetch('routes/track_points.geojson').then(res => res.json())
]).then(([trackData, pointData]) => {
    const polyline = L.geoJSON(trackData, {
            style: { color: 'blue', weight: 4 }            
        }).addTo(map);

    const coords = pointData.features.map(f => {
            const [lon, lat] = f.geometry.coordinates;
            const ele = f.properties.ele; //* 3.28
            const time = new Date(f.properties.time);
            const hr = extractFromExtension(f.properties.gpxtpx_TrackPointExtension || '', 'hr');
            return { lat, lon, ele, time, hr};
        });


    // Mile Markers
    let dist = 0;
    let mileCount = 1;

    for()
    
    const latlngs = coords.map(c => [c.lat, c.lon]);
        map.fitBounds(latlngs);

    const popup = L.popup();

    polyline.on('click', function(e) {
            const latlng = e.latlng;

            // find nearest coordinate
            let nearest = coords.reduce((a, b) =>
                distanceSq(a, latlng) < distanceSq(b, latlng) ? a : b
            );

            const elevationFt = (nearest.ele * 3.28084).toFixed(0);
            const timeStr = nearest.time.toLocaleTimeString();
            const hr = nearest.hr;
            const popupHtml = `
                <b>Elevation:</b> ${elevationFt} ft<br>
                <b>Time:</b> ${timeStr} <br>
                <b>Heart Rate:</b> ${hr || 'n/a'} bpm
                `;

            popup.setLatLng(latlng).setContent(popupHtml).openOn(map);
    });

    // Building elevation chart
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

    const ctx = document.getElementById('elevationChart').getContext('2d');
    new Chart(ctx, {
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
            }]
        },
        options: {
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distance (mi)'
                    },
                    ticks: {
                        maxTicksLimit: 10
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Elevation (ft)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });


    let totalDist = 0;
    let totalElevGain = 0;
    for (let i = 1; i < coords.length; i++) {
        const prev = coords[i-1];
        const curr = coords[i];

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


    document.getElementById("distance").textContent = (totalDist / 1.609).toFixed(2);
    document.getElementById("elevation").textContent = Math.round(totalElevGain *  3.28);
    document.getElementById("pace").textContent =  `${paceMin}:${paceSec.toFixed(0).padStart(2, '0')}`;
})
