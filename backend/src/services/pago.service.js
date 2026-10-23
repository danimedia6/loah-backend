import wompiService from './wompi.service.js'
import { assertLegacyPaymentsAvailable } from './legacy-payments.guard.js'

class PagoService {
  async createPayment() {
    assertLegacyPaymentsAvailable()
  }

  async processWebhook(rawBody, checksum) {
    wompiService.verifyWebhookSignature(rawBody, checksum)
    // Authenticity is not proof of purchase binding or atomic application.
    // No financial reads/writes until Block 3 supplies those guarantees.
    assertLegacyPaymentsAvailable()
  }
}

export default new PagoService()
