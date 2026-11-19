// Error con status code HTTP. Los services y controllers lo lanzan
// y el middleware de errores de index.js lo convierte en { message }.
export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
