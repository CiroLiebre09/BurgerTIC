import { sequelize, Pedido, PlatoXPedido, Plato, Usuario } from "../db.js";
import { HttpError } from "../utils/HttpError.js";

const INCLUDE_ITEMS = [
    {
        model: PlatoXPedido,
        as: "items",
        include: [{ model: Plato, as: "plato", attributes: ["id", "nombre", "precio"] }],
    },
];

const ORDEN = [
    ["id", "ASC"],
    [{ model: PlatoXPedido, as: "items" }, "id", "ASC"],
];

// Da al pedido el formato del enunciado: { id, id_usuario, fecha, estado, platos: [{ id, cantidad }] }
const formatearPedido = (pedido) => {
    const platos = pedido.items.map((item) => ({
        id: item.id_plato,
        nombre: item.plato?.nombre,
        precio: item.plato?.precio,
        cantidad: item.cantidad,
        ...(item.bebida ? { bebida: item.bebida } : {}),
    }));
    return {
        id: pedido.id,
        id_usuario: pedido.id_usuario,
        fecha: pedido.fecha,
        estado: pedido.estado,
        platos,
        total: platos.reduce((acc, p) => acc + (p.precio ?? 0) * p.cantidad, 0),
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

// platos: [{ id, cantidad, bebida }] ya validado en el controller
export const createPedido = async (idUsuario, platos) => {
    const usuario = await Usuario.findByPk(idUsuario);
    if (!usuario) throw new HttpError(404, `No existe un usuario con id ${idUsuario}`);

    const ids = [...new Set(platos.map((p) => p.id))];
    const existentes = await Plato.findAll({ where: { id: ids }, attributes: ["id", "tipo", "nombre"] });
    const platosPorId = new Map(existentes.map((p) => [p.id, p]));
    const inexistentes = ids.filter((id) => !platosPorId.has(id));
    if (inexistentes.length > 0) {
        throw new HttpError(404, `No existen platos con id: ${inexistentes.join(", ")}`);
    }

    // Los combos exigen bebida; el resto de los platos no lleva
    for (const p of platos) {
        const plato = platosPorId.get(p.id);
        if (plato.tipo === "combo" && !p.bebida) {
            throw new HttpError(400, `El combo "${plato.nombre}" requiere elegir una bebida`);
        }
        if (plato.tipo !== "combo" && p.bebida) {
            throw new HttpError(400, `El plato "${plato.nombre}" no es un combo y no lleva bebida`);
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

    // Pedido + renglones en una transacción: o se guarda todo o nada
    const pedido = await sequelize.transaction(async (transaction) => {
        const nuevo = await Pedido.create(
            { id_usuario: idUsuario, fecha: fechaHoy(), estado: "pendiente" },
            { transaction }
        );
        await PlatoXPedido.bulkCreate(
            [...renglones.values()].map(({ id, cantidad, bebida }) => ({
                id_pedido: nuevo.id,
                id_plato: id,
                cantidad,
                bebida,
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

export const cambiarEstado = async (id, estadoNuevo) => {
    const pedido = await Pedido.findByPk(id);
    if (!pedido) throw new HttpError(404, `No existe un pedido con id ${id}`);

    const previo = ESTADO_PREVIO[estadoNuevo];
    if (pedido.estado !== previo) {
        throw new HttpError(
            409,
            `El pedido está "${pedido.estado}". Solo un pedido "${previo}" puede pasar a "${estadoNuevo}"`
        );
    }

    await pedido.update({ estado: estadoNuevo });
    return getPedidoById(id);
};

export const deletePedido = async (id) => {
    const pedido = await Pedido.findByPk(id);
    if (!pedido) throw new HttpError(404, `No existe un pedido con id ${id}`);

    await sequelize.transaction(async (transaction) => {
        await PlatoXPedido.destroy({ where: { id_pedido: id }, transaction });
        await pedido.destroy({ transaction });
    });
};
