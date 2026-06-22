import pedidoRepository from '../repositories/pedido.repository.js'
import productoRepository from '../repositories/producto.repository.js'
import usuarioRepository from '../repositories/usuario.repository.js'
import mesaRepository from '../repositories/mesa.repository.js'
import auditoriaService from './auditoria.service.js'
import { calcularTotal } from '../utils/calculateTotal.js'
import supabase from "../config/supabaseClient.js"

/**
 * Servicio para la lógica de negocio de Pedidos.
 */
class PedidoService {
  
  /**
   * Normaliza el estado del pedido.
   * @param {string} input - Estado a normalizar.
   * @returns {string} Estado normalizado.
   */
  normalizeEstado(input) {
    if (input === undefined || input === null) return input
    const s = String(input)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    const map = {
      'en preparacion': 'preparando',
      'en preparacion ': 'preparando',
      'preparacion': 'preparando',
      'preparación': 'preparando',
      'pendiente': 'pendiente',
      'preparando': 'preparando',
      'listo': 'listo',
      'entregado': 'entregado',
      'cancelado': 'cancelado'
    }

    if (map[s]) return map[s]
    return s.replace(/\s+/g, '')
  }

  /**
   * Obtiene pedidos con filtros.
   * @param {Object} filters - Filtros de búsqueda.
   * @returns {Promise<Object>} Resultados paginados.
   */
  async getPedidos(filters) {
    const { data, count, page, limit } = await pedidoRepository.findAll(filters)
    const totalPages = Math.ceil((count || 0) / limit) || 0

    // Enrich items with product names
    await this._enrichPedidosWithProductNames(data)

    return { page, limit, total: count || 0, totalPages, pedidos: data }
  }

  /**
   * Obtiene un pedido por ID.
   * @param {number} id - ID del pedido.
   * @returns {Promise<Object>} El pedido encontrado y su historial.
   * @throws {Error} Si el pedido no existe.
   */
  async getPedidoById(id) {
    const pedido = await pedidoRepository.findById(id)
    if (!pedido) throw new Error('Pedido no encontrado')

    // Enrich items
    await this._enrichPedidosWithProductNames([pedido])

    // Fetch history (best-effort logic from controller)
    const history = await this._getPedidoHistory(id, pedido)

    return { pedido, history }
  }

  /**
   * Obtiene pedidos de un cliente.
   * @param {number} clienteId - ID del cliente.
   * @returns {Promise<Array<Object>>} Lista de pedidos.
   */
  

  async getPedidosByCliente(clienteId) {
  const { data, error } = await supabase
    .from("pedidos")
    .select(`
      id_pedido,
      id_cliente,
      id_mesa,
      estado,
      pago,
      fecha_pedido,
      total,
      items
    `)
    .eq("id_cliente", clienteId)
    .order("fecha_pedido", { ascending: false });

  if (error) {
    console.error("[Supabase] Error al obtener pedidos del cliente:", error);
    throw new Error("Error obteniendo pedidos");
  }

  // Enriquecer items con nombres de productos
  await this._enrichPedidosWithProductNames(data);

  return data.map(p => ({
    ...p,
    id: p.id_pedido,
    // Asegurar que items tenga la estructura correcta
    items: Array.isArray(p.items) ? p.items.map(item => ({
      ...item,
      product: {
        id_producto: item.id_producto,
        nombre: item.nombre,
        precio: item.precio,
        imagen_url: item.imagen_url || null
      }
    })) : []
  }));
}




  /**
   * Crea un nuevo pedido.
   * @param {Object} data - Datos del pedido.
   * @returns {Promise<Object>} El pedido creado.
   * @throws {Error} Si faltan datos o son inválidos.
   */
  async createPedido(data) {
    let { id_cliente, id_mesa, items, total } = data

    // Basic validations
    if (!id_cliente && !id_mesa) throw new Error('id_cliente o id_mesa es requerido')
    if (!items || !Array.isArray(items) || items.length === 0) throw new Error('items debe ser un arreglo con al menos un elemento')

    // Verify foreign keys
    if (id_cliente) {
      const cliente = await usuarioRepository.findById(id_cliente)
      if (!cliente) throw new Error('id_cliente no existe')
    }

    if (id_mesa) {
      const maybeId = Number(id_mesa)
      if (Number.isNaN(maybeId) || maybeId <= 0) throw new Error('id_mesa inválido; debe ser un número entero')
      
      const mesa = await mesaRepository.findById(maybeId)
      if (!mesa) throw new Error('Mesa no encontrada (id_mesa inválido)')
      id_mesa = mesa.id_mesa
    }

    // Validate items and calculate prices
    const processedItems = await this._processItems(items)
    
    const expectedTotal = calcularTotal(processedItems)
    if (total !== undefined && total !== null) {
      const totalNum = Number(total)
      if (Number.isNaN(totalNum) || Math.abs(totalNum - expectedTotal) > 0.01) {
        throw new Error(`Total inválido. Esperado: ${expectedTotal}`)
      }
    }

    const pedidoObj = {
      id_cliente: id_cliente || null,
      id_mesa: id_mesa || null,
      items: processedItems,
      total: expectedTotal,
      estado: 'pendiente',
      pago: "no_pagado",
    }

    const newPedido = await pedidoRepository.create(pedidoObj)

    // Log event
    await auditoriaService.logEvento({ 
      id_pedido: newPedido.id_pedido || newPedido.id, 
      estado_anterior: null, 
      estado_nuevo: newPedido.estado || 'pendiente', 
      descripcion: 'Pedido creado' 
    })

    return newPedido
  }

  /**
   * Actualiza un pedido.
   * @param {number} id - ID del pedido.
   * @param {Object} updates - Datos a actualizar.
   * @returns {Promise<Object>} El pedido actualizado.
   * @throws {Error} Si el pedido no existe o los datos son inválidos.
   */
  async updatePedido(id, updates) {
    let { id_cliente, id_mesa, estado, total, items, pago } = updates

    if (estado !== undefined) estado = this.normalizeEstado(estado)

    if (pago !== undefined) {
      const allowedPago = ['pagado', 'no_pagado']
      if (!allowedPago.includes(pago)) throw new Error(`pago no válido: ${pago}`)
    }

    const existingPedido = await pedidoRepository.findById(id)
    if (!existingPedido) throw new Error('Pedido no encontrado')

    const previousEstado = existingPedido.estado

    // Handle items update
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) throw new Error('items debe ser un arreglo con al menos un elemento')
      
      const processedItems = await this._processItems(items)
      items = processedItems // Update items with processed ones (prices, names)

      const expectedTotal = calcularTotal(items)
      if (total !== undefined && total !== null) {
        const totalNum = Number(total)
        if (Number.isNaN(totalNum) || Math.abs(totalNum - expectedTotal) > 0.01) {
          throw new Error(`Total inválido. Esperado: ${expectedTotal}`)
        }
      }
      total = expectedTotal
    }

    // Verify FKs if provided
    if (id_cliente) {
      const cliente = await usuarioRepository.findById(id_cliente)
      if (!cliente) throw new Error('id_cliente no existe')
    }
    if (id_mesa) {
      const maybeId = Number(id_mesa)
      if (Number.isNaN(maybeId) || maybeId <= 0) throw new Error('id_mesa inválido')
      const mesa = await mesaRepository.findById(maybeId)
      if (!mesa) throw new Error('Mesa no encontrada')
      id_mesa = mesa.id_mesa
    }

    const updatePayload = {}
    if (id_cliente !== undefined) updatePayload.id_cliente = id_cliente
    if (id_mesa !== undefined) updatePayload.id_mesa = id_mesa
    if (estado !== undefined) updatePayload.estado = estado
    if (total !== undefined) updatePayload.total = total
    if (pago !== undefined) updatePayload.pago = pago
    if (items !== undefined) updatePayload.items = items

    const updatedPedido = await pedidoRepository.update(id, updatePayload)

    // Log state change
    if (updatedPedido && previousEstado !== updatedPedido.estado) {
      await auditoriaService.logEvento({ 
        id_pedido: id, 
        estado_anterior: previousEstado, 
        estado_nuevo: updatedPedido.estado, 
        descripcion: `Cambio de estado ${previousEstado} → ${updatedPedido.estado}` 
      })
    }

    return updatedPedido
  }

  /**
   * Actualiza el estado de un pedido.
   * @param {number} id - ID del pedido.
   * @param {string} nuevoEstado - Nuevo estado.
   * @returns {Promise<Object>} El pedido actualizado.
   * @throws {Error} Si la transición de estado no es válida.
   */
  async updatePedidoEstado(id, nuevoEstado) {
    nuevoEstado = this.normalizeEstado(nuevoEstado)
    if (!nuevoEstado) throw new Error('estado es requerido')

    const allowedStates = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado']
    if (!allowedStates.includes(nuevoEstado)) throw new Error(`estado no válido: ${nuevoEstado}`)

    const transitions = {
      pendiente: ['preparando', 'cancelado'],
      preparando: ['listo', 'cancelado'],
      listo: ['entregado'],
      entregado: [],
      cancelado: []
    }

    const pedido = await pedidoRepository.findById(id)
    if (!pedido) throw new Error('Pedido no encontrado')

    const estadoActual = pedido.estado
    if (estadoActual === nuevoEstado) return { message: 'Estado sin cambios', pedido }

    const allowed = transitions[estadoActual] || []
    if (!allowed.includes(nuevoEstado)) {
      throw new Error(`Transición inválida de ${estadoActual} a ${nuevoEstado}`)
    }

    const updated = await pedidoRepository.update(id, { estado: nuevoEstado })

    await auditoriaService.logEvento({ 
      id_pedido: id, 
      estado_anterior: estadoActual, 
      estado_nuevo: nuevoEstado, 
      descripcion: `Cambio de estado ${estadoActual} → ${nuevoEstado}` 
    })

    return updated
  }

  /**
   * Actualiza la mesa de un pedido.
   * @param {number} id - ID del pedido.
   * @param {number} id_mesa - ID de la nueva mesa.
   * @returns {Promise<Object>} El pedido actualizado.
   * @throws {Error} Si la mesa no existe.
   */
  async updatePedidoMesa(id, id_mesa) {
    if (!id_mesa) throw new Error('id_mesa es requerido')

    const mesa = await mesaRepository.findById(id_mesa)
    if (!mesa) throw new Error('Mesa no encontrada')

    const updated = await pedidoRepository.update(id, { id_mesa })

    await auditoriaService.logEvento({ 
      id_pedido: id, 
      estado_anterior: null, 
      estado_nuevo: null, 
      descripcion: `Cambio de mesa a ${id_mesa}` 
    })

    return updated
  }

  /**
   * Actualiza el estado de pago de un pedido.
   * @param {number} id - ID del pedido.
   * @param {string} pago - Nuevo estado de pago.
   * @returns {Promise<Object>} El pedido actualizado.
   * @throws {Error} Si el estado de pago no es válido.
   */
  async updatePedidoPago(id, pago) {
    if (pago === undefined || pago === null) throw new Error('pago es requerido')
    
    const allowedPago = ['pagado', 'no_pagado']
    if (!allowedPago.includes(pago)) throw new Error(`pago no válido: ${pago}`)

    const updated = await pedidoRepository.update(id, { pago })
    if (!updated) throw new Error('Pedido no encontrado')
    
    return updated
  }

  /**
   * Elimina un pedido.
   * @param {number} id - ID del pedido.
   * @returns {Promise<void>}
   */
  async deletePedido(id) {
    return await pedidoRepository.delete(id)
  }

  // --- Private Helpers ---

  /**
   * Procesa los items del pedido, validando productos y calculando subtotales.
   * @param {Array<Object>} items - Items del pedido.
   * @returns {Promise<Array<Object>>} Items procesados.
   * @private
   */
  async _processItems(items) {
    const processed = []
    const productIds = [...new Set(items.map(i => i.id_producto))]
    const products = await productoRepository.findByIds(productIds)
    
    const priceMap = new Map()
    const nameMap = new Map()
    for (const p of products) {
      priceMap.set(p.id_producto, Number(p.precio))
      nameMap.set(p.id_producto, p.nombre || null)
    }

    for (const it of items) {
      if (!it.id_producto) throw new Error('cada item debe tener id_producto')
      
      const cantidadNum = Number(it.cantidad)
      if (Number.isNaN(cantidadNum) || cantidadNum <= 0) throw new Error('cantidad inválida en un item')

      if (!priceMap.has(it.id_producto)) throw new Error(`Producto no encontrado: ${it.id_producto}`)
      
      const precioNum = priceMap.get(it.id_producto)
      
      processed.push({
        ...it,
        cantidad: cantidadNum,
        precio: precioNum,
        subtotal: Number((precioNum * cantidadNum).toFixed(2)),
        nombre: nameMap.get(it.id_producto) || null
      })
    }
    return processed
  }

  /**
   * Enriquece los pedidos con los nombres de los productos.
   * @param {Array<Object>} pedidos - Lista de pedidos.
   * @returns {Promise<void>}
   * @private
   */
  async _enrichPedidosWithProductNames(pedidos) {
    if (!pedidos || pedidos.length === 0) return

    const allProductIds = new Set()
    for (const ped of pedidos) {
      if (Array.isArray(ped.items)) {
        for (const it of ped.items) {
          if (it && it.id_producto != null) allProductIds.add(it.id_producto)
        }
      }
    }

    if (allProductIds.size > 0) {
      const ids = Array.from(allProductIds)
      const prods = await productoRepository.findByIds(ids)
      
      const nameMap = new Map()
      for (const p of prods) nameMap.set(p.id_producto, p.nombre || null)

      for (const ped of pedidos) {
        if (Array.isArray(ped.items)) {
          ped.items = ped.items.map(it => ({ 
            ...it, 
            nombre: nameMap.get(it.id_producto) || it.nombre || null 
          }))
        }
      }
    }
  }

  /**
   * Obtiene el historial de un pedido.
   * @param {number} id - ID del pedido.
   * @param {Object} pedido - Objeto del pedido.
   * @returns {Promise<Array<Object>>} Historial de eventos.
   * @private
   */
  async _getPedidoHistory(id, pedido) {
    // Try to fetch recent events from auditoria service
    let events = []
    try {
      const { events: evs } = await auditoriaService.getEventos({ id_pedido: id, limit: 5 })
      if (evs && evs.length > 0) {
        events = evs.map(e => ({
          id: e.id || null,
          description: e.descripcion || (e.estado_anterior ? `Cambio ${e.estado_anterior} → ${e.estado_nuevo}` : undefined),
          from: e.estado_anterior || null,
          to: e.estado_nuevo || null,
          at: e.created_at || null
        }))
      }
    } catch (err) {
      // ignore error
    }

    if (events.length === 0) {
      const fallbackAt = pedido.fecha_pedido || pedido.created_at || null
      events = [{
        id: null,
        description: 'Pedido creado',
        from: null,
        to: pedido.estado || null,
        at: fallbackAt
      }]
    }
    return events
  }
}

export default new PedidoService()
