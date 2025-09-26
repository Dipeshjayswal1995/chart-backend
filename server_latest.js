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

const folderPath = path.join(__dirname, "data");
const metaFilePath = path.join(folderPath, "fileIndex.json");

// ✅ Ensure folder + metadata file exists and is valid JSON
if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
if (!fs.existsSync(metaFilePath) || fs.readFileSync(metaFilePath, "utf-8").trim() === "") {
  fs.writeFileSync(metaFilePath, JSON.stringify([], null, 2));
}

// ✅ Helper: uniform response
function sendResponse(res, success, data, message, statusCode) {
  return res.status(statusCode).json({ status: success, data, message, statusCode });
}

// ✅ Helper: read & write metadata safely
function readMeta() {
  try {
    const raw = fs.readFileSync(metaFilePath, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error("⚠️ Meta read error:", err.message);
    fs.writeFileSync(metaFilePath, JSON.stringify([], null, 2));
    return [];
  }
}
function writeMeta(meta) {
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2));
}

// ✅ 1. Save JSON (store as UUID file)
app.post("/save-json", (req, res) => {
  try {
    const { filename, data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const id = uuidv4(); // always unique
    const displayName = filename || `data_${Date.now()}`;
    const fileName = `${id}.json`; // saved as UUID.json
    const filePath = path.join(folderPath, fileName);

    // Save JSON data
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Add to metadata
    const meta = readMeta();
    const newFileInfo = {
      id,
      filename: fileName,      // actual saved file
      displayName,             // ✅ user-facing name
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

// ✅ 2. List files
app.get("/files", (req, res) => {
  try {
    const meta = readMeta()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendResponse(res, true, meta, "Files retrieved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading files: ${err.message}`, 500);
  }
});

// ✅ 3. Get file by ID
app.get("/file/:id", (req, res) => {
  try {
    const meta = readMeta();
    const fileMeta = meta.find((m) => m.id === req.params.id);

    if (!fileMeta) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const filePath = path.join(folderPath, fileMeta.filename);
    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found on disk", 404);
    }

    const fileData = fs.readFileSync(filePath, "utf-8");
    const jsonData = JSON.parse(fileData);

    return sendResponse(res, true, { meta: fileMeta, data: jsonData }, "File retrieved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading file: ${err.message}`, 500);
  }
});

// ✅ 4. Update JSON + metadata (by ID)
app.put("/file/:id", (req, res) => {
  try {
    const { data, newDisplayName } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const meta = readMeta();
    const fileMeta = meta.find((m) => m.id === req.params.id);
    if (!fileMeta) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const filePath = path.join(folderPath, fileMeta.filename);
    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found on disk", 404);
    }

    // ✅ Save updated JSON data
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // ✅ Update metadata
    if (newDisplayName) {
      fileMeta.displayName = newDisplayName;
    }
    fileMeta.updatedAt = new Date().toISOString();
    writeMeta(meta);

    return sendResponse(res, true, fileMeta, "File updated successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
  }
});

// ✅ 5. Delete file + metadata (by ID)
app.delete("/file/:id", (req, res) => {
  try {
    const meta = readMeta();
    const fileMeta = meta.find((m) => m.id === req.params.id);

    if (!fileMeta) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const filePath = path.join(folderPath, fileMeta.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const newMeta = meta.filter((m) => m.id !== req.params.id);
    writeMeta(newMeta);

    return sendResponse(res, true, { id: req.params.id }, "File deleted successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error deleting file: ${err.message}`, 500);
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
