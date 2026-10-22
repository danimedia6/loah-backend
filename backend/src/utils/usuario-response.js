export function toUsuarioResponse(user) {
  return {
    id_usuario: user.id_usuario,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    venue_id: user.venue_id,
    fecha_registro: user.fecha_registro,
  }
}
