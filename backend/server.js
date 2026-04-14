import express from "express";
import cors from "cors";
import multer from "multer";
import AWS from "aws-sdk";
import { DOMParser } from '@xmldom/xmldom';
import { gpx } from '@tmcw/togeojson';
import crypto from "crypto";

const app = express();
app.use(cors());

const s3 = new AWS.S3({ // Initializing S3 client
    region: "us-east-2",
});

const dynamoDb = new AWS.DynamoDB.DocumentClient({ // Initializing DynamoDB client. however DynamoDB is not a constructor
    region: "us-east-2",
});

const TABLE_NAME = "Routes"; // DynamoDB table name

const upload = multer({ storage: multer.memoryStorage() });

async function getRoutes() {
    const data = await dynamoDb.scan({ // Scanning the DynamoDB table to get all routes. This is not the most efficient way to get data from DynamoDB, but it works for now. Later will want to implement pagination or some other method to get data more efficiently.
        TableName: TABLE_NAME
    }).promise();
    const routes = data.Items || []; // The items from the scan result are stored in the Items property. If there are no items, we return an empty array.
    routes.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); // Sorting the routes by uploadedAt in descending order so that the most recently uploaded routes appear first.
    return routes; // Returning the items from the scan result, or an empty array if there are no items.
}

app.get("/routes", async (req, res) => {
    const routes = await getRoutes();
    res.json(routes);
});

app.get("/", (req, res) => {
    res.send("Server is running");
});

app.get("/routes/:id", async (req, res) => { // I need to change this
    const result = await dynamoDb.get({ // Getting a specific route from DynamoDB using the route_id as the key.
        TableName: TABLE_NAME,
        Key: {
            route_id: req.params.id
        }
    }).promise();
    const route = result.Item; // The route object is stored in the Item property of the result.
    if (route) {
        const trackUrl = s3.getSignedUrl("getObject", {
            Bucket: "cdb-interactivemap",
            Key: route.trackKey,
            Expires: 60 * 60, // URL expires in 1 hour
        });
        const pointUrl = s3.getSignedUrl("getObject", {
            Bucket: "cdb-interactivemap",
            Key: route.pointKey,
            Expires: 60 * 60, // URL expires in 1 hour
        });
        res.json({ // Returning the route details along with the signed URLs for the track and point files.
            route_id: route.route_id,
            name: route.name,
            trackUrl,
            pointUrl,
            uploadedAt: route.uploadedAt
        });
    } else {
        res.status(404).json({ error: "THERE IS NO ROUTE MATCHING THE PROVIDED ID SILLY GOOSE" });
    }
});

app.delete("/routes/:id", async (req, res) => { // This endpoint will delete a route from the DynamoDB table and also delete the associated files from S3.
    const routes = await getRoutes();
    const route = routes.findIndex(r => r.route_id === req.params.id);
    if (route !== -1) { // if the route is found, delete it from the array and save the updated array back to the file.
        await s3.deleteObject({
            Bucket: "cdb-interactivemap",
            Key: routes[route].trackKey
        }).promise();

        await s3.deleteObject({
            Bucket: "cdb-interactivemap",
            Key: routes[route].pointKey
        }).promise();

        await dynamoDb.delete({ // Deleting the route from DynamoDB using the route_id as the key.
            TableName: TABLE_NAME,
            Key: {
                route_id: routes[route].route_id
            }
        }).promise();
        res.json({ message: "Route deleted successfully" });
    } else {
        res.status(404).json({ error: "Route not found" });
    }
});


app.post("/upload", upload.array("files"), async (req, res) => {
    try {
        console.log(req.files.length);
        req.files.forEach(file => console.log(file.originalname));
        const uploadedRoutes = [];
        const skippedDuplicates = [];
        for (const file of req.files) { 
            let routeName = "Uploaded Route";

            // before any of the file converting or uploading, I need to check for duplicates in the system
            const fileHash = crypto // creating hash of the uploaded gpx file, a "finger print" unique identifier
                .createHash("sha256")
                .update(file.buffer)
                .digest("hex");
            
            const result = await dynamoDb.scan({
                TableName: TABLE_NAME
            }).promise();

            const duplicate = result.Items.find(route => route.fileHash === fileHash);

            if(duplicate) { //if the file is a duplicate, don't upload it
                skippedDuplicates.push({
                    fileName: file.originalname,
                    reason: "Duplicate file upload"
                });
                continue;
            }

            const gpxFile = file.buffer.toString();
            const dom = new DOMParser().parseFromString(gpxFile, "application/xml");
            const geojson = gpx(dom);
            const feature = geojson.features[0];

            const tracksGeojson = {
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

            const routeId = crypto.randomUUID();
            const name = file.originalname.replace(".gpx", "").toLowerCase().replace(/\s+/g, "-");
            const trackKey = `routes/${routeId}/${name}-tracks.geojson`;
            const pointKey = `routes/${routeId}/${name}-track_points.geojson`; 


            await s3.upload({
                Bucket: "cdb-interactivemap",
                Key: trackKey,
                Body: JSON.stringify(tracksGeojson),
                ContentType: "application/geo+json",
            }).promise();

            await s3.upload({
                Bucket: "cdb-interactivemap",
                Key: pointKey,
                Body: JSON.stringify(trackPointsGeojson),
                ContentType: "application/geo+json",
            }).promise();

            if (tracksGeojson.features && tracksGeojson.features.length > 0) {
                routeName = tracksGeojson.features[0].properties.name || routeName;
            }


            const newRoute = { // Creating a new route object to be stored in DynamoDB.
                route_id: routeId,
                name: routeName,
                trackKey: trackKey,
                pointKey: pointKey,
                uploadedAt: new Date().toISOString(),
                fileHash: fileHash
            };

            await dynamoDb.put({ // Uploading newRoute object to DynamoDB.
                TableName: TABLE_NAME,
                Item: newRoute
            }).promise();
            console.log("uploaded a files.");
            uploadedRoutes.push(newRoute);
        }
        res.json({ message: "Files uploaded successfully", uploadedRoutes, skippedDuplicates});
        console.log(JSON.stringify({uploadedRoutes, skippedDuplicates}));

    } catch (error) {
        console.error("Error uploading files:", error);
        res.status(500).json({ error: "Failed to upload files" });
    }
}); //updated to include gpx -> geojson file conversion.

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});

