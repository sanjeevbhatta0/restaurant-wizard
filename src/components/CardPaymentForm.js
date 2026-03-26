import React, { useState } from 'react';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createPaymentIntent, confirmPayment } from '../services/stripeService';

// Stripe Card Element styling
export const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#32325d',
      fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
      fontSmoothing: 'antialiased',
      fontSize: '16px',
      '::placeholder': {
        color: '#aab7c4'
      }
    },
    invalid: {
      color: '#fa755a',
      iconColor: '#fa755a'
    }
  },
  hidePostalCode: false
};

// Stripe Card Payment Form Component
const CardPaymentForm = ({
  total,
  onPaymentSuccess,
  onPaymentError,
  processing,
  setProcessing,
  orderIds,
  tableNumbers,
  restaurantId,
  paymentDetails
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [cardError, setCardError] = useState(null);
  const [cardComplete, setCardComplete] = useState(false);

  const handleCardChange = (event) => {
    setCardError(event.error ? event.error.message : null);
    setCardComplete(event.complete);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setCardError(null);

    try {
      // 1. Create PaymentIntent on the backend
      const { clientSecret, paymentIntentId } = await createPaymentIntent(
        total,
        orderIds,
        tableNumbers,
        restaurantId
      );

      // 2. Confirm the payment with Stripe
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
        }
      });

      if (error) {
        setCardError(error.message);
        onPaymentError(error.message);
      } else if (paymentIntent.status === 'succeeded') {
        // 3. Confirm payment on backend and update orders
        await confirmPayment(paymentIntentId, orderIds, paymentDetails, restaurantId);
        onPaymentSuccess(paymentIntentId);
      } else {
        setCardError('Payment was not completed. Please try again.');
        onPaymentError('Payment was not completed');
      }
    } catch (error) {
      console.error('Payment error:', error);
      setCardError(error.message || 'An error occurred during payment');
      onPaymentError(error.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit}>
      <div className="stripe-card-element">
        <Form.Label><strong>Card Details</strong></Form.Label>
        <div className="card-element-wrapper">
          <CardElement options={CARD_ELEMENT_OPTIONS} onChange={handleCardChange} />
        </div>
        {cardError && (
          <Alert variant="danger" className="mt-2 mb-0">
            <i className="bi bi-exclamation-circle"></i> {cardError}
          </Alert>
        )}
      </div>

      <div className="mt-4 d-flex justify-content-between align-items-center">
        <div className="payment-total-display">
          <span>Total to charge:</span>
          <strong className="text-success fs-4">${total.toFixed(2)}</strong>
        </div>
        <Button
          type="submit"
          variant="success"
          size="lg"
          disabled={!stripe || !cardComplete || processing}
        >
          {processing ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Processing...
            </>
          ) : (
            <>
              <i className="bi bi-credit-card"></i> Pay ${total.toFixed(2)}
            </>
          )}
        </Button>
      </div>
    </Form>
  );
};

export default CardPaymentForm;
