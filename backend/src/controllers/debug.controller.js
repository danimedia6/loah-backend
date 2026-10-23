// Fail closed for legacy internal consumers as well as the retired HTTP routes.
export const getPedidoDebug = (req, res) => res.sendStatus(410)
export const updatePedidoDebug = (req, res) => res.sendStatus(410)
export default { getPedidoDebug, updatePedidoDebug }
