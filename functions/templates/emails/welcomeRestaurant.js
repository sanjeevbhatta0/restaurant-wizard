/**
 * Welcome Email Template — Restaurant Admin
 *
 * Branded Koda Carte welcome email sent when a restaurant admin signs up.
 */

function welcomeRestaurantEmail({ restaurantName, email, tier, username }) {
  const tierName = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Scout';
  const tierEmoji = { scout: '🔍', ally: '🌱', guide: '🧭', chief: '🦅', elder: '👑' }[tier] || '🔍';

  const subject = `Welcome to Koda Carte, ${restaurantName}! 🎉`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Koda Carte</title>
</head>
<body style="margin:0; padding:0; background-color:#0f0f1a; font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f1a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px; width:100%;">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size:28px; font-weight:800; letter-spacing:-0.5px;">
                    <span style="color:#4ade80;">Koda</span><span style="color:#ffffff;"> Carte</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#252547 100%); border-radius:16px; border:1px solid rgba(255,255,255,0.1);">

              <!-- Hero Banner -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:40px 40px 24px; text-align:center;">
                    <div style="font-size:48px; margin-bottom:16px;">🎉</div>
                    <h1 style="margin:0; font-size:26px; font-weight:800; color:#ffffff; line-height:1.3;">
                      Welcome to the Family,<br/>${restaurantName}!
                    </h1>
                    <p style="margin:12px 0 0; font-size:15px; color:rgba(255,255,255,0.7); line-height:1.5;">
                      Your restaurant management platform is ready. Let's get you up and running.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Plan Badge -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:0 40px 24px;" align="center">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="background:rgba(74,222,128,0.15); border:1px solid rgba(74,222,128,0.3); border-radius:24px; padding:8px 20px;">
                          <span style="font-size:14px; color:#4ade80; font-weight:600;">
                            ${tierEmoji} ${tierName} Plan Active
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:0 40px;">
                    <div style="height:1px; background:rgba(255,255,255,0.1);"></div>
                  </td>
                </tr>
              </table>

              <!-- Quick Start Steps -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:24px 40px;">
                    <h2 style="margin:0 0 16px; font-size:18px; font-weight:700; color:#ffffff;">
                      Get Started in 4 Steps
                    </h2>

                    ${renderStep(1, '🍽️', 'Set Up Your Menu', 'Add categories and items with photos, prices, and descriptions.')}
                    ${renderStep(2, '📋', 'Configure Your POS', 'Design your table layout and start taking orders.')}
                    ${renderStep(3, '💳', 'Connect Payments', 'Link Stripe to accept card payments in-person and online.')}
                    ${renderStep(4, '🌐', 'Build Your Website', 'Create a customer-facing website with online ordering.')}
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:8px 40px 32px;" align="center">
                    <a href="https://kodacarte.com"
                       style="display:inline-block; padding:14px 40px; background:linear-gradient(135deg,#4ade80 0%,#22c55e 100%); color:#0f0f1a; font-size:16px; font-weight:700; text-decoration:none; border-radius:12px;">
                      Go to Your Dashboard →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:0 40px;">
                    <div style="height:1px; background:rgba(255,255,255,0.1);"></div>
                  </td>
                </tr>
              </table>

              <!-- Account Details -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:24px 40px;">
                    <h3 style="margin:0 0 12px; font-size:14px; font-weight:600; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:1px;">
                      Your Account
                    </h3>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:rgba(255,255,255,0.6); width:120px;">Username</td>
                        <td style="padding:6px 0; font-size:14px; color:#ffffff; font-weight:600;">@${username || 'N/A'}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:rgba(255,255,255,0.6); width:120px;">Email</td>
                        <td style="padding:6px 0; font-size:14px; color:#ffffff; font-weight:600;">${email}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:rgba(255,255,255,0.6); width:120px;">Plan</td>
                        <td style="padding:6px 0; font-size:14px; color:#4ade80; font-weight:600;">${tierEmoji} ${tierName}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Help Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:0 40px 32px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                           style="background:rgba(168,85,247,0.1); border:1px solid rgba(168,85,247,0.2); border-radius:12px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <p style="margin:0; font-size:14px; color:rgba(255,255,255,0.8); line-height:1.5;">
                            <strong style="color:#a855f7;">Need help?</strong> Our setup guide walks you through every step.
                            Look for the <strong>Setup Guide</strong> panel on your dashboard — it tracks your progress automatically.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 16px; text-align:center;">
              <p style="margin:0 0 8px; font-size:13px; color:rgba(255,255,255,0.4);">
                "Koda" means <em>friend</em> in Lakota — we're here to help you succeed.
              </p>
              <p style="margin:0 0 4px; font-size:12px; color:rgba(255,255,255,0.3);">
                Koda Carte &bull; Restaurant Management Platform
              </p>
              <p style="margin:0; font-size:12px; color:rgba(255,255,255,0.3);">
                <a href="mailto:support@kodacarte.com" style="color:rgba(255,255,255,0.4); text-decoration:underline;">support@kodacarte.com</a>
                &bull; (937) 361-9400
              </p>
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

function renderStep(num, emoji, title, description) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
      <tr>
        <td width="40" valign="top" style="padding-top:2px;">
          <div style="width:32px; height:32px; border-radius:8px; background:rgba(74,222,128,0.15); text-align:center; line-height:32px; font-size:14px;">
            ${emoji}
          </div>
        </td>
        <td style="padding-left:12px;">
          <p style="margin:0; font-size:15px; font-weight:600; color:#ffffff;">${title}</p>
          <p style="margin:2px 0 0; font-size:13px; color:rgba(255,255,255,0.6); line-height:1.4;">${description}</p>
        </td>
      </tr>
    </table>`;
}

module.exports = { welcomeRestaurantEmail };
