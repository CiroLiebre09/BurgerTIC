import { Router } from "express";
import * as promocionController from "../controllers/promocion.controller.js";
import { verificarToken, verificarAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

// Pública: el menú la usa para mostrar el banner y los precios con descuento
router.get("/", promocionController.getPromocion);

// Admin: activar "dia_partido" / "gano_ciclon" o desactivar (null)
router.put("/", verificarToken, verificarAdmin, promocionController.setPromocion);

export default router;
