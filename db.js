import "dotenv/config";
import { Sequelize, DataTypes } from "sequelize";

if (!process.env.DATABASE_URL) {
    throw new Error("Falta la variable DATABASE_URL en el archivo .env");
}

// Neon exige SSL. Quitamos los parámetros de la URL (?sslmode=...&channel_binding=...)
// y configuramos el SSL a mano para que el driver pg no se queje.
const connectionString = process.env.DATABASE_URL.split("?")[0];

export const sequelize = new Sequelize(connectionString, {
    dialect: "postgres",
    dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false },
    },
    logging: false,
    define: {
        timestamps: false, // las tablas no tienen createdAt / updatedAt
        freezeTableName: true, // usar el nombre de tabla tal cual
    },
});

export const TIPOS_PLATO = ["principal", "combo", "postre"];
export const ESTADOS_PEDIDO = ["pendiente", "aceptado", "en camino", "entregado"];

/* ===================== MODELOS ===================== */

export const Plato = sequelize.define("platos", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tipo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [TIPOS_PLATO] },
    },
    nombre: { type: DataTypes.STRING(70), allowNull: false },
    precio: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
    descripcion: { type: DataTypes.STRING(400), allowNull: false },
});

export const Usuario = sequelize.define("usuarios", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(50), allowNull: false },
    apellido: { type: DataTypes.STRING(50), allowNull: false },
    email: { type: DataTypes.STRING(256), allowNull: false, unique: true },
    password: { type: DataTypes.STRING(256), allowNull: false },
    admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
});

export const Pedido = sequelize.define("pedidos", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    estado: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "pendiente",
        validate: { isIn: [ESTADOS_PEDIDO] },
    },
});

export const PlatoXPedido = sequelize.define("platosxpedidos", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cantidad: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
});

/* =================== ASOCIACIONES =================== */
// Las FK (id_usuario, id_pedido, id_plato) las crean las asociaciones.

// Un usuario tiene muchos pedidos
Usuario.hasMany(Pedido, {
    foreignKey: { name: "id_usuario", allowNull: false },
    onDelete: "CASCADE",
});
Pedido.belongsTo(Usuario, { foreignKey: "id_usuario", as: "usuario" });

// Un pedido tiene muchos renglones (plato + cantidad)
Pedido.hasMany(PlatoXPedido, {
    foreignKey: { name: "id_pedido", allowNull: false },
    as: "items",
    onDelete: "CASCADE", // al borrar un pedido se borran sus renglones
});
PlatoXPedido.belongsTo(Pedido, { foreignKey: "id_pedido", as: "pedido" });

// Un plato aparece en muchos renglones de pedidos
Plato.hasMany(PlatoXPedido, {
    foreignKey: { name: "id_plato", allowNull: false },
    onDelete: "RESTRICT", // no se puede borrar un plato que forma parte de pedidos
});
PlatoXPedido.belongsTo(Plato, { foreignKey: "id_plato", as: "plato" });

/* ======================= SYNC ======================= */

export const conectarDB = async () => {
    await sequelize.authenticate();
    await sequelize.sync(); // crea las tablas que no existan
    console.log("Conectado a la base de datos y tablas sincronizadas");
};
