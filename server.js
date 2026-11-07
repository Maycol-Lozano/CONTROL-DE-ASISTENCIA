const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('./db');
const app = express();
const PORT = 4000;

const SECRET_KEY = 'tu_clave_secreta_super_segura_timepulse';

app.use(express.json());

const entidades = ['talleres', 'usuarios', 'proyectos', 'equipos', 'asistencias'];

// ==========================================
// API REST CRUD PARA LAS 5 TABLAS
// ==========================================
entidades.forEach(tabla => {
  app.get(`/api/${tabla}`, (req, res) => {
    db.all(`SELECT * FROM ${tabla}`, [], (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, data: rows });
    });
  });

  app.post(`/api/${tabla}`, async (req, res) => {
    const body = req.body;

    if (tabla === 'usuarios' && body.password) {
      try {
        const salt = await bcrypt.genSalt(10);
        body.password = await bcrypt.hash(body.password, salt);
      } catch (e) {
        console.error('Error al hashear password', e);
      }
    }

    const keys = Object.keys(body);
    const values = Object.values(body);
    if (keys.length === 0) return res.status(400).json({ success: false, mensaje: 'Sin datos' });

    const placeholders = keys.map(() => '?').join(',');
    const query = `INSERT INTO ${tabla} (${keys.join(',')}) VALUES (${placeholders})`;

    db.run(query, values, function(err) {
      if (err) return res.status(400).json({ success: false, error: err.message });
      res.json({ success: true, mensaje: 'Creado exitosamente', id: this.lastID, data: body });
    });
  });

  app.put(`/api/${tabla}/:id`, async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    if (tabla === 'usuarios' && body.password) {
      try {
        const salt = await bcrypt.genSalt(10);
        body.password = await bcrypt.hash(body.password, salt);
      } catch (e) {
        console.error('Error al hashear password', e);
      }
    }

    const entries = Object.entries(body);
    if (entries.length === 0) return res.status(400).json({ success: false, mensaje: 'Sin datos' });

    const setQuery = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = [...entries.map(([, val]) => val), id];
    const idField = tabla === 'usuarios' ? 'dni' : 'id';

    db.run(`UPDATE ${tabla} SET ${setQuery} WHERE ${idField} = ?`, values, function(err) {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (this.changes === 0) return res.status(404).json({ success: false, mensaje: 'No encontrado' });
      res.json({ success: true, mensaje: 'Actualizado correctamente' });
    });
  });

  app.delete(`/api/${tabla}/:id`, (req, res) => {
    const { id } = req.params;
    const idField = tabla === 'usuarios' ? 'dni' : 'id';

    db.run(`DELETE FROM ${tabla} WHERE ${idField} = ?`, [id], function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (this.changes === 0) return res.status(404).json({ success: false, mensaje: 'No encontrado' });
      res.json({ success: true, mensaje: 'Eliminado correctamente' });
    });
  });
});

// ==========================================
// ENDPOINT DE AUTENTICACIÓN (ADMIN)
// ==========================================
app.post('/api/login', (req, res) => {
  const { dni, password } = req.body;

  db.get(`SELECT * FROM usuarios WHERE dni = ?`, [dni], async (err, usuario) => {
    if (err || !usuario) {
      return res.status(401).json({ success: false, mensaje: 'DNI no encontrado' });
    }

    if (usuario.password) {
      const passwordValida = await bcrypt.compare(password, usuario.password);
      if (!passwordValida) {
        return res.status(401).json({ success: false, mensaje: 'Contraseña incorrecta' });
      }
    }

    const token = jwt.sign(
      { dni: usuario.dni, nombre: usuario.nombre, rol: usuario.rol }, 
      SECRET_KEY, 
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      mensaje: 'Autenticación exitosa',
      token,
      usuario: {
        dni: usuario.dni,
        nombre: usuario.nombre,
        rol: usuario.rol
      }
    });
  });
});

app.get('/api/buscar-usuario/:dni', (req, res) => {
  const { dni } = req.params;
  const query = `
    SELECT u.*, 
           t.nombre as taller_nombre, 
           p.titulo as proyecto_titulo, 
           e.nombre as equipo_nombre 
    FROM usuarios u
    LEFT JOIN talleres t ON u.taller_id = t.id
    LEFT JOIN proyectos p ON u.proyecto_id = p.id
    LEFT JOIN equipos e ON u.equipo_id = e.id
    WHERE u.dni = ?
  `;
  db.get(query, [dni], (err, usuario) => {
    if (err || !usuario) {
      return res.status(404).json({ success: false, mensaje: 'DNI no registrado en el sistema.' });
    }
    res.json({ success: true, usuario });
  });
});

app.post('/api/asistencia-dni', (req, res) => {
  const { dni, tipo } = req.body;
  const query = `
    SELECT u.*, 
           t.nombre as taller_nombre, 
           p.titulo as proyecto_titulo, 
           e.nombre as equipo_nombre 
    FROM usuarios u
    LEFT JOIN talleres t ON u.taller_id = t.id
    LEFT JOIN proyectos p ON u.proyecto_id = p.id
    LEFT JOIN equipos e ON u.equipo_id = e.id
    WHERE u.dni = ?
  `;
  db.get(query, [dni], (err, usuario) => {
    if (err || !usuario) {
      return res.status(404).json({ success: false, mensaje: 'DNI no registrado.' });
    }
    const horaActual = new Date().toLocaleTimeString();
    db.run(`INSERT INTO asistencias (dni, tipo, hora) VALUES (?, ?, ?)`, [dni, tipo || 'ENTRADA', horaActual], function(err2) {
      if (err2) return res.status(500).json({ success: false, error: err2.message });
      res.json({
        success: true,
        mensaje: 'ASISTENCIA EXITOSA',
        colaborador: usuario.nombre,
        rol: usuario.rol,
        grupo: usuario.grupo || 'N/A',
        taller: usuario.taller_nombre || 'Ninguno',
        proyecto: usuario.proyecto_titulo || 'Ninguno',
        equipo: usuario.equipo_nombre || 'Ninguno',
        hora: horaActual
      });
    });
  });
});

// ==========================================
// RUTA PRINCIPAL (/) - ESTACIÓN BIOMÉTRICA LIBRE
// ==========================================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TimePulse ID - Estación Biométrica</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-slate-900 text-slate-100 min-h-screen font-sans p-4 md:p-6 flex items-center justify-center">

        <div class="max-w-md w-full space-y-6">
            <header class="text-center space-y-2">
                <div class="bg-blue-600 w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg shadow-blue-600/40 text-2xl">
                    <i class="fa-solid fa-fingerprint"></i>
                </div>
                <h1 class="text-2xl font-bold text-white tracking-wide">TimePulse <span class="text-blue-500">ID</span></h1>
                <p class="text-xs text-slate-400">Estación de Control Biométrico de Asistencias</p>
            </header>

            <div class="bg-slate-800/50 border border-slate-700/60 rounded-3xl p-6 backdrop-blur shadow-xl space-y-5">
                <div>
                    <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1.5 text-center">Paso 1: Ingrese su DNI</label>
                    <input type="text" id="dniFichaje" placeholder="Ej: 87654321" maxlength="8" oninput="buscarUsuarioDni()"
                        class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3.5 text-white font-mono text-center tracking-widest text-xl focus:border-blue-500 focus:outline-none" />
                </div>

                <div id="panelRostroCamara" class="hidden space-y-4 border-t border-slate-700/60 pt-4">
                    <div class="bg-blue-950/40 border border-blue-500/30 p-3.5 rounded-xl space-y-1">
                        <p class="text-[10px] uppercase text-blue-400 font-bold">Colaborador Identificado</p>
                        <p id="lblNombreColaborador" class="font-bold text-white text-sm"></p>
                        <p id="lblRolColaborador" class="text-xs text-slate-300"></p>
                        <div class="text-[11px] text-slate-400 pt-1 border-t border-blue-500/20 space-y-0.5">
                            <p>📁 <strong>Taller:</strong> <span id="lblTaller"></span></p>
                            <p>🛠️ <strong>Proyecto:</strong> <span id="lblProyecto"></span></p>
                            <p>👥 <strong>Grupo:</strong> <span id="lblGrupo"></span></p>
                            <p>⚙️ <strong>Equipo:</strong> <span id="lblEquipo"></span></p>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1">Paso 2: Reconocimiento Facial</label>
                        <div class="relative overflow-hidden rounded-xl bg-black aspect-video border border-blue-500/40 flex items-center justify-center">
                            <video id="video" autoplay playsinline class="w-full h-full object-cover"></video>
                            <div class="absolute inset-0 border-2 border-dashed border-blue-400/60 rounded-xl m-3 pointer-events-none flex items-center justify-center">
                                <div class="w-24 h-32 border-2 border-emerald-400/80 rounded-full flex items-center justify-center relative animate-pulse">
                                    <span class="absolute -top-3 bg-blue-600 text-[8px] font-bold px-2 py-0.5 rounded text-white tracking-widest">ROSTRO</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] uppercase text-slate-400 mb-1">Tipo de Asistencia</label>
                        <select id="tipoAsistenciaSelect" class="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white">
                            <option value="ENTRADA">ENTRADA</option>
                            <option value="SALIDA">SALIDA</option>
                        </select>
                    </div>

                    <button onclick="verificarYMarcar()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30">
                        <i class="fa-solid fa-face-recognition"></i> Verificar Rostro y Registrar
                    </button>
                </div>

                <div id="resFichaje" class="hidden p-3.5 rounded-xl border text-xs text-center font-semibold"></div>
            </div>

            <div class="text-center">
                <a href="/admin" class="text-xs text-slate-500 hover:text-slate-300 transition">Acceso Administrador</a>
            </div>
        </div>

        <script>
            let cameraStream = null;

            async function buscarUsuarioDni() {
                const dni = document.getElementById('dniFichaje').value.trim();
                const panelRostro = document.getElementById('panelRostroCamara');
                const resDiv = document.getElementById('resFichaje');
                resDiv.classList.add('hidden');

                if (dni.length === 8) {
                    const res = await fetch('/api/buscar-usuario/' + dni);
                    const data = await res.json();

                    if (data.success) {
                        document.getElementById('lblNombreColaborador').innerText = data.usuario.nombre;
                        document.getElementById('lblRolColaborador').innerText = \`Rol: \${data.usuario.rol}\`;
                        document.getElementById('lblTaller').innerText = data.usuario.taller_nombre || 'Sin asignar';
                        document.getElementById('lblProyecto').innerText = data.usuario.proyecto_titulo || 'Sin asignar';
                        document.getElementById('lblGrupo').innerText = data.usuario.grupo || 'Sin asignar';
                        document.getElementById('lblEquipo').innerText = data.usuario.equipo_nombre || 'Sin asignar';
                        
                        panelRostro.classList.remove('hidden');

                        if (!cameraStream) {
                            navigator.mediaDevices.getUserMedia({ video: true })
                                .then(s => { cameraStream = s; document.getElementById('video').srcObject = s; })
                                .catch(e => console.warn("Cámara no disponible"));
                        }
                    } else {
                        panelRostro.classList.add('hidden');
                        resDiv.classList.remove('hidden');
                        resDiv.className = 'p-3.5 rounded-xl border text-xs text-center font-semibold bg-rose-500/20 border-rose-500/40 text-rose-300';
                        resDiv.innerHTML = data.mensaje;
                    }
                } else {
                    panelRostro.classList.add('hidden');
                }
            }

            async function verificarYMarcar() {
                const dni = document.getElementById('dniFichaje').value.trim();
                const tipo = document.getElementById('tipoAsistenciaSelect').value;
                const container = document.getElementById('resFichaje');
                const panelRostro = document.getElementById('panelRostroCamara');

                if (!cameraStream) {
                    container.classList.remove('hidden');
                    container.className = 'p-3.5 rounded-xl border text-xs text-center font-semibold bg-rose-500/20 border-rose-500/40 text-rose-300';
                    container.innerHTML = 'EL SISTEMA NO RECONOCE EL ROSTRO';
                    return;
                }

                const res = await fetch('/api/asistencia-dni', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dni, tipo })
                });
                const data = await res.json();

                container.classList.remove('hidden');
                if (data.success) {
                    container.className = 'p-3.5 rounded-xl border text-xs text-center font-semibold bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
                    container.innerHTML = \`
                        <div class="text-sm font-bold mb-1"><i class="fa-solid fa-circle-check"></i> ASISTENCIA EXITOSA</div>
                        <div class="text-[11px] space-y-0.5 text-left bg-black/20 p-2 rounded-lg">
                            <p><strong>Colaborador:</strong> \${data.colaborador}</p>
                            <p><strong>Rol:</strong> \${data.rol}</p>
                            <p><strong>Taller:</strong> \${data.taller}</p>
                            <p><strong>Proyecto:</strong> \${data.proyecto}</p>
                            <p><strong>Grupo:</strong> \${data.grupo}</p>
                            <p><strong>Equipo:</strong> \${data.equipo}</p>
                            <p><strong>Tipo/Hora:</strong> \${tipo} - \${data.hora}</p>
                        </div>
                    \`;
                    document.getElementById('dniFichaje').value = '';
                    panelRostro.classList.add('hidden');
                } else {
                    container.className = 'p-3.5 rounded-xl border text-xs text-center font-semibold bg-rose-500/20 border-rose-500/40 text-rose-300';
                    container.innerHTML = data.mensaje;
                }
            }
        </script>
    </body>
    </html>
  `);
});

// ==========================================
// RUTA ADMIN (/admin) - PANEL CRUD PROTEGIDO CON LOGIN
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TimePulse ID - Panel Administrador</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-slate-900 text-slate-100 min-h-screen font-sans p-4 md:p-6">

        <!-- PANTALLA DE LOGIN ADMIN -->
        <div id="loginModal" class="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4 backdrop-blur-md">
            <div class="bg-slate-900 border border-slate-700/80 rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
                <div class="text-center space-y-2">
                    <div class="bg-blue-600 w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg shadow-blue-600/40 text-2xl">
                        <i class="fa-solid fa-lock"></i>
                    </div>
                    <h2 class="text-2xl font-bold text-white tracking-wide">Acceso <span class="text-blue-500">Administrador</span></h2>
                    <p class="text-xs text-slate-400">Ingrese sus credenciales JWT</p>
                </div>

                <div class="space-y-4">
                    <div>
                        <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1">DNI del Administrador</label>
                        <input type="text" id="loginDni" placeholder="Ej: 87654321" maxlength="8"
                            class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono text-center tracking-widest text-lg focus:border-blue-500 focus:outline-none" />
                    </div>
                    <div>
                        <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-1">Contraseña</label>
                        <input type="password" id="loginPassword" placeholder="••••••••"
                            class="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white font-mono text-center tracking-widest text-lg focus:border-blue-500 focus:outline-none" />
                    </div>
                    <button onclick="realizarLogin()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl text-xs transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2">
                        <i class="fa-solid fa-right-to-bracket"></i> Entrar al Panel
                    </button>
                    <div id="loginError" class="hidden text-rose-400 text-xs text-center font-semibold bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl"></div>
                </div>
                <div class="text-center">
                    <a href="/" class="text-xs text-slate-500 hover:text-slate-300 transition">← Volver a la Estación Biométrica</a>
                </div>
            </div>
        </div>
        
        <!-- PANEL CRUD ADMIN -->
        <div id="appContainer" class="opacity-0 transition-opacity duration-500 max-w-7xl mx-auto">
            <header class="flex flex-col md:flex-row justify-between items-center pb-6 mb-6 border-b border-slate-800 gap-4">
                <div class="flex items-center space-x-3">
                    <div class="bg-blue-600 p-3 rounded-2xl text-white shadow-lg shadow-blue-600/30">
                        <i class="fa-solid fa-fingerprint text-2xl"></i>
                    </div>
                    <div>
                        <h1 class="font-bold text-2xl text-white tracking-wide">TimePulse <span class="text-blue-500">ID</span></h1>
                        <p class="text-xs text-slate-400">Panel de Administración General</p>
                    </div>
                </div>
                <div class="flex items-center space-x-3">
                    <div class="flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl text-xs text-slate-300">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span id="userInfoLabel">Admin Activo</span>
                    </div>
                    <button onclick="cerrarSesion()" class="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5">
                        <i class="fa-solid fa-right-from-bracket"></i> Cerrar Sesión
                    </button>
                </div>
            </header>

            <main class="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-5 backdrop-blur shadow-xl flex flex-col">
                <div class="flex flex-wrap gap-2 pb-4 mb-4 border-b border-slate-700/60">
                    <button onclick="cambiarTabla('talleres')" id="btn-talleres" class="tab-btn px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white transition"><i class="fa-solid fa-building mr-1"></i> Talleres</button>
                    <button onclick="cambiarTabla('usuarios')" id="btn-usuarios" class="tab-btn px-4 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-slate-300 hover:bg-slate-600 transition"><i class="fa-solid fa-users mr-1"></i> Usuarios</button>
                    <button onclick="cambiarTabla('proyectos')" id="btn-proyectos" class="tab-btn px-4 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-slate-300 hover:bg-slate-600 transition"><i class="fa-solid fa-diagram-project mr-1"></i> Proyectos</button>
                    <button onclick="cambiarTabla('equipos')" id="btn-equipos" class="tab-btn px-4 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-slate-300 hover:bg-slate-600 transition"><i class="fa-solid fa-toolbox mr-1"></i> Equipos</button>
                    <button onclick="cambiarTabla('asistencias')" id="btn-asistencias" class="tab-btn px-4 py-2 rounded-xl text-xs font-semibold bg-slate-700 text-slate-300 hover:bg-slate-600 transition"><i class="fa-solid fa-clock-rotate-left mr-1"></i> Asistencias</button>
                </div>

                <div class="bg-slate-900/60 p-4 rounded-xl border border-slate-700/50 mb-4">
                    <h3 id="formTitle" class="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3">Nuevo Registro</h3>
                    <div id="formFields" class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3"></div>
                    <div class="flex gap-2">
                        <button onclick="guardarRegistro()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-4 rounded-lg transition"><i class="fa-solid fa-save mr-1"></i> Guardar</button>
                        <button onclick="resetForm()" class="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs py-2 px-3 rounded-lg transition">Cancelar</button>
                    </div>
                </div>

                <div class="overflow-x-auto flex-1">
                    <table class="w-full text-left text-xs text-slate-300">
                        <thead id="tableHead" class="bg-slate-900 uppercase text-slate-400 border-b border-slate-700"></thead>
                        <tbody id="tableBody" class="divide-y divide-slate-800"></tbody>
                    </table>
                </div>
            </main>
        </div>

        <script>
            window.addEventListener('DOMContentLoaded', () => {
                const auth = localStorage.getItem('auth');
                const userObj = localStorage.getItem('usuario');
                if (auth) {
                    document.getElementById('loginModal').classList.add('hidden');
                    document.getElementById('appContainer').classList.remove('opacity-0');
                    if(userObj) {
                        const u = JSON.parse(userObj);
                        document.getElementById('userInfoLabel').innerText = \`Admin: \${u.nombre}\`;
                    }
                    cargarDatos();
                } else {
                    document.getElementById('loginModal').classList.remove('hidden');
                }
            });

            async function realizarLogin() {
                const dni = document.getElementById('loginDni').value.trim();
                const password = document.getElementById('loginPassword').value;
                const errDiv = document.getElementById('loginError');
                errDiv.classList.add('hidden');

                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dni, password })
                });
                const data = await res.json();

                if (data.success) {
                    localStorage.setItem('auth', data.token);
                    localStorage.setItem('usuario', JSON.stringify(data.usuario));
                    document.getElementById('loginModal').classList.add('hidden');
                    document.getElementById('appContainer').classList.remove('opacity-0');
                    document.getElementById('userInfoLabel').innerText = \`Admin: \${data.usuario.nombre}\`;
                    cargarDatos();
                } else {
                    errDiv.classList.remove('hidden');
                    errDiv.innerText = data.mensaje || 'Error al autenticar';
                }
            }

            function cerrarSesion() {
                localStorage.removeItem('auth');
                localStorage.removeItem('usuario');
                location.reload();
            }

            let tablaActual = 'talleres';
            let editandoId = null;
            let cacheRelaciones = { talleres: [], proyectos: [], equipos: [] };

            async function cargarListasRelacionales() {
                const [tRes, pRes, eRes] = await Promise.all([
                    fetch('/api/talleres').then(r => r.json()),
                    fetch('/api/proyectos').then(r => r.json()),
                    fetch('/api/equipos').then(r => r.json())
                ]);
                cacheRelaciones.talleres = tRes.data || [];
                cacheRelaciones.proyectos = pRes.data || [];
                cacheRelaciones.equipos = eRes.data || [];
            }

            function cambiarTabla(nombre) {
                tablaActual = nombre;
                editandoId = null;
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.remove('bg-blue-600', 'text-white');
                    b.classList.add('bg-slate-700', 'text-slate-300');
                });
                document.getElementById('btn-' + nombre).classList.remove('bg-slate-700', 'text-slate-300');
                document.getElementById('btn-' + nombre).classList.add('bg-blue-600', 'text-white');
                cargarDatos();
            }

            async function cargarDatos() {
                await cargarListasRelacionales();
                const res = await fetch('/api/' + tablaActual);
                const json = await res.json();
                const items = json.data || [];
                renderForm(items[0] || getPlantillaVacia(tablaActual));
                renderTable(items);
            }

            function getPlantillaVacia(tabla) {
                if (tabla === 'talleres') return { nombre: '', ubicacion: '' };
                if (tabla === 'usuarios') return { dni: '', nombre: '', password: '', rol: '', grupo: '', taller_id: 1, proyecto_id: 1, equipo_id: 1 };
                if (tabla === 'proyectos') return { titulo: '', taller_id: 1, estado: 'En Progreso' };
                if (tabla === 'equipos') return { codigo: '', nombre: '', taller_id: 1, estado: 'Operativo' };
                if (tabla === 'asistencias') return { dni: '', tipo: 'ENTRADA', hora: '12:00:00 PM' };
            }

            function renderForm(sampleObj) {
                const container = document.getElementById('formFields');
                if(!container) return;
                container.innerHTML = '';
                document.getElementById('formTitle').innerText = editandoId ? \`Editar Registro en \${tablaActual}\` : \`Nuevo Registro en \${tablaActual}\`;

                Object.keys(sampleObj).forEach(key => {
                    if (key === 'id' && !editandoId) return;
                    const isIdField = key === 'id' || (tablaActual === 'usuarios' && key === 'dni');
                    
                    if (tablaActual === 'usuarios' && key === 'taller_id') {
                        let opts = cacheRelaciones.talleres.map(t => \`<option value="\${t.id}">\${t.nombre}</option>\`).join('');
                        container.innerHTML += \`<div><label class="block text-[10px] uppercase text-slate-400 mb-1">Taller</label><select id="field_\${key}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white">\${opts}</select></div>\`;
                    } else if (tablaActual === 'usuarios' && key === 'proyecto_id') {
                        let opts = cacheRelaciones.proyectos.map(p => \`<option value="\${p.id}">\${p.titulo}</option>\`).join('');
                        container.innerHTML += \`<div><label class="block text-[10px] uppercase text-slate-400 mb-1">Proyecto</label><select id="field_\${key}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white">\${opts}</select></div>\`;
                    } else if (tablaActual === 'usuarios' && key === 'equipo_id') {
                        let opts = cacheRelaciones.equipos.map(e => \`<option value="\${e.id}">\${e.nombre} (\${e.codigo})</option>\`).join('');
                        container.innerHTML += \`<div><label class="block text-[10px] uppercase text-slate-400 mb-1">Equipo</label><select id="field_\${key}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white">\${opts}</select></div>\`;
                    } else if (tablaActual === 'asistencias' && key === 'tipo') {
                        container.innerHTML += \`<div><label class="block text-[10px] uppercase text-slate-400 mb-1">Tipo</label><select id="field_\${key}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"><option value="ENTRADA">ENTRADA</option><option value="SALIDA">SALIDA</option></select></div>\`;
                    } else {
                        const inputType = key === 'password' ? 'password' : 'text';
                        const placeholderText = key === 'password' ? 'Dejar en blanco para no cambiar' : key;
                        container.innerHTML += \`<div><label class="block text-[10px] uppercase text-slate-400 mb-1">\{$key}\</label><input type="\${inputType}" id="field_\${key}" value="" \${isIdField && editandoId ? 'disabled' : ''} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono" placeholder="\${placeholderText}"></div>\`;
                    }
                });
            }

            function renderTable(items) {
                const thead = document.getElementById('tableHead');
                const tbody = document.getElementById('tableBody');
                if(!thead || !tbody) return;
                thead.innerHTML = '';
                tbody.innerHTML = '';

                if (items.length === 0) {
                    tbody.innerHTML = \`<tr><td colspan="10" class="p-4 text-center text-slate-500">No hay registros.</td></tr>\`;
                    return;
                }

                const keys = Object.keys(items[0]);
                let headHtml = '<tr>';
                keys.forEach(k => headHtml += \`<th class="p-3">\${k}</th>\`);
                headHtml += '<th class="p-3 text-right">Acciones</th></tr>';
                thead.innerHTML = headHtml;

                items.forEach(item => {
                    let rowHtml = '<tr class="hover:bg-slate-800/40 transition">';
                    keys.forEach(k => {
                        let val = item[k];
                        if (k === 'password' && val) val = '••••••••';
                        rowHtml += \`<td class="p-3 font-mono text-slate-300">\${val !== null ? val : ''}</td>\`;
                    });
                    const primaryKey = tablaActual === 'usuarios' ? item.dni : item.id;
                    rowHtml += \`<td class="p-3 text-right space-x-2"><button onclick='prepararEditar(\${JSON.stringify(item)})' class="text-amber-400 hover:text-amber-300 p-1"><i class="fa-solid fa-pen"></i></button><button onclick="eliminar('\${primaryKey}')" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash"></i></button></td></tr>\`;
                    tbody.innerHTML += rowHtml;
                });
            }

            function prepararEditar(item) {
                editandoId = tablaActual === 'usuarios' ? item.dni : item.id;
                document.getElementById('formTitle').innerText = \`Editar en \${tablaActual}\`;
                Object.keys(item).forEach(key => {
                    const el = document.getElementById('field_' + key);
                    if (el) {
                        if (key === 'password') el.value = '';
                        else el.value = item[key];
                        if (key === 'id' || (tablaActual === 'usuarios' && key === 'dni')) el.disabled = true;
                    }
                });
            }

            async function guardarRegistro() {
                const sample = getPlantillaVacia(tablaActual);
                const data = {};
                Object.keys(sample).forEach(key => {
                    const el = document.getElementById('field_' + key);
                    if (el) {
                        if (editandoId && tablaActual === 'usuarios' && key === 'password' && !el.value) return;
                        data[key] = el.value;
                    }
                });

                const url = editandoId ? \`/api/\${tablaActual}/\${editandoId}\` : \`/api/\${tablaActual}\`;
                const method = editandoId ? 'PUT' : 'POST';

                const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                const json = await res.json();
                alert(json.mensaje || 'Operación exitosa');
                resetForm();
                cargarDatos();
            }

            async function eliminar(id) {
                if (!confirm('¿Desea eliminar este registro?')) return;
                const res = await fetch(\`/api/\${tablaActual}/\${id}\`, { method: 'DELETE' });
                const json = await res.json();
                alert(json.mensaje || 'Eliminado');
                cargarDatos();
            }

            function resetForm() {
                editandoId = null;
                cargarDatos();
            }
        </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor de TimePulse ID corriendo en http://localhost:${PORT}`);
});