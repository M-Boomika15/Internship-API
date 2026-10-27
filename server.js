
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "100kb" }));

// Create a persistent SQLite database file
const db = new Database(path.join(__dirname, "internships.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS internships (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('Remote', 'Hybrid', 'On-site')),
    location TEXT NOT NULL,
    skills TEXT NOT NULL,
    openings INTEGER NOT NULL CHECK (openings >= 1),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

// Official sample seed records
const seedRecords = [
  {
    id: "INT-101",
    title: "Frontend Intern",
    domain: "Full Stack Development",
    mode: "Remote",
    location: "India",
    skills: ["HTML", "CSS", "JavaScript"],
    openings: 3
  },
  {
    id: "INT-102",
    title: "API Engineering Intern",
    domain: "Full Stack Development",
    mode: "Hybrid",
    location: "Pune",
    skills: ["Node.js", "SQL", "Testing"],
    openings: 2
  },
  {
    id: "INT-103",
    title: "UI/UX Intern",
    domain: "UI/UX",
    mode: "Remote",
    location: "India",
    skills: ["Figma", "Research", "Accessibility"],
    openings: 1
  },
  {
    id: "INT-104",
    title: "Data Analyst Intern",
    domain: "Data Analytics",
    mode: "On-site",
    location: "Bengaluru",
    skills: ["Excel", "SQL", "Data visualisation"],
    openings: 2
  },
  {
    id: "INT-105",
    title: "Security Operations Intern",
    domain: "Cyber Security",
    mode: "Remote",
    location: "India",
    skills: ["Linux", "Logs", "Networking"],
    openings: 1
  }
];

const count = db.prepare(
  "SELECT COUNT(*) AS total FROM internships"
).get().total;

if (count === 0) {
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO internships
    (id, title, domain, mode, location, skills, openings, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction((records) => {
    for (const item of records) {
      insert.run(
        item.id,
        item.title,
        item.domain,
        item.mode,
        item.location,
        JSON.stringify(item.skills),
        item.openings,
        now,
        now
      );
    }
  });

  seed(seedRecords);
}

// Convert database rows to API objects
function formatInternship(row) {
  if (!row) return null;

  return {
    ...row,
    skills: JSON.parse(row.skills)
  };
}

// Input validation
const allowedModes = ["Remote", "Hybrid", "On-site"];

function validateInternship(body) {
  const errors = [];
  const fields = ["title", "domain", "mode", "location", "skills", "openings"];

  for (const field of fields) {
    if (body[field] === undefined || body[field] === null) {
      errors.push(`${field} is required`);
    }
  }

  for (const field of ["title", "domain", "location"]) {
    if (typeof body[field] === "string" && !body[field].trim()) {
      errors.push(`${field} cannot be empty`);
    }
  }

  if (body.mode !== undefined && !allowedModes.includes(body.mode)) {
    errors.push("mode must be Remote, Hybrid, or On-site");
  }

  if (
    body.skills !== undefined &&
    (!Array.isArray(body.skills) ||
      body.skills.length === 0 ||
      !body.skills.every(
        skill => typeof skill === "string" && skill.trim().length > 0
      ))
  ) {
    errors.push("skills must be a non-empty array of strings");
  }

  if (
    body.openings !== undefined &&
    (!Number.isInteger(body.openings) || body.openings < 1)
  ) {
    errors.push("openings must be a positive integer");
  }

  return errors;
}

function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;

  return res.status(status).json({
    success: false,
    error
  });
}

function findInternship(id) {
  return db.prepare(
    "SELECT * FROM internships WHERE id = ?"
  ).get(id);
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: { status: "ok" }
  });
});

// LIST internships with pagination
app.get("/api/internships", (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 10);

  if (
    !Number.isInteger(page) || page < 1 ||
    !Number.isInteger(limit) || limit < 1 || limit > 100
  ) {
    return sendError(
      res, 400, "INVALID_PAGINATION",
      "page must be >= 1 and limit must be between 1 and 100"
    );
  }

  const total = db.prepare(
    "SELECT COUNT(*) AS total FROM internships"
  ).get().total;

  const rows = db.prepare(`
    SELECT * FROM internships
    ORDER BY id
    LIMIT ? OFFSET ?
  `).all(limit, (page - 1) * limit);

  res.json({
    success: true,
    data: rows.map(formatInternship),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

// GET one internship
app.get("/api/internships/:id", (req, res) => {
  const row = findInternship(req.params.id);

  if (!row) {
    return sendError(
      res, 404, "NOT_FOUND", "Internship not found"
    );
  }

  res.json({
    success: true,
    data: formatInternship(row)
  });
});

// CREATE internship
app.post("/api/internships", (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return sendError(res, 400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const errors = validateInternship(req.body);
  if (errors.length) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid internship data", errors);
  }

  const last = db.prepare(`
    SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS number
    FROM internships WHERE id GLOB 'INT-[0-9]*'
  `).get();

  const nextNumber = (last.number || 100) + 1;
  const id = `INT-${nextNumber}`;
  const now = new Date().toISOString();
  const item = req.body;

  db.prepare(`
    INSERT INTO internships
    (id, title, domain, mode, location, skills, openings, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, item.title.trim(), item.domain.trim(), item.mode,
    item.location.trim(), JSON.stringify(item.skills), item.openings, now, now
  );

  res.status(201).json({
    success: true,
    data: formatInternship(findInternship(id))
  });
});

// UPDATE internship (PUT requires all fields)
app.put("/api/internships/:id", (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return sendError(res, 400, "INVALID_BODY", "Request body must be a JSON object");
  }

  if (!findInternship(req.params.id)) {
    return sendError(res, 404, "NOT_FOUND", "Internship not found");
  }

  const errors = validateInternship(req.body);
  if (errors.length) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid internship data", errors);
  }

  const item = req.body;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE internships SET
      title = ?, domain = ?, mode = ?, location = ?,
      skills = ?, openings = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    item.title.trim(), item.domain.trim(), item.mode,
    item.location.trim(), JSON.stringify(item.skills),
    item.openings, now, req.params.id
  );

  res.json({
    success: true,
    data: formatInternship(findInternship(req.params.id))
  });
});

// DELETE internship
app.delete("/api/internships/:id", (req, res) => {
  const result = db.prepare(
    "DELETE FROM internships WHERE id = ?"
  ).run(req.params.id);

  if (result.changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "Internship not found");
  }

  res.json({
    success: true,
    data: { id: req.params.id, deleted: true }
  });
});

// Handle unknown routes
app.use((req, res) => {
  sendError(res, 404, "ROUTE_NOT_FOUND", "API route not found");
});

// Handle invalid JSON and unexpected errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return sendError(res, 400, "INVALID_JSON", "Request body contains invalid JSON");
  }

  console.error(err);
  return sendError(res, 500, "INTERNAL_ERROR", "An unexpected server error occurred");
});

const server = app.listen(PORT, () => {
  console.log(`Internship API running at http://localhost:${PORT}`);
  console.log(`List endpoint: http://localhost:${PORT}/api/internships`);
});

// Close the database cleanly when stopping the server
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
