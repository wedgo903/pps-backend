const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/version', (req, res) => {
  res.send('PPS BACKEND VERSION 4');
});

// ===== DB CONNECTION (Render + lokalnie) =====
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:AStechnik2012!@localhost:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// ===== Tworzenie tabel jeśli nie istnieją =====
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

// ===== Multer w pamięci =====
const upload = multer({ storage: multer.memoryStorage() });

// ===== NOWA PRÓBA =====
app.post('/new-test', upload.single('photo'), async (req, res) => {
  try {
    const { device_name, inspector_name, photo_taken_at } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Brak zdjęcia' });
    }

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
        req.file.buffer,
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ===== LISTA TESTÓW =====
app.get('/tests', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT t.id, c.device_name, c.serial_number,
             t.inspector_name, t.test_datetime
      FROM tests t
      JOIN coolers c ON t.cooler_id=c.id
      ORDER BY t.id DESC
    `);

    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POBIERANIE ZDJĘCIA =====
app.get('/photo/:id', async (req, res) => {
  try {
    const q = await pool.query(
      'SELECT photo FROM tests WHERE id=$1',
      [req.params.id]
    );

    if (!q.rows.length) {
      return res.status(404).send('Brak zdjęcia');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(q.rows[0].photo);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ===== RAPORT PDF =====
app.get('/report/:id', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT c.device_name, c.serial_number,
             t.inspector_name, t.test_datetime, t.photo
      FROM tests t
      JOIN coolers c ON t.cooler_id=c.id
      WHERE t.id=$1
    `, [req.params.id]);

    if (!q.rows.length) {
      return res.status(404).send('Brak danych');
    }

    const row = q.rows[0];

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(18).text('PROTOKÓŁ PRÓBY SZCZELNOŚCI');
    doc.moveDown();
    doc.fontSize(12).text(`Nazwa chłodnicy: ${row.device_name}`);
    doc.text(`Nr seryjny: ${row.serial_number}`);
    doc.text(`Osoba sprawdzająca: ${row.inspector_name}`);
    doc.text(`Data: ${row.test_datetime}`);
    doc.moveDown();

    if (row.photo) {
      doc.image(row.photo, { width: 300 });
    }

    doc.end();
  } catch (e) {
    res.status(500).send(e.message);
  }
});

// ===== START SERWERA =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`API działa na porcie ${PORT}`);

  try {
    await initDB();
    await pool.query('SELECT 1');
    console.log('DB connected');
  } catch (e) {
    console.error('DB init error:', e.message);
  }
});
