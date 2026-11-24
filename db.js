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

export const TIPOS_PLATO = ["combo", "postre"];
// Flujo normal del pedido. "cancelado" queda fuera del flujo: se llega desde cualquier estado menos "entregado".
export const ESTADOS_FLUJO = ["pendiente", "aceptado", "en camino", "entregado"];
export const ESTADOS_PEDIDO = [...ESTADOS_FLUJO, "cancelado"];
export const BEBIDAS_COMBO = ["Agua", "Pepsi", "Mirinda", "Seven Up"];

// Promociones que puede activar el admin (una sola a la vez)
export const PROMOCIONES = {
    dia_partido: { nombre: "Día de partido", descuento: 20 },
    gano_ciclon: { nombre: "¡Ganó el Ciclón!", descuento: 50 },
};

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
    // Foto del plato: data URL (subida por el admin) o URL http(s). null = sin foto
    imagen: { type: DataTypes.TEXT, allowNull: true },
    // false = agotado / sin stock: se muestra en el menú pero no se puede pedir
    disponible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
    creado_en: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
    estado: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: "pendiente",
        validate: { isIn: [ESTADOS_PEDIDO] },
    },
    direccion: { type: DataTypes.STRING(200), allowNull: true },
    comentario: { type: DataTypes.STRING(200), allowNull: true },
    // Promoción vigente al momento de hacer el pedido (queda registrada aunque después se desactive)
    promocion: { type: DataTypes.STRING(50), allowNull: true },
    descuento: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    motivo_cancelacion: { type: DataTypes.STRING(200), allowNull: true },
});

export const PlatoXPedido = sequelize.define("platosxpedidos", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    cantidad: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
    // Solo para platos de tipo "combo": la bebida que eligió el cliente
    bebida: {
        type: DataTypes.STRING(20),
        allowNull: true,
        validate: { isIn: [BEBIDAS_COMBO] },
    },
    // Precio cobrado por unidad (con descuento). Así el pedido no cambia si después cambia el precio del plato.
    precio_unitario: { type: DataTypes.INTEGER, allowNull: true },
});

export const Notificacion = sequelize.define("notificaciones", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    mensaje: { type: DataTypes.STRING(300), allowNull: false },
    tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "info" }, // info | exito | alerta
    leida: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    creado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
});

// Una sola fila (id = 1) con la configuración del local
export const Configuracion = sequelize.define("configuracion", {
    id: { type: DataTypes.INTEGER, primaryKey: true },
    promocion: {
        type: DataTypes.STRING(30),
        allowNull: true,
        validate: { isIn: [Object.keys(PROMOCIONES)] },
    },
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

// Notificaciones para el cliente (cambios de estado, cancelaciones)
Usuario.hasMany(Notificacion, {
    foreignKey: { name: "id_usuario", allowNull: false },
    onDelete: "CASCADE",
});
Pedido.hasMany(Notificacion, {
    foreignKey: { name: "id_pedido", allowNull: true },
    onDelete: "CASCADE",
});

/* ======================= SYNC ======================= */

// sync() crea las tablas que faltan, pero no agrega columnas a tablas que ya existen.
// Para bases creadas con versiones anteriores, agregamos a mano las columnas nuevas.
const COLUMNAS_NUEVAS = {
    platos: {
        imagen: { type: DataTypes.TEXT, allowNull: true },
        disponible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    pedidos: {
        creado_en: { type: DataTypes.DATE, allowNull: true },
        direccion: { type: DataTypes.STRING(200), allowNull: true },
        comentario: { type: DataTypes.STRING(200), allowNull: true },
        promocion: { type: DataTypes.STRING(50), allowNull: true },
        descuento: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        motivo_cancelacion: { type: DataTypes.STRING(200), allowNull: true },
    },
    platosxpedidos: {
        bebida: { type: DataTypes.STRING(20), allowNull: true },
        precio_unitario: { type: DataTypes.INTEGER, allowNull: true },
    },
};

const migrar = async () => {
    const qi = sequelize.getQueryInterface();
    for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
        const existentes = await qi.describeTable(tabla);
        for (const [columna, definicion] of Object.entries(columnas)) {
            if (!existentes[columna]) {
                await qi.addColumn(tabla, columna, definicion);
                console.log(`Columna "${columna}" agregada a ${tabla}`);
            }
        }
    }

    // El menú ahora tiene solo combos y postres: los platos "principal" pasan a ser combos
    const [, cambiados] = await sequelize.query("UPDATE platos SET tipo = 'combo' WHERE tipo = 'principal'");
    if (cambiados?.rowCount) console.log(`${cambiados.rowCount} plato(s) "principal" pasados a "combo"`);

    await Configuracion.findOrCreate({ where: { id: 1 }, defaults: { id: 1, promocion: null } });
};

export const conectarDB = async () => {
    await sequelize.authenticate();
    await sequelize.sync(); // crea las tablas que no existan
    await migrar();
    console.log("Conectado a la base de datos y tablas sincronizadas");
};
