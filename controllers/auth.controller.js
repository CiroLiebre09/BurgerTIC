import * as authService from "../services/auth.service.js";
import { HttpError } from "../utils/HttpError.js";
import { validarString, validarBody, camposFaltantes } from "../utils/validaciones.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validarEmail = (email) => {
    const limpio = validarString(email, "email", 256).toLowerCase();
    if (!EMAIL_REGEX.test(limpio)) throw new HttpError(400, "El email no tiene un formato válido");
    return limpio;
};

const validarPassword = (password) => {
    if (typeof password !== "string" || password.length < 6) {
        throw new HttpError(400, "La contraseña debe ser un texto de al menos 6 caracteres");
    }
    if (password.length > 72) {
        throw new HttpError(400, "La contraseña no puede superar los 72 caracteres");
    }
    return password;
};

export const register = async (req, res) => {
    const body = validarBody(req.body);
    const faltantes = camposFaltantes(body, ["nombre", "apellido", "email", "password"]);
    if (faltantes.length > 0) {
        throw new HttpError(400, `Faltan campos obligatorios: ${faltantes.join(", ")}`);
    }

    // El campo admin se ignora aunque venga en el body
    const usuario = await authService.register({
        nombre: validarString(body.nombre, "nombre", 50),
        apellido: validarString(body.apellido, "apellido", 50),
        email: validarEmail(body.email),
        password: validarPassword(body.password),
    });

    res.status(201).json({ message: "Usuario registrado correctamente", usuario });
};

export const login = async (req, res) => {
    const body = validarBody(req.body);
    const faltantes = camposFaltantes(body, ["email", "password"]);
    if (faltantes.length > 0) {
        throw new HttpError(400, `Faltan campos obligatorios: ${faltantes.join(", ")}`);
    }
    if (typeof body.email !== "string" || typeof body.password !== "string") {
        throw new HttpError(400, "El email y la contraseña deben ser texto");
    }

    const { token, usuario } = await authService.login({
        email: body.email.trim().toLowerCase(),
        password: body.password,
    });

    res.status(200).json({ message: "Login exitoso", token, usuario });
};
