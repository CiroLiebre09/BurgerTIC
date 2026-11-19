import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Usuario } from "../db.js";
import { HttpError } from "../utils/HttpError.js";

const sinPassword = (usuario) => {
    const { password, ...resto } = usuario.toJSON();
    return resto;
};

export const getUsuarioById = (id) =>
    Usuario.findByPk(id, { attributes: { exclude: ["password"] } });

export const register = async ({ nombre, apellido, email, password }) => {
    const existente = await Usuario.findOne({ where: { email } });
    if (existente) {
        throw new HttpError(409, `Ya existe un usuario registrado con el email ${email}`);
    }

    const hash = await bcrypt.hash(password, 10);
    const usuario = await Usuario.create({
        nombre,
        apellido,
        email,
        password: hash,
        admin: false, // nunca se crea un admin desde la API
    });
    return sinPassword(usuario);
};

export const login = async ({ email, password }) => {
    const usuario = await Usuario.findOne({ where: { email } });
    // Mismo mensaje para email inexistente y password incorrecta (no revelamos cuál falló)
    if (!usuario || !(await bcrypt.compare(password, usuario.password))) {
        throw new HttpError(401, "Email o contraseña incorrectos");
    }

    const token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET, { expiresIn: "30m" });
    return { token, usuario: sinPassword(usuario) };
};
