import * as platosService from "../services/platos.service.js";
import { TIPOS_PLATO } from "../db.js";
import { HttpError } from "../utils/HttpError.js";
import { parseId, validarString, validarBody, camposFaltantes, esEnteroPositivo } from "../utils/validaciones.js";

const OBLIGATORIOS = ["tipo", "nombre", "precio", "descripcion"];
const CAMPOS = [...OBLIGATORIOS, "imagen", "disponible"];

// Foto: data URL de imagen (la sube el admin desde el front, ya achicada) o URL http(s)
const MAX_IMAGEN = 1_500_000; // ~1,1 MB de imagen en base64
const DATA_URL_IMAGEN = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const URL_HTTP = /^https?:\/\/\S+$/;

const validarImagen = (valor) => {
    if (valor === null || valor === "") return null; // quitar la foto
    if (typeof valor !== "string") throw new HttpError(400, "La imagen debe ser un texto (data URL o URL) o null");
    if (valor.length > MAX_IMAGEN) throw new HttpError(400, "La imagen es demasiado grande (máximo ~1 MB)");
    if (!DATA_URL_IMAGEN.test(valor) && !(URL_HTTP.test(valor) && valor.length <= 2000)) {
        throw new HttpError(400, "La imagen debe ser un archivo PNG, JPG, WEBP o GIF, o una URL http(s)");
    }
    return valor;
};

// parcial = true para PUT (se puede mandar solo algunos campos)
const validarPlato = (body, parcial = false) => {
    validarBody(body);

    if (!parcial) {
        const faltantes = camposFaltantes(body, OBLIGATORIOS);
        if (faltantes.length > 0) {
            throw new HttpError(400, `Faltan campos obligatorios: ${faltantes.join(", ")}`);
        }
    }

    const datos = {};
    for (const campo of CAMPOS) {
        if (body[campo] !== undefined) datos[campo] = body[campo];
    }
    if (parcial && Object.keys(datos).length === 0) {
        throw new HttpError(400, `Debe enviar al menos uno de estos campos: ${CAMPOS.join(", ")}`);
    }

    if ("tipo" in datos && !TIPOS_PLATO.includes(datos.tipo)) {
        throw new HttpError(400, `El tipo debe ser uno de: ${TIPOS_PLATO.join(", ")}`);
    }
    if ("nombre" in datos) datos.nombre = validarString(datos.nombre, "nombre", 70);
    if ("descripcion" in datos) datos.descripcion = validarString(datos.descripcion, "descripcion", 400);
    if ("precio" in datos && !esEnteroPositivo(datos.precio)) {
        throw new HttpError(400, "El precio debe ser un número entero mayor a 0");
    }
    if ("imagen" in datos) datos.imagen = validarImagen(datos.imagen);
    if ("disponible" in datos && typeof datos.disponible !== "boolean") {
        throw new HttpError(400, "El campo disponible debe ser true o false");
    }

    return datos;
};

export const getPlatos = async (req, res) => {
    const platos = await platosService.getPlatos();
    res.status(200).json(platos);
};

export const getPlatoById = async (req, res) => {
    const id = parseId(req.params.id);
    const plato = await platosService.getPlatoById(id);
    res.status(200).json(plato);
};

export const getPlatosByTipo = async (req, res) => {
    const tipo = req.params.tipo.toLowerCase();
    if (!TIPOS_PLATO.includes(tipo)) {
        throw new HttpError(400, `Tipo inválido. Debe ser uno de: ${TIPOS_PLATO.join(", ")}`);
    }
    const platos = await platosService.getPlatosByTipo(tipo);
    res.status(200).json(platos);
};

export const createPlato = async (req, res) => {
    const datos = validarPlato(req.body);
    const plato = await platosService.createPlato(datos);
    res.status(201).json(plato);
};

export const updatePlato = async (req, res) => {
    const id = parseId(req.params.id);
    const datos = validarPlato(req.body, true);
    const plato = await platosService.updatePlato(id, datos);
    res.status(200).json(plato);
};

export const deletePlato = async (req, res) => {
    const id = parseId(req.params.id);
    await platosService.deletePlato(id);
    res.status(200).json({ message: `Plato con id ${id} eliminado correctamente` });
};
