const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'pps',
  password: 'AStechnik2012!',
  port: 5432,
});

const upload = multer({ dest: 'uploads/' });

app.post('/new-test', upload.single('photo'), async (req, res) => {
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
      req.file.path,
    ]
  );

  res.json({ ok: true });
});

app.get('/tests', async (req, res) => {
  const q = await pool.query(`
    SELECT t.id, c.device_name, c.serial_number,
           t.inspector_name, t.test_datetime, t.photo_url
    FROM tests t
    JOIN coolers c ON t.cooler_id=c.id
    ORDER BY t.id DESC
  `);
  res.json(q.rows);
});

app.get('/report/:id', async (req, res) => {
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
  doc.image(row.photo_url, { width: 300 });

  doc.end();
});

app.listen(3000, () => console.log('API działa na 3000'));
