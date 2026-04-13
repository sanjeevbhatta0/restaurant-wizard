/**
 * Order Receipt Email Template
 *
 * Branded Koda Carte receipt email sent when an order is completed/paid.
 */

function orderReceiptEmail({ restaurantName, orderNumber, items, subtotal, tax, total, taxRate, paymentMethod, promoDiscount, pointsDiscount, rewardDiscount, orderType, customerName, createdAt }) {
  const paymentLabel = {
    card: 'Credit/Debit Card',
    cash: 'Cash',
    terminal: 'Card Terminal',
    online: 'Online Payment'
  }[paymentMethod] || paymentMethod || 'Card';

  const orderTypeLabel = {
    pickup: 'Pickup',
    delivery: 'Delivery',
    dine_in: 'Dine-In'
  }[orderType] || 'Dine-In';

  const dateStr = createdAt ? new Date(createdAt).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }) : new Date().toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  // Build items rows
  const itemRows = (items || []).map(item => {
    const qty = item.quantity || 1;
    const price = item.price || 0;
    const itemTotal = (qty * price).toFixed(2);
    return `
      <tr>
        <td style="padding:10px 0; border-bottom:1px solid #2a2a3a; color:#d0d0d0; font-size:14px;">
          ${item.name || 'Item'}${qty > 1 ? ` <span style="color:#888;">&times;${qty}</span>` : ''}
        </td>
        <td align="right" style="padding:10px 0; border-bottom:1px solid #2a2a3a; color:#d0d0d0; font-size:14px;">
          $${itemTotal}
        </td>
      </tr>`;
  }).join('');

  // Build discount rows
  let discountRows = '';
  if (promoDiscount && promoDiscount > 0) {
    discountRows += `
      <tr>
        <td style="padding:6px 0; color:#4ecdc4; font-size:14px;">Promo Discount</td>
        <td align="right" style="padding:6px 0; color:#4ecdc4; font-size:14px;">-$${Number(promoDiscount).toFixed(2)}</td>
      </tr>`;
  }
  if (pointsDiscount && pointsDiscount > 0) {
    discountRows += `
      <tr>
        <td style="padding:6px 0; color:#4ecdc4; font-size:14px;">Points Redeemed</td>
        <td align="right" style="padding:6px 0; color:#4ecdc4; font-size:14px;">-$${Number(pointsDiscount).toFixed(2)}</td>
      </tr>`;
  }
  if (rewardDiscount && rewardDiscount > 0) {
    discountRows += `
      <tr>
        <td style="padding:6px 0; color:#4ecdc4; font-size:14px;">Reward Discount</td>
        <td align="right" style="padding:6px 0; color:#4ecdc4; font-size:14px;">-$${Number(rewardDiscount).toFixed(2)}</td>
      </tr>`;
  }

  const taxPct = taxRate ? `(${(Number(taxRate)).toFixed(1)}%)` : '';

  const subject = `Your receipt from ${restaurantName} — Order #${orderNumber}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Receipt</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f1a; font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f1a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%;">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:24px; font-weight:700; color:#ffffff; letter-spacing:1px;">Koda Carte</span>
            </td>
          </tr>

          <!-- Receipt Card -->
          <tr>
            <td style="background:#1a1a2e; border-radius:16px; padding:32px 28px;">

              <!-- Header -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding-bottom:8px;">
                    <span style="font-size:13px; color:#888; text-transform:uppercase; letter-spacing:1px;">Receipt</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:4px;">
                    <span style="font-size:22px; font-weight:700; color:#ffffff;">${restaurantName}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:20px;">
                    <span style="font-size:13px; color:#888;">${dateStr}</span>
                  </td>
                </tr>
              </table>

              <!-- Order Info Bar -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#12122a; border-radius:10px; margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <span style="font-size:13px; color:#888;">Order</span><br/>
                    <span style="font-size:15px; font-weight:600; color:#fff;">#${orderNumber}</span>
                  </td>
                  <td align="center" style="padding:14px 16px;">
                    <span style="font-size:13px; color:#888;">Type</span><br/>
                    <span style="font-size:15px; font-weight:600; color:#fff;">${orderTypeLabel}</span>
                  </td>
                  <td align="right" style="padding:14px 16px;">
                    <span style="font-size:13px; color:#888;">Payment</span><br/>
                    <span style="font-size:15px; font-weight:600; color:#fff;">${paymentLabel}</span>
                  </td>
                </tr>
              </table>

              <!-- Items -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
                <tr>
                  <td style="padding-bottom:8px; border-bottom:2px solid #2a2a3a;">
                    <span style="font-size:13px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:1px;">Items</span>
                  </td>
                  <td align="right" style="padding-bottom:8px; border-bottom:2px solid #2a2a3a;">
                    <span style="font-size:13px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:1px;">Price</span>
                  </td>
                </tr>
                ${itemRows}
              </table>

              <!-- Totals -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:6px 0; color:#aaa; font-size:14px;">Subtotal</td>
                  <td align="right" style="padding:6px 0; color:#aaa; font-size:14px;">$${Number(subtotal || 0).toFixed(2)}</td>
                </tr>
                ${discountRows}
                <tr>
                  <td style="padding:6px 0; color:#aaa; font-size:14px;">Tax ${taxPct}</td>
                  <td align="right" style="padding:6px 0; color:#aaa; font-size:14px;">$${Number(tax || 0).toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0 0; border-top:2px solid #2a2a3a; font-size:18px; font-weight:700; color:#ffffff;">Total</td>
                  <td align="right" style="padding:12px 0 0; border-top:2px solid #2a2a3a; font-size:18px; font-weight:700; color:#ffffff;">$${Number(total || 0).toFixed(2)}</td>
                </tr>
              </table>

              <!-- Thank you -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:16px; background:#12122a; border-radius:10px;">
                    <span style="font-size:15px; color:#d0d0d0;">Thank you${customerName ? `, ${customerName}` : ''}! We hope you enjoyed your meal.</span>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <span style="font-size:12px; color:#555;">Powered by <span style="color:#888;">Koda Carte</span> &bull; <a href="https://kodacarte.com" style="color:#555; text-decoration:none;">kodacarte.com</a></span>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

module.exports = { orderReceiptEmail };
