import express from "express";
import cors from "cors";
import multer from "multer";

const app = express();
app.use(cors());

// now I am going to implement file upload functionality using multer.

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
    res.send("Server is running");
});

app.post("/upload", upload.array("files"), (req, res) => {
    console.log("Files received:", req.files.map(file => file.originalname));

    res.json({ 
        message: "Files recieved succesfully",
        fileCount: req.files.length
     });
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});

