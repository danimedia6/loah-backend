# Loah: Bloque 0.4, webhooks y endurecimiento general

## Base y limites de esta intervencion

- Rama `danielfelipe`, base `9cc583001df6a462fd2e93d865d216b5369ae11e`.
- Arbol limpio antes de empezar. No se crearon ramas, commits ni pushes.
- No se consulto Supabase real, Wompi real, datos, credenciales ni configuracion
  privada de Render. No se hicieron cobros, migraciones ni cambios de frontend.
- La contencion financiera de Gifts del Bloque 0.2 permanece intacta.
- Fecha de revision de dependencias: 2026-10-23. Node local: 22.18.0.

## Vulnerabilidades verificadas en el codigo anterior

1. `/api/wompi/webhook` no verificaba ninguna firma y, con una sola transaccion,
   marcaba TODOS los pedidos no pagados del cliente como pagados.
2. `/api/pagos/webhooks/wompi` esperaba un HMAC del body y headers que no son el
   contrato de eventos Wompi Colombia. Si faltaba el secreto, continuaba.
3. El segundo flujo inferia un pedido extrayendo numeros de referencias y usaba
   fallbacks para crear pagos o modificar el ultimo pago sin asociacion segura.
4. No se contrastaban compra esperada, importe, moneda y transaccion; se aplicaban
   cambios independientes a pagos/pedidos sin atomicidad ni recuperacion fiable.
5. `wompiService.createPayment` simulaba pagos sin clave y al fallar una operacion
   externa. La otra ruta aceptaba total del cliente y no comprobaba la insercion.
6. `PUT /api/pedidos/:id` aceptaba cambios de propietario, total y pago de cualquier
   pedido autenticado. El PATCH de pago permitia una aprobacion manual sin prueba.
7. Borrar pedidos podia borrar su historial de pagos: la migracion 0002 declara
   `pagos.id_pedido ON DELETE CASCADE`. No se verifico el esquema desplegado.
8. Multer 1.x y varios componentes de HTTP/socket/validacion tenian avisos npm.
   Uploads comprobaban solo MIME declarado y tenian pocos limites de multipart.
9. No habia presupuestos generales de peticiones o eventos/conexiones socket.
   El mapa de fallos de login no tenia limite de identidades almacenadas.

## Rutas financieras y estado final

| Metodo y ruta | Acceso | Estado final |
| --- | --- | --- |
| POST /api/wompi/crear-transaccion | JWT vigente | 503 LEGACY_PAYMENTS_UNAVAILABLE; sin cobro ni DB financiera |
| POST /api/pagos/create | JWT + esquema existente id_pedido | 503 LEGACY_PAYMENTS_UNAVAILABLE; sin simulacion |
| POST /api/wompi/webhook | Publico, firma de evento | Firma/payload invalidos: 400; configuracion ausente: 503; valido: 503 contenido, sin efectos |
| POST /api/pagos/webhooks/wompi | Publico, mismo pipeline | Igual que el alias anterior |
| PUT /api/pedidos/:id | JWT + esquema existente | 503; se contiene toda esta edicion generica insegura |
| PATCH /api/pedidos/:id/pago | JWT + staff/admin | 503 tanto para pagado como no_pagado |
| DELETE /api/pedidos/:id | JWT + staff/admin | 503; preserva pedido e historial financiero |
| PATCH /api/pedidos/:id/estado | JWT + staff/admin | Conserva transiciones operativas; entrega de pedido no pagado: 503 |
| PATCH /api/pedidos/:id/mesa | JWT + staff/admin | Sin cambios financieros |
| POST /api/pedidos | JWT + esquema existente | Sigue creando no_pagado, con precios del catalogo; cliente no puede imponer otro propietario |
| GET de pedidos | Controles anteriores | Sin cambios en esta intervencion |
| Gifts send/respond/redeem | Guardas del Bloque 0.2 | Siguen suspendidos, sin habilitacion |
| /api/debug | Guardas del Bloque 0.3 | No cambia; no modifica pedidos |
| /api/payments | No montado; comentarios en server.js | No es un alias funcional |

No se encontro endpoint activo de reembolso. El repositorio de pagos conserva
sus metodos internos, pero ningun flujo HTTP de pago los invoca ahora. El guard
de servicio tambien bloquea llamadas directas a crear/procesar pagos y a las
mutaciones genericas de pedidos, sin depender solo del router.

### Impacto operativo importante

No puede cobrarse ni cerrarse financieramente un pedido por estas rutas. Un
pedido ya registrado como pagado conserva su transicion operativa de entrega,
pero ese dato historico NO fue conciliado ni certificado como pago real aqui.
Preparar/listar/asignar mesa no equivale a confirmar dinero. Antes de desplegar,
coordinar esta suspension con el establecimiento; no es compatible con continuar
usando el checkout heredado como si estuviera activo. No se borro historial.

## Validacion de eventos Wompi Colombia

Fuente oficial: https://docs.wompi.co/docs/colombia/eventos/

Ambos aliases usan un unico controlador/servicio. El body JSON se recibe como
Buffer, con limite de 64 KiB, antes del parser JSON general. El router tambien
declara raw para funcionar aisladamente. No se registra body, checksum o secreto.

La verificacion concatena, EN EL ORDEN RECIBIDO, los valores de los paths de
`signature.properties` relativos a `data`, luego `timestamp`, luego el secreto
de eventos. Calcula SHA256 y compara buffers con timingSafeEqual. No usa HMAC
del body, llaves privadas/publicas, ni headers Wompi-Signature inventados.
Acepta `signature.checksum` o el header oficial `X-Event-Checksum`; si llegan
ambos, deben coincidir. Whitespace del JSON no cambia el checksum.

`WOMPI_EVENTS_SECRET` es una configuracion nueva y explicita para el secreto de
EVENTOS. No tiene fallback a WOMPI_SIGNATURE_SECRET, WOMPI_KEY o WOMPI_PRIVATE_KEY.
No se inspeccionaron valores reales. `WOMPI_ENV` debe ser `sandbox` o `production`,
con environment `test` o `prod`, respectivamente. Configuracion ausente: 503.

Se validan paths propios/no prototipos, tipos/longitudes, timestamp entero,
transaction.updated, entorno, ID/referencia no vacios, centavos enteros positivos,
moneda COP y estados PENDING/APPROVED/DECLINED/VOIDED/ERROR. Para este tipo de
evento se exige que ID, estado e importe esten entre las propiedades firmadas;
la lista puede incluir mas campos o venir en otro orden.

IMPORTANTE: referencia, moneda, entorno y otros campos no necesariamente estan
firmados por Wompi. La validacion anterior NO demuestra que pertenecen a una
compra local ni que el pedido fue pagado. Por eso incluso una firma valida
termina en 503 LEGACY_PAYMENTS_UNAVAILABLE antes de leer/escribir finanzas.
No se devuelve 200 ni se finge procesamiento satisfactorio.

## Idempotencia y consistencia: demostradas vs pendientes

Demostrado con mocks: cualquier evento, duplicado, fuera de orden, referencia
inexistente/ajena, importe distinto o estado pendiente/cancelado/aprobado tiene
CERO escrituras financieras. Un fallo de persistencia hipotetico tampoco puede
dejar un efecto parcial porque no se intenta persistir. No es una prueba de
recuperacion transaccional: el procesamiento completo sigue deshabilitado.

La migracion 0007 declara UNIQUE(transaction_id), pero eso NO hace atomicas las
operaciones separadas en pagos y pedidos; tampoco se verifico que este aplicada.
No hay nuevo registro persistente de eventos, locks ni garantia exactamente-una-vez.
Un timestamp firmado no se trata como prueba de frescura; no se impone una ventana
arbitraria que rompa reintentos de Wompi. No hay efectos que un replay pueda aplicar.

Antes de habilitar (Bloque 3): compra inmutable y referencia unica; unidades de
importe uniformes (el legacy mezclaba centavos/pesos); asociacion exacta de
transaccion/compra/venue; contrastar datos contra API confiable de Wompi; control
de estados terminales/cancelaciones; aplicacion atomica en PostgreSQL; persistencia
durable de idempotencia/reintentos; recuperacion ante interrupcion y conciliacion.
Estos puntos requieren staging PostgreSQL y sandbox Wompi, no solo mocks.

## Dependencias

Parches directos dirigidos: multer 1.4.5-lts.2 -> 2.5.0; axios 1.13.2 -> 1.20.0;
joi 18.0.2 -> 18.3.0; morgan 1.10.1 -> 1.12.1; uuid 13.0.0 -> 13.0.2.
Se declaran proxy-addr 2.0.8 (antes transitivo 2.0.7), file-type 22.2.0 y sharp
0.35.5 para fronteras de proxy y validacion real de contenido.

Se actualizaron SOLO transitivas con avisos: body-parser, engine.io,
follow-redirects, form-data, jws, lodash, path-to-regexp, proxy-addr, qs,
socket.io-adapter, socket.io-parser y ws, conservando rangos de sus consumidores.
No se uso npm audit fix --force ni se cambio la version mayor de Express/Jest.
Instalacion con --ignore-scripts; import de sharp y decodificacion real probados.
Fuentes: npm audit y https://github.com/expressjs/multer/security/advisories

Audit de produccion posterior: 0 avisos conocidos. Esto NO es una garantia de
ausencia de vulnerabilidades. Audit completo: 35 paquetes afectados de desarrollo
(33 high, 1 moderate, 1 low), principalmente la cadena Jest 29, glob/micromatch,
js-yaml y Babel/browserslist. No los carga el servidor productivo. La remediacion
completa propuesta por npm incluye migrar Jest a otra version mayor; se deja
documentada para no mezclar una migracion de runner con la correccion financiera.
No ejecutar tests/configuraciones/globs de terceros no confiables con secretos.
Produccion debe instalar con npm ci --omit=dev y usar Node 22 (>=22.18.0), como
declara engines; sharp necesita sus paquetes nativos opcionales para la plataforma.

## Uploads

Un helper comun aplica a productos, logo/cover venue, avatar/background/gallery
y stories. Imagenes: 5 MiB por archivo; stories: conserva 50 MiB y MP4/MOV.
Gallery conserva maximo 6 archivos. Multipart: 16 campos de 8 KiB, nombres de
64 bytes y numero de partes/archivos acotado. Hay maximo 2 uploads simultaneos
por proceso; exceso responde 503 UPLOAD_BUSY con Retry-After.

Postauditoria: maximo 1 upload por usuario autenticado (429 UPLOAD_USER_BUSY,
Retry-After: 3), compartido entre rutas/pestanas; no se toma identidad del body
ni de IP/XFF. Todos los consumidores productivos autentican antes del helper.
Sin contexto de autenticacion se comparte un unico cupo conservador.

Deadline absoluto de recepcion: 120 segundos desde entrar al parser, no se
reinicia al recibir bytes. Vencido: 408 UPLOAD_TIMEOUT, unpipe/destroy de Busboy
y su stream de archivo, cierre de conexion tras responder. Abort/error/cierre
anticipado tambien cancelan recepcion. El semaforo libera una sola vez; durante
decodificacion mantiene la reserva hasta terminar el trabajo nativo acotado.
En exito se mantiene hasta terminar respuesta/storage, como antes. Sin colas.
Timer y listeners propios se retiran al terminar. El timeout de decoder sigue
siendo independiente (3 segundos). No cambia requestTimeout del servidor Node
(default 300 segundos), ni headersTimeout; el deadline de multipart es menor.
Auth anterior al parser no reserva un cupo, y sigue sujeto a limites HTTP/Node.

Impacto movil: 50 MiB en 120 segundos exige aproximadamente 3,5 Mbit/s sostenidos;
una galeria de 30 MiB, 2,1 Mbit/s; 5 MiB, 0,35 Mbit/s, sin contar overhead.
Con redes mas lentas hay que reducir/comprimir la carga y reintentar. Esto es
un presupuesto inicial acotado, no una garantia de cargas lentas ilimitadas.

file-type contrasta contenido con MIME declarado. JPEG/PNG/WebP se decodifican
y recodifican con sharp, limite de 16 millones de pixeles, rechazo ante warnings,
sin multiples frames y timeout de procesamiento de 3 segundos. Se normaliza la
extension y vuelve a limitar el buffer resultante. Archivos falsificados,
imagenes corruptas y excesos se rechazan antes de storage. Animaciones y fotos
por encima del presupuesto requieren adaptar la imagen antes de subirla.
autoOrient aplica EXIF a los pixeles ANTES de recodificar sin conservar metadata.
Las pruebas usan cuadrantes sinteticos asimetricos, verifican colores y dimensiones
para 1/3/6/8 y sin orientacion, ausencia de EXIF privado y segunda carga sin giro
adicional. Se inspecciono visualmente una lamina de resultados del helper HTTP.

MP4/MOV se identifican por contenido/contenedor, NO se transcodifican ni se
certifica la integridad de todos los codecs/frames. Esa comprobacion profunda,
escaneo de malware y aislamiento de multimedia quedan pendientes; no se afirma
que file-type sea un antivirus o un decodificador de video.

Errores Multer/validacion son 400/413/415 con codigos INVALID_UPLOAD o
UPLOAD_TOO_LARGE. No se devuelve la excepcion del decoder. Los errores de storage
en perfiles, story upload y creacion/edicion de productos usan respuestas genericas.
Los exitos y paths de storage existentes se conservan; no se redisenaron buckets.

## Limites contra abuso

Presupuestos de ventana fija, por proceso, con maximo 20.000 claves por presupuesto
y limpieza lazy de vencidas. Si se llena, se rechazan claves nuevas; no se evictan
claves activas para permitir bypass. Las rutas se normalizan por mayusculas y
barra final. HTTP excedido: 429 RATE_LIMITED con Retry-After.

| Tipo | Limite |
| --- | --- |
| General por IP | 3000 / 5 min |
| Mutaciones por IP | 600 / min |
| Login por IP | 120 / 15 min |
| Login por identidad (hash del email normalizado) | 20 / 15 min |
| Registro por IP | 120 / 15 min |
| Lecturas por usuario autenticado | 600 / min |
| Escrituras/interacciones por usuario | 120 / min |
| Validacion QR por usuario | 20 / min |
| Reportes por usuario | 10 / 15 min |
| Uploads por usuario | 12 / min |
| Handshakes Engine.IO por IP | 120 / min |
| Eventos socket por usuario, compartido entre pestanas | 180 / min |
| Conexiones socket activas por usuario | 8 |

Registro se eleva de 30 a 120 para admitir una llegada concentrada de hasta 120
personas en la Wi-Fi/NAT del piloto durante 15 minutos. Sigue acotado por IP,
sin confiar en email/headers como identidad autentica; request 121 recibe 429.
No es una capacidad de aforo prometida: escrituras/general por IP siguen activos
y pueden agotarse antes bajo otra carga. Login sigue 120/IP y 20/identidad;
QR/reportes/uploads autenticados son por ID canonico del servidor, no por NAT.
Se debe medir llegada real en staging y ajustar deliberadamente, no desactivar
limites. Reinicios/multiproceso no comparten presupuestos en memoria.

Se conserva el limite previo de 5 fallos de login/15 min y se acota su mapa a
10.000 identidades. Exceso de eventos se descarta ANTES de handlers de negocio;
ack de error una vez si existe, o socket:error. Exceso de conexiones:
socket:error SOCKET_LIMITED y desconexion. Maximo de paquete Engine.IO: 64 KiB.

Los dos webhooks se EXCLUYEN de los presupuestos de usuarios/IP generales:
Wompi puede compartir IPs y reintentar. Tienen body de 64 KiB, trabajo acotado
de firma y ninguna consulta financiera. No hay exencion para crear cobros.
Proteccion volumetrica de los webhooks necesita el edge del proveedor, no una
lista inventada de IPs Wompi ni bloquear reintentos legitimos.

Limitaciones: memoria se reinicia al desplegar, no se comparte entre procesos,
no elimina DDoS ni abuso distribuido, y NAT del venue comparte limites por IP.
Los limites por usuario requieren primero autenticar (hay una lectura de cuenta).
No sustituyen autorizacion ni corrigen por si mismos endpoints que aceptan IDs
del body. No se agrego Redis ni otra infraestructura.

## Render, configuracion y preflight operativo

Fuente de contexto: https://render.com/articles/how-render-handles-ddos-attacks

TRUSTED_PROXY_CIDRS acepta solo IPs/CIDRs explicitos de proxies verificados.
No admite true, numeros de saltos o redes /0. Por defecto NO confia en XFF.
HTTP y handshakes usan la misma frontera; se selecciona el salto no confiable
mas cercano, no el primer XFF enviado por el cliente. Un valor malformado falla
antes de crear listener/sweep. No se verificaron rangos reales de Render.

Antes de produccion, confirmar en staging la topologia real y rangos estables
confiables, y verificar con headers falsificados desde fuera. No copiar rangos
de ejemplo o confiar en todo Internet. Si no se configura, multiples clientes
pueden compartir la IP del proxy y agotar un limite comun. No desplegar sin
validar este punto en el venue con multiples clientes/pestanas.

Mantener JWT_SECRET seguro, NODE_ENV=production, debug deshabilitado, CORS con
origenes reales, bloqueo de DEBUG de engine.io/socket.io y las guardas de Gifts.
No se necesitan claves privadas Wompi para operar esta contencion. Si se desean
probar firmas en staging, configurar WOMPI_EVENTS_SECRET y WOMPI_ENV correctos.
Los endpoints contenidos devuelven no-2xx: Wompi puede reintentar. Coordinar con
operacion y no iniciar nuevos cobros/esperar confirmaciones automaticas durante
la suspension; conciliar eventos/cobros anteriores por un proceso autorizado.
El nuevo codigo nunca ofrece un bypass por variable de entorno para habilitar pagos.

## Pruebas y limites de verificacion

Comandos: npm run test:usuarios, test:gifts, test:auth-security, test:hardening.
test:hardening incluye tambien uploads.security.test.js, sin dependencias nuevas.
La regresion usa Supabase mock antes de importar produccion y bloquea fetch
externo. HTTP real con Supertest, ambos aliases y parser del servidor real;
firmas con valores ficticios, archivos reales generados localmente por sharp.
Se cubren duplicados/fuera de orden/ausencia de efectos (no atomicidad real),
limites, proxy manipulado, tipos/corrupcion/tamano/pixeles/concurrencia de upload.
La prueba de paquetes socket usa middleware real con transporte simulado; la
suite 0.3 conserva handshakes Socket.IO reales locales y reconexion explicita.

Regresion original: 267 (usuarios 64, Gifts 80, seguridad 0.3 61,
hardening 0.4 62), mas 18 pruebas postauditoria: resultado final 285/285,
cinco suites aprobadas en una ejecucion conjunta (12,004 segundos).
Las nuevas pruebas usan HTTP real local, deadlines de 250 ms, abandono/bytes
lentos/abort/size/parser/decoder/early response, recuperacion de cupos, maximo
global aun tras errores (detecta doble liberacion), deadline limpiado/listeners
retirados, identidades distintas, NAT y EXIF sintetico.
Se conservaron las 205 pruebas previas. Se comprueba sintaxis
en todos los JS cambiados/nuevos y git diff --check, sin errores de whitespace.
Git emite advertencias informativas de conversion LF/CRLF en Windows.

No se prueban PostgreSQL real, RLS, constraints desplegados, Wompi sandbox real,
reembolsos, conciliacion, fallos transaccionales reales ni Render productivo.
El runner encontro un EPERM de cache temporal del sandbox en una ejecucion;
se repitio la suite aislada con autorizacion fuera de ese sandbox.
Tambien hubo un timeout intermitente en el fixture de handshake del servidor:
se agrego cierre explicito del transporte Engine.IO del cliente simulado y se
verifica que abandona su room. No se aumentaron timeouts ni quitaron assertions.
La regresion completa posterior paso; no quedo instrumentacion temporal.
En postauditoria se observo ademas una ejecucion con timeout de 5 segundos del
fixture existente que importa/inicializa el servidor real. Se repitio sin cambiar
el fixture, sus assertions ni sus plazos; ver resultado final de la entrega.

## Riesgos pendientes y recomendacion

- Bloque 3: resolver las garantias de compra/pago/idempotencia antes de habilitar.
- Tooling: migracion controlada de Jest y sus dependencias vulnerables.
- Infraestructura: verificar proxy, memoria nativa de sharp y limites con carga real.
- Bloque 1: autorizacion de interacciones story que aun usan IDs del cliente,
  ownership de lecturas de pedidos heredadas y revocacion integral de sockets.
  Estos controles no se declaran resueltos por un rate limiter.
- Frontend: manejar 429/503, upload invalido y la suspension de checkout; recuperacion
  de autenticacion Socket.IO del Bloque 0.3 sigue requiriendo integracion cliente.

Solicitar revision independiente del diff y pruebas antes de autorizar commit.
No habilitar cobros reales ni dar por listo el checkout del piloto con este bloque.

## Inventario de archivos de esta intervencion

- .gitignore; README.md; package.json; package-lock.json.
- backend/src/controllers/auth.controller.js, pagos.controller.js,
  wompi.controller.js, pedidos.controller.js, productos.controller.js.
- backend/src/middlewares/abuse-protection.js (nuevo), validated-upload.js
  (nuevo), auth.middleware.js, errorHandler.js, upload.middleware.js.
- backend/src/services/legacy-payments.guard.js (nuevo), wompi.service.js,
  pago.service.js, pedido.service.js.
- backend/src/routes/wompi.routes.js, pagos.routes.js.
- backend/src/modules/social/profile-background.routes.js, stories.controller.js.
- backend/src/server.js; backend/src/sockets/social.socket.js.
- backend/tests/hardening.security.test.js (nuevo), uploads.security.test.js
  (nuevo en postauditoria); este informe (nuevo).
- backend/tests/auth-config.security.test.js: cierre explicito del transporte
  del fixture, conservando las verificaciones originales.
