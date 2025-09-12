const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;

app.use(cors({
  origin: "http://localhost:4200",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const folderPath = path.join(__dirname, "jsonFiles");
const metaFilePath = path.join(folderPath, "fileIndex.json");

// Ensure folder + metadata exists
if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
if (!fs.existsSync(metaFilePath)) fs.writeFileSync(metaFilePath, JSON.stringify([], null, 2));

// ✅ Helper: uniform response
function sendResponse(res, success, data, message, statusCode) {
  return res.status(statusCode).json({ status: success, data, message, statusCode });
}

// ✅ Helper: read & write metadata
function readMeta() {
  return JSON.parse(fs.readFileSync(metaFilePath, "utf-8"));
}
function writeMeta(meta) {
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2));
}

// ✅ 1. Save JSON (with file info in metadata)
app.post("/save-json", (req, res) => {
  try {
    const { filename, data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const fileName = filename ? `${filename}.json` : `data_${Date.now()}.json`;
    const filePath = path.join(folderPath, fileName);

    if (fs.existsSync(filePath)) {
      return sendResponse(res, false, null, `File '${fileName}' already exists.`, 409);
    }

    // Save JSON data
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Add to metadata
    const meta = readMeta();
    const newFileInfo = {
      id: uuidv4(),
      filename: fileName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    meta.push(newFileInfo);
    writeMeta(meta);

    return sendResponse(res, true, newFileInfo, "JSON saved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error saving file: ${err.message}`, 500);
  }
});

// ✅ 2. List files (from metadata)
app.get("/files", (req, res) => {
  try {
    const meta = readMeta().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendResponse(res, true, meta, "Files retrieved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading files: ${err.message}`, 500);
  }
});

// ✅ 3. Get data from a particular file
app.get("/file/:name", (req, res) => {
  try {
    const fileName = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
    const filePath = path.join(folderPath, fileName);

    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const fileData = fs.readFileSync(filePath, "utf-8");
    const jsonData = JSON.parse(fileData);

    return sendResponse(res, true, jsonData, "File retrieved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading file: ${err.message}`, 500);
  }
});

// ✅ 4. Update JSON + metadata
app.put("/file/:name", (req, res) => {
  try {
    const fileName = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
    const { data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const filePath = path.join(folderPath, fileName);
    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    // Save updated JSON
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Update metadata
    const meta = readMeta();
    const fileMeta = meta.find(m => m.filename === fileName);
    if (fileMeta) fileMeta.updatedAt = new Date().toISOString();
    writeMeta(meta);

    return sendResponse(res, true, fileMeta, "File updated successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
  }
});

// ✅ 5. Delete file + metadata
app.delete("/file/:name", (req, res) => {
  try {
    const fileName = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
    const filePath = path.join(folderPath, fileName);

    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    fs.unlinkSync(filePath);

    // Remove from metadata
    let meta = readMeta();
    meta = meta.filter(m => m.filename !== fileName);
    writeMeta(meta);

    return sendResponse(res, true, { file: fileName }, "File deleted successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error deleting file: ${err.message}`, 500);
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
