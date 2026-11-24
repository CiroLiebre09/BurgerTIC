import * as notificacionesService from "../services/notificaciones.service.js";

// GET /notificaciones -> { no_leidas, notificaciones: [...] } del usuario del token
export const getNotificaciones = async (req, res) => {
    res.status(200).json(await notificacionesService.getNotificaciones(req.usuario.id));
};

// PUT /notificaciones/leer -> marca todas como leídas
export const marcarLeidas = async (req, res) => {
    const cantidad = await notificacionesService.marcarLeidas(req.usuario.id);
    res.status(200).json({ message: `${cantidad} notificación(es) marcadas como leídas` });
};
