import { Plato, PlatoXPedido } from "../db.js";
import { HttpError } from "../utils/HttpError.js";
import { getPromocion, aplicarDescuento } from "./promocion.service.js";

// Agrega al plato el precio con la promoción vigente:
// precio = precio de lista (el que carga el admin), precio_final = lo que paga el cliente
const conPromocion = (plato, promo) => {
    const datos = plato.toJSON();
    return {
        ...datos,
        descuento: promo.descuento,
        precio_final: aplicarDescuento(datos.precio, promo.descuento),
    };
};

const listar = async (where = {}) => {
    const [platos, promo] = await Promise.all([
        Plato.findAll({ where, order: [["tipo", "ASC"], ["id", "ASC"]] }),
        getPromocion(),
    ]);
    return platos.map((p) => conPromocion(p, promo));
};

const buscar = async (id) => {
    const plato = await Plato.findByPk(id);
    if (!plato) throw new HttpError(404, `No existe un plato con id ${id}`);
    return plato;
};

export const getPlatos = () => listar();

export const getPlatosByTipo = (tipo) => listar({ tipo });

export const getPlatoById = async (id) => conPromocion(await buscar(id), await getPromocion());

export const createPlato = async (datos) => conPromocion(await Plato.create(datos), await getPromocion());

export const updatePlato = async (id, datos) => {
    const plato = await buscar(id);
    await plato.update(datos);
    return conPromocion(plato, await getPromocion());
};

export const deletePlato = async (id) => {
    const plato = await buscar(id);
    const enPedidos = await PlatoXPedido.count({ where: { id_plato: id } });
    if (enPedidos > 0) {
        throw new HttpError(
            409,
            `No se puede eliminar "${plato.nombre}" porque forma parte de pedidos. Marcalo como agotado para sacarlo de la venta.`
        );
    }
    await plato.destroy();
};
