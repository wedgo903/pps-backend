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

/* ===== WYLICZANIE NAJBLIŻSZEGO WOLNEGO NUMERU ===== */
async function getNextSerial() {
  const q = await pool.query(`
    SELECT COALESCE(MIN(t1.serial_number + 1), 1) AS next
    FROM tests t1
    LEFT JOIN tests t2
      ON t2.serial_number = t1.serial_number + 1
    WHERE t2.serial_number IS NULL
  `);
  return q.rows[0].next;
}

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

    if (!req.file)
      throw new Error('Brak zdjęcia');

    const serial = await getNextSerial();

    const cooler = await pool.query(
      `INSERT INTO coolers(device_name)
       VALUES($1)
       RETURNING id`,
      [device_name]
    );

    await pool.query(`
      INSERT INTO tests
      (cooler_id, serial_number, inspector_name, test_datetime, photo, pressure_bar, min_45_minutes, medium)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [
      cooler.rows[0].id,
      serial,
      inspector_name,
      photo_taken_at,
      req.file.buffer,
      pressure_bar,
      min_45_minutes === 'true',
      medium
    ]);

    saveLock = false;
    res.json({ ok: true, serial_number: serial });

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
      t.serial_number,
      t.inspector_name,
      t.test_datetime,
      t.pressure_bar,
      t.min_45_minutes,
      t.medium
    FROM tests t
    JOIN coolers c ON t.cooler_id = c.id
    ORDER BY t.serial_number DESC
  `);
  res.json(q.rows);
});

/* ===== USUWANIE ===== */
app.delete('/test/:id', async (req, res) => {
  await pool.query(`DELETE FROM tests WHERE id=$1`, [req.params.id]);
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
    SELECT
      c.device_name,
      t.serial_number,
      t.inspector_name,
      t.test_datetime,
      t.photo,
      t.pressure_bar,
      t.min_45_minutes,
      t.medium
    FROM tests t
    JOIN coolers c ON t.cooler_id = c.id
    WHERE t.id = $1
  `, [req.params.id]);

  if (!q.rows.length) return res.status(404).send('Brak danych');

  const row = q.rows[0];

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  doc.image(path.join(__dirname, 'assets', 'letterhead.png'), 0, 0, { width: 595 });

  doc.registerFont('exo', path.join(__dirname, 'fonts', 'Exo2-Regular.ttf'));
  doc.registerFont('exo-bold', path.join(__dirname, 'fonts', 'Exo2-Bold.ttf'));

  doc.fillColor('black');

  doc.font('exo-bold')
     .fontSize(20)
     .text('PROTOKÓŁ PRÓBY SZCZELNOŚCI', 50, 160);

  doc.font('exo')
     .fontSize(12)
     .text(`Nazwa chłodnicy: ${row.device_name}`, 50, 210)
     .text(`Numer seryjny: ${row.serial_number}`)
     .text(`Medium: ${row.medium}`)
     .text(`Inspektor: ${row.inspector_name}`)
     .text(`Data: ${new Date(row.test_datetime).toLocaleString('pl-PL')}`)
     .text(`Ciśnienie próby: ${row.pressure_bar} bar`)
     .text(`Czas próby min. 45 min: ${row.min_45_minutes ? 'TAK' : 'NIE'}`);

  doc.font('exo-bold')
     .text('Zdjęcie z próby:', 50, 320);

  doc.image(row.photo, 50, 350, { fit: [500, 300] });

  doc.end();
});

app.listen(process.env.PORT || 3000);
