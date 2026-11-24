import { Configuracion, PROMOCIONES } from "../db.js";

// Devuelve la promoción activa: { promocion, nombre, descuento } (promocion = null si no hay ninguna)
export const getPromocion = async () => {
    const config = await Configuracion.findByPk(1);
    const clave = config?.promocion ?? null;
    if (!clave || !PROMOCIONES[clave]) return { promocion: null, nombre: null, descuento: 0 };
    return { promocion: clave, ...PROMOCIONES[clave] };
};

// clave: una de PROMOCIONES o null para desactivar (ya validada en el controller)
export const setPromocion = async (clave) => {
    await Configuracion.upsert({ id: 1, promocion: clave });
    return getPromocion();
};

// Precio con descuento, redondeado a pesos enteros
export const aplicarDescuento = (precio, descuento) => Math.round((precio * (100 - descuento)) / 100);
