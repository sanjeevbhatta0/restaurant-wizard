import { loadStripeTerminal } from '@stripe/terminal-js';
import { getFunctions, httpsCallable } from 'firebase/functions';

const BLUETOOTH_DEVICE_TYPES = new Set(['bbpos_chipper2x', 'stripe_m2', 'bbpos_wisepad3']);

/**
 * Determine the connection type of a reader based on its device type.
 */
export const getReaderConnectionType = (deviceType) => {
  if (!deviceType) return 'unknown';
  if (BLUETOOTH_DEVICE_TYPES.has(deviceType)) return 'bluetooth';
  if (deviceType.startsWith('simulated_')) return 'simulated';
  return 'internet';
};

let terminalInstance = null;
let connectedReader = null;

/**
 * Initialize the Stripe Terminal SDK.
 * Creates a StripeTerminal instance with a connection token fetcher.
 */
export const initTerminal = async () => {
  if (terminalInstance) return terminalInstance;

  const StripeTerminal = await loadStripeTerminal();

  terminalInstance = StripeTerminal.create({
    onFetchConnectionToken: fetchConnectionToken,
    onUnexpectedReaderDisconnect: handleUnexpectedDisconnect,
  });

  return terminalInstance;
};

/**
 * Fetch a connection token from the backend.
 * Called by the Terminal SDK when it needs to authenticate.
 */
const fetchConnectionToken = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'createTerminalConnectionToken');
  const result = await fn();
  return result.data.secret;
};

/**
 * Handle unexpected reader disconnection.
 */
const handleUnexpectedDisconnect = () => {
  console.warn('Stripe Terminal: Reader unexpectedly disconnected');
  connectedReader = null;
};

/**
 * Discover available readers at the restaurant's location.
 * @param {boolean} simulated - Use simulated readers for testing
 * @returns {Promise<Array>} List of discovered readers
 */
export const discoverReaders = async (simulated = false) => {
  const terminal = await initTerminal();

  const config = { simulated };

  const result = await terminal.discoverReaders(config);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.discoveredReaders || [];
};

/**
 * Connect to a specific reader.
 * @param {Object} reader - Reader object from discoverReaders
 * @returns {Promise<Object>} Connected reader
 */
export const connectReader = async (reader) => {
  const terminal = await initTerminal();

  const result = await terminal.connectReader(reader);

  if (result.error) {
    throw new Error(result.error.message);
  }

  connectedReader = result.reader;
  return result.reader;
};

/**
 * Connect to an internet-connected reader (WisePOS E, S700, etc.).
 * @param {Object} reader - Reader object from discoverReaders
 * @returns {Promise<Object>} Connected reader
 */
export const connectInternetReader = async (reader) => {
  const terminal = await initTerminal();

  const result = await terminal.connectInternetReader(reader);

  if (result.error) {
    throw new Error(result.error.message);
  }

  connectedReader = result.reader;
  return result.reader;
};

/**
 * Get the currently connected reader.
 * @returns {Object|null} Connected reader or null
 */
export const getConnectedReader = () => connectedReader;

/**
 * Disconnect from the current reader.
 */
export const disconnectReader = async () => {
  if (!terminalInstance) return;

  await terminalInstance.disconnectReader();
  connectedReader = null;
};

/**
 * Collect a payment using the connected terminal reader.
 * Creates a PaymentIntent on the server, then collects and processes it on the reader.
 *
 * @param {number} amount - Amount in dollars
 * @param {Array<string>} orderIds - Order IDs being paid
 * @param {Array<string>} tableNumbers - Table numbers
 * @param {string} restaurantId - Restaurant ID
 * @param {Function} onStatusChange - Callback for status updates
 * @returns {Promise<{paymentIntentId: string}>}
 */
export const collectTerminalPayment = async (amount, orderIds, tableNumbers, restaurantId, onStatusChange) => {
  const terminal = await initTerminal();

  if (!connectedReader) {
    throw new Error('No reader connected. Please connect a reader first.');
  }

  // 1. Create PaymentIntent on the server
  if (onStatusChange) onStatusChange('creating_intent');
  const functions = getFunctions();
  const createPI = httpsCallable(functions, 'createTerminalPaymentIntent');
  const piResult = await createPI({
    amount,
    orderIds,
    tableNumbers,
    restaurantId
  });
  const { clientSecret, paymentIntentId } = piResult.data;

  // 2. Collect payment method from the reader
  if (onStatusChange) onStatusChange('waiting_for_card');
  const collectResult = await terminal.collectPaymentMethod(clientSecret);

  if (collectResult.error) {
    throw new Error(collectResult.error.message);
  }

  // 3. Process the payment
  if (onStatusChange) onStatusChange('processing');
  const processResult = await terminal.processPayment(collectResult.paymentIntent);

  if (processResult.error) {
    throw new Error(processResult.error.message);
  }

  if (processResult.paymentIntent.status === 'succeeded') {
    if (onStatusChange) onStatusChange('succeeded');
    return { paymentIntentId };
  }

  // For card_present, status may be 'requires_capture' if capture_method is manual
  if (processResult.paymentIntent.status === 'requires_capture') {
    if (onStatusChange) onStatusChange('succeeded');
    return { paymentIntentId };
  }

  throw new Error(`Unexpected payment status: ${processResult.paymentIntent.status}`);
};

/**
 * Cancel an in-progress collectPaymentMethod operation (client-driven).
 */
export const cancelCollectPayment = async () => {
  if (!terminalInstance) return;
  await terminalInstance.cancelCollectPaymentMethod();
};

// ============================================
// SERVER-DRIVEN FLOW (for screenless readers)
// ============================================

/**
 * Process a payment via server-driven flow.
 * The server tells the reader to collect payment — no client SDK connection needed.
 * Works with both smart readers and screenless readers (M2, BBPOS Chipper).
 *
 * @param {string} readerId - Stripe reader ID (e.g., tmr_xxx)
 * @param {number} amount - Amount in dollars
 * @param {Array<string>} orderIds
 * @param {Array<string>} tableNumbers
 * @param {string} restaurantId
 * @param {Function} onStatusChange
 * @returns {Promise<{paymentIntentId: string}>}
 */
export const collectServerDrivenPayment = async (readerId, amount, orderIds, tableNumbers, restaurantId, onStatusChange) => {
  const functions = getFunctions();

  // 1. Tell the server to hand the PaymentIntent to the reader
  if (onStatusChange) onStatusChange('creating_intent');
  const processPI = httpsCallable(functions, 'processTerminalPayment');
  const result = await processPI({ readerId, amount, orderIds, tableNumbers, restaurantId });
  const { paymentIntentId } = result.data;

  // 2. Poll reader status until payment completes or fails
  if (onStatusChange) onStatusChange('waiting_for_card');
  const getStatus = httpsCallable(functions, 'getTerminalReaderStatus');

  const maxAttempts = 120; // 2 minutes at 1s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const statusResult = await getStatus({ readerId, paymentIntentId });
    const { paymentIntentStatus, actionStatus } = statusResult.data;

    if (paymentIntentStatus === 'succeeded' || paymentIntentStatus === 'requires_capture') {
      if (onStatusChange) onStatusChange('succeeded');
      return { paymentIntentId };
    }

    if (paymentIntentStatus === 'canceled' || paymentIntentStatus === 'requires_payment_method') {
      throw new Error('Payment was canceled or failed on the reader.');
    }

    // If reader action completed (failed), break
    if (actionStatus === 'failed') {
      throw new Error('Reader failed to process the payment.');
    }

    // Update status when reader is actively waiting
    if (actionStatus === 'in_progress' && i > 2) {
      if (onStatusChange) onStatusChange('waiting_for_card');
    }
  }

  throw new Error('Payment timed out. The reader did not complete the transaction.');
};

/**
 * Cancel the current action on a reader (server-driven).
 */
export const cancelServerDrivenAction = async (readerId) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'cancelTerminalAction');
  await fn({ readerId });
};

/**
 * Create a simulated reader for testing.
 */
export const createSimulatedReader = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'createSimulatedReader');
  const result = await fn();
  return result.data;
};

/**
 * Simulate a card tap on a simulated reader (test mode).
 */
export const simulateCardPresent = async (readerId) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'simulateTerminalCardPresent');
  await fn({ readerId });
};

/**
 * Get the terminal configuration for the current restaurant.
 */
export const getTerminalConfig = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'getTerminalConfig');
  const result = await fn();
  return result.data;
};

/**
 * Create a terminal location.
 */
export const createTerminalLocation = async (locationData) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'createTerminalLocation');
  const result = await fn(locationData);
  return result.data;
};

/**
 * Register a reader with a registration code.
 */
export const registerReader = async (registrationCode, label) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'registerTerminalReader');
  const result = await fn({ registrationCode, label });
  return result.data;
};

/**
 * List registered readers.
 */
export const listReaders = async () => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'listTerminalReaders');
  const result = await fn();
  return result.data;
};

/**
 * Delete a reader.
 */
export const deleteReader = async (readerId) => {
  const functions = getFunctions();
  const fn = httpsCallable(functions, 'deleteTerminalReader');
  const result = await fn({ readerId });
  return result.data;
};

export default {
  initTerminal,
  discoverReaders,
  connectReader,
  connectInternetReader,
  getConnectedReader,
  disconnectReader,
  collectTerminalPayment,
  cancelCollectPayment,
  collectServerDrivenPayment,
  cancelServerDrivenAction,
  createSimulatedReader,
  simulateCardPresent,
  getTerminalConfig,
  createTerminalLocation,
  registerReader,
  listReaders,
  deleteReader,
  getReaderConnectionType
};
