/* =========================================================
   BurgerTIC - Front-end
   Se sirve desde el mismo Express que la API, por eso las
   requests van a rutas relativas (/platos, /auth, /pedidos).
   ========================================================= */

const TIPOS = ["principal", "combo", "postre"];
const ESTADOS = ["pendiente", "aceptado", "en camino", "entregado"];
const EMOJI_TIPO = { principal: "🍔", combo: "🍟", postre: "🍦" };
const BEBIDAS_COMBO = ["Agua", "Pepsi", "Mirinda", "Seven Up"]; // mismas que en el back (db.js)

// Acción de admin disponible según el estado actual del pedido
const SIGUIENTE_ACCION = {
    pendiente: { ruta: "aceptar", texto: "Aceptar" },
    aceptado: { ruta: "comenzar", texto: "Enviar (en camino)" },
    "en camino": { ruta: "entregar", texto: "Marcar entregado" },
};

/* ---------------- Utilidades ---------------- */

const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");

// Escapa texto que viene de la base antes de meterlo en el HTML
const esc = (valor) =>
    String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const precio = (n) => "$" + Number(n || 0).toLocaleString("es-AR");

const fecha = (iso) => {
    if (!iso) return "";
    const [a, m, d] = String(iso).split("-");
    return `${d}/${m}/${a}`;
};

const claseEstado = (estado) => "estado estado--" + String(estado).replace(/\s+/g, "-");

const storage = {
    get(clave, def = null) {
        try {
            const v = localStorage.getItem(clave);
            return v === null ? def : JSON.parse(v);
        } catch {
            return def;
        }
    },
    set(clave, valor) {
        try {
            localStorage.setItem(clave, JSON.stringify(valor));
        } catch { /* sin storage: la app sigue funcionando en memoria */ }
    },
    remove(clave) {
        try {
            localStorage.removeItem(clave);
        } catch { /* nada */ }
    },
};

function toast(mensaje, tipo = "info") {
    const el = document.createElement("div");
    el.className = `toast toast--${tipo}`;
    el.textContent = mensaje;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/* ---------------- Sesión ---------------- */

const sesion = {
    token: storage.get("burgertic_token"),
    usuario: storage.get("burgertic_usuario"),
    timer: null,
};

const estaLogueado = () => Boolean(sesion.token && sesion.usuario);
const esAdmin = () => estaLogueado() && sesion.usuario.admin === true;

// Lee la fecha de expiración del JWT (sin verificarlo, eso lo hace el back)
function expiracionToken(token) {
    try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return payload.exp ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

function programarExpiracion() {
    clearTimeout(sesion.timer);
    if (!sesion.token) return;
    const exp = expiracionToken(sesion.token);
    if (!exp) return;
    const restante = exp - Date.now();
    if (restante <= 0) {
        cerrarSesion();
        return;
    }
    sesion.timer = setTimeout(() => {
        cerrarSesion();
        toast("Tu sesión expiró (30 minutos). Volvé a iniciar sesión.", "error");
        location.hash = "#/login";
    }, restante);
}

function iniciarSesion(token, usuario) {
    sesion.token = token;
    sesion.usuario = usuario;
    storage.set("burgertic_token", token);
    storage.set("burgertic_usuario", usuario);
    programarExpiracion();
}

function cerrarSesion() {
    sesion.token = null;
    sesion.usuario = null;
    clearTimeout(sesion.timer);
    storage.remove("burgertic_token");
    storage.remove("burgertic_usuario");
    renderNav();
}

/* ---------------- Cliente de la API ---------------- */

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function api(ruta, { method = "GET", body } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (sesion.token) headers.Authorization = `Bearer ${sesion.token}`;

    let res;
    try {
        res = await fetch(ruta, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError(0, "No se pudo conectar con el servidor. ¿Está corriendo la API?");
    }

    let data = null;
    try {
        data = await res.json();
    } catch { /* respuesta sin JSON */ }

    if (!res.ok) {
        const mensaje = data?.message || `Error ${res.status}`;
        // Token vencido o inválido en una ruta protegida: cerramos sesión
        if (res.status === 401 && sesion.token) {
            cerrarSesion();
            toast(mensaje, "error");
            location.hash = "#/login";
        }
        throw new ApiError(res.status, mensaje);
    }
    return data;
}

/* ---------------- Carrito ---------------- */
// [{ key, id, nombre, precio, cantidad, bebida }]
// Un mismo combo con distinta bebida ocupa renglones distintos, por eso cada renglón
// se identifica por key = "id|bebida" y no solo por el id del plato.
const claveItem = (id, bebida) => `${id}|${bebida ?? ""}`;

let carrito = storage.get("burgertic_carrito", []);
if (!Array.isArray(carrito)) carrito = [];
carrito.forEach((i) => (i.key = claveItem(i.id, i.bebida)));

const guardarCarrito = () => {
    storage.set("burgertic_carrito", carrito);
    renderCarrito();
};

// Total de unidades de un plato en el carrito (sumando todas sus bebidas)
const cantidadEnCarrito = (id) => carrito.filter((i) => i.id === id).reduce((a, i) => a + i.cantidad, 0);

function cambiarCantidad(plato, delta, bebida = null) {
    const key = claveItem(plato.id, bebida);
    const item = carrito.find((i) => i.key === key);
    if (item) {
        item.cantidad += delta;
        if (item.cantidad <= 0) carrito = carrito.filter((i) => i.key !== key);
    } else if (delta > 0) {
        carrito.push({ key, id: plato.id, nombre: plato.nombre, precio: plato.precio, cantidad: delta, bebida });
    }
    guardarCarrito();
}

function renderCarrito() {
    const totalItems = carrito.reduce((a, i) => a + i.cantidad, 0);
    const total = carrito.reduce((a, i) => a + i.precio * i.cantidad, 0);
    $("#carrito-count").textContent = totalItems;
    $("#carrito-total").textContent = precio(total);
    $("#btn-confirmar").disabled = carrito.length === 0;

    const cont = $("#carrito-items");
    if (carrito.length === 0) {
        cont.innerHTML = `<div class="vacio"><span class="emoji">🛒</span>Todavía no agregaste platos</div>`;
        return;
    }
    cont.innerHTML = carrito
        .map(
            (i) => `
        <div class="carrito__item">
            <div>
                <strong>${esc(i.nombre)}</strong>
                ${i.bebida ? `<small>🥤 Bebida: ${esc(i.bebida)}</small>` : ""}
                <small>${precio(i.precio)} c/u · ${precio(i.precio * i.cantidad)}</small>
            </div>
            <div class="stepper">
                <button type="button" data-carrito="-1" data-key="${esc(i.key)}" aria-label="Quitar uno">−</button>
                <span>${i.cantidad}</span>
                <button type="button" data-carrito="1" data-key="${esc(i.key)}" aria-label="Agregar uno">+</button>
            </div>
        </div>`
        )
        .join("");
}

function abrirCarrito() {
    $("#carrito").classList.add("abierto");
    $("#carrito").setAttribute("aria-hidden", "false");
    $("#overlay").hidden = false;
}
function cerrarCarrito() {
    $("#carrito").classList.remove("abierto");
    $("#carrito").setAttribute("aria-hidden", "true");
    $("#overlay").hidden = true;
}

$("#btn-carrito").addEventListener("click", abrirCarrito);
$("#cerrar-carrito").addEventListener("click", cerrarCarrito);
$("#overlay").addEventListener("click", cerrarCarrito);
$("#carrito-items").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-carrito]");
    if (!btn) return;
    const item = carrito.find((i) => i.key === btn.dataset.key);
    if (item) {
        cambiarCantidad(item, Number(btn.dataset.carrito), item.bebida);
        refrescarSteppersMenu();
    }
});

$("#btn-confirmar").addEventListener("click", async () => {
    if (carrito.length === 0) return;
    if (!estaLogueado()) {
        cerrarCarrito();
        toast("Iniciá sesión para confirmar tu pedido", "info");
        location.hash = "#/login";
        return;
    }
    const btn = $("#btn-confirmar");
    btn.disabled = true;
    btn.textContent = "Enviando...";
    try {
        // El body es { platos: [{ id, cantidad, bebida? }] }. Fecha, estado y usuario los pone el back.
        const pedido = await api("/pedidos", {
            method: "POST",
            body: {
                platos: carrito.map(({ id, cantidad, bebida }) => (bebida ? { id, cantidad, bebida } : { id, cantidad })),
            },
        });
        carrito = [];
        guardarCarrito();
        cerrarCarrito();
        toast(`¡Pedido #${pedido.id} realizado! Total ${precio(pedido.total)}`, "success");
        location.hash = "#/mis-pedidos";
    } catch (err) {
        toast(err.message, "error");
    } finally {
        btn.textContent = "Confirmar pedido";
        btn.disabled = carrito.length === 0;
    }
});

/* ---------------- Navegación ---------------- */

function renderNav() {
    const ruta = location.hash.slice(1) || "/menu";
    const link = (href, texto) => `<a href="#${href}" class="${ruta === href ? "activo" : ""}">${texto}</a>`;

    let html = link("/menu", "Menú");
    if (estaLogueado()) html += link("/mis-pedidos", "Mis pedidos");
    if (esAdmin()) {
        html += link("/admin/pedidos", "Gestionar pedidos");
        html += link("/admin/platos", "Gestionar platos");
    }

    if (estaLogueado()) {
        html += `<div class="nav__usuario">
            ${esAdmin() ? '<span class="tag-admin">Admin</span>' : ""}
            <span>Hola, ${esc(sesion.usuario.nombre)}</span>
            <button class="btn btn--sm" id="btn-salir" type="button">Salir</button>
        </div>`;
    } else {
        html += `<div class="nav__usuario">
            ${link("/login", "Ingresar")}
            <a href="#/registro" class="btn btn--primary btn--sm">Registrarme</a>
        </div>`;
    }
    $("#nav").innerHTML = html;

    $("#btn-salir")?.addEventListener("click", () => {
        cerrarSesion();
        toast("Cerraste sesión", "info");
        location.hash = "#/menu";
    });
}

const rutas = {
    "/menu": { vista: vistaMenu },
    "/login": { vista: vistaLogin },
    "/registro": { vista: vistaRegistro },
    "/mis-pedidos": { vista: vistaMisPedidos, requiereLogin: true },
    "/admin/pedidos": { vista: vistaAdminPedidos, requiereAdmin: true },
    "/admin/platos": { vista: vistaAdminPlatos, requiereAdmin: true },
};

function router() {
    const ruta = location.hash.slice(1) || "/menu";
    const def = rutas[ruta];

    if (!def) {
        location.hash = "#/menu";
        return;
    }
    if ((def.requiereLogin || def.requiereAdmin) && !estaLogueado()) {
        toast("Tenés que iniciar sesión para ver esa sección", "info");
        location.hash = "#/login";
        return;
    }
    if (def.requiereAdmin && !esAdmin()) {
        toast("No tenés permisos de administrador", "error");
        location.hash = "#/menu";
        return;
    }

    renderNav();
    window.scrollTo(0, 0);
    def.vista();
}

window.addEventListener("hashchange", router);

/* =========================================================
   VISTAS
   ========================================================= */

/* ---------------- Menú ---------------- */

let platosMenu = [];
let filtroMenu = "todos";

async function vistaMenu() {
    app.innerHTML = `
        <section class="hero">
            <h1>Las mejores burgers, a un click 🍔</h1>
            <p>Elegí tus platos, armá tu pedido y seguilo en tiempo real.</p>
        </section>
        <div class="chips" id="filtros">
            ${["todos", ...TIPOS]
                .map((t) => `<button type="button" class="chip ${t === filtroMenu ? "activo" : ""}" data-tipo="${t}">
                    ${t === "todos" ? "Todos" : `${EMOJI_TIPO[t]} ${t[0].toUpperCase() + t.slice(1)}s`}
                </button>`)
                .join("")}
        </div>
        <div id="lista-platos"><div class="cargando">Cargando menú...</div></div>`;

    $("#filtros").addEventListener("click", (e) => {
        const chip = e.target.closest("[data-tipo]");
        if (!chip) return;
        filtroMenu = chip.dataset.tipo;
        document.querySelectorAll("#filtros .chip").forEach((c) => c.classList.toggle("activo", c === chip));
        cargarPlatosMenu();
    });

    $("#lista-platos").addEventListener("click", (e) => {
        // Combo: se agrega con la bebida elegida en el select de la tarjeta
        const btnCombo = e.target.closest("[data-agregar-combo]");
        if (btnCombo) {
            const plato = platosMenu.find((p) => p.id === Number(btnCombo.dataset.agregarCombo));
            const select = $(`[data-bebida="${btnCombo.dataset.agregarCombo}"]`);
            if (!plato || !select) return;
            if (!select.value) {
                toast("Elegí una bebida para el combo", "info");
                select.focus();
                return;
            }
            cambiarCantidad(plato, 1, select.value);
            refrescarSteppersMenu();
            toast(`${plato.nombre} con ${select.value} agregado al pedido`, "success");
            return;
        }

        const btn = e.target.closest("[data-delta]");
        if (!btn) return;
        const plato = platosMenu.find((p) => p.id === Number(btn.dataset.id));
        if (!plato) return;
        cambiarCantidad(plato, Number(btn.dataset.delta));
        refrescarSteppersMenu();
        if (Number(btn.dataset.delta) > 0) toast(`${plato.nombre} agregado al pedido`, "success");
    });

    await cargarPlatosMenu();
}

async function cargarPlatosMenu() {
    const cont = $("#lista-platos");
    if (!cont) return;
    cont.innerHTML = `<div class="cargando">Cargando menú...</div>`;
    try {
        // GET /platos o GET /platos/tipo/:tipo
        platosMenu = await api(filtroMenu === "todos" ? "/platos" : `/platos/tipo/${filtroMenu}`);
        if (!$("#lista-platos")) return; // el usuario cambió de vista
        if (platosMenu.length === 0) {
            cont.innerHTML = `<div class="vacio"><span class="emoji">🍽️</span>No hay platos en esta categoría todavía</div>`;
            return;
        }
        cont.innerHTML = `<div class="grid">${platosMenu.map(cardPlato).join("")}</div>`;
    } catch (err) {
        cont.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`;
    }
}

function controlCantidad(plato) {
    const cant = cantidadEnCarrito(plato.id);
    // Los combos se agregan de a uno con la bebida elegida; las cantidades se ajustan en el carrito
    if (plato.tipo === "combo") {
        return `<button type="button" class="btn btn--primary btn--sm" data-agregar-combo="${plato.id}">
            Agregar${cant > 0 ? ` (${cant} en el pedido)` : ""}</button>`;
    }
    if (cant === 0) {
        return `<button type="button" class="btn btn--primary btn--sm" data-delta="1" data-id="${plato.id}">Agregar</button>`;
    }
    return `<div class="stepper">
        <button type="button" data-delta="-1" data-id="${plato.id}" aria-label="Quitar uno">−</button>
        <span>${cant}</span>
        <button type="button" data-delta="1" data-id="${plato.id}" aria-label="Agregar uno">+</button>
    </div>`;
}

const cardPlato = (p) => `
    <article class="card">
        <div class="plato__emoji">${EMOJI_TIPO[p.tipo] ?? "🍽️"}</div>
        <span class="plato__tipo">${esc(p.tipo)}</span>
        <h3 class="plato__nombre">${esc(p.nombre)}</h3>
        <p class="plato__desc">${esc(p.descripcion)}</p>
        ${p.tipo === "combo"
            ? `<label class="plato__bebida">Bebida
                <select data-bebida="${p.id}">
                    <option value="">Elegí tu bebida</option>
                    ${BEBIDAS_COMBO.map((b) => `<option value="${b}">${b}</option>`).join("")}
                </select>
            </label>`
            : ""}
        <div class="plato__pie">
            <span class="precio">${precio(p.precio)}</span>
            <span data-control="${p.id}">${controlCantidad(p)}</span>
        </div>
    </article>`;

function refrescarSteppersMenu() {
    document.querySelectorAll("[data-control]").forEach((el) => {
        const plato = platosMenu.find((p) => p.id === Number(el.dataset.control));
        if (plato) el.innerHTML = controlCantidad(plato);
    });
}

/* ---------------- Login / Registro ---------------- */

function vistaLogin() {
    if (estaLogueado()) {
        location.hash = "#/menu";
        return;
    }
    app.innerHTML = `
        <div class="card form-card">
            <h1>Ingresar</h1>
            <p class="subtitulo">Iniciá sesión para hacer y seguir tus pedidos.</p>
            <form class="form" id="form-login" novalidate>
                <label>Email
                    <input type="email" name="email" required autocomplete="email">
                </label>
                <label>Contraseña
                    <input type="password" name="password" required autocomplete="current-password">
                </label>
                <div class="form-error" id="error" hidden></div>
                <button class="btn btn--primary btn--block" type="submit">Ingresar</button>
                <p class="form-alt">¿No tenés cuenta? <a href="#/registro">Registrate</a></p>
            </form>
        </div>`;

    $("#form-login").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        const datos = Object.fromEntries(new FormData(form));
        if (!datos.email.trim() || !datos.password) {
            return mostrarError("Completá el email y la contraseña");
        }
        await enviarForm(form, async () => {
            await login(datos.email, datos.password);
        });
    });
}

async function login(email, password) {
    const { token, usuario } = await api("/auth/login", { method: "POST", body: { email: email.trim(), password } });
    iniciarSesion(token, usuario);
    toast(`¡Bienvenido/a, ${usuario.nombre}!`, "success");
    location.hash = esAdmin() ? "#/admin/pedidos" : "#/menu";
    if (carrito.length > 0 && !esAdmin()) setTimeout(abrirCarrito, 150);
}

function vistaRegistro() {
    if (estaLogueado()) {
        location.hash = "#/menu";
        return;
    }
    app.innerHTML = `
        <div class="card form-card">
            <h1>Crear cuenta</h1>
            <p class="subtitulo">Registrate para empezar a pedir.</p>
            <form class="form" id="form-registro" novalidate>
                <div class="form-row">
                    <label>Nombre <input name="nombre" required maxlength="50" autocomplete="given-name"></label>
                    <label>Apellido <input name="apellido" required maxlength="50" autocomplete="family-name"></label>
                </div>
                <label>Email <input type="email" name="email" required maxlength="256" autocomplete="email"></label>
                <label>Contraseña
                    <input type="password" name="password" required minlength="6" maxlength="72" autocomplete="new-password">
                    <span class="contador">Mínimo 6 caracteres</span>
                </label>
                <label>Repetir contraseña
                    <input type="password" name="password2" required autocomplete="new-password">
                </label>
                <div class="form-error" id="error" hidden></div>
                <button class="btn btn--primary btn--block" type="submit">Registrarme</button>
                <p class="form-alt">¿Ya tenés cuenta? <a href="#/login">Ingresá</a></p>
            </form>
        </div>`;

    $("#form-registro").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        const d = Object.fromEntries(new FormData(form));

        const faltan = ["nombre", "apellido", "email", "password"].filter((c) => !d[c].trim());
        if (faltan.length) return mostrarError(`Completá: ${faltan.join(", ")}`);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return mostrarError("El email no tiene un formato válido");
        if (d.password.length < 6) return mostrarError("La contraseña debe tener al menos 6 caracteres");
        if (d.password !== d.password2) return mostrarError("Las contraseñas no coinciden");

        await enviarForm(form, async () => {
            await api("/auth/register", {
                method: "POST",
                body: { nombre: d.nombre.trim(), apellido: d.apellido.trim(), email: d.email.trim(), password: d.password },
            });
            toast("Cuenta creada correctamente", "success");
            await login(d.email, d.password); // entra directo después de registrarse
        });
    });
}

function mostrarError(mensaje) {
    const el = $("#error");
    if (!el) return toast(mensaje, "error");
    el.textContent = mensaje;
    el.hidden = false;
}

// Deshabilita el botón mientras se envía y muestra el error del back si falla
async function enviarForm(form, accion) {
    const btn = form.querySelector('[type="submit"]');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Enviando...";
    $("#error") && ($("#error").hidden = true);
    try {
        await accion();
        return true;
    } catch (err) {
        mostrarError(err.message);
        return false;
    } finally {
        if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }
}

/* ---------------- Mis pedidos ---------------- */

async function vistaMisPedidos() {
    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Mis pedidos</h1>
                <p class="subtitulo">Seguí el estado de cada pedido.</p>
            </div>
            <button class="btn" id="btn-refrescar" type="button">↻ Actualizar</button>
        </div>
        <div id="lista"><div class="cargando">Cargando pedidos...</div></div>`;

    const cargar = async () => {
        const cont = $("#lista");
        try {
            const pedidos = await api("/pedidos/usuario"); // GET /pedidos/usuario
            if (!$("#lista")) return;
            if (pedidos.length === 0) {
                cont.innerHTML = `<div class="vacio"><span class="emoji">🧾</span>Todavía no hiciste pedidos.<br><br>
                    <a href="#/menu" class="btn btn--primary">Ver el menú</a></div>`;
                return;
            }
            // Más recientes primero
            cont.innerHTML = `<div class="pedidos">${[...pedidos].reverse().map((p) => cardPedido(p)).join("")}</div>`;
        } catch (err) {
            cont.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`;
        }
    };

    $("#btn-refrescar").addEventListener("click", cargar);
    await cargar();
}

function progreso(estado) {
    const idx = ESTADOS.indexOf(estado);
    return `
        <div class="progreso">${ESTADOS.map((_, i) => `<div class="${i <= idx ? "hecho" : ""}"></div>`).join("")}</div>
        <div class="progreso__labels">${ESTADOS.map((e) => `<span>${e}</span>`).join("")}</div>`;
}

function cardPedido(p, { admin = false } = {}) {
    const accion = SIGUIENTE_ACCION[p.estado];
    return `
        <article class="card" data-pedido="${p.id}">
            <div class="pedido__head">
                <div>
                    <h3 style="margin:0">Pedido #${p.id}</h3>
                    <span class="pedido__meta">${fecha(p.fecha)}${admin ? ` · Usuario #${p.id_usuario}` : ""}</span>
                </div>
                <span class="${claseEstado(p.estado)}">${esc(p.estado)}</span>
            </div>
            ${progreso(p.estado)}
            <ul class="pedido__lista">
                ${p.platos
                    .map((pl) => `<li><span>${pl.cantidad} × ${esc(pl.nombre ?? `Plato #${pl.id}`)}${pl.bebida ? ` <small>(🥤 ${esc(pl.bebida)})</small>` : ""}</span>
                        <span>${pl.precio != null ? precio(pl.precio * pl.cantidad) : ""}</span></li>`)
                    .join("")}
            </ul>
            <div class="pedido__pie">
                <strong>Total: ${precio(p.total)}</strong>
                ${admin
                    ? `<div class="pedido__acciones">
                        ${accion ? `<button type="button" class="btn btn--primary btn--sm" data-accion="${accion.ruta}" data-id="${p.id}">${accion.texto}</button>` : ""}
                        <button type="button" class="btn btn--danger btn--sm" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
                    </div>`
                    : ""}
            </div>
        </article>`;
}

/* ---------------- Admin: pedidos ---------------- */

let filtroEstadoAdmin = "todos";

async function vistaAdminPedidos() {
    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Gestionar pedidos</h1>
                <p class="subtitulo">Aceptá, enviá y entregá los pedidos de los clientes.</p>
            </div>
            <form class="buscador" id="form-buscar">
                <input type="number" min="1" name="id" placeholder="Buscar por id" aria-label="Id de pedido">
                <button class="btn" type="submit">Buscar</button>
                <button class="btn" type="button" id="btn-refrescar" title="Ver todos">↻</button>
            </form>
        </div>
        <div class="chips" id="filtros">
            ${["todos", ...ESTADOS]
                .map((e) => `<button type="button" class="chip ${e === filtroEstadoAdmin ? "activo" : ""}" data-estado="${e}">${e === "todos" ? "Todos" : e}</button>`)
                .join("")}
        </div>
        <div id="lista"><div class="cargando">Cargando pedidos...</div></div>`;

    let pedidos = [];

    const pintar = (lista) => {
        const cont = $("#lista");
        if (!cont) return;
        const filtrados = filtroEstadoAdmin === "todos" ? lista : lista.filter((p) => p.estado === filtroEstadoAdmin);
        if (filtrados.length === 0) {
            cont.innerHTML = `<div class="vacio"><span class="emoji">🧾</span>No hay pedidos para mostrar</div>`;
            return;
        }
        cont.innerHTML = `<div class="pedidos">${[...filtrados].reverse().map((p) => cardPedido(p, { admin: true })).join("")}</div>`;
    };

    const cargarTodos = async () => {
        $("#lista").innerHTML = `<div class="cargando">Cargando pedidos...</div>`;
        try {
            pedidos = await api("/pedidos"); // GET /pedidos
            pintar(pedidos);
        } catch (err) {
            $("#lista") && ($("#lista").innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`);
        }
    };

    $("#filtros").addEventListener("click", (e) => {
        const chip = e.target.closest("[data-estado]");
        if (!chip) return;
        filtroEstadoAdmin = chip.dataset.estado;
        document.querySelectorAll("#filtros .chip").forEach((c) => c.classList.toggle("activo", c === chip));
        pintar(pedidos);
    });

    $("#form-buscar").addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = e.target.id.value.trim();
        if (!id) return cargarTodos();
        try {
            const pedido = await api(`/pedidos/${encodeURIComponent(id)}`); // GET /pedidos/:id
            pedidos = [pedido];
            filtroEstadoAdmin = "todos";
            document.querySelectorAll("#filtros .chip").forEach((c) => c.classList.toggle("activo", c.dataset.estado === "todos"));
            pintar(pedidos);
        } catch (err) {
            toast(err.message, "error");
        }
    });

    $("#btn-refrescar").addEventListener("click", () => {
        $("#form-buscar").reset();
        cargarTodos();
    });

    $("#lista").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-accion]");
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const accion = btn.dataset.accion;

        if (accion === "eliminar" && !confirm(`¿Eliminar el pedido #${id}? Esta acción no se puede deshacer.`)) return;

        btn.disabled = true;
        try {
            if (accion === "eliminar") {
                const r = await api(`/pedidos/${id}`, { method: "DELETE" }); // DELETE /pedidos/:id
                pedidos = pedidos.filter((p) => p.id !== id);
                toast(r.message, "success");
            } else {
                // PUT /pedidos/:id/aceptar | comenzar | entregar
                const r = await api(`/pedidos/${id}/${accion}`, { method: "PUT" });
                pedidos = pedidos.map((p) => (p.id === id ? r.pedido : p));
                toast(r.message, "success");
            }
            pintar(pedidos);
        } catch (err) {
            toast(err.message, "error");
            btn.disabled = false;
        }
    });

    await cargarTodos();
}

/* ---------------- Admin: platos ---------------- */

async function vistaAdminPlatos() {
    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Gestionar platos</h1>
                <p class="subtitulo">Creá, editá y eliminá los platos del menú.</p>
            </div>
        </div>
        <div class="admin-grid">
            <div class="card">
                <h2 id="form-titulo">Nuevo plato</h2>
                <form class="form" id="form-plato" novalidate>
                    <label>Tipo
                        <select name="tipo" required>
                            <option value="">Elegí un tipo</option>
                            ${TIPOS.map((t) => `<option value="${t}">${EMOJI_TIPO[t]} ${t}</option>`).join("")}
                        </select>
                    </label>
                    <label>Nombre <input name="nombre" required maxlength="70"></label>
                    <label>Precio <input name="precio" type="number" min="1" step="1" required></label>
                    <label>Descripción
                        <textarea name="descripcion" required maxlength="400"></textarea>
                        <span class="contador" id="contador-desc">0 / 400</span>
                    </label>
                    <div class="form-error" id="error" hidden></div>
                    <button class="btn btn--primary btn--block" type="submit" id="btn-guardar">Crear plato</button>
                    <button class="btn btn--block" type="button" id="btn-cancelar" hidden>Cancelar edición</button>
                </form>
            </div>
            <div class="card">
                <h2>Platos del menú</h2>
                <div class="tabla-wrap" id="tabla"><div class="cargando">Cargando...</div></div>
            </div>
        </div>`;

    let platos = [];
    let editando = null; // plato que se está editando

    const form = $("#form-plato");
    const desc = form.descripcion;
    desc.addEventListener("input", () => ($("#contador-desc").textContent = `${desc.value.length} / 400`));

    const modoCrear = () => {
        editando = null;
        form.reset();
        $("#contador-desc").textContent = "0 / 400";
        $("#form-titulo").textContent = "Nuevo plato";
        $("#btn-guardar").textContent = "Crear plato";
        $("#btn-cancelar").hidden = true;
        $("#error").hidden = true;
    };

    const modoEditar = (plato) => {
        editando = plato;
        form.tipo.value = plato.tipo;
        form.nombre.value = plato.nombre;
        form.precio.value = plato.precio;
        form.descripcion.value = plato.descripcion;
        $("#contador-desc").textContent = `${plato.descripcion.length} / 400`;
        $("#form-titulo").textContent = `Editar plato #${plato.id}`;
        $("#btn-guardar").textContent = "Guardar cambios";
        $("#btn-cancelar").hidden = false;
        $("#error").hidden = true;
        form.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const pintarTabla = () => {
        const cont = $("#tabla");
        if (!cont) return;
        if (platos.length === 0) {
            cont.innerHTML = `<div class="vacio"><span class="emoji">🍽️</span>Todavía no hay platos. Creá el primero.</div>`;
            return;
        }
        cont.innerHTML = `
            <table>
                <thead><tr><th>Id</th><th>Plato</th><th>Tipo</th><th>Precio</th><th></th></tr></thead>
                <tbody>
                    ${platos
                        .map((p) => `<tr>
                            <td>${p.id}</td>
                            <td><strong>${esc(p.nombre)}</strong><br><small class="subtitulo">${esc(p.descripcion)}</small></td>
                            <td>${EMOJI_TIPO[p.tipo] ?? ""} ${esc(p.tipo)}</td>
                            <td>${precio(p.precio)}</td>
                            <td class="acciones">
                                <button type="button" class="btn btn--sm" data-editar="${p.id}">Editar</button>
                                <button type="button" class="btn btn--danger btn--sm" data-eliminar="${p.id}">Eliminar</button>
                            </td>
                        </tr>`)
                        .join("")}
                </tbody>
            </table>`;
    };

    const cargar = async () => {
        try {
            platos = await api("/platos");
            pintarTabla();
        } catch (err) {
            $("#tabla") && ($("#tabla").innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`);
        }
    };

    $("#btn-cancelar").addEventListener("click", modoCrear);

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        const datos = {
            tipo: d.tipo,
            nombre: d.nombre.trim(),
            precio: Number(d.precio),
            descripcion: d.descripcion.trim(),
        };

        const faltan = Object.entries(datos).filter(([, v]) => v === "" || (typeof v === "number" && !d.precio)).map(([k]) => k);
        if (faltan.length) return mostrarError(`Completá: ${faltan.join(", ")}`);
        if (!Number.isInteger(datos.precio) || datos.precio <= 0) return mostrarError("El precio debe ser un número entero mayor a 0");

        await enviarForm(form, async () => {
            if (editando) {
                // PUT /platos/:id
                const actualizado = await api(`/platos/${editando.id}`, { method: "PUT", body: datos });
                platos = platos.map((p) => (p.id === actualizado.id ? actualizado : p));
                toast(`Plato "${actualizado.nombre}" actualizado`, "success");
            } else {
                // POST /platos
                const nuevo = await api("/platos", { method: "POST", body: datos });
                platos.push(nuevo);
                toast(`Plato "${nuevo.nombre}" creado`, "success");
            }
            pintarTabla();
            modoCrear();
        });
    });

    $("#tabla").addEventListener("click", async (e) => {
        const btnEditar = e.target.closest("[data-editar]");
        const btnEliminar = e.target.closest("[data-eliminar]");

        if (btnEditar) {
            const plato = platos.find((p) => p.id === Number(btnEditar.dataset.editar));
            if (plato) modoEditar(plato);
            return;
        }
        if (btnEliminar) {
            const id = Number(btnEliminar.dataset.eliminar);
            const plato = platos.find((p) => p.id === id);
            if (!confirm(`¿Eliminar "${plato?.nombre ?? id}"?`)) return;
            btnEliminar.disabled = true;
            try {
                const r = await api(`/platos/${id}`, { method: "DELETE" }); // DELETE /platos/:id
                platos = platos.filter((p) => p.id !== id);
                // Si estaba en el carrito, lo sacamos
                carrito = carrito.filter((i) => i.id !== id);
                guardarCarrito();
                if (editando?.id === id) modoCrear();
                pintarTabla();
                toast(r.message, "success");
            } catch (err) {
                // Ej.: 409 si el plato forma parte de pedidos
                toast(err.message, "error");
                btnEliminar.disabled = false;
            }
        }
    });

    await cargar();
}

/* ---------------- Inicio ---------------- */

programarExpiracion();
renderCarrito();
router();
