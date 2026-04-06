import express from "express";
import cors from "cors";
import multer from "multer";
import AWS from "aws-sdk";

const app = express();
app.use(cors());

// now I am going to implement file upload functionality using multer.

const s3 = new AWS.S3({
    region: "us-east-2",
});

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
    res.send("Server is running");
});

app.post("/upload", upload.array("files"), async (req, res) => {
    try {
        let trackUrl = null;
        let pointUrl = null;

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
            } else if (file.originalname === "track_points.geojson") {
                pointUrl = signedUrl;
            }
     }
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

