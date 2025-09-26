const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;

// ✅ Middlewares
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// 📂 Base storage
const BASE_DIR = path.join(__dirname, "ahc_charts_db");

// Ensure base directory exists
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
ensureDirSync(BASE_DIR);

// ✅ Sanitize host string
function sanitizeHost(host) {
  return host.replace(/[^a-zA-Z0-9.-]/g, "_");
}

// ✅ Get effective host
function getEffectiveHost(req) {
  if (req.headers["x-host"]) return sanitizeHost(req.headers["x-host"].split(":")[0]);
  if (req.headers["origin"]) {
    try {
      const url = new URL(req.headers["origin"]);
      return sanitizeHost(url.hostname);
    } catch (e) {
      console.warn("Invalid origin header:", req.headers["origin"]);
    }
  }
  return sanitizeHost(req.hostname.split(":")[0]);
}

// ✅ Utility: Get domain paths
function getDomainPaths(host) {
  const domainDir = path.join(BASE_DIR, host);
  ensureDirSync(domainDir);

  const metaFilePath = path.join(domainDir, "fileIndex.json");
  if (!fs.existsSync(metaFilePath) || fs.readFileSync(metaFilePath, "utf-8").trim() === "") {
    fs.writeFileSync(metaFilePath, JSON.stringify([], null, 2));
  }

  return { domainDir, metaFilePath };
}

// ✅ Metadata read/write
function readMeta(metaFilePath) {
  try {
    const raw = fs.readFileSync(metaFilePath, "utf-8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch {
    fs.writeFileSync(metaFilePath, JSON.stringify([], null, 2));
    return [];
  }
}
function writeMeta(metaFilePath, meta) {
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2));
}

// ✅ Uniform response
function sendResponse(res, success, data, message, statusCode) {
  return res.status(statusCode).json({ status: success, data, message, statusCode });
}

//
// 🔹 FILE APIs (Host-based)
//

// Save JSON
app.post("/save-json", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const { filename, data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const id = uuidv4();
    const displayName = filename || `data_${Date.now()}`;
    const fileName = `${id}.json`;
    const filePath = path.join(domainDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const meta = readMeta(metaFilePath);
    const newFileInfo = {
      id,
      filename: fileName,
      displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    meta.push(newFileInfo);
    writeMeta(metaFilePath, meta);

    return sendResponse(res, true, newFileInfo, `JSON saved successfully for host ${host}`, 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error saving file: ${err.message}`, 500);
  }
});

// List files
app.get("/files", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { metaFilePath } = getDomainPaths(host);
    const meta = readMeta(metaFilePath).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendResponse(res, true, meta, `Files retrieved successfully for host ${host}`, 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading files: ${err.message}`, 500);
  }
});

// Get file
app.get("/file/:id", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const meta = readMeta(metaFilePath);
    const fileMeta = meta.find(m => m.id === req.params.id);

    if (!fileMeta) return sendResponse(res, false, null, "File not found", 404);

    const filePath = path.join(domainDir, fileMeta.filename);
    if (!fs.existsSync(filePath)) return sendResponse(res, false, null, "File not found on disk", 404);

    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return sendResponse(res, true, { meta: fileMeta, data: jsonData }, `File retrieved for host ${host}`, 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error reading file: ${err.message}`, 500);
  }
});

// Update file
app.put("/file/:id", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const { data, newDisplayName } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    const meta = readMeta(metaFilePath);
    const fileMeta = meta.find(m => m.id === req.params.id);
    if (!fileMeta) return sendResponse(res, false, null, "File not found", 404);

    const filePath = path.join(domainDir, fileMeta.filename);
    if (!fs.existsSync(filePath)) return sendResponse(res, false, null, "File not found on disk", 404);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (newDisplayName) fileMeta.displayName = newDisplayName;
    fileMeta.updatedAt = new Date().toISOString();
    writeMeta(metaFilePath, meta);

    return sendResponse(res, true, fileMeta, `File updated successfully for host ${host}`, 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
  }
});

// Delete file
app.delete("/file/:id", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const meta = readMeta(metaFilePath);
    const fileMeta = meta.find(m => m.id === req.params.id);

    if (!fileMeta) return sendResponse(res, false, null, "File not found", 404);

    const filePath = path.join(domainDir, fileMeta.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    writeMeta(metaFilePath, meta.filter(m => m.id !== req.params.id));

    return sendResponse(res, true, { id: req.params.id }, `File deleted successfully for host ${host}`, 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error deleting file: ${err.message}`, 500);
  }
});



// Get config file path for host
function getHostConfigPath(host) {
  return path.join(BASE_DIR, host, "config.json");
}

// Save config atomically
function saveConfigAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// Simple config validator (expand as needed)
function validateConfig(config) {
  return typeof config === "object" && config !== null;
}

app.get("/config", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const hostDir = path.join(BASE_DIR, host);
    const hostConfigPath = getHostConfigPath(host);

    ensureDirSync(hostDir);

    // If config exists → return it
    if (fs.existsSync(hostConfigPath)) {
      const config = JSON.parse(fs.readFileSync(hostConfigPath, "utf-8"));
      return res.json({ success: true, host, config });
    }

    // Otherwise → create new config automatically
    const newConfig = {
      "Project Name": "Ace High Chart",
      "Project Id": uuidv4(),
      "Project Owner": "Dipesh Jayswa"
    };

    fs.writeFileSync(hostConfigPath, JSON.stringify(newConfig, null, 2), "utf-8");

    return res.json({ success: true, host, config: newConfig, created: true });
  } catch (error) {
    console.error("Error reading/creating config:", error);
    res.status(500).json({ success: false, message: "Error loading configuration" });
  }
});

// ✅ POST config
app.post("/config", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const hostDir = path.join(BASE_DIR, host);
    const hostConfigPath = getHostConfigPath(host);

    ensureDirSync(hostDir);

    const newConfig =
      req.body && Object.keys(req.body).length > 0
        ? req.body
        : JSON.parse(fs.readFileSync(DEFAULT_CONFIG, "utf-8"));

    if (!validateConfig(newConfig)) {
      return res.status(400).json({ success: false, message: "Invalid config format" });
    }

    saveConfigAtomic(hostConfigPath, newConfig);

    res.json({ success: true, message: "Config saved successfully", host, config: newConfig });
  } catch (error) {
    console.error("Error saving config:", error);
    res.status(500).json({ success: false, message: "Error saving configuration" });
  }
});

// ✅ Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://172.16.50.100:${PORT}`);
});
