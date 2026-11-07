const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dirData = path.resolve(__dirname, 'data');
if (!fs.existsSync(dirData)){
    fs.mkdirSync(dirData);
}

const dbFile = path.resolve(dirData, 'timepulse.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error al abrir la base de datos SQLite', err.message);
  } else {
    console.log('Conectado exitosamente a la base de datos SQLite en /data.');
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS talleres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    ubicacion TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS proyectos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    taller_id INTEGER,
    estado TEXT,
    FOREIGN KEY(taller_id) REFERENCES talleres(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    taller_id INTEGER,
    estado TEXT,
    FOREIGN KEY(taller_id) REFERENCES talleres(id)
  )`);

  // Tabla usuarios ampliada con relaciones completas
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    dni TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    rol TEXT,
    grupo TEXT,
    taller_id INTEGER,
    proyecto_id INTEGER,
    equipo_id INTEGER,
    FOREIGN KEY(taller_id) REFERENCES talleres(id),
    FOREIGN KEY(proyecto_id) REFERENCES proyectos(id),
    FOREIGN KEY(equipo_id) REFERENCES equipos(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS asistencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dni TEXT NOT NULL,
    tipo TEXT,
    hora TEXT,
    FOREIGN KEY(dni) REFERENCES usuarios(dni)
  )`);

  db.get("SELECT COUNT(*) as count FROM talleres", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO talleres (nombre, ubicacion) VALUES ('Mecánica Industrial', 'Pabellón A')`);
      db.run(`INSERT INTO talleres (nombre, ubicacion) VALUES ('Sistemas & Redes', 'Pabellón B')`);

      db.run(`INSERT INTO proyectos (titulo, taller_id, estado) VALUES ('Ensamblaje de Motor', 1, 'En Progreso')`);
      db.run(`INSERT INTO proyectos (titulo, taller_id, estado) VALUES ('Despliegue Red Local', 2, 'Completado')`);

      db.run(`INSERT INTO equipos (codigo, nombre, taller_id, estado) VALUES ('EQ-001', 'Osciloscopio', 2, 'Operativo')`);
      db.run(`INSERT INTO equipos (codigo, nombre, taller_id, estado) VALUES ('EQ-002', 'Torno CNC', 1, 'Operativo')`);

      db.run(`INSERT INTO usuarios (dni, nombre, rol, grupo, taller_id, proyecto_id, equipo_id) VALUES ('87654321', 'Maycol Lozano', 'Administrador', 'Grupo A', 2, 2, 1)`);
      db.run(`INSERT INTO usuarios (dni, nombre, rol, grupo, taller_id, proyecto_id, equipo_id) VALUES ('12345678', 'Carlos Pérez', 'Técnico', 'Grupo B', 1, 1, 2)`);
    }
  });
});

module.exports = db;