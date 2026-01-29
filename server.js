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

app.get('/version', (req, res) => {
  res.send('PPS BACKEND VERSION 12');
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

// ===== INIT DB =====
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

const upload = multer({ storage: multer.memoryStorage() });

// ===== NOWA PRÓBA =====
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ===== LISTA TESTÓW =====
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
           t.inspector_name, t.test_datetime, t.photo
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

  // ===== ŚCIEŻKI =====
  const bgPath = path.join(__dirname, 'assets', 'letterhead.png');
  const fontRegular = path.join(__dirname, 'fonts', 'Exo2-Regular.ttf');
  const fontBold = path.join(__dirname, 'fonts', 'Exo2-Bold.ttf');

  console.log('BG PATH:', bgPath);
  console.log('FONT PATH:', fontRegular);

  // ===== BEZPIECZEŃSTWO =====
  if (fs.existsSync(bgPath)) {
    doc.image(bgPath, 0, 0, { width: 595 });
  }

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
     .text(`Data wykonania próby: ${new Date(row.test_datetime).toLocaleString('pl-PL')}`);

  doc.font('exo-bold')
     .text('Zdjęcie z próby:', 50, 320);

  doc.image(img, 50, 350, { fit: [500, 350] });

  doc.end();
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await initDB();
  console.log('API działa');
});
