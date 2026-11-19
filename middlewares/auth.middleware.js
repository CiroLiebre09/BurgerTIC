import jwt from "jsonwebtoken";
import { HttpError } from "../utils/HttpError.js";
import { getUsuarioById } from "../services/auth.service.js";

// Requiere un token JWT válido en el header Authorization ("Bearer <token>").
// Deja el usuario autenticado en req.usuario.
export const verificarToken = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) {
        throw new HttpError(401, "No se envió el token de autenticación en el header Authorization");
    }

    const partes = header.trim().split(" ");
    const token = partes.length === 2 && partes[0].toLowerCase() === "bearer" ? partes[1] : partes[0];

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            throw new HttpError(401, "El token expiró, volvé a iniciar sesión");
        }
        throw new HttpError(401, "Token inválido");
    }

    if (!payload || !Number.isInteger(payload.id)) {
        throw new HttpError(401, "Token inválido");
    }

    const usuario = await getUsuarioById(payload.id);
    if (!usuario) {
        throw new HttpError(401, "El usuario del token no existe");
    }

    req.usuario = usuario;
    next();
};

// Debe usarse después de verificarToken
export const verificarAdmin = (req, res, next) => {
    if (!req.usuario?.admin) {
        throw new HttpError(403, "No tenés permisos de administrador para realizar esta acción");
    }
    next();
};
