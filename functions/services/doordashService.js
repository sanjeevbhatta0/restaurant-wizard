/**
 * DoorDash Drive API Service
 *
 * Encapsulates all DoorDash Drive (white-label delivery) API interactions.
 * Uses JWT (HS256) authentication per DoorDash Drive API spec.
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');

const BASE_URL = 'https://openapi.doordash.com';

// JWT cache: reuse token for 4 minutes (tokens have 5-min lifetime)
let _cachedToken = null;
let _cachedTokenExpiry = 0;

/**
 * Create a DoorDash Drive service instance with the given credentials.
 * @param {Object} credentials
 * @param {string} credentials.developerId - DoorDash Developer ID
 * @param {string} credentials.keyId - DoorDash Key ID
 * @param {string} credentials.signingSecret - DoorDash Signing Secret
 */
function createDoordashService({ developerId, keyId, signingSecret }) {

  // Clear cache on each service creation to ensure fresh credentials
  _cachedToken = null;
  _cachedTokenExpiry = 0;

  /**
   * Generate a JWT for DoorDash API authentication.
   * Cached for 4 minutes to avoid regenerating on every call.
   */
  function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (_cachedToken && now < _cachedTokenExpiry) {
      return _cachedToken;
    }

    if (!developerId || !keyId || !signingSecret) {
      console.error('DoorDash credentials missing:', {
        hasDeveloperId: !!developerId,
        hasKeyId: !!keyId,
        hasSigningSecret: !!signingSecret,
      });
      throw new Error('DoorDash credentials not configured');
    }

    const payload = {
      aud: 'doordash',
      iss: developerId,
      kid: keyId,
      exp: now + 300, // 5-minute lifetime
      iat: now,
    };

    // DoorDash requires the signing secret to be base64url-decoded
    const decodedSecret = Buffer.from(signingSecret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    const token = jwt.sign(payload, decodedSecret, {
      algorithm: 'HS256',
      header: {
        'dd-ver': 'DD-JWT-V1',
      },
    });

    _cachedToken = token;
    _cachedTokenExpiry = now + 240; // Cache for 4 minutes
    return token;
  }

  /**
   * Make an authenticated request to the DoorDash API.
   */
  async function apiRequest(method, path, data = null) {
    const token = getAccessToken();
    const config = {
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      const ddError = error.response?.data;
      const status = error.response?.status;
      console.error(`DoorDash API error [${method} ${path}]:`, JSON.stringify(ddError, null, 2));
      const err = new Error(ddError?.message || ddError?.error || `DoorDash API error: ${status}`);
      err.status = status;
      err.doordashError = ddError;
      throw err;
    }
  }

  // ============================================
  // DELIVERY QUOTE & ACCEPTANCE
  // ============================================

  /**
   * Get a delivery quote from DoorDash.
   * @param {Object} params
   * @param {string} params.externalDeliveryId - Unique ID for this delivery (e.g., 'kc-{restaurantId}-{timestamp}')
   * @param {string} params.pickupAddress - Restaurant address
   * @param {string} params.pickupPhone - Restaurant phone
   * @param {string} params.pickupBusinessName - Restaurant name
   * @param {string} params.pickupInstructions - Pickup instructions for dasher
   * @param {string} params.dropoffAddress - Customer delivery address
   * @param {string} params.dropoffPhone - Customer phone
   * @param {string} params.dropoffContactGivenName - Customer first name
   * @param {string} params.dropoffContactFamilyName - Customer last name
   * @param {number} params.orderValue - Order value in cents
   * @param {number} [params.pickupTime] - ISO timestamp when order will be ready (optional)
   * @returns {Object} Quote response with fee, estimated times, and external_delivery_id
   */
  async function getQuote(params) {
    const body = {
      external_delivery_id: params.externalDeliveryId,
      pickup_address: params.pickupAddress,
      pickup_phone_number: params.pickupPhone,
      pickup_business_name: params.pickupBusinessName,
      pickup_instructions: params.pickupInstructions || '',
      dropoff_address: params.dropoffAddress,
      dropoff_phone_number: params.dropoffPhone,
      dropoff_contact_given_name: params.dropoffContactGivenName || '',
      dropoff_contact_family_name: params.dropoffContactFamilyName || '',
      order_value: params.orderValue, // cents
    };

    if (params.pickupTime) {
      body.pickup_time = params.pickupTime;
    }

    return apiRequest('POST', '/drive/v2/quotes', body);
  }

  /**
   * Accept a delivery quote, dispatching a DoorDash driver.
   * @param {string} externalDeliveryId - The external_delivery_id from the quote
   * @param {Object} [options]
   * @param {number} [options.tip] - Driver tip in cents
   * @param {string} [options.dropoffPhone] - Override dropoff phone
   * @param {boolean} [options.contactlessDropoff] - Contactless delivery
   * @param {string} [options.dropoffInstructions] - Delivery instructions
   * @returns {Object} Accepted delivery with tracking_url and dasher info
   */
  async function acceptQuote(externalDeliveryId, options = {}) {
    const body = {};
    if (options.tip != null) body.tip = options.tip;
    if (options.dropoffPhone) body.dropoff_phone_number = options.dropoffPhone;
    if (options.contactlessDropoff != null) body.contactless_dropoff = options.contactlessDropoff;
    if (options.dropoffInstructions) body.dropoff_instructions = options.dropoffInstructions;

    return apiRequest('POST', `/drive/v2/quotes/${externalDeliveryId}/accept`, body);
  }

  // ============================================
  // DELIVERY MANAGEMENT
  // ============================================

  /**
   * Get the current status of a delivery.
   * @param {string} externalDeliveryId
   * @returns {Object} Delivery status with dasher info, timestamps, tracking URL
   */
  async function getDelivery(externalDeliveryId) {
    return apiRequest('GET', `/drive/v2/deliveries/${externalDeliveryId}`);
  }

  /**
   * Cancel an active delivery.
   * Can only cancel before the dasher picks up the order.
   * @param {string} externalDeliveryId
   * @returns {Object} Cancellation result
   */
  async function cancelDelivery(externalDeliveryId) {
    return apiRequest('PUT', `/drive/v2/deliveries/${externalDeliveryId}/cancel`);
  }

  // ============================================
  // BUSINESS & STORE REGISTRATION
  // ============================================

  /**
   * Register a business with DoorDash Drive.
   * Required before creating stores/deliveries.
   * @param {Object} data
   * @param {string} data.name - Business name
   * @param {string} data.externalBusinessId - Our internal ID for this business
   * @param {string} [data.description] - Business description
   * @returns {Object} Created business
   */
  async function registerBusiness(data) {
    return apiRequest('POST', '/drive/v2/businesses', {
      name: data.name,
      external_business_id: data.externalBusinessId,
      description: data.description || '',
    });
  }

  /**
   * Register a store (location) under a business.
   * @param {string} externalBusinessId - The business ID
   * @param {Object} data
   * @param {string} data.name - Store/location name
   * @param {string} data.externalStoreId - Our internal ID for this store
   * @param {string} data.address - Store address
   * @param {string} data.phoneNumber - Store phone
   * @returns {Object} Created store
   */
  async function registerStore(externalBusinessId, data) {
    return apiRequest('POST', `/drive/v2/businesses/${externalBusinessId}/stores`, {
      name: data.name,
      external_store_id: data.externalStoreId,
      address: data.address,
      phone_number: data.phoneNumber,
    });
  }

  // ============================================
  // STATUS MAPPING
  // ============================================

  /**
   * Map DoorDash delivery/webhook status to internal status fields.
   * Returns { deliveryStatus, orderStatus } where orderStatus is null if no order-level change needed.
   */
  function mapDeliveryStatus(doordashStatus) {
    const mapping = {
      'quote': { deliveryStatus: 'quoted', orderStatus: null },
      'created': { deliveryStatus: 'awaiting_driver', orderStatus: null },
      'confirmed': { deliveryStatus: 'driver_assigned', orderStatus: null },
      'enroute_to_pickup': { deliveryStatus: 'driver_enroute_pickup', orderStatus: null },
      'arrived_at_pickup': { deliveryStatus: 'driver_at_pickup', orderStatus: null },
      'picked_up': { deliveryStatus: 'picked_up', orderStatus: 'out_for_delivery' },
      'enroute_to_dropoff': { deliveryStatus: 'driver_enroute_dropoff', orderStatus: null },
      'arrived_at_dropoff': { deliveryStatus: 'driver_at_dropoff', orderStatus: null },
      'delivered': { deliveryStatus: 'delivered', orderStatus: 'completed' },
      'cancelled': { deliveryStatus: 'cancelled', orderStatus: 'delivery_failed' },
    };

    return mapping[doordashStatus] || { deliveryStatus: doordashStatus, orderStatus: null };
  }

  /**
   * Map DoorDash webhook event_name to the delivery status string.
   */
  function mapWebhookEvent(eventName) {
    const eventMapping = {
      'DELIVERY_CREATED': 'created',
      'DASHER_CONFIRMED': 'confirmed',
      'DASHER_ENROUTE_TO_PICKUP': 'enroute_to_pickup',
      'DASHER_ARRIVED_AT_PICKUP': 'arrived_at_pickup',
      'DASHER_PICKED_UP': 'picked_up',
      'DASHER_ENROUTE_TO_DROPOFF': 'enroute_to_dropoff',
      'DASHER_ARRIVED_AT_DROPOFF': 'arrived_at_dropoff',
      'DASHER_DROPPED_OFF': 'delivered',
      'DELIVERY_CANCELLED': 'cancelled',
    };

    return eventMapping[eventName] || null;
  }

  /**
   * Generate a unique external delivery ID for DoorDash.
   * Format: kc-{restaurantId}-{timestamp}
   */
  function generateExternalDeliveryId(restaurantId) {
    return `kc-${restaurantId}-${Date.now()}`;
  }

  /**
   * Parse restaurant ID from an external delivery ID.
   * @param {string} externalDeliveryId - Format: kc-{restaurantId}-{timestamp}
   * @returns {string|null} Restaurant ID or null if invalid format
   */
  function parseExternalDeliveryId(externalDeliveryId) {
    if (!externalDeliveryId || !externalDeliveryId.startsWith('kc-')) return null;
    const parts = externalDeliveryId.split('-');
    // Format: kc-{restaurantId}-{timestamp}
    // restaurantId could contain hyphens, so join all parts except first and last
    if (parts.length < 3) return null;
    return parts.slice(1, -1).join('-');
  }

  /**
   * Extract dasher info from a DoorDash delivery response.
   */
  function extractDasherInfo(deliveryData) {
    if (!deliveryData) return null;

    const dasher = deliveryData.dasher;
    if (!dasher) return null;

    return {
      dasherName: [dasher.first_name, dasher.last_name].filter(Boolean).join(' ') || null,
      dasherPhone: dasher.phone_number || null,
      dasherVehicle: dasher.vehicle ? {
        make: dasher.vehicle.make || null,
        model: dasher.vehicle.model || null,
      } : null,
      dasherLocation: dasher.location ? {
        lat: dasher.location.lat,
        lng: dasher.location.lng,
      } : null,
    };
  }

  /**
   * Build the doordash sub-object for an order document from a DoorDash API response.
   */
  function buildOrderDoordashData(deliveryData, existingData = {}) {
    const dasherInfo = extractDasherInfo(deliveryData);

    return {
      externalDeliveryId: deliveryData.external_delivery_id || existingData.externalDeliveryId,
      deliveryStatus: deliveryData.delivery_status || existingData.deliveryStatus,
      trackingUrl: deliveryData.tracking_url || existingData.trackingUrl || null,
      fee: deliveryData.fee || existingData.fee || 0,
      tip: deliveryData.tip || existingData.tip || 0,
      dasherName: dasherInfo?.dasherName || existingData.dasherName || null,
      dasherPhone: dasherInfo?.dasherPhone || existingData.dasherPhone || null,
      dasherVehicle: dasherInfo?.dasherVehicle || existingData.dasherVehicle || null,
      dasherLocation: dasherInfo?.dasherLocation || existingData.dasherLocation || null,
      estimatedPickupTime: deliveryData.pickup_time_estimated || existingData.estimatedPickupTime || null,
      estimatedDropoffTime: deliveryData.dropoff_time_estimated || existingData.estimatedDropoffTime || null,
      actualPickupTime: deliveryData.pickup_time_actual || existingData.actualPickupTime || null,
      actualDeliveryTime: deliveryData.dropoff_time_actual || existingData.actualDeliveryTime || null,
      supportReference: deliveryData.support_reference || existingData.supportReference || null,
      proofOfDeliveryUrl: deliveryData.dropoff_verification_image_url || existingData.proofOfDeliveryUrl || null,
      cancelReason: deliveryData.cancellation_reason || existingData.cancelReason || null,
    };
  }

  return {
    getAccessToken,
    getQuote,
    acceptQuote,
    getDelivery,
    cancelDelivery,
    registerBusiness,
    registerStore,
    mapDeliveryStatus,
    mapWebhookEvent,
    generateExternalDeliveryId,
    parseExternalDeliveryId,
    extractDasherInfo,
    buildOrderDoordashData,
  };
}

module.exports = { createDoordashService };
