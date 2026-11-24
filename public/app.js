/* =========================================================
   Hamburguesas El Ciclón - Front-end
   Se sirve desde el mismo Express que la API, por eso las
   requests van a rutas relativas (/platos, /auth, /pedidos...).
   ========================================================= */

const TIPOS = ["combo", "postre"];
const TIPO_INFO = {
    combo: { plural: "Combos", singular: "Combo", emoji: "🍔" },
    postre: { plural: "Postres", singular: "Postre", emoji: "🍨" },
};
const ESTADOS = ["pendiente", "aceptado", "en camino", "entregado"]; // flujo normal
const BEBIDAS_COMBO = ["Agua", "Pepsi", "Mirinda", "Seven Up"]; // mismas que en el back (db.js)

// Promociones que puede activar el admin (las claves coinciden con PROMOCIONES de db.js)
const PROMOS_UI = [
    { clave: "dia_partido", titulo: "Día de partido", detalle: "20% OFF en todo el menú", emoji: "⚽" },
    { clave: "gano_ciclon", titulo: "Ganó el Ciclón", detalle: "50% OFF en todo el menú", emoji: "🏆" },
];

// Acción de admin disponible según el estado actual del pedido
const SIGUIENTE_ACCION = {
    pendiente: { ruta: "aceptar", texto: "Aceptar pedido" },
    aceptado: { ruta: "comenzar", texto: "Despachar (en camino)" },
    "en camino": { ruta: "entregar", texto: "Marcar entregado" },
};

const MOTIVOS_CANCELACION = [
    "Nos quedamos sin stock",
    "La dirección está fuera de la zona de entrega",
    "El cliente pidió cancelar",
    "No pudimos contactar al cliente",
];

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

const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "");

const haceCuanto = (iso) => {
    const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return "recién";
    if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
    return new Date(iso).toLocaleDateString("es-AR");
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

function toast(mensaje, tipo = "info", ms = 4000) {
    const el = document.createElement("div");
    el.className = `toast toast--${tipo}`;
    el.textContent = mensaje;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), ms);
}

// Intervalos de la vista actual: se cortan al cambiar de pantalla
let timersVista = [];
const cadaTanto = (ms, fn) => timersVista.push(setInterval(fn, ms));
const cortarTimersVista = () => {
    timersVista.forEach(clearInterval);
    timersVista = [];
};

/* ---------------- Sesión ---------------- */

const sesion = {
    token: storage.get("ciclon_token"),
    usuario: storage.get("ciclon_usuario"),
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
    storage.set("ciclon_token", token);
    storage.set("ciclon_usuario", usuario);
    programarExpiracion();
    iniciarNotificaciones();
}

function cerrarSesion() {
    sesion.token = null;
    sesion.usuario = null;
    clearTimeout(sesion.timer);
    storage.remove("ciclon_token");
    storage.remove("ciclon_usuario");
    detenerNotificaciones();
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

/* ---------------- Promoción vigente ---------------- */

let promo = { promocion: null, nombre: null, descuento: 0 };

function renderPromoBanner() {
    const el = $("#promo-banner");
    const info = PROMOS_UI.find((p) => p.clave === promo.promocion);
    if (!info) {
        el.hidden = true;
        return;
    }
    el.innerHTML = `<strong>${info.emoji} ${esc(info.titulo)}</strong> ${promo.descuento}% OFF en todo el menú`;
    el.hidden = false;
}

async function cargarPromo() {
    try {
        promo = await api("/promocion");
    } catch { /* si falla, seguimos sin banner */ }
    renderPromoBanner();
}

/* ---------------- Carrito ---------------- */
// [{ key, id, nombre, precio, precio_lista, cantidad, bebida }]
// precio = lo que se paga por unidad (con descuento); precio_lista = precio sin descuento.
// Un mismo combo con distinta bebida ocupa renglones distintos, por eso cada renglón
// se identifica por key = "id|bebida" y no solo por el id del plato.
const claveItem = (id, bebida) => `${id}|${bebida ?? ""}`;

let carrito = storage.get("ciclon_carrito", []);
if (!Array.isArray(carrito)) carrito = [];
carrito.forEach((i) => (i.key = claveItem(i.id, i.bebida)));

const guardarCarrito = () => {
    storage.set("ciclon_carrito", carrito);
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
        carrito.push({
            key,
            id: plato.id,
            nombre: plato.nombre,
            precio: plato.precio_final ?? plato.precio,
            precio_lista: plato.precio,
            cantidad: delta,
            bebida,
        });
    }
    guardarCarrito();
}

// Actualiza precios del carrito con la última info del menú y saca lo que ya no se puede pedir
function sincronizarCarrito(platos) {
    const quitados = [];
    carrito = carrito.filter((item) => {
        const p = platos.find((pl) => pl.id === item.id);
        if (!p || !p.disponible) {
            quitados.push(item.nombre);
            return false;
        }
        item.nombre = p.nombre;
        item.precio = p.precio_final ?? p.precio;
        item.precio_lista = p.precio;
        return true;
    });
    guardarCarrito();
    if (quitados.length) {
        toast(`Sacamos de tu pedido lo que ya no está disponible: ${[...new Set(quitados)].join(", ")}`, "error", 6000);
    }
}

function renderCarrito() {
    const totalItems = carrito.reduce((a, i) => a + i.cantidad, 0);
    const total = carrito.reduce((a, i) => a + i.precio * i.cantidad, 0);
    const subtotal = carrito.reduce((a, i) => a + (i.precio_lista ?? i.precio) * i.cantidad, 0);
    $("#carrito-count").textContent = totalItems;
    $("#btn-confirmar").disabled = carrito.length === 0;
    $("#carrito-foot").hidden = carrito.length === 0;

    const ahorro = subtotal - total;
    $("#carrito-resumen").innerHTML = `
        ${ahorro > 0
            ? `<div class="fila"><span>Subtotal</span><span>${precio(subtotal)}</span></div>
               <div class="fila fila--descuento"><span>${esc(promo.nombre ?? "Descuento")} (-${promo.descuento}%)</span><span>−${precio(ahorro)}</span></div>`
            : ""}
        <div class="fila fila--total"><span>Total</span><span>${precio(total)}</span></div>`;

    const cont = $("#carrito-items");
    if (carrito.length === 0) {
        cont.innerHTML = `<div class="vacio"><span class="emoji">🛒</span>Todavía no agregaste nada.<br>¡Mirá el menú y armá tu pedido!</div>`;
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

// La dirección se recuerda para el próximo pedido
$("#entrega-direccion").value = storage.get("ciclon_direccion", "") || "";

$("#btn-confirmar").addEventListener("click", async () => {
    if (carrito.length === 0) return;
    if (!estaLogueado()) {
        cerrarCarrito();
        toast("Iniciá sesión para confirmar tu pedido", "info");
        location.hash = "#/login";
        return;
    }
    const direccion = $("#entrega-direccion").value.trim();
    const comentario = $("#entrega-comentario").value.trim();
    if (direccion.length < 5) {
        toast("Ingresá la dirección de entrega", "error");
        $("#entrega-direccion").focus();
        return;
    }

    const btn = $("#btn-confirmar");
    btn.disabled = true;
    btn.textContent = "Enviando...";
    try {
        // El precio final lo calcula el back con la promoción vigente
        const pedido = await api("/pedidos", {
            method: "POST",
            body: {
                platos: carrito.map(({ id, cantidad, bebida }) => (bebida ? { id, cantidad, bebida } : { id, cantidad })),
                direccion,
                ...(comentario ? { comentario } : {}),
            },
        });
        storage.set("ciclon_direccion", direccion);
        $("#entrega-comentario").value = "";
        carrito = [];
        guardarCarrito();
        cerrarCarrito();
        toast(`¡Pedido #${pedido.id} recibido! Total ${precio(pedido.total)}. Te avisamos cuando lo aceptemos.`, "success", 6000);
        location.hash = "#/mis-pedidos";
    } catch (err) {
        toast(err.message, "error", 6000);
        // Puede haber cambiado la disponibilidad o el precio: refrescamos el carrito
        api("/platos").then(sincronizarCarrito).catch(() => {});
    } finally {
        btn.textContent = "Confirmar pedido";
        btn.disabled = carrito.length === 0;
    }
});

/* ---------------- Notificaciones del cliente ---------------- */

const notifs = { lista: [], noLeidas: 0, avisadas: new Set(), timer: null, alNotificar: null };

function iniciarNotificaciones() {
    detenerNotificaciones();
    if (!estaLogueado() || esAdmin()) return;
    $("#notif").hidden = false;
    cargarNotificaciones();
    notifs.timer = setInterval(cargarNotificaciones, 15000);
}

function detenerNotificaciones() {
    clearInterval(notifs.timer);
    notifs.timer = null;
    notifs.lista = [];
    notifs.noLeidas = 0;
    notifs.avisadas.clear();
    $("#notif").hidden = true;
    $("#notif-panel").hidden = true;
}

async function cargarNotificaciones() {
    if (!estaLogueado() || esAdmin()) return;
    try {
        const r = await api("/notificaciones");
        notifs.lista = r.notificaciones;
        notifs.noLeidas = r.no_leidas;

        // Las no leídas que todavía no mostramos en esta sesión aparecen como aviso
        const nuevas = r.notificaciones.filter((n) => !n.leida && !notifs.avisadas.has(n.id));
        nuevas.forEach((n) => notifs.avisadas.add(n.id));
        nuevas
            .slice(0, 3)
            .reverse()
            .forEach((n) => toast(`🔔 ${n.mensaje}`, n.tipo === "alerta" ? "error" : n.tipo === "exito" ? "success" : "info", 8000));
        if (nuevas.length && notifs.alNotificar) notifs.alNotificar();

        renderNotificaciones();
    } catch { /* se reintenta en el próximo ciclo */ }
}

function renderNotificaciones() {
    const count = $("#notif-count");
    count.textContent = notifs.noLeidas > 9 ? "9+" : notifs.noLeidas;
    count.hidden = notifs.noLeidas === 0;

    const icono = { alerta: "❌", exito: "✅", info: "🍔" };
    $("#notif-panel").innerHTML = `
        <div class="notif__titulo">Notificaciones</div>
        ${notifs.lista.length === 0
            ? `<div class="notif__item">No tenés notificaciones todavía.</div>`
            : notifs.lista
                .map((n) => `<div class="notif__item notif__item--${esc(n.tipo)} ${n.leida ? "" : "notif__item--nueva"}">
                    <span class="notif__icono">${icono[n.tipo] ?? "🔔"}</span>
                    <div>${esc(n.mensaje)}<small>${haceCuanto(n.creado_en)}</small></div>
                </div>`)
                .join("")}`;
}

$("#btn-notif").addEventListener("click", async (e) => {
    e.stopPropagation();
    const panel = $("#notif-panel");
    panel.hidden = !panel.hidden;
    $("#btn-notif").setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && notifs.noLeidas > 0) {
        try {
            await api("/notificaciones/leer", { method: "PUT" });
            notifs.noLeidas = 0;
            // Se dejan resaltadas mientras el panel está abierto; la próxima vez se ven como leídas
            $("#notif-count").hidden = true;
            notifs.lista.forEach((n) => (n.leida = true));
        } catch { /* nada */ }
    }
});
document.addEventListener("click", (e) => {
    if (!e.target.closest("#notif")) {
        $("#notif-panel").hidden = true;
        $("#btn-notif").setAttribute("aria-expanded", "false");
        renderNotificaciones();
    }
});

/* ---------------- Modal ---------------- */

// Pide confirmación para cancelar un pedido. Devuelve { motivo } o null si se arrepiente.
function modalCancelar(pedido) {
    return new Promise((resolve) => {
        const dlg = $("#modal");
        dlg.innerHTML = `
            <form method="dialog" class="modal__form">
                <h2>Cancelar pedido #${pedido.id}</h2>
                <p class="subtitulo">${esc(pedido.cliente?.nombre ?? "El cliente")} va a recibir un aviso de que su pedido fue cancelado.</p>
                <label>Motivo <span class="opcional">(opcional, lo ve el cliente)</span>
                    <textarea name="motivo" maxlength="200" rows="2" placeholder="Contale al cliente por qué se cancela"></textarea>
                </label>
                <div class="motivos">
                    ${MOTIVOS_CANCELACION.map((m) => `<button type="button" class="chip" data-motivo="${esc(m)}">${esc(m)}</button>`).join("")}
                </div>
                <div class="modal__acciones">
                    <button class="btn" value="volver">Volver</button>
                    <button class="btn btn--danger-solid" value="ok">Sí, cancelar pedido</button>
                </div>
            </form>`;
        dlg.querySelector(".motivos").addEventListener("click", (e) => {
            const b = e.target.closest("[data-motivo]");
            if (b) dlg.querySelector("[name=motivo]").value = b.dataset.motivo;
        });
        dlg.returnValue = "";
        dlg.addEventListener(
            "close",
            () => resolve(dlg.returnValue === "ok" ? { motivo: dlg.querySelector("[name=motivo]").value.trim() } : null),
            { once: true }
        );
        dlg.showModal();
    });
}

/* ---------------- Navegación ---------------- */

function renderNav() {
    const ruta = location.hash.slice(1) || "/menu";
    const link = (href, texto) => `<a href="#${href}" class="${ruta === href ? "activo" : ""}">${texto}</a>`;

    let html = link("/menu", "Menú");
    if (estaLogueado() && !esAdmin()) html += link("/mis-pedidos", "Mis pedidos");
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
    // El admin gestiona el local; el carrito es para los clientes
    $("#btn-carrito").hidden = esAdmin();

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

    cortarTimersVista();
    notifs.alNotificar = null;
    cerrarCarrito();
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
    const promoInfo = () => PROMOS_UI.find((p) => p.clave === promo.promocion);
    app.innerHTML = `
        <section class="hero">
            <div class="hero__texto">
                <span class="hero__kicker">La hamburguesería del Ciclón</span>
                <h1>Hamburguesas El Ciclón</h1>
                <p class="hero__slogan">“Hamburguesas grandes como tu pasión por San Lorenzo”</p>
                <div id="hero-promo"></div>
                <a href="#lista-platos" class="btn btn--blanco" id="btn-ver-menu">Ver el menú</a>
            </div>
            <img src="logo.svg" class="hero__logo" alt="Logo de El Ciclón: un cuervo agarrando una hamburguesa">
        </section>
        <div class="chips" id="filtros">
            ${["todos", ...TIPOS]
                .map((t) => `<button type="button" class="chip ${t === filtroMenu ? "activo" : ""}" data-tipo="${t}">
                    ${t === "todos" ? "Todo el menú" : `${TIPO_INFO[t].emoji} ${TIPO_INFO[t].plural}`}
                </button>`)
                .join("")}
        </div>
        <div id="lista-platos"><div class="cargando">Cargando menú...</div></div>`;

    const pintarHeroPromo = () => {
        const info = promoInfo();
        $("#hero-promo").innerHTML = info ? `<span class="hero__promo">${info.emoji} ${esc(info.titulo)}: ${promo.descuento}% OFF</span>` : "";
    };
    pintarHeroPromo();

    $("#btn-ver-menu").addEventListener("click", (e) => {
        e.preventDefault(); // el hash lo usa el router
        $("#filtros").scrollIntoView({ behavior: "smooth" });
    });

    $("#filtros").addEventListener("click", (e) => {
        const chip = e.target.closest("[data-tipo]");
        if (!chip) return;
        filtroMenu = chip.dataset.tipo;
        document.querySelectorAll("#filtros .chip").forEach((c) => c.classList.toggle("activo", c === chip));
        pintarPlatosMenu();
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
    pintarHeroPromo();

    // Si el admin activa una promo o agota un plato, el menú se actualiza solo
    cadaTanto(60000, async () => {
        const antes = promo.promocion;
        await cargarPromo();
        if (promo.promocion !== antes) {
            pintarHeroPromo();
            await cargarPlatosMenu({ silencioso: true });
        }
    });
}

async function cargarPlatosMenu({ silencioso = false } = {}) {
    const cont = $("#lista-platos");
    if (!cont) return;
    if (!silencioso) cont.innerHTML = `<div class="cargando">Cargando menú...</div>`;
    try {
        // Traemos todo el menú (GET /platos) y filtramos acá: así el carrito se puede sincronizar
        platosMenu = await api("/platos");
        sincronizarCarrito(platosMenu);
        pintarPlatosMenu();
    } catch (err) {
        $("#lista-platos") && (cont.innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`);
    }
}

function pintarPlatosMenu() {
    const cont = $("#lista-platos");
    if (!cont) return;
    const lista = filtroMenu === "todos" ? platosMenu : platosMenu.filter((p) => p.tipo === filtroMenu);
    if (lista.length === 0) {
        cont.innerHTML = `<div class="vacio"><span class="emoji">🍽️</span>No hay platos en esta categoría todavía</div>`;
        return;
    }
    // Primero lo disponible, lo agotado al final
    const ordenada = [...lista].sort((a, b) => Number(b.disponible) - Number(a.disponible));
    cont.innerHTML = `<div class="grid">${ordenada.map(cardPlato).join("")}</div>`;
}

function controlCantidad(plato) {
    if (!plato.disponible) return `<button type="button" class="btn btn--sm" disabled>Agotado</button>`;
    const cant = cantidadEnCarrito(plato.id);
    // Los combos se agregan de a uno con la bebida elegida; las cantidades se ajustan en el carrito
    if (plato.tipo === "combo") {
        return `<button type="button" class="btn btn--primary btn--sm" data-agregar-combo="${plato.id}">
            Agregar${cant > 0 ? ` (${cant})` : ""}</button>`;
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

const fotoPlato = (p) =>
    p.imagen
        ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy">`
        : `<div class="plato__placeholder"><img src="logo.svg" alt=""></div>`;

const precioPlato = (p) =>
    p.descuento > 0
        ? `<span class="precio precio--promo"><s>${precio(p.precio)}</s>${precio(p.precio_final)}</span>`
        : `<span class="precio">${precio(p.precio)}</span>`;

const cardPlato = (p) => `
    <article class="card plato ${p.disponible ? "" : "plato--agotado"}">
        <div class="plato__foto">
            ${fotoPlato(p)}
            ${p.descuento > 0 && p.disponible ? `<span class="badge badge--promo">-${p.descuento}%</span>` : ""}
            ${p.disponible ? "" : `<span class="badge badge--agotado">Agotado</span>`}
        </div>
        <div class="plato__cuerpo">
            <span class="plato__tipo">${esc(TIPO_INFO[p.tipo]?.singular ?? p.tipo)}</span>
            <h3>${esc(p.nombre)}</h3>
            <p class="plato__desc">${esc(p.descripcion)}</p>
            ${p.tipo === "combo" && p.disponible
                ? `<label class="plato__bebida">Bebida incluida
                    <select data-bebida="${p.id}">
                        <option value="">Elegí tu bebida</option>
                        ${BEBIDAS_COMBO.map((b) => `<option value="${b}">${b}</option>`).join("")}
                    </select>
                </label>`
                : ""}
            <div class="plato__pie">
                ${precioPlato(p)}
                <span data-control="${p.id}">${controlCantidad(p)}</span>
            </div>
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
            <img src="logo.svg" alt="" class="form-card__logo">
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
    toast(`¡Bienvenido/a, ${usuario.nombre}! Vamos Ciclón 💙❤️`, "success");
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
            <img src="logo.svg" alt="" class="form-card__logo">
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

/* ---------------- Pedidos (compartido) ---------------- */

function progreso(estado) {
    const idx = ESTADOS.indexOf(estado);
    return `
        <div class="progreso">${ESTADOS.map((_, i) => `<div class="${i < idx ? "hecho" : i === idx ? (estado === "entregado" ? "hecho" : "actual") : ""}"></div>`).join("")}</div>
        <div class="progreso__labels">${ESTADOS.map((e) => `<span>${e}</span>`).join("")}</div>`;
}

function cardPedido(p, { admin = false } = {}) {
    const accion = SIGUIENTE_ACCION[p.estado];
    const cancelable = admin && p.estado !== "entregado" && p.estado !== "cancelado";
    const ahorro = p.subtotal - p.total;
    return `
        <article class="card ${p.estado === "cancelado" ? "pedido--cancelado" : ""}" data-pedido="${p.id}">
            <div class="pedido__head">
                <div>
                    <h3>Pedido #${p.id}</h3>
                    <span class="pedido__meta">${fecha(p.fecha)}${p.creado_en ? ` · ${hora(p.creado_en)} hs` : ""}</span>
                </div>
                <span class="${claseEstado(p.estado)}">${esc(p.estado)}</span>
            </div>
            ${p.estado === "cancelado"
                ? `<div class="aviso aviso--cancelado">❌ Pedido cancelado${p.motivo_cancelacion ? `: ${esc(p.motivo_cancelacion)}` : ""}</div>`
                : progreso(p.estado)}
            ${admin || p.direccion
                ? `<div class="pedido__datos">
                    ${admin ? `<span>👤 <strong>${esc(p.cliente?.nombre ?? `Usuario #${p.id_usuario}`)}</strong>${p.cliente?.email ? ` · ${esc(p.cliente.email)}` : ""}</span>` : ""}
                    ${p.direccion ? `<span>📍 ${esc(p.direccion)}</span>` : ""}
                    ${p.comentario ? `<span>📝 ${esc(p.comentario)}</span>` : ""}
                </div>`
                : ""}
            <ul class="pedido__lista">
                ${p.platos
                    .map((pl) => `<li><span>${pl.cantidad} × ${esc(pl.nombre ?? `Plato #${pl.id}`)}${pl.bebida ? ` <small>(🥤 ${esc(pl.bebida)})</small>` : ""}</span>
                        <span>${pl.precio != null ? precio(pl.precio * pl.cantidad) : ""}</span></li>`)
                    .join("")}
            </ul>
            <div class="pedido__pie">
                <div class="pedido__totales">
                    <strong>Total: ${precio(p.total)}</strong>
                    ${ahorro > 0 ? `<small>${esc(p.promocion ?? "Promoción")} (-${p.descuento}%): ahorro de ${precio(ahorro)}</small>` : ""}
                </div>
                ${admin && (accion || cancelable)
                    ? `<div class="pedido__acciones">
                        ${accion ? `<button type="button" class="btn btn--azul btn--sm" data-accion="${accion.ruta}" data-id="${p.id}">${accion.texto}</button>` : ""}
                        ${cancelable ? `<button type="button" class="btn btn--danger btn--sm" data-accion="cancelar" data-id="${p.id}">Cancelar pedido</button>` : ""}
                    </div>`
                    : ""}
            </div>
        </article>`;
}

/* ---------------- Mis pedidos ---------------- */

async function vistaMisPedidos() {
    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Mis pedidos</h1>
                <p class="subtitulo">Seguí el estado de cada pedido. Se actualiza solo.</p>
            </div>
            <button class="btn" id="btn-refrescar" type="button">↻ Actualizar</button>
        </div>
        <div id="lista"><div class="cargando">Cargando pedidos...</div></div>`;

    const cargar = async () => {
        const cont = $("#lista");
        if (!cont) return;
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
    // Cuando llega una notificación (cambio de estado / cancelación) se recarga la lista
    notifs.alNotificar = cargar;
    cadaTanto(30000, cargar);
    await cargar();
}

/* ---------------- Admin: pedidos ---------------- */

let filtroEstadoAdmin = "activos";

async function vistaAdminPedidos() {
    const FILTROS = [
        { clave: "activos", texto: "En curso" },
        ...ESTADOS.map((e) => ({ clave: e, texto: e[0].toUpperCase() + e.slice(1) })),
        { clave: "cancelado", texto: "Cancelados" },
        { clave: "todos", texto: "Todos" },
    ];

    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Gestionar pedidos</h1>
                <p class="subtitulo">Aceptá, despachá y entregá los pedidos. La lista se actualiza sola cada 20 segundos.</p>
            </div>
            <form class="buscador" id="form-buscar">
                <input type="number" min="1" name="id" placeholder="N° de pedido" aria-label="Número de pedido">
                <button class="btn" type="submit">Buscar</button>
                <button class="btn" type="button" id="btn-refrescar" title="Ver todos">↻</button>
            </form>
        </div>
        <div class="chips" id="filtros"></div>
        <div id="lista"><div class="cargando">Cargando pedidos...</div></div>`;

    let pedidos = [];
    let buscando = false; // mientras se muestra un resultado de búsqueda no se auto-refresca
    let idsConocidos = null;

    const coincide = (p, filtro) =>
        filtro === "todos" ||
        (filtro === "activos" ? ["pendiente", "aceptado", "en camino"].includes(p.estado) : p.estado === filtro);

    const pintarFiltros = () => {
        $("#filtros").innerHTML = FILTROS.map((f) => {
            const n = f.clave === "todos" ? 0 : pedidos.filter((p) => coincide(p, f.clave)).length;
            const mostrarN = ["activos", "pendiente"].includes(f.clave) && n > 0;
            return `<button type="button" class="chip ${f.clave === filtroEstadoAdmin ? "activo" : ""}" data-estado="${f.clave}">
                ${f.texto}${mostrarN ? `<span class="chip__n">${n}</span>` : ""}</button>`;
        }).join("");
    };

    const pintar = () => {
        const cont = $("#lista");
        if (!cont) return;
        pintarFiltros();
        const filtrados = pedidos.filter((p) => coincide(p, filtroEstadoAdmin));
        if (filtrados.length === 0) {
            cont.innerHTML = `<div class="vacio"><span class="emoji">🧾</span>No hay pedidos para mostrar</div>`;
            return;
        }
        // En curso: los más viejos primero (se atienden en orden de llegada). El resto: más recientes primero.
        const orden = filtroEstadoAdmin === "activos" || filtroEstadoAdmin === "pendiente" ? filtrados : [...filtrados].reverse();
        cont.innerHTML = `<div class="pedidos">${orden.map((p) => cardPedido(p, { admin: true })).join("")}</div>`;
    };

    const cargarTodos = async ({ silencioso = false } = {}) => {
        if (!silencioso) $("#lista").innerHTML = `<div class="cargando">Cargando pedidos...</div>`;
        try {
            pedidos = await api("/pedidos"); // GET /pedidos
            if (!$("#lista")) return;
            buscando = false;
            // Avisar los pedidos nuevos que llegaron desde la última carga
            if (idsConocidos) {
                const nuevos = pedidos.filter((p) => !idsConocidos.has(p.id));
                nuevos.forEach((p) => toast(`🔔 Nuevo pedido #${p.id} de ${p.cliente?.nombre ?? "un cliente"}`, "info", 7000));
            }
            idsConocidos = new Set(pedidos.map((p) => p.id));
            pintar();
        } catch (err) {
            $("#lista") && ($("#lista").innerHTML = `<div class="vacio"><span class="emoji">⚠️</span>${esc(err.message)}</div>`);
        }
    };

    $("#filtros").addEventListener("click", (e) => {
        const chip = e.target.closest("[data-estado]");
        if (!chip) return;
        filtroEstadoAdmin = chip.dataset.estado;
        pintar();
    });

    $("#form-buscar").addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = e.target.id.value.trim();
        if (!id) return cargarTodos();
        try {
            const pedido = await api(`/pedidos/${encodeURIComponent(id)}`); // GET /pedidos/:id
            pedidos = [pedido];
            buscando = true;
            filtroEstadoAdmin = "todos";
            pintar();
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
        const pedido = pedidos.find((p) => p.id === id);

        let body;
        if (accion === "cancelar") {
            const r = await modalCancelar(pedido ?? { id });
            if (!r) return;
            body = r.motivo ? { motivo: r.motivo } : undefined;
        }

        btn.disabled = true;
        try {
            // PUT /pedidos/:id/aceptar | comenzar | entregar | cancelar
            const r = await api(`/pedidos/${id}/${accion}`, { method: "PUT", body });
            pedidos = pedidos.map((p) => (p.id === id ? r.pedido : p));
            toast(r.message, "success");
            pintar();
        } catch (err) {
            toast(err.message, "error");
            btn.disabled = false;
        }
    });

    cadaTanto(20000, () => {
        // No refrescar con un modal abierto o mostrando una búsqueda
        if (!buscando && !$("#modal").open) cargarTodos({ silencioso: true });
    });
    await cargarTodos();
}

/* ---------------- Admin: platos y promociones ---------------- */

// Achica la foto en el navegador (máx. 900 px, JPG) para que viaje liviana en el JSON
async function procesarImagen(file) {
    if (!file.type.startsWith("image/")) throw new Error("El archivo tiene que ser una imagen");
    if (file.size > 15 * 1024 * 1024) throw new Error("La imagen pesa demasiado (máximo 15 MB)");
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error("No se pudo leer la imagen"));
            i.src = url;
        });
        const MAX = 900;
        const escala = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // fondo blanco para PNG con transparencia
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let calidad = 0.85;
        let data = canvas.toDataURL("image/jpeg", calidad);
        while (data.length > 1_400_000 && calidad > 0.4) {
            calidad -= 0.15;
            data = canvas.toDataURL("image/jpeg", calidad);
        }
        return data;
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function vistaAdminPlatos() {
    app.innerHTML = `
        <div class="page-head">
            <div>
                <h1>Gestionar platos</h1>
                <p class="subtitulo">Promociones del día, fotos, precios y stock del menú.</p>
            </div>
        </div>
        <section class="card promos">
            <h2>Promociones</h2>
            <p class="subtitulo">Se aplican a todo el menú al instante. Solo puede haber una activa: activar una apaga la otra.</p>
            <div class="promos__grid" id="promos"></div>
        </section>
        <div class="admin-grid">
            <div class="card">
                <h2 id="form-titulo">Nuevo plato</h2>
                <form class="form" id="form-plato" novalidate>
                    <label>Categoría
                        <select name="tipo" required>
                            <option value="">Elegí una categoría</option>
                            ${TIPOS.map((t) => `<option value="${t}">${TIPO_INFO[t].emoji} ${TIPO_INFO[t].singular}</option>`).join("")}
                        </select>
                    </label>
                    <label>Nombre <input name="nombre" required maxlength="70"></label>
                    <label>Precio de lista ($) <input name="precio" type="number" min="1" step="1" required></label>
                    <label>Descripción
                        <textarea name="descripcion" required maxlength="400"></textarea>
                        <span class="contador" id="contador-desc">0 / 400</span>
                    </label>
                    <div>
                        <span style="font-weight:500;font-size:0.92rem">Foto</span>
                        <div class="foto-input">
                            <div class="foto-input__preview" id="foto-preview">Sin foto</div>
                            <div class="foto-input__botones">
                                <label class="btn btn--sm" for="foto-archivo" style="display:inline-block">📷 Elegir foto</label>
                                <input type="file" id="foto-archivo" accept="image/*">
                                <button type="button" class="btn btn--sm btn--danger" id="btn-quitar-foto" hidden>Quitar foto</button>
                            </div>
                        </div>
                    </div>
                    <label class="check"><input type="checkbox" name="disponible" checked> Disponible para la venta</label>
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
    let imagen = null; // foto del formulario: data URL / URL o null

    const form = $("#form-plato");
    const desc = form.descripcion;
    desc.addEventListener("input", () => ($("#contador-desc").textContent = `${desc.value.length} / 400`));

    /* --- Promociones --- */
    const pintarPromos = () => {
        $("#promos").innerHTML = PROMOS_UI.map((p) => `
            <button type="button" class="promo-toggle ${promo.promocion === p.clave ? "activa" : ""}" data-promo="${p.clave}"
                aria-pressed="${promo.promocion === p.clave}">
                <span class="promo-toggle__emoji">${p.emoji}</span>
                <span class="promo-toggle__texto"><strong>${esc(p.titulo)}</strong><small>${esc(p.detalle)}</small></span>
                <span class="switch" aria-hidden="true"></span>
            </button>`).join("");
    };

    $("#promos").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-promo]");
        if (!btn) return;
        const clave = btn.dataset.promo;
        const nueva = promo.promocion === clave ? null : clave; // tocar la activa la apaga
        document.querySelectorAll("[data-promo]").forEach((b) => (b.disabled = true));
        try {
            const r = await api("/promocion", { method: "PUT", body: { promocion: nueva } });
            promo = { promocion: r.promocion, nombre: r.nombre, descuento: r.descuento };
            renderPromoBanner();
            toast(r.message, "success");
            await cargar(); // los precios finales cambiaron
        } catch (err) {
            toast(err.message, "error");
        } finally {
            pintarPromos();
        }
    });

    /* --- Foto --- */
    const pintarFoto = () => {
        $("#foto-preview").innerHTML = imagen ? `<img src="${esc(imagen)}" alt="Vista previa">` : "Sin foto";
        $("#btn-quitar-foto").hidden = !imagen;
    };

    $("#foto-archivo").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = ""; // permite volver a elegir el mismo archivo
        if (!file) return;
        $("#foto-preview").textContent = "Procesando...";
        try {
            imagen = await procesarImagen(file);
        } catch (err) {
            toast(err.message, "error");
        }
        pintarFoto();
    });

    $("#btn-quitar-foto").addEventListener("click", () => {
        imagen = null;
        pintarFoto();
    });

    /* --- Formulario --- */
    const modoCrear = () => {
        editando = null;
        imagen = null;
        form.reset();
        form.disponible.checked = true;
        pintarFoto();
        $("#contador-desc").textContent = "0 / 400";
        $("#form-titulo").textContent = "Nuevo plato";
        $("#btn-guardar").textContent = "Crear plato";
        $("#btn-cancelar").hidden = true;
        $("#error").hidden = true;
    };

    const modoEditar = (plato) => {
        editando = plato;
        imagen = plato.imagen ?? null;
        form.tipo.value = TIPOS.includes(plato.tipo) ? plato.tipo : "";
        form.nombre.value = plato.nombre;
        form.precio.value = plato.precio;
        form.descripcion.value = plato.descripcion;
        form.disponible.checked = plato.disponible;
        pintarFoto();
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
                <thead><tr><th>Foto</th><th>Plato</th><th>Categoría</th><th>Precio</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                    ${platos
                        .map((p) => `<tr>
                            <td>${p.imagen ? `<img class="thumb" src="${esc(p.imagen)}" alt="">` : `<span class="thumb thumb--vacia">📷</span>`}</td>
                            <td><strong>${esc(p.nombre)}</strong><br><small class="subtitulo">${esc(p.descripcion)}</small></td>
                            <td>${TIPO_INFO[p.tipo]?.emoji ?? ""} ${esc(TIPO_INFO[p.tipo]?.singular ?? p.tipo)}</td>
                            <td>${p.descuento > 0 ? `<s class="subtitulo">${precio(p.precio)}</s><br><strong style="color:var(--rojo)">${precio(p.precio_final)}</strong>` : precio(p.precio)}</td>
                            <td><button type="button" class="pill ${p.disponible ? "pill--ok" : "pill--no"}" data-stock="${p.id}"
                                title="Tocar para marcar como ${p.disponible ? "agotado" : "disponible"}">${p.disponible ? "Disponible" : "Agotado"}</button></td>
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
            sincronizarCarrito(platos);
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
            imagen,
            disponible: form.disponible.checked,
        };

        const faltan = [
            !datos.tipo && "categoría",
            !datos.nombre && "nombre",
            !d.precio && "precio",
            !datos.descripcion && "descripción",
        ].filter(Boolean);
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
            sincronizarCarrito(platos);
            pintarTabla();
            modoCrear();
        });
    });

    $("#tabla").addEventListener("click", async (e) => {
        const btnEditar = e.target.closest("[data-editar]");
        const btnEliminar = e.target.closest("[data-eliminar]");
        const btnStock = e.target.closest("[data-stock]");

        if (btnEditar) {
            const plato = platos.find((p) => p.id === Number(btnEditar.dataset.editar));
            if (plato) modoEditar(plato);
            return;
        }
        if (btnStock) {
            const id = Number(btnStock.dataset.stock);
            const plato = platos.find((p) => p.id === id);
            if (!plato) return;
            btnStock.disabled = true;
            try {
                const actualizado = await api(`/platos/${id}`, { method: "PUT", body: { disponible: !plato.disponible } });
                platos = platos.map((p) => (p.id === id ? actualizado : p));
                if (editando?.id === id) form.disponible.checked = actualizado.disponible;
                toast(`"${actualizado.nombre}" ${actualizado.disponible ? "vuelve a estar disponible" : "marcado como agotado"}`, "success");
                pintarTabla();
            } catch (err) {
                toast(err.message, "error");
                btnStock.disabled = false;
            }
            return;
        }
        if (btnEliminar) {
            const id = Number(btnEliminar.dataset.eliminar);
            const plato = platos.find((p) => p.id === id);
            if (!confirm(`¿Eliminar "${plato?.nombre ?? id}" del menú?`)) return;
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
                toast(err.message, "error", 7000);
                btnEliminar.disabled = false;
            }
        }
    });

    pintarPromos();
    await cargar();
}

/* ---------------- Inicio ---------------- */

programarExpiracion();
renderCarrito();
iniciarNotificaciones();
cargarPromo().then(renderCarrito);
router();
