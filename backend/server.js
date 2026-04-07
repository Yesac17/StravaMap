import express from "express";
import cors from "cors";
import multer from "multer";
import AWS from "aws-sdk";
import fs from "fs/promises";

const app = express();
app.use(cors());

// now I am going to implement file upload functionality using multer.

const s3 = new AWS.S3({
    region: "us-east-2",
});



const upload = multer({ storage: multer.memoryStorage() });

async function getRoutes() {
    const data = await fs.readFile("./routes.json", "utf-8");
    return JSON.parse(data);
}

async function saveRoutes(routes) {
    await fs.writeFile("./routes.json", JSON.stringify(routes, null, 2));
}


app.get("/routes", async (req, res) => {
    const routes = await getRoutes();
    res.json(routes);
});

app.get("/", (req, res) => {
    res.send("Server is running");
});

app.get("/routes/:id", async (req, res) => {
    const routes = await getRoutes();
    const route = routes.find(r => r.id === req.params.id);
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
        res.json({
            id: route.id,
            name: route.name,
            trackUrl,
            pointUrl,
            uploadedAt: route.uploadedAt
        });
    } else {
        res.status(404).json({ error: "Route not found" });
    }
});

app.post("/upload", upload.array("files"), async (req, res) => {
    try {
        let trackUrl = null;
        let pointUrl = null;
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

            const signedUrl = s3.getSignedUrl("getObject", {
                Bucket: "cdb-interactivemap",
                Key: key,
                Expires: 60 * 60, // URL expires in 1 hour
            });

            if (file.originalname === "tracks.geojson") {
                trackUrl = signedUrl;
                trackKey = key;
                const json = JSON.parse(file.buffer.toString());
                if (json.features && json.features.length > 0) {
                    routeName = json.features[0].properties.name || routeName;
                }
            } else if (file.originalname === "track_points.geojson") {
                pointUrl = signedUrl;
                pointKey = key;
            }
        }

        const routes = await getRoutes();

        // This is a placeholder for the new route object that will be created after a successful upload. Later will store in DynamoDB or some other database, but for now just log it to the console.
        // Also will want to get the actual name from the file later, but for now just use a placeholder name.
        const newRoute = { // 
            id: Date.now().toString(),
            name: routeName,
            trackKey: trackKey,
            pointKey: pointKey,
            uploadedAt: new Date().toISOString()
        };

        routes.push(newRoute);
        await saveRoutes(routes);

        res.json({ 
            message: "Files recieved succesfully",
            trackUrl,
            pointUrl,
            fileCount: req.files.length
        });

    } catch (error) {
        console.error("Error uploading files:", error);
        res.status(500).json({ error: "Failed to upload files" });
    }

});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});

