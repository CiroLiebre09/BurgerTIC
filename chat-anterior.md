# Conversación anterior con Claude — proyecto BurgerTIC

## 🧑 Vos

realiza una REST API para un restaurant de comida rápida BurgerTIC. Utilizaremos node js con express , postgres, sequelize, jwt y bcryptjs.
La arquitectura del back-end tiene que dividirse en Routes, services, controllers, index.js, db.js, .env y package.json
Yo crearé el neon, dime como hacerlo dependiendo de como lo hagas vos así lo conecto.
 En este trabajo se tendrá en cuenta, además, que los status codes sean los adecuados para cada respuesta posible y que se haga error handling, es decir, la API debe ser robusta y cubrir los casos donde la request sea incorrecta (ej.: pedimos un plato con un id que no existe, queremos crear un plato y mandamos menos campos de los necesarios, etc).
La base de datos de BurgerTIC cuenta con las siguientes tablas:
platos:

<pasted_content id="60d5">
Nombre	Tipo	Extra
id	int	PK, AI
tipo	varchar(20)	("principal", "combo", "postre")
nombre	varchar(70)	
precio	int	
descripcion	varchar(400)
</pasted_content id="60d5">

Usuarios:

<pasted_content id="60d5">
Nombre	Tipo	Extra
id	int	PK, AI
nombre	varchar(50)	
apellido	varchar(50)	
email	varchar(256)	
password	varchar(256)	
admin	boolean
</pasted_content id="60d5">

	
Pedidos:

<pasted_content id="60d5">
Nombre	Tipo	Extra
id	int	PK, AI
id_usuario	int	FK
fecha	date	
estado	varchar(50)	("pendiente", "aceptado", "en camino", "entregado")
</pasted_content id="60d5">

PlatosXPedidos:

<pasted_content id="60d5">
Nombre	Tipo	Extra
id	int	PK, AI
id_pedido	int	FK
id_plato	int	FK
cantidad	int
</pasted_content id="60d5">

	
Se deben realizar las asociaciones y el sync
La API a realizar consistirá de 3 partes:
Platos
Usuarios/Autenticación
Pedidos
A continuación, cada una con su método, ruta, acción y nivel de acceso
API - Platos

<pasted_content id="60d5">
GET	/platos	Devuelve la lista de todos los platos	Público
GET	/platos/:id	Devuelve la información del plato con el id especificado	Público
GET	/platos/tipo/:tipo	Devuelve la información de los platos con el tipo especificado	Público
POST	/platos	Crea un nuevo plato	Admin
PUT	/platos/:id	Modifica la información del plato con el id especificado	Admin
DELETE	/platos/:id	Elimina el plato con el id especificado	Admin
</pasted_content id="60d5">

ejemplo de plato:

<pasted_content id="60d5">
{
    "id": 1,
    "tipo": "principal",
    "nombre": "Hamburguesa",
    "precio": 300,
    "descripcion": "Hamburguesa de carne con lechuga, tomate y queso"
}
</pasted_content id="60d5">

API - Usuarios/Autenticación
POST	/auth/register	Crea un nuevo usuario	Público
POST	/auth/login	Autentica un usuario	Público
ejemplo de usuario:

<pasted_content id="60d5">
{
    "id": 1,
    "nombre": "Juan",
    "apellido": "Pérez",
    "email": "juanperez@gmail.com",
    "password": "123456"
}
</pasted_content id="60d5">

<pasted_content id="60d5">
Obs. 1: El campo email debe ser único. Si se intenta crear un usuario con un email que ya existe, se debe devolver un error.

Obs. 2: El campo password debe ser hasheado antes de ser almacenado en la base de datos. Para esto, se debe utilizar bcrypt. Al autenticar un usuario, se debe comparar el password enviado con el password hasheado almacenado en la base de datos. Si no coinciden, se debe devolver un error.

Obs. 3: Al autenticar un usuario, se debe devolver un token jwt de autenticación. Este token debe ser enviado en el header Authorization de las rutas protegidas. El token debe tener una duración de 30 minutos. Si el token expira, se debe devolver un error 401. El formato del payload token será: { id: <id_del_usuario> }.

Obs. 4: La ruta /register no debe estar protegida por autenticación. La ruta /login tampoco, obviamente.

Obs. 5: Al crear un usuario, su campo admin debe ser false. La única forma de crear un usuario admin es desde la propia base de datos.
</pasted_content id="60d5">

API - Pedidos

<pasted_content id="60d5">
GET	/pedidos	Devuelve la lista de todos los pedidos	Admin
GET	/pedidos/usuario	Devuelve la información de los pedidos del usuario que realiza la request	Usuario autenticado
GET	/pedidos/:id	Devuelve la información del pedido con el id especificado	Admin
POST	/pedidos	Crea un nuevo pedido	Usuario autenticado
PUT	/pedidos/:id/aceptar	Modifica la información del pedido con el id especificado, cambiando su estado a "aceptado"	Admin
PUT	/pedidos/:id/comenzar	Modifica la información del pedido con el id especificado, cambiando su estado a "en camino"	Admin
PUT	/pedidos/:id/entregar	Modifica la información del pedido con el id especificado, cambiando su estado a "entregado"	Admin
DELETE	/pedidos/:id	Elimina el pedido con el id especificado	Admin
</pasted_content id="60d5">

ejemplo de pedido:

<pasted_content id="60d5">
{
    "id": 1,
    "id_usuario": 1,
    "fecha": "2021-10-15",
    "estado": "pendiente",
    "platos": [
        {
            "id": 1,
            "cantidad": 2
        },
        {
            "id": 2,
            "cantidad": 1
        }
    ]
}
</pasted_content id="60d5">

<pasted_content id="60d5">
Obs. 1: El campo id_usuario debe ser el id de un usuario existente. Si se intenta crear un pedido con un id de usuario que no existe, se debe devolver un error. Además, éste debe ser el id del usuario autenticado, es decir, un usuario no puede crear un pedido para otro usuario. Para esto, se debe utilizar el id que se envía en el payload del token jwt.

Obs. 2: Al crear un pedido, la fecha y el estado no se envían en el body. La fecha debe ser la fecha actual y el estado debe ser "pendiente". El body consistirá únicamente de un objeto que por dentro tendrá un atributo "platos", que será un array de objetos con los campos id y cantidad de los platos que se quieren pedir.

Obs. 3: La acción de eliminar un pedido y las acciones para modificar su estado solo pueden ser realizadas por un usuario autenticado y con el rol de admin.
</pasted_content id="60d5">

Mensajes de éxito y error
Los mensajes de éxito y error NO deben ser enviados como texto mediante res.send(). Deben ser enviados como objetos JSON con la siguiente estructura:
{
    "message": "Mensaje de éxito o error"
}
Utilizar el status code adecuado para cada caso.

> 🔧 _PowerShell_: Check Node/npm versions and target folder

## 🤖 Claude

Node 22 está disponible. Creo el proyecto en `C:\Users\49671693\BurgerTIC`.

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\package.json

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\.env

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\.gitignore

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\db.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\utils\HttpError.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\utils\validaciones.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\middlewares\auth.middleware.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\services\platos.service.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\services\auth.service.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\services\pedidos.service.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\controllers\platos.controller.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\controllers\auth.controller.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\controllers\pedidos.controller.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\routes\platos.routes.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\routes\auth.routes.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\routes\pedidos.routes.js

> 🔧 _Write_: C:\Users\49671693\BurgerTIC\index.js

## 🤖 Claude

Ahora instalo dependencias y verifico que todos los módulos carguen y las asociaciones se definan bien (sin conectar a la base todavía).

> 🔧 _PowerShell_: Install dependencies and test module loading

## 🤖 Claude

Armé el proyecto en `C:\Users\49671693\BurgerTIC`. Las dependencias se instalaron, todos los módulos cargan y Sequelize registra los 4 modelos con sus claves foráneas. Lo que todavía no probé son los endpoints contra una base real, porque falta tu Neon.

## Cómo crear y conectar Neon

1. En **neon.tech** creá un proyecto. Postgres en cualquier versión y la región más cercana, por ejemplo AWS São Paulo. Se puede usar la base que viene por defecto, `neondb`.
2. En el Dashboard tocá **Connect** y copiá el **connection string**. Es una URL del tipo `postgresql://usuario:password@ep-xxx.neon.tech/neondb?sslmode=require...`.
3. Abrí [.env](.env) y pegala en `DATABASE_URL` entre comillas. Cambiá también `JWT_SECRET` por un texto largo cualquiera.
4. **No crees las tablas a mano.** Al arrancar, `sequelize.sync()` crea `platos`, `usuarios`, `pedidos` y `platosxpedidos` con sus claves foráneas. Los parámetros `?sslmode=...` de la URL no molestan: el código los quita y configura el SSL por su cuenta.
5. Para arrancar: `npm start`, o `npm run dev` si querés que se reinicie al guardar. En PowerShell usá `npm.cmd start`, porque tu sistema bloquea `npm.ps1`.
6. Para tener un admin, registrá un usuario por `/auth/register` y después corré esto en el **SQL Editor** de Neon:
   ```sql
   UPDATE usuarios SET admin = true WHERE email = 'tu@email.com';
   ```

## Estructura

```
index.js            app, rutas, 404 y manejo central de errores
db.js               conexión, modelos, asociaciones y sync
routes/             platos, auth, pedidos
controllers/        validan la request y arman la respuesta
services/           lógica y acceso a la base
middlewares/        auth.middleware.js (verificarToken, verificarAdmin)
utils/              HttpError y validaciones
```

Agregué `middlewares/` y `utils/` además de las carpetas que pediste, para no repetir el chequeo del token y las validaciones en cada controller. Los modelos están dentro de [db.js](db.js), así la estructura se mantiene como la pediste.

## Status codes y casos cubiertos

Todas las respuestas son JSON. Los mensajes van con la forma `{ "message": "..." }`.

| Caso | Código |
|---|---|
| GET ok, PUT ok, DELETE ok, login ok | 200 |
| Plato, usuario o pedido creado | 201 |
| Faltan campos, tipos inválidos, id no numérico, JSON mal formado, `tipo` inválido, precio no entero o menor o igual a 0 | 400 |
| Sin token, token inválido o vencido (30 min), login incorrecto | 401 |
| Un usuario que no es admin entra a una ruta de admin | 403 |
| Plato o pedido inexistente, o un pedido con platos que no existen, ruta inexistente | 404 |
| Email repetido, cambio de estado inválido (ej.: entregar un pedido "pendiente"), borrar un plato que está en pedidos | 409 |
| Error inesperado / base caída | 500 / 503 |

## Decisiones que tomé y podés cambiar

- **El orden de estados es estricto:** pendiente → aceptado → en camino → entregado. Si se saltea un paso, devuelve 409.
- **Un plato que está en algún pedido no se puede borrar** (409), para no romper el historial de pedidos. Al borrar un pedido, en cambio, se borran también sus renglones en `platosxpedidos`.
- **El usuario del pedido sale siempre del token.** Si el body trae un `id_usuario`, se ignora. Lo mismo pasa con `admin` en el registro.
- **Contraseña:** pide un mínimo de 6 caracteres. El email se guarda en minúsculas.
- **`PUT /platos/:id` acepta cambios parciales:** se puede mandar uno o más campos.
- **Platos repetidos en un pedido:** si el mismo plato aparece dos veces, se suman las cantidades.
- **Respuesta de los pedidos:** sigue el formato del ejemplo y le agregué `nombre` y `precio` en cada plato, más un `total`.
- **Token:** las rutas protegidas lo esperan como `Authorization: Bearer <token>`. También funciona si mandás el token solo, sin `Bearer`.

