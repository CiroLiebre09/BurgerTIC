import * as promocionService from "../services/promocion.service.js";
import { PROMOCIONES } from "../db.js";
import { HttpError } from "../utils/HttpError.js";
import { validarBody } from "../utils/validaciones.js";

export const getPromocion = async (req, res) => {
    res.status(200).json(await promocionService.getPromocion());
};

// body: { promocion: "dia_partido" | "gano_ciclon" | null }
export const setPromocion = async (req, res) => {
    const body = validarBody(req.body);
    if (!("promocion" in body)) throw new HttpError(400, 'Falta el campo "promocion"');

    const clave = body.promocion;
    if (clave !== null && !Object.hasOwn(PROMOCIONES, clave)) {
        throw new HttpError(400, `La promoción debe ser null o una de: ${Object.keys(PROMOCIONES).join(", ")}`);
    }

    const promo = await promocionService.setPromocion(clave);
    const message = promo.promocion
        ? `Promoción "${promo.nombre}" activada: ${promo.descuento}% de descuento en todo el menú`
        : "Promoción desactivada: el menú vuelve a precio normal";
    res.status(200).json({ message, ...promo });
};
