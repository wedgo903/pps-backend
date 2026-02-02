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

/* ===== FUNKCJA NUMERU SERYJNEGO ===== */
async function getNextSerialNumber() {
  const q = await pool.query(`
    SELECT COALESCE(
      MIN(t1.serial_number + 1),
      1
    ) AS next
    FROM tests t1
    LEFT JOIN tests t2
      ON t2.serial_number = t1.serial_number + 1
    WHERE t2.serial_number IS NULL
  `);
  return q.rows[0].next;
}

/* ===== BLOKADA PODWÓJNEGO KLIKNIĘCIA ===== */
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

    if (!req.file)
      return res.status(400).json({ error: 'Brak zdjęcia' });

    // 🔒 Blokada duplikatu (ta sama próba w 10s)
    const last = await pool.query(`
      SELECT * FROM tests
      ORDER BY id DESC LIMIT 1
    `);

    if (last.rows.length) {
      const diff = Date.now() - new Date(last.rows[0].test_datetime).getTime();
      if (diff < 10000 && last.rows[0].device_name === device_name) {
        saveLock = false;
        return res.status(400).json({ error: 'Ta próba została już zapisana' });
      }
    }

    const serial = await getNextSerialNumber();

    const cooler = await pool.query(
      `INSERT INTO coolers(device_name)
       VALUES($1)
       RETURNING id`,
      [device_name]
    );

    await pool.query(
      `INSERT INTO tests
      (cooler_id, serial_number, inspector_name, test_datetime, photo, pressure_bar, min_45_minutes, medium)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        cooler.rows[0].id,
        serial,
        inspector_name,
        photo_taken_at,
        req.file.buffer,
        pressure_bar,
        min_45_minutes === 'true',
        medium
      ]
    );

    saveLock = false;
    res.json({ ok: true });

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
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY t.serial_number DESC
  `);

  res.json(q.rows);
});

/* ===== USUWANIE ===== */
app.delete('/test/:id', async (req, res) => {
  await pool.query(`DELETE FROM tests WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

/* ===== START ===== */
app.listen(process.env.PORT || 3000);
