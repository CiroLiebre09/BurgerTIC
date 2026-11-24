import { sequelize, Pedido, PlatoXPedido, Plato, Usuario, Notificacion } from "../db.js";
import { HttpError } from "../utils/HttpError.js";
import { getPromocion, aplicarDescuento } from "./promocion.service.js";
import { crearNotificacion } from "./notificaciones.service.js";

const INCLUDE_ITEMS = [
    {
        model: PlatoXPedido,
        as: "items",
        include: [{ model: Plato, as: "plato", attributes: ["id", "nombre", "precio", "tipo"] }],
    },
    { model: Usuario, as: "usuario", attributes: ["id", "nombre", "apellido", "email"] },
];

const ORDEN = [
    ["id", "ASC"],
    [{ model: PlatoXPedido, as: "items" }, "id", "ASC"],
];

// Formato de respuesta: { id, id_usuario, cliente, fecha, creado_en, estado, direccion, comentario,
//                         promocion, descuento, motivo_cancelacion, platos: [...], subtotal, total }
const formatearPedido = (pedido) => {
    const platos = pedido.items.map((item) => {
        const precioLista = item.plato?.precio ?? null;
        // Pedidos viejos no tienen precio_unitario guardado: usamos el precio del plato
        const precioCobrado = item.precio_unitario ?? precioLista;
        return {
            id: item.id_plato,
            nombre: item.plato?.nombre,
            tipo: item.plato?.tipo,
            precio: precioCobrado,
            precio_lista: precioLista,
            cantidad: item.cantidad,
            ...(item.bebida ? { bebida: item.bebida } : {}),
        };
    });
    const total = platos.reduce((acc, p) => acc + (p.precio ?? 0) * p.cantidad, 0);
    const subtotal = platos.reduce((acc, p) => acc + (p.precio_lista ?? p.precio ?? 0) * p.cantidad, 0);
    const u = pedido.usuario;
    return {
        id: pedido.id,
        id_usuario: pedido.id_usuario,
        cliente: u ? { nombre: `${u.nombre} ${u.apellido}`, email: u.email } : null,
        fecha: pedido.fecha,
        creado_en: pedido.creado_en,
        estado: pedido.estado,
        direccion: pedido.direccion,
        comentario: pedido.comentario,
        promocion: pedido.promocion,
        descuento: pedido.descuento,
        motivo_cancelacion: pedido.motivo_cancelacion,
        platos,
        subtotal,
        total,
    };
};

// Fecha actual (hora local del servidor) en formato YYYY-MM-DD
const fechaHoy = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const getPedidos = async () => {
    const pedidos = await Pedido.findAll({ include: INCLUDE_ITEMS, order: ORDEN });
    return pedidos.map(formatearPedido);
};

export const getPedidosByUsuario = async (idUsuario) => {
    const pedidos = await Pedido.findAll({
        where: { id_usuario: idUsuario },
        include: INCLUDE_ITEMS,
        order: ORDEN,
    });
    return pedidos.map(formatearPedido);
};

export const getPedidoById = async (id) => {
    const pedido = await Pedido.findByPk(id, { include: INCLUDE_ITEMS, order: ORDEN });
    if (!pedido) throw new HttpError(404, `No existe un pedido con id ${id}`);
    return formatearPedido(pedido);
};

// platos: [{ id, cantidad, bebida }], entrega: { direccion, comentario } (ya validados en el controller)
export const createPedido = async (idUsuario, platos, { direccion, comentario }) => {
    const usuario = await Usuario.findByPk(idUsuario);
    if (!usuario) throw new HttpError(404, `No existe un usuario con id ${idUsuario}`);

    const ids = [...new Set(platos.map((p) => p.id))];
    const existentes = await Plato.findAll({
        where: { id: ids },
        attributes: ["id", "tipo", "nombre", "precio", "disponible"],
    });
    const platosPorId = new Map(existentes.map((p) => [p.id, p]));
    const inexistentes = ids.filter((id) => !platosPorId.has(id));
    if (inexistentes.length > 0) {
        throw new HttpError(404, `No existen platos con id: ${inexistentes.join(", ")}`);
    }

    for (const p of platos) {
        const plato = platosPorId.get(p.id);
        if (!plato.disponible) {
            throw new HttpError(409, `"${plato.nombre}" está agotado en este momento. Sacalo del pedido para continuar.`);
        }
        // Los combos exigen bebida; los postres no llevan
        if (plato.tipo === "combo" && !p.bebida) {
            throw new HttpError(400, `El combo "${plato.nombre}" requiere elegir una bebida`);
        }
        if (plato.tipo !== "combo" && p.bebida) {
            throw new HttpError(400, `"${plato.nombre}" no es un combo y no lleva bebida`);
        }
    }

    // Si el mismo plato (con la misma bebida) viene repetido, sumamos las cantidades
    const renglones = new Map();
    for (const { id, cantidad, bebida } of platos) {
        const clave = `${id}|${bebida ?? ""}`;
        const r = renglones.get(clave);
        if (r) r.cantidad += cantidad;
        else renglones.set(clave, { id, cantidad, bebida: bebida ?? null });
    }

    // El precio lo calcula siempre el back, con la promoción vigente en este momento
    const promo = await getPromocion();

    // Pedido + renglones en una transacción: o se guarda todo o nada
    const pedido = await sequelize.transaction(async (transaction) => {
        const nuevo = await Pedido.create(
            {
                id_usuario: idUsuario,
                fecha: fechaHoy(),
                creado_en: new Date(),
                estado: "pendiente",
                direccion,
                comentario,
                promocion: promo.nombre,
                descuento: promo.descuento,
            },
            { transaction }
        );
        await PlatoXPedido.bulkCreate(
            [...renglones.values()].map(({ id, cantidad, bebida }) => ({
                id_pedido: nuevo.id,
                id_plato: id,
                cantidad,
                bebida,
                precio_unitario: aplicarDescuento(platosPorId.get(id).precio, promo.descuento),
            })),
            { transaction }
        );
        return nuevo;
    });

    return getPedidoById(pedido.id);
};

// Estado nuevo -> estado en el que tiene que estar el pedido para poder pasar a él
const ESTADO_PREVIO = {
    aceptado: "pendiente",
    "en camino": "aceptado",
    entregado: "en camino",
};

// Mensaje que recibe el cliente en cada cambio de estado
const AVISO_ESTADO = {
    aceptado: { tipo: "info", texto: (id) => `Tu pedido #${id} fue aceptado y ya lo estamos preparando 🍔` },
    "en camino": { tipo: "info", texto: (id) => `Tu pedido #${id} está en camino 🛵` },
    entregado: { tipo: "exito", texto: (id) => `Tu pedido #${id} fue entregado. ¡Que lo disfrutes! 💙❤️` },
};

const buscarPedido = async (id, transaction) => {
    const pedido = await Pedido.findByPk(id, { transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
    if (!pedido) throw new HttpError(404, `No existe un pedido con id ${id}`);
    return pedido;
};

export const cambiarEstado = async (id, estadoNuevo) => {
    await sequelize.transaction(async (transaction) => {
        const pedido = await buscarPedido(id, transaction);

        if (pedido.estado === "cancelado") {
            throw new HttpError(409, `El pedido #${id} está cancelado y no puede avanzar`);
        }
        const previo = ESTADO_PREVIO[estadoNuevo];
        if (pedido.estado !== previo) {
            throw new HttpError(
                409,
                `El pedido está "${pedido.estado}". Solo un pedido "${previo}" puede pasar a "${estadoNuevo}"`
            );
        }

        await pedido.update({ estado: estadoNuevo }, { transaction });
        const aviso = AVISO_ESTADO[estadoNuevo];
        await crearNotificacion(
            { id_usuario: pedido.id_usuario, id_pedido: pedido.id, tipo: aviso.tipo, mensaje: aviso.texto(id) },
            { transaction }
        );
    });
    return getPedidoById(id);
};

// Se puede cancelar en cualquier etapa menos cuando ya fue entregado
export const cancelarPedido = async (id, motivo) => {
    await sequelize.transaction(async (transaction) => {
        const pedido = await buscarPedido(id, transaction);

        if (pedido.estado === "entregado") {
            throw new HttpError(409, `El pedido #${id} ya fue entregado y no se puede cancelar`);
        }
        if (pedido.estado === "cancelado") {
            throw new HttpError(409, `El pedido #${id} ya estaba cancelado`);
        }

        await pedido.update({ estado: "cancelado", motivo_cancelacion: motivo }, { transaction });
        await crearNotificacion(
            {
                id_usuario: pedido.id_usuario,
                id_pedido: pedido.id,
                tipo: "alerta",
                mensaje: `Tu pedido #${id} fue cancelado por el local.${motivo ? ` Motivo: ${motivo}` : ""}`,
            },
            { transaction }
        );
    });
    return getPedidoById(id);
};

export const deletePedido = async (id) => {
    const pedido = await buscarPedido(id);

    await sequelize.transaction(async (transaction) => {
        await Notificacion.destroy({ where: { id_pedido: id }, transaction });
        await PlatoXPedido.destroy({ where: { id_pedido: id }, transaction });
        await pedido.destroy({ transaction });
    });
};
