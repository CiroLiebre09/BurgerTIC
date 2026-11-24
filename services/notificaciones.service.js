import { Notificacion } from "../db.js";

export const crearNotificacion = (datos, options = {}) => Notificacion.create(datos, options);

// Últimas 30 notificaciones del usuario + cantidad sin leer
export const getNotificaciones = async (idUsuario) => {
    const notificaciones = await Notificacion.findAll({
        where: { id_usuario: idUsuario },
        order: [["id", "DESC"]],
        limit: 30,
    });
    const noLeidas = await Notificacion.count({ where: { id_usuario: idUsuario, leida: false } });
    return { no_leidas: noLeidas, notificaciones };
};

export const marcarLeidas = async (idUsuario) => {
    const [cantidad] = await Notificacion.update(
        { leida: true },
        { where: { id_usuario: idUsuario, leida: false } }
    );
    return cantidad;
};
