import { Router } from "express";
import * as pedidosController from "../controllers/pedidos.controller.js";
import { verificarToken, verificarAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

// Todas las rutas de pedidos requieren estar autenticado
router.use(verificarToken);

// Usuario autenticado (/usuario va antes de /:id para que no lo tome como id)
router.get("/usuario", pedidosController.getPedidosUsuario);
router.post("/", pedidosController.createPedido);

// Admin
router.get("/", verificarAdmin, pedidosController.getPedidos);
router.get("/:id", verificarAdmin, pedidosController.getPedidoById);
router.put("/:id/aceptar", verificarAdmin, pedidosController.aceptarPedido);
router.put("/:id/comenzar", verificarAdmin, pedidosController.comenzarPedido);
router.put("/:id/entregar", verificarAdmin, pedidosController.entregarPedido);
router.delete("/:id", verificarAdmin, pedidosController.deletePedido);

export default router;
