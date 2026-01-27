const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

// ===== PostgreSQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== Tworzenie tabel =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coolers (
      id SERIAL PRIMARY KEY,
      device_name TEXT,
      serial_number SERIAL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tests (
      id SERIAL PRIMARY KEY,
      cooler_id INTEGER REFERENCES coolers(id),
      inspector_name TEXT,
      test_datetime TIMESTAMP,
      photo BYTEA
    );
  `);
}
initDB();

// ===== Multer w pamięci (NIE NA DYSKU) =====
const upload = multer({ storage: multer.memoryStorage() });

// ===== Nowa próba =====
app.post('/new-test', upload.single('photo'), async (req, res) => {
  try {
    const { device_name, inspector_name, photo_taken_at } = req.body;

    const cooler = await pool.query(
      `INSERT INTO coolers(device_name)
       VALUES($1)
       RETURNING id, serial_number`,
      [device_name]
    );

    await pool.query(
      `INSERT INTO tests(cooler_id, inspector_name, test_datetime, photo)
       VALUES($1,$2,$3,$4)`,
      [
        cooler.rows[0].id,
        inspector_name,
        photo_taken_at,
        req.file.buffer
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Lista prób =====
app.get('/tests', async (req, res) => {
  const q = await pool.query(`
    SELECT t.id, c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY t.id DESC
  `);
  res.json(q.rows);
});

// ===== PDF raport =====
app.get('/report/:id', async (req, res) => {
  const q = await pool.query(`
    SELECT c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime, t.photo
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    WHERE t.id=$1
  `, [req.params.id]);

  const row = q.rows[0];

  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  doc.text('PROTOKÓŁ PRÓBY SZCZELNOŚCI');
  doc.moveDown();
  doc.text(`Nazwa: ${row.device_name}`);
  doc.text(`Nr seryjny: ${row.serial_number}`);
  doc.text(`Osoba: ${row.inspector_name}`);
  doc.text(`Data: ${row.test_datetime}`);
  doc.moveDown();
  doc.image(row.photo, { width: 300 });

  doc.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API działa na ${PORT}`));
