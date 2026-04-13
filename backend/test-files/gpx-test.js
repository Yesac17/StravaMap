import fs from 'fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { gpx } from '@tmcw/togeojson';


// Read the GPX file

const gpxFile = await fs.readFile('Rio_de_Janeiro.gpx', 'utf8');
// This line is asynchronously reading the contents of the 'Rio_de_Janeiro.gpx' file and storing it in the variable 'gpxFile' as a string.

// parse XML

const dom = new DOMParser().parseFromString(gpxFile, 'application/xml');
// This line is parsing the GPX file string into an XML DOM object using the DOMParser from the '@xmldom/xmldom' library. The resulting DOM object is stored in the variable 'dom'.

// convert to GeoJSON

const geojson = gpx(dom);
// This line is converting the parsed XML DOM object into GeoJSON format using the 'gpx' function from the '@tmcw/togeojson' library. The resulting GeoJSON object is stored in the variable 'geojson'.

// await fs.writeFile(
//   'converted.geojson',
//   JSON.stringify(geojson, null, 2)
// );

// next i need to split the converted file into what works with my frontend, tracks.geojson and track_points.geojson
// tracks.geojson includes type: "FeatureCollection" and features with type: "Feature" (properties are name and type) and geometry type: "LineString"
// track_points.geojson includes type: "FeatureCollection" and features with type: "Feature" with geometry type: "Point" and more properties for each point
// converted.geojson includes all of the point properties in the properties section under CoordinateProperties, and the geometry is a LineString with all the points. I need to split this into two separate files, one for the tracks and one for the track points.

const feature = geojson.features[0];
// await fs.writeFile(
//   'converted.geojson',
//   JSON.stringify(feature, null, 2)
// );

const tracksGeojson = { // i have realized that the coordinates in the converted.geojson file include lat long and ele, but my frontend only expects lat and long
// so i need to remove the ele from the coordinates in the tracks.geojson file
  type: 'FeatureCollection',
  name: 'tracks',
  features: [
    {
      type: 'Feature',
      properties: {
        name: feature.properties.name,
        type: feature.properties.type,
      },
      geometry: 
      {
        type: 'LineString',
        coordinates: feature.geometry.coordinates.map((coord) => [coord[0], coord[1]])
      } // this line is removing the ele from the coordinates
    }
  ]
}
//console.log(tracksGeojson);
await fs.writeFile(
  'tracks.geojson',
  JSON.stringify(tracksGeojson, null, 2)
);

const coords = feature.geometry.coordinates;
const coordProps = feature.properties.coordinateProperties;

const features = [];

for (let i = 0; i < coords.length; i++) {
  const [lon, lat, ele] = coords[i];
  const times = coordProps.times[i];
  const atemp = coordProps.atemps[i];
  const hr = coordProps.heart[i];
  const cad = coordProps.cads[i];

  const pointFeature = {
    type: "Feature",
    properties: {
          track_fid: 0,
          track_seg_id: 0,
          track_seg_point_id: i,
          ele: ele,
          time: times,
          gpxtpx_TrackPointExtension: `<gpxtpx:atemp>${atemp}</gpxtpx:atemp><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:cad>${cad}</gpxtpx:cad>`
        },
      geometry: {
        type: "Point",
        coordinates: [lon, lat]
      }
    }
  features.push(pointFeature);
}



const trackPointsGeojson = {
  type: "FeatureCollection",
  name: "track_points",
  features: features
}

await fs.writeFile(
  'track_points.geojson',
  JSON.stringify(trackPointsGeojson, null, 2)
);
