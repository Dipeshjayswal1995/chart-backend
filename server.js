const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
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

function sanitizeHost(host) {
  return host.replace(/:/g, "-").replace(/[^a-zA-Z0-9.-]/g, "_");
}

// ✅ Get effective host (keep host + port)
function getEffectiveHost(req) {
  if (req.headers["x-host"]) {
    // Example: 172.16.50.100:4200 → 172.16.50.100-4200
    return sanitizeHost(req.headers["x-host"]);
  }

  if (req.headers["origin"]) {
    try {
      const url = new URL(req.headers["origin"]);
      const port = url.port || "80";
      return sanitizeHost(`${url.hostname}:${port}`);
    } catch (e) {
      console.warn("Invalid origin header:", req.headers["origin"]);
    }
  }

  // fallback: req.headers.host includes port
  return sanitizeHost(req.headers.host || req.hostname);
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

app.post("/save-json", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const { displayName, data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    if (!displayName || displayName.trim() === "") {
      return sendResponse(res, false, null, "Report name is required", 400);
    }

    const meta = readMeta(metaFilePath);

    // ✅ Check if displayName already exists
    const exists = meta.some(file => file.displayName === displayName);
    if (exists) {
      return sendResponse(res, false, null, "Report name already used, choose another", 400);
    }

    const id = uuidv4(); // unique ID
    const fileName = `${id}.json`; // unique filename
    const filePath = path.join(domainDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    const newFileInfo = {
      id,
      filename: fileName,
      displayName,        // one-time use display name
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

app.put("/file/:id", (req, res) => {
  try {
    const host = getEffectiveHost(req);
    const { domainDir, metaFilePath } = getDomainPaths(host);
    const { data, newDisplayName } = req.body;

    const meta = readMeta(metaFilePath);
    const fileMeta = meta.find(m => m.id === req.params.id);
    if (!fileMeta) return sendResponse(res, false, null, "File not found", 404);

    const oldFilePath = path.join(domainDir, fileMeta.filename);
    if (!fs.existsSync(oldFilePath)) {
      return sendResponse(res, false, null, "File not found on disk", 404);
    }

    // ✅ Check if new display name already exists in other files
    if (newDisplayName && newDisplayName !== fileMeta.displayName) {
      const nameExists = meta.some(
        m => m.displayName === newDisplayName && m.id !== req.params.id
      );
      if (nameExists) {
        return sendResponse(
          res,
          false,
          null,
          "Report name already used, choose a different name",
          400
        );
      }
      // ✅ Update display name if unique
      fileMeta.displayName = newDisplayName;
    }

    // ✅ Update JSON data if provided
    if (data && typeof data === "object") {
      fs.writeFileSync(oldFilePath, JSON.stringify(data, null, 2));
    }

    // ✅ Always update updatedAt
    fileMeta.updatedAt = new Date().toISOString();

    // ✅ Save back to metadata
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
      "id": uuidv4(),
      "projectName": "Ace High Chart",
      "sidebarColor": "#1b273a",
      "mainBackgroundColor": "#ffffff",
      "textColor": "#ffffff",
      "projectLogo": "data:image/png;base64,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",
      "chartBackgroundColor": "#ffffff",
      "selectedColor": "#196ba7"
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