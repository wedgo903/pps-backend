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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const upload = multer({ storage: multer.memoryStorage() });

let saveLock = false;

/* ===== NOWA PRÓBA ===== */
app.post('/new-test', upload.single('photo'), async (req, res) => {
  try {
    if (saveLock)
      return res.status(400).json({ error: 'Trwa zapisywanie próby' });

    saveLock = true;

    const {
      device_name,
      inspector_name,
      photo_taken_at,
      pressure_bar,
      min_45_minutes,
      medium
    } = req.body;

    // blokada duplikatu 10s
    const last = await pool.query(`
      SELECT test_datetime FROM tests
      ORDER BY id DESC LIMIT 1
    `);

    if (last.rows.length) {
      const diff = Date.now() - new Date(last.rows[0].test_datetime).getTime();
      if (diff < 10000) {
        saveLock = false;
        return res.status(400).json({ error: 'Ta próba została już zapisana' });
      }
    }

    // numer seryjny bierze się WYŁĄCZNIE z coolers
    const cooler = await pool.query(
      `INSERT INTO coolers(device_name)
       VALUES($1)
       RETURNING id, serial_number`,
      [device_name]
    );

    await pool.query(
      `INSERT INTO tests
      (cooler_id, inspector_name, test_datetime, photo, pressure_bar, min_45_minutes, medium)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        cooler.rows[0].id,
        inspector_name,
        photo_taken_at,
        req.file.buffer,
        pressure_bar,
        min_45_minutes === 'true',
        medium
      ]
    );

    saveLock = false;
    res.json({ ok: true, serial_number: cooler.rows[0].serial_number });

  } catch (e) {
    saveLock = false;
    res.status(500).json({ error: e.message });
  }
});

/* ===== LISTA ===== */
app.get('/tests', async (req, res) => {
  const q = await pool.query(`
    SELECT
      t.id,
      c.device_name,
      c.serial_number,
      t.inspector_name,
      t.test_datetime,
      t.pressure_bar,
      t.min_45_minutes,
      t.medium
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY c.serial_number DESC
  `);

  res.json(q.rows);
});

/* ===== USUWANIE (usuwa też numer seryjny!) ===== */
app.delete('/test/:id', async (req, res) => {
  const q = await pool.query(
    `SELECT cooler_id FROM tests WHERE id=$1`,
    [req.params.id]
  );

  await pool.query(`DELETE FROM tests WHERE id=$1`, [req.params.id]);
  await pool.query(`DELETE FROM coolers WHERE id=$1`, [q.rows[0].cooler_id]);

  res.json({ ok: true });
});

/* ===== ZDJĘCIE ===== */
app.get('/photo/:id', async (req, res) => {
  const q = await pool.query(
    'SELECT photo FROM tests WHERE id=$1',
    [req.params.id]
  );
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(q.rows[0].photo);
});

/* ===== PDF ===== */
app.get('/report/:id', async (req, res) => {
  const q = await pool.query(`
    SELECT c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime,
           t.photo, t.pressure_bar,
           t.min_45_minutes, t.medium
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    WHERE t.id=$1
  `, [req.params.id]);

  const row = q.rows[0];
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const bgPath = path.join(__dirname, 'assets', 'letterhead.png');
  if (fs.existsSync(bgPath))
    doc.image(bgPath, 0, 0, { width: 595 });

  doc.fontSize(12)
     .text(`Nazwa chłodnicy: ${row.device_name}`, 50, 200)
     .text(`Numer seryjny: ${row.serial_number}`)
     .text(`Medium: ${row.medium}`)
     .text(`Inspektor: ${row.inspector_name}`)
     .text(`Ciśnienie: ${row.pressure_bar} bar`)
     .text(`45 min: ${row.min_45_minutes ? 'TAK' : 'NIE'}`);

  doc.end();
});

app.listen(process.env.PORT || 3000);
