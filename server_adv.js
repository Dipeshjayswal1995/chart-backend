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
// ✅ 4. Update JSON + metadata
app.put("/file/:id", (req, res) => {
  try {
    const { data, newFilename } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const meta = readMeta();
    const fileMeta = meta.find((m) => m.id === req.params.id);
    if (!fileMeta) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const oldFilePath = path.join(folderPath, fileMeta.filename);
    if (!fs.existsSync(oldFilePath)) {
      return sendResponse(res, false, null, "File not found on disk", 404);
    }

    let finalFileName = fileMeta.filename;
    let newFilePath = oldFilePath;

    // ✅ Handle rename if newFilename is provided
    if (newFilename) {
      const safeNewFileName = newFilename.endsWith(".json")
        ? newFilename
        : `${newFilename}.json`;
      newFilePath = path.join(folderPath, safeNewFileName);

      if (safeNewFileName !== fileMeta.filename && fs.existsSync(newFilePath)) {
        return sendResponse(res, false, null, `File '${safeNewFileName}' already exists.`, 409);
      }

      if (safeNewFileName !== fileMeta.filename) {
        fs.renameSync(oldFilePath, newFilePath);
        finalFileName = safeNewFileName;
      }
    }

    // ✅ Save updated JSON data
    fs.writeFileSync(newFilePath, JSON.stringify(data, null, 2));

    // ✅ Update metadata
    fileMeta.filename = finalFileName;
    fileMeta.updatedAt = new Date().toISOString();
    writeMeta(meta);

    return sendResponse(res, true, fileMeta, "File updated successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
  }
});


// ✅ 5. Delete file + metadata
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
