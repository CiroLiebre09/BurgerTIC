import * as pedidosService from "../services/pedidos.service.js";
import { HttpError } from "../utils/HttpError.js";
import { parseId, validarBody, esEnteroPositivo } from "../utils/validaciones.js";

const validarPlatosPedido = (body) => {
    validarBody(body);
    const { platos } = body;

    if (platos === undefined) throw new HttpError(400, 'Falta el campo obligatorio "platos"');
    if (!Array.isArray(platos) || platos.length === 0) {
        throw new HttpError(400, 'El campo "platos" debe ser un array con al menos un plato');
    }

    platos.forEach((p, i) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) {
            throw new HttpError(400, `platos[${i}] debe ser un objeto con los campos id y cantidad`);
        }
        if (p.id === undefined || p.cantidad === undefined) {
            throw new HttpError(400, `platos[${i}] debe tener los campos id y cantidad`);
        }
        if (!esEnteroPositivo(p.id)) {
            throw new HttpError(400, `platos[${i}].id debe ser un número entero positivo`);
        }
        if (!esEnteroPositivo(p.cantidad)) {
            throw new HttpError(400, `platos[${i}].cantidad debe ser un número entero mayor a 0`);
        }
    });

    return platos.map(({ id, cantidad }) => ({ id, cantidad }));
};

export const getPedidos = async (req, res) => {
    const pedidos = await pedidosService.getPedidos();
    res.status(200).json(pedidos);
};

export const getPedidosUsuario = async (req, res) => {
    const pedidos = await pedidosService.getPedidosByUsuario(req.usuario.id);
    res.status(200).json(pedidos);
};

export const getPedidoById = async (req, res) => {
    const id = parseId(req.params.id);
    const pedido = await pedidosService.getPedidoById(id);
    res.status(200).json(pedido);
};

export const createPedido = async (req, res) => {
    const platos = validarPlatosPedido(req.body);
    // El id del usuario sale SIEMPRE del token, nunca del body
    const pedido = await pedidosService.createPedido(req.usuario.id, platos);
    res.status(201).json(pedido);
};

const cambiarEstado = (estado) => async (req, res) => {
    const id = parseId(req.params.id);
    const pedido = await pedidosService.cambiarEstado(id, estado);
    res.status(200).json({ message: `Pedido ${id} actualizado a "${estado}"`, pedido });
};

export const aceptarPedido = cambiarEstado("aceptado");
export const comenzarPedido = cambiarEstado("en camino");
export const entregarPedido = cambiarEstado("entregado");

export const deletePedido = async (req, res) => {
    const id = parseId(req.params.id);
    await pedidosService.deletePedido(id);
    res.status(200).json({ message: `Pedido con id ${id} eliminado correctamente` });
};
