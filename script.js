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


fetch('routes/tracks.geojson')
    .then(res => res.json())
    .then(data => {
        L.geoJSON(data, {
            style: { color: 'blue', weight: 4 },
            // onEachFeature: (feature, layer) => {
            //     const name = feature.properties.name || "Unnamed Route";
            //     const time = feature.properties.time;
            //     layer.bindPopup(`<b>${name}</b><br>${time}`);
            // }
            
        }).addTo(map);
    });

function haversine(p1, p2) {
    const R = 6371; //Earth radius in km
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLon = toRad(p2.lon - p1.lon);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // in km
}

fetch('routes/track_points.geojson')
    .then(res => res.json())
    .then(pointsData => {
        pointsData.features.forEach((feature, index) => {
            if (index % 100 === 0) { // only every 100th point
                const [lon, lat] = feature.geometry.coordinates;
                const elevation = feature.properties.ele;
                const time = feature.properties.time;
                const hr = extractFromExtension(feature.properties.gpxtpx_TrackPointExtension, 'hr');

                L.circleMarker([lat, lon] ,{
                    radius: 4,
                    color: 'red',
                    fillOpacity: 0.7
                }).addTo(map).bindPopup(`
                    <b>Elevation:</b> ${(elevation * 3.28).toFixed(0)} ft<br>
                    <b>Time:</b> ${new Date(time).toLocaleTimeString()}<br>
                    <b>Heart Rate:</b> ${hr || 'n/a'} bpm
                    `);
            }
        });

        
        const coords = pointsData.features.map(f => {
            const [lon, lat] = f.geometry.coordinates;
            const ele = f.properties.ele; //* 3.28
            const time = new Date(f.properties.time);
            return { lat, lon, ele, time};
        });

        // Center map on route
        const latlngs = coords.map(c => [c.lat, c.lon]);
        map.fitBounds(latlngs);

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
        document.getElementById("pace").textContent = paceMin + ":" + paceSec.toFixed(0);
    });

    function extractFromExtension(xmlStr, tag) {
        const match = xmlStr.match(new RegExp(`<gpxtpx:${tag}>(\\d+)</gpxtpx:${tag}>`));
        return match ? match[1]: null;
    }

