import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conectarDB } from "./db.js";
import { HttpError } from "./utils/HttpError.js";
import platosRoutes from "./routes/platos.routes.js";
import authRoutes from "./routes/auth.routes.js";
import pedidosRoutes from "./routes/pedidos.routes.js";

if (!process.env.JWT_SECRET) {
    throw new Error("Falta la variable JWT_SECRET en el archivo .env");
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Front-end: sirve public/ (index.html, styles.css, app.js) en la raíz.
// Solo responde si el archivo existe, así que no pisa las rutas de la API.
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public")));

app.use("/platos", platosRoutes);
app.use("/auth", authRoutes);
app.use("/pedidos", pedidosRoutes);

// Ruta inexistente
app.use((req, res) => {
    res.status(404).json({ message: `No existe la ruta ${req.method} ${req.originalUrl}` });
});

// Manejo centralizado de errores.
// Express 5 captura automáticamente los errores lanzados en funciones async.
app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ message: err.message });
    }
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ message: "El body no es un JSON válido" });
    }
    if (err.name === "SequelizeValidationError") {
        return res.status(400).json({ message: err.errors.map((e) => e.message).join(", ") });
    }
    if (err.name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({ message: "Ya existe un registro con esos datos" });
    }
    if (err.name === "SequelizeForeignKeyConstraintError") {
        return res.status(409).json({ message: "La operación viola una relación entre tablas" });
    }
    if (err.name?.startsWith("SequelizeConnection")) {
        return res.status(503).json({ message: "No se pudo conectar con la base de datos" });
    }

    console.error(err);
    res.status(500).json({ message: "Error interno del servidor" });
});

try {
    await conectarDB();
    app.listen(PORT, () => console.log(`Servidor escuchando en http://localhost:${PORT}`));
} catch (error) {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exit(1);
}
