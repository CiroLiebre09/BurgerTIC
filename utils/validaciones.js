import { HttpError } from "./HttpError.js";

const MAX_INT = 2147483647;

// Valida que un parámetro de ruta sea un id entero positivo
export const parseId = (valor, nombre = "id") => {
    if (!/^\d+$/.test(String(valor))) {
        throw new HttpError(400, `El ${nombre} debe ser un número entero positivo`);
    }
    const id = Number(valor);
    if (id < 1 || id > MAX_INT) {
        throw new HttpError(400, `El ${nombre} debe ser un número entero positivo`);
    }
    return id;
};

export const esEnteroPositivo = (valor) =>
    Number.isInteger(valor) && valor > 0 && valor <= MAX_INT;

// Valida un string obligatorio no vacío con largo máximo. Devuelve el valor sin espacios extremos.
export const validarString = (valor, campo, max) => {
    if (typeof valor !== "string" || valor.trim() === "") {
        throw new HttpError(400, `El campo ${campo} debe ser un texto no vacío`);
    }
    const limpio = valor.trim();
    if (limpio.length > max) {
        throw new HttpError(400, `El campo ${campo} no puede superar los ${max} caracteres`);
    }
    return limpio;
};

// Verifica que el body sea un objeto JSON
export const validarBody = (body) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "El body de la request debe ser un objeto JSON");
    }
    return body;
};

// Devuelve los campos obligatorios que faltan en el body
export const camposFaltantes = (body, campos) =>
    campos.filter((c) => body[c] === undefined || body[c] === null || body[c] === "");
