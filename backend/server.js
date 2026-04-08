import express from "express";
import cors from "cors";
import multer from "multer";
import AWS from "aws-sdk";

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
    console.log(route);
    console.log(req.params.id);
     // Logging the route object to the console for debugging purposes.
    // Interesting that it is logging "undefined". 
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
        console.log(`Deleting route with id: ${req.params.id}`);

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
    } else {
        res.status(404).json({ error: "Route not found" });
    }
});


// alright, my first step in switching to dynamodb is to fix the upload
app.post("/upload", upload.array("files"), async (req, res) => {
    try {
        let trackKey = null;
        let pointKey = null;
        let routeName = "Uploaded Route";

        for (const file of req.files) {
            const key = `routes/${Date.now()}-${file.originalname}`;

            await s3.upload({
                Bucket: "cdb-interactivemap",
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }).promise();

            // const signedUrl = s3.getSignedUrl("getObject", {
            //     Bucket: "cdb-interactivemap",
            //     Key: key,
            //     Expires: 60 * 60, // URL expires in 1 hour
            // });

            if (file.originalname === "tracks.geojson") {
                trackKey = key;
                const json = JSON.parse(file.buffer.toString());
                if (json.features && json.features.length > 0) {
                    routeName = json.features[0].properties.name || routeName;
                }
            } else if (file.originalname === "track_points.geojson") {
                pointKey = key;
            }
        }

        // const routes = await getRoutes();


        // This is a placeholder for the new route object that will be created after a successful upload. Later will store in DynamoDB or some other database, but for now just log it to the console.
        const newRoute = { // 
            route_id: Date.now().toString(),
            name: routeName,
            trackKey: trackKey,
            pointKey: pointKey,
            uploadedAt: new Date().toISOString()
        };

        await dynamoDb.put({ // Uploading newRoute object to DynamoDB.
            TableName: TABLE_NAME,
            Item: newRoute
        }).promise();

        // routes.push(newRoute);
        // await saveRoutes(routes);

        // res.json({ 
        //     message: "Files recieved succesfully",
        //     trackUrl,
        //     pointUrl,
        //     fileCount: req.files.length
        // });

    } catch (error) {
        console.error("Error uploading files:", error);
        res.status(500).json({ error: "Failed to upload files" });
    }

});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});

