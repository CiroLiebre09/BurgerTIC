import { Router } from "express";
import * as notificacionesController from "../controllers/notificaciones.controller.js";
import { verificarToken } from "../middlewares/auth.middleware.js";

const router = Router();

// Cada usuario ve solo sus notificaciones (el id sale del token)
router.use(verificarToken);

router.get("/", notificacionesController.getNotificaciones);
router.put("/leer", notificacionesController.marcarLeidas);

export default router;
