const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/version', (req, res) => {
  res.send('PPS BACKEND VERSION 13');
});

// ===== DB CONNECTION =====
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:AStechnik2012!@localhost:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

// ===== INIT / MIGRACJA DB =====
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

  // 🔥 MIGRACJA — nowe pola jeśli nie istnieją
  await pool.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS pressure_bar NUMERIC;`);
  await pool.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS min_45_minutes BOOLEAN;`);
}

const upload = multer({ storage: multer.memoryStorage() });

// ===== NOWA PRÓBA =====
app.post('/new-test', upload.single('photo'), async (req, res) => {
  try {
    const {
      device_name,
      inspector_name,
      photo_taken_at,
      pressure_bar,
      min_45_minutes
    } = req.body;

    // ✅ WALIDACJA CIŚNIENIA
    if (!/^\d+(\.\d+)?$/.test(pressure_bar)) {
      return res.status(400).json({
        error: 'Pole "Ciśnienie (bar)" musi być liczbą'
      });
    }

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
      `INSERT INTO tests
      (cooler_id, inspector_name, test_datetime, photo, pressure_bar, min_45_minutes)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        cooler.rows[0].id,
        inspector_name,
        photo_taken_at,
        req.file.buffer,
        pressure_bar,
        min_45_minutes === 'true'
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
  const q = await pool.query(`
    SELECT t.id, c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime,
           t.pressure_bar, t.min_45_minutes
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY t.id DESC
  `);

  res.json(q.rows);
});

// ===== POBRANIE ZDJĘCIA =====
app.get('/photo/:id', async (req, res) => {
  const q = await pool.query(
    'SELECT photo FROM tests WHERE id=$1',
    [req.params.id]
  );

  if (!q.rows.length) return res.status(404).send('Brak zdjęcia');

  res.setHeader('Content-Type', 'image/jpeg');
  res.send(q.rows[0].photo);
});

// ===== RAPORT PDF =====
app.get('/report/:id', async (req, res) => {
  const q = await pool.query(`
    SELECT c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime,
           t.photo, t.pressure_bar, t.min_45_minutes
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    WHERE t.id=$1
  `, [req.params.id]);

  if (!q.rows.length) return res.status(404).send('Brak danych');

  const row = q.rows[0];
  const img = row.photo;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // ===== TŁO =====
  const bgPath = path.join(__dirname, 'assets', 'letterhead.png');
  if (fs.existsSync(bgPath)) {
    doc.image(bgPath, 0, 0, { width: 595 });
  }

  // ===== FONTY =====
  const fontRegular = path.join(__dirname, 'fonts', 'Exo2-Regular.ttf');
  const fontBold = path.join(__dirname, 'fonts', 'Exo2-Bold.ttf');

  if (fs.existsSync(fontRegular)) doc.registerFont('exo', fontRegular);
  if (fs.existsSync(fontBold)) doc.registerFont('exo-bold', fontBold);

  // ===== TEKST =====
  doc.fillColor('black');

  doc.font('exo-bold')
     .fontSize(20)
     .text('PROTOKÓŁ PRÓBY SZCZELNOŚCI', 50, 170);

  doc.font('exo')
     .fontSize(12)
     .text(`Nazwa chłodnicy: ${row.device_name}`, 50, 220)
     .text(`Numer seryjny: ${row.serial_number}`)
     .text(`Osoba sprawdzająca: ${row.inspector_name}`)
     .text(`Data wykonania próby: ${new Date(row.test_datetime).toLocaleString('pl-PL')}`)
     .text(`Ciśnienie próby: ${row.pressure_bar} bar`)
     .text(`Czas próby min. 45 minut: ${row.min_45_minutes ? 'TAK' : 'NIE'}`);

  doc.font('exo-bold')
     .text('Zdjęcie z próby:', 50, 330);

  doc.image(img, 50, 360, { fit: [500, 350] });

  doc.end();
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await initDB();
  console.log('API działa');
});
