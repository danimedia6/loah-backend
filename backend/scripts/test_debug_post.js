// The unauthenticated order-debug endpoint is retired; never send business writes here.
console.error('Script retirado. Usa npm run test:auth-security con almacenamiento aislado.')
process.exitCode = 1
