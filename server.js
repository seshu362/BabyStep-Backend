const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const moment = require("moment");

const app = express();
app.use(express.json());
app.use(cors());

// Connect to SQLite database
const db = new sqlite3.Database("appointments.db", (err) => {
  if (err) console.error("Error connecting to database", err);
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialization TEXT NOT NULL,
    working_start TEXT NOT NULL,
    working_end TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctorId INTEGER NOT NULL,
    date TEXT NOT NULL,
    duration INTEGER NOT NULL,
    appointmentType TEXT NOT NULL,
    patientName TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY (doctorId) REFERENCES doctors(id)
  )`);
});

// Fetch all doctors
app.get("/doctors", (req, res) => {
  db.all("SELECT * FROM doctors", (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
  });
});

// Get available time slots for a doctor on a given date
app.get("/doctors/:id/slots", (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  db.get("SELECT * FROM doctors WHERE id = ?", [id], (err, doctor) => {
    if (err || !doctor) return res.status(404).json({ error: "Doctor not found" });

    const start = moment(`${date} ${doctor.working_start}`, "YYYY-MM-DD HH:mm");
    const end = moment(`${date} ${doctor.working_end}`, "YYYY-MM-DD HH:mm");

    db.all(
      "SELECT date, duration FROM appointments WHERE doctorId = ? AND date BETWEEN ? AND ?",
      [id, start.toISOString(), end.toISOString()],
      (err, existingAppointments) => {
        if (err) return res.status(500).json({ error: "Failed to fetch appointments" });

        let slots = [];
        let currentSlot = start.clone();

        while (currentSlot.isBefore(end)) {
          let slotEnd = currentSlot.clone().add(30, "minutes");

          let isOverlapping = existingAppointments.some((app) =>
            moment(app.date).isBetween(currentSlot, slotEnd, null, "[")
          );

          if (!isOverlapping) {
            slots.push(currentSlot.format("HH:mm"));
          }

          currentSlot.add(30, "minutes");
        }
        res.json(slots);
      }
    );
  });
});

// Book an appointment
app.post("/appointments", (req, res) => {
  console.log("Request body:", req.body); // Log the request body
  const { doctorId, date, duration, appointmentType, patientName, notes } = req.body;

  // Check for missing fields
  if (!doctorId || !date || !duration || !appointmentType || !patientName) {
    console.error("Missing fields:", { doctorId, date, duration, appointmentType, patientName });
    return res.status(400).json({ error: "All fields are required" });
  }

  const appointmentStart = moment(date, "YYYY-MM-DD HH:mm");
  const appointmentEnd = appointmentStart.clone().add(duration, "minutes");

  db.all("SELECT date, duration FROM appointments WHERE doctorId = ?", [doctorId], (err, existingAppointments) => {
    if (err) {
      console.error("Error fetching existing appointments:", err);
      return res.status(500).json({ error: "Failed to fetch existing appointments" });
    }

    const isOverlapping = existingAppointments.some((app) => {
      const existingStart = moment(app.date, "YYYY-MM-DD HH:mm");
      const existingEnd = existingStart.clone().add(app.duration, "minutes");

      return appointmentStart.isBetween(existingStart, existingEnd, null, "[") ||
             appointmentEnd.isBetween(existingStart, existingEnd, null, "]") ||
             appointmentStart.isSame(existingStart);
    });

    if (isOverlapping) {
      console.error("Time slot not available");
      return res.status(400).json({ error: "Time slot not available" });
    }

    db.run(
      `INSERT INTO appointments (doctorId, date, duration, appointmentType, patientName, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [doctorId, appointmentStart.toISOString(), duration, appointmentType, patientName, notes],
      function (err) {
        if (err) {
          console.error("Error inserting appointment:", err);
          return res.status(500).json({ error: "Failed to create appointment" });
        }
        res.status(201).json({ id: this.lastID, doctorId, date, duration, appointmentType, patientName, notes });
      }
    );
  });
});

// Fetch all appointments
app.get("/appointments", (req, res) => {
  db.all("SELECT * FROM appointments", (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
  });
});

// Update an appointment
app.put("/appointments/:id", (req, res) => {
  const { id } = req.params;
  const { date, duration, appointmentType, patientName, notes } = req.body;

  db.run(
    `UPDATE appointments SET date = ?, duration = ?, appointmentType = ?, patientName = ?, notes = ? WHERE id = ?`,
    [date, duration, appointmentType, patientName, notes, id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to update appointment" });
      if (this.changes === 0) return res.status(404).json({ error: "Appointment not found" });
      res.json({ message: "Appointment updated successfully" });
    }
  );
});

// Delete an appointment
app.delete("/appointments/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM appointments WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Failed to delete appointment" });
    if (this.changes === 0) return res.status(404).json({ error: "Appointment not found" });
    res.json({ message: "Appointment deleted successfully" });
  });
});

// Start server
app.listen(5000, () => console.log("Server running on port 5000"));
