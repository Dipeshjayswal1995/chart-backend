const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors"); // ✅ Import CORS

const app = express();
const PORT = 3000;


// ✅ Enable CORS for Angular (http://localhost:4200)
// app.use(cors({
//   origin: "http://localhost:4200",
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   credentials: true
// }));

// app.use(cors({
//   origin: "http://172.16.50.100:4300", // ✅ Angular frontend origin
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   credentials: true
// }));

const allowedOrigins = [
  "http://localhost:4200",
  "http://172.16.50.100:4300"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const folderPath = path.join(__dirname, "ahc_data");

// Ensure folder exists
if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath);
}

// ✅ Helper: uniform response
function sendResponse(res, success, data, message, statusCode) {
  return res.status(statusCode).json({
    status: success,
    data: data || null,
    message,
    statusCode,
  });
}

// ✅ 1. Save JSON (prevent duplicate filenames)
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

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return sendResponse(res, true, data, "JSON saved successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error saving file: ${err.message}`, 500);
  }
});

app.get("/files", (req, res) => {
  try {
    const files = fs.readdirSync(folderPath)
      .filter((file) => file.endsWith(".json"))
      .map(file => {
        const filePath = path.join(folderPath, file);
        const stats = fs.statSync(filePath);
        return {
          name: file.replace(/\.json$/, ""), // remove .json
          createdAt: stats.birthtime // creation date
        };
      })
      // Sort by creation date descending (latest first)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return sendResponse(res, true, files, "Files retrieved successfully", 200);
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

// ✅ 4. Update a JSON file
// app.put("/file/:name", (req, res) => {
//   try {
//     const fileName = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
//     const { data } = req.body;

//     if (!data || typeof data !== "object") {
//       return sendResponse(res, false, null, "Invalid JSON format", 400);
//     }

//     const filePath = path.join(folderPath, fileName);

//     if (!fs.existsSync(filePath)) {
//       return sendResponse(res, false, null, "File not found", 404);
//     }

//     fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
//     return sendResponse(res, true, data, "File updated successfully", 200);
//   } catch (err) {
//     return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
//   }
// });

// Lestest Code currently not in use
app.put("/file/:oldName", (req, res) => {
  try {
    const oldName = req.params.oldName.endsWith(".json")
      ? req.params.oldName
      : `${req.params.oldName}.json`;

    const { newName, data } = req.body;

    if (!data || typeof data !== "object") {
      return sendResponse(res, false, null, "Invalid JSON format", 400);
    }

    if (!newName || typeof newName !== "string") {
      return sendResponse(res, false, null, "New file name is required", 400);
    }

    const oldPath = path.join(folderPath, oldName);
    if (!fs.existsSync(oldPath)) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    const newFileName = newName.endsWith(".json") ? newName : `${newName}.json`;
    const newPath = path.join(folderPath, newFileName);

    // ✅ Validation: check if new file name already exists
    if (fs.existsSync(newPath) && newPath !== oldPath) {
      return sendResponse(res, false, null, "File name already exists", 409);
    }

    // ✅ Rename if needed
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }

    // ✅ Update file content
    fs.writeFileSync(newPath, JSON.stringify(data, null, 2));

    return sendResponse(res, true, { file: newFileName, data }, "File updated successfully", 200);

  } catch (err) {
    return sendResponse(res, false, null, `Error updating file: ${err.message}`, 500);
  }
});

// ✅ 5. Delete a JSON file
app.delete("/file/:name", (req, res) => {
  try {
    const fileName = req.params.name.endsWith(".json") ? req.params.name : `${req.params.name}.json`;
    const filePath = path.join(folderPath, fileName);

    if (!fs.existsSync(filePath)) {
      return sendResponse(res, false, null, "File not found", 404);
    }

    fs.unlinkSync(filePath);
    return sendResponse(res, true, { file: fileName }, "File deleted successfully", 200);
  } catch (err) {
    return sendResponse(res, false, null, `Error deleting file: ${err.message}`, 500);
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://172.16.50.100:${PORT}`);
});
