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
  res.send('PPS BACKEND VERSION 16');
});

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:AStechnik2012!@localhost:5432/postgres';

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

const upload = multer({ storage: multer.memoryStorage() });

// ===== NOWA PRÓBA =====
app.post('/new-test', upload.single('photo'), async (req, res) => {
  try {
    const {
      device_name,
      inspector_name,
      photo_taken_at,
      pressure_bar,
      min_45_minutes,
      medium
    } = req.body;

    if (!/^\d+(\.\d+)?$/.test(pressure_bar))
      return res.status(400).json({ error: 'Ciśnienie musi być liczbą' });

    if (!['OL','PO','WO','SP'].includes(medium))
      return res.status(400).json({ error: 'Nieprawidłowe medium' });

    if (!req.file)
      return res.status(400).json({ error: 'Brak zdjęcia' });

    // 🔥 blokada podwójnego zapisu
    const last = await pool.query(`
      SELECT test_datetime FROM tests
      ORDER BY id DESC LIMIT 1
    `);

    if (last.rows.length) {
      const diff = Date.now() - new Date(last.rows[0].test_datetime).getTime();
      if (diff < 5000) {
        return res.status(400).json({ error: 'Ta próba została już zapisana' });
      }
    }

    // 🔥 pobranie następnego numeru seryjnego
    const sn = await pool.query(`SELECT nextval('tests_serial_seq') as sn`);

    await pool.query(
      `INSERT INTO tests
      (serial_number, inspector_name, test_datetime, photo, pressure_bar, min_45_minutes, medium, device_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        sn.rows[0].sn,
        inspector_name,
        photo_taken_at,
        req.file.buffer,
        pressure_bar,
        min_45_minutes === 'true',
        medium,
        device_name
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
    SELECT id, device_name, serial_number,
           inspector_name, test_datetime,
           pressure_bar, min_45_minutes, medium
    FROM tests
    ORDER BY id DESC
  `);

  res.json(q.rows);
});

// ===== USUWANIE PRÓBY =====
app.delete('/test/:id', async (req, res) => {
  await pool.query(`DELETE FROM tests WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ===== ZDJĘCIE =====
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
    SELECT *
    FROM tests
    WHERE id=$1
  `, [req.params.id]);

  if (!q.rows.length) return res.status(404).send('Brak danych');

  const row = q.rows[0];

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  const bgPath = path.join(__dirname, 'assets', 'letterhead.png');
  if (fs.existsSync(bgPath)) {
    doc.image(bgPath, 0, 0, { width: 595 });
  }

  const fontRegular = path.join(__dirname, 'fonts', 'Exo2-Regular.ttf');
  const fontBold = path.join(__dirname, 'fonts', 'Exo2-Bold.ttf');

  if (fs.existsSync(fontRegular)) doc.registerFont('exo', fontRegular);
  if (fs.existsSync(fontBold)) doc.registerFont('exo-bold', fontBold);

  doc.font('exo-bold')
     .fontSize(20)
     .text('PROTOKÓŁ PRÓBY SZCZELNOŚCI', 50, 170);

  doc.font('exo')
     .fontSize(12)
     .text(`Nazwa chłodnicy: ${row.device_name}`, 50, 220)
     .text(`Numer seryjny: ${row.serial_number}`, 50, 240)
     .text(`Medium: ${row.medium}`, 50, 260)
     .text(`Osoba sprawdzająca: ${row.inspector_name}`, 50, 280)
     .text(`Data wykonania próby: ${new Date(row.test_datetime).toLocaleString('pl-PL')}`, 50, 300)
     .text(`Ciśnienie próby: ${row.pressure_bar} bar`, 50, 320)
     .text(`Czas próby min. 45 minut: ${row.min_45_minutes ? 'TAK' : 'NIE'}`, 50, 340);

  doc.image(row.photo, 50, 380, { fit: [500, 320] });

  doc.end();
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('API działa');
});
