const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ====== Upewnij się, że folder uploads istnieje ======
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use('/uploads', express.static(uploadDir));

// ====== PostgreSQL z Render ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ====== Tworzenie tabel jeśli nie istnieją ======
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
      photo_url TEXT
    );
  `);
}

initDB();

// ====== Multer ======
const upload = multer({ dest: uploadDir });

// ====== Nowa próba ======
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
      `INSERT INTO tests(cooler_id, inspector_name, test_datetime, photo_url)
       VALUES($1,$2,$3,$4)`,
      [
        cooler.rows[0].id,
        inspector_name,
        photo_taken_at,
        req.file.filename
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ====== Lista prób ======
app.get('/tests', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT t.id, c.device_name, c.serial_number,
             t.inspector_name, t.test_datetime, t.photo_url
      FROM tests t
      JOIN coolers c ON t.cooler_id=c.id
      ORDER BY t.id DESC
    `);
    res.json(q.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== PDF raport ======
app.get('/report/:id', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT c.device_name, c.serial_number,
             t.inspector_name, t.test_datetime, t.photo_url
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

    const imgPath = path.join(uploadDir, row.photo_url);
    if (fs.existsSync(imgPath)) {
      doc.image(imgPath, { width: 300 });
    }

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== PORT z Render ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API działa na ${PORT}`));
