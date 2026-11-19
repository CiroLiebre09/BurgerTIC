import { Plato, PlatoXPedido } from "../db.js";
import { HttpError } from "../utils/HttpError.js";

export const getPlatos = () => Plato.findAll({ order: [["id", "ASC"]] });

export const getPlatoById = async (id) => {
    const plato = await Plato.findByPk(id);
    if (!plato) throw new HttpError(404, `No existe un plato con id ${id}`);
    return plato;
};

export const getPlatosByTipo = (tipo) =>
    Plato.findAll({ where: { tipo }, order: [["id", "ASC"]] });

export const createPlato = (datos) => Plato.create(datos);

export const updatePlato = async (id, datos) => {
    const plato = await getPlatoById(id);
    await plato.update(datos);
    return plato;
};

export const deletePlato = async (id) => {
    const plato = await getPlatoById(id);
    const enPedidos = await PlatoXPedido.count({ where: { id_plato: id } });
    if (enPedidos > 0) {
        throw new HttpError(409, `No se puede eliminar el plato con id ${id} porque forma parte de uno o más pedidos`);
    }
    await plato.destroy();
};
