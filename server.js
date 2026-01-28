const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/version', (req, res) => {
  res.send('PPS BACKEND VERSION 5');
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
  const q = await pool.query(`
    SELECT t.id, c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY t.id DESC
  `);

  res.json(q.rows);
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
    SELECT c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime, t.photo
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    WHERE t.id=$1
  `, [req.params.id]);

  if (!q.rows.length) return res.status(404).send('Brak danych');

  const row = q.rows[0];

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // ===== FONTY (POPRAWIONE ŚCIEŻKI) =====
  doc.registerFont(
    'exo',
    path.join(__dirname, 'fonts', 'Exo2-Regular.ttf')
  );
  doc.registerFont(
    'exo-bold',
    path.join(__dirname, 'fonts', 'Exo2-Bold.ttf')
  );

  // ===== LOGO (POPRAWIONA ŚCIEŻKA) =====
  doc.image(
    path.join(__dirname, 'assets', 'logo.png'),
    40,
    30,
    { width: 120 }
  );

  // ===== TYTUŁ =====
  doc.font('exo-bold')
     .fontSize(22)
     .text('PROTOKÓŁ PRÓBY SZCZELNOŚCI', 0, 50, { align: 'center' });

  doc.moveDown(3);

  // ===== DANE =====
  doc.font('exo')
     .fontSize(12)
     .text(`Nazwa chłodnicy: ${row.device_name}`)
     .text(`Numer seryjny: ${row.serial_number}`)
     .text(`Osoba sprawdzająca: ${row.inspector_name}`)
     .text(`Data wykonania próby: ${new Date(row.test_datetime).toLocaleString('pl-PL')}`);

  doc.moveDown(2);

  // ===== ZDJĘCIE =====
  if (row.photo) {
    doc.font('exo-bold').text('Zdjęcie z próby:');
    doc.moveDown();
    doc.image(row.photo, {
      fit: [450, 350],
      align: 'center',
    });
  }

  doc.end();
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`API działa na porcie ${PORT}`);
  await initDB();
});
