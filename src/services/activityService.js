import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const activityService = {
  /**
   * Log an activity to Firestore
   * @param {string} restaurantId - Restaurant user ID
   * @param {string} type - Activity type (e.g., 'pin_created', 'order_received', 'order_status_changed')
   * @param {string} message - Activity message
   * @param {object} metadata - Additional metadata (orderNumber, tableNumber, etc.)
   */
  logActivity: async (restaurantId, type, message, metadata = {}) => {
    try {
      const activitiesRef = collection(db, `restaurants/${restaurantId}/activities`);
      await addDoc(activitiesRef, {
        type,
        message,
        ...metadata,
        createdAt: serverTimestamp(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error logging activity:', error);
      // Don't throw - activity logging shouldn't break the app
    }
  },

  /**
   * Log reimbursement PIN activity
   */
  logPinActivity: async (restaurantId, action, metadata = {}) => {
    const messages = {
      created: 'Reimbursement PIN was created',
      updated: 'Reimbursement PIN was updated'
    };
    await activityService.logActivity(
      restaurantId,
      'pin_' + action,
      messages[action] || `Reimbursement PIN was ${action}`,
      metadata
    );
  },

  /**
   * Log order activity
   */
  logOrderActivity: async (restaurantId, action, orderData) => {
    const { orderNumber, tableNumber, status, orderId } = orderData;
    
    let message = '';
    let type = 'order_' + action;
    
    switch (action) {
      case 'received':
        message = `Order ${orderNumber || orderId || 'received'} received for table ${tableNumber || 'N/A'}`;
        break;
      case 'status_changed':
        const statusMessages = {
          'new': 'Order received',
          'sent_to_kitchen': 'Order sent to kitchen',
          'preparing': `Order ${orderNumber || orderId || ''} is getting prepared for table ${tableNumber || 'N/A'}`,
          'ready': `Order ${orderNumber || orderId || ''} is ready for table ${tableNumber || 'N/A'}`,
          'served': `Order ${orderNumber || orderId || ''} was served to table ${tableNumber || 'N/A'}`,
          'completed': `Order ${orderNumber || orderId || ''} was completed for table ${tableNumber || 'N/A'}`,
          'cancelled': `Order ${orderNumber || orderId || ''} was cancelled`
        };
        message = statusMessages[status] || `Order ${orderNumber || orderId || ''} status changed to ${status}`;
        break;
      default:
        message = `Order ${orderNumber || orderId || ''} ${action}`;
    }
    
    await activityService.logActivity(
      restaurantId,
      type,
      message,
      {
        orderNumber: orderNumber || orderId,
        tableNumber,
        status,
        orderId: orderId || orderNumber
      }
    );
  },

  /**
   * Log payment activity
   */
  logPaymentActivity: async (restaurantId, paymentData) => {
    const { orderNumbers, tableNumbers, total, orderCount } = paymentData;
    
    const tableDisplay = Array.isArray(tableNumbers) 
      ? tableNumbers.length === 1 
        ? `table ${tableNumbers[0]}`
        : `tables ${tableNumbers.join(', ')}`
      : `table ${tableNumbers || 'N/A'}`;
    
    const orderDisplay = orderCount === 1
      ? orderNumbers?.[0] || 'order'
      : `${orderCount} orders`;
    
    const message = `Payment processed for ${orderDisplay} from ${tableDisplay} - Total: $${total.toFixed(2)}`;
    
    await activityService.logActivity(
      restaurantId,
      'payment_processed',
      message,
      {
        orderNumbers: Array.isArray(orderNumbers) ? orderNumbers : [orderNumbers],
        tableNumbers: Array.isArray(tableNumbers) ? tableNumbers : [tableNumbers],
        total,
        orderCount
      }
    );
  },

  /**
   * Log reimbursement activity
   */
  logReimbursementActivity: async (restaurantId, reimbursementData) => {
    const { orderNumber, tableNumber, refundAmount, refundType, orderId } = reimbursementData;
    
    const tableDisplay = Array.isArray(tableNumber) 
      ? tableNumber.join(' and ')
      : tableNumber || 'N/A';
    
    const typeDisplay = refundType === 'full' ? 'Full' : 'Partial';
    const message = `${typeDisplay} reimbursement processed for order ${orderNumber || orderId || ''} from table ${tableDisplay} - Refund: $${refundAmount.toFixed(2)}`;
    
    await activityService.logActivity(
      restaurantId,
      'reimbursement_processed',
      message,
      {
        orderNumber: orderNumber || orderId,
        orderId: orderId || orderNumber,
        tableNumber,
        refundAmount,
        refundType
      }
    );
  }
};

export default activityService;
