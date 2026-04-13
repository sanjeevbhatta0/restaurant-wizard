/**
 * Delivery Service — Client-side wrappers for DoorDash delivery Cloud Functions
 */
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

/**
 * Configure delivery settings for the restaurant.
 * Registers with DoorDash on first enable.
 */
export async function configureDelivery(settings) {
  const fn = httpsCallable(functions, 'configureDelivery');
  const result = await fn(settings);
  return result.data;
}

/**
 * Cancel a delivery order (before driver pickup).
 */
export async function cancelDeliveryOrder(orderId) {
  const fn = httpsCallable(functions, 'cancelDeliveryOrder');
  const result = await fn({ orderId });
  return result.data;
}

/**
 * Get fresh delivery status from DoorDash (on-demand refresh).
 */
export async function getDeliveryStatus(orderId) {
  const fn = httpsCallable(functions, 'getDeliveryStatus');
  const result = await fn({ orderId });
  return result.data;
}
