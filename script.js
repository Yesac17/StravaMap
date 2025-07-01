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
                    <b>Elevation:</b> ${elevation * 3.28} ft<br>
                    <b>Time:</b> ${new Date(time).toLocaleTimeString()}<br>
                    <b>Heart Rate:</b> ${hr || 'n/a'} bpm
                    `);
            }
        });
    });

    function extractFromExtension(xmlStr, tag) {
        const match = xmlStr.match(new RegExp(`<gpxtpx:${tag}>(\\d+)</gpxtpx:${tag}>`));
        return match ? match[1]: null;
    }

