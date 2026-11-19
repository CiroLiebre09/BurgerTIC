import { Router } from "express";
import * as platosController from "../controllers/platos.controller.js";
import { verificarToken, verificarAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

// Públicas
router.get("/", platosController.getPlatos);
router.get("/tipo/:tipo", platosController.getPlatosByTipo);
router.get("/:id", platosController.getPlatoById);

// Admin
router.post("/", verificarToken, verificarAdmin, platosController.createPlato);
router.put("/:id", verificarToken, verificarAdmin, platosController.updatePlato);
router.delete("/:id", verificarToken, verificarAdmin, platosController.deletePlato);

export default router;
