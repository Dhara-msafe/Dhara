# DHARA Pro — UPI Payment Page (Outside the App)

A standalone web page where a user can pay for DHARA Pro using any UPI app — GPay, PhonePe, BharatPe, Paytm, or others — by scanning a QR code or tapping a UPI link, then submitting their payment reference for confirmation. The page lives outside the mobile app and is shared directly with users (chat, SMS, email, a website), not linked from inside the Play Store/App Store app, so the live app itself stays free of any in-app digital-purchase flow.

## Who it's for
DHARA users in India who want to upgrade to Pro and prefer UPI over a card, reached outside the app — through a message, support conversation, or a link on your own website.

## Core features and experience
- A payment page showing the Pro price, a UPI QR code, and a "Pay with UPI app" button containing your UPI ID with the amount and a reference note already filled in — tapping it opens whichever UPI app is installed (GPay, PhonePe, BharatPe, Paytm...); scanning the QR does the same on another device.
- A short form below it for the user to enter their UPI payment reference number (UTR) and the email of their DHARA account, once they've paid.
- A clear "Submitted — we'll confirm shortly" state after that, so the user isn't left wondering what happens next.
- A simple way for you to see submitted reference numbers and mark a payment as confirmed once you've checked it against your own UPI payment history.
- Once confirmed, the account is flipped to Pro using the same mechanism already in the app today (no change to what Pro unlocks).
- No button, card, or mention of this page appears anywhere inside the DHARA mobile app in this phase — it only exists as a link you share outside the app.

## User flow
1. You send the user a link to the payment page.
2. They open it on their phone and see the Pro price with a "Pay via UPI" button and a QR code.
3. Tapping the button opens their UPI app with your UPI ID and the amount pre-filled; scanning the QR does the same.
4. They complete the payment in their UPI app, then return to the page and enter the payment reference number and their DHARA account email.
5. The page confirms the submission was received and is pending a check.
6. You check the reference number against your UPI payment history and confirm it.
7. Their account shows as Pro the next time they open DHARA.

## UI/UX feel
A single, calm, trustworthy screen that matches DHARA's existing look — not a flashy checkout page. Large, obvious tap targets for the UPI button and QR code, plain language, and reassuring confirmation copy, consistent with an app people already trust with sensitive legal and safety matters.

## Implementation phases

**Phase 1 (MVP — built now)**
A standalone web payment page, reachable only by direct link, with:
- Pro price, UPI QR code, and a "Pay via UPI" link to your UPI ID with amount and note pre-filled.
- A form to submit the UPI reference number and account email after paying.
- A simple review list for you to check submissions and confirm a payment, which then grants Pro on that account.
- Nothing about this page is referenced anywhere inside the shipped mobile app.

**Phase 2**
Replace manual checking with automatic confirmation by connecting a UPI-capable payment gateway (for example Razorpay or Cashfree, both of which already support UPI collect requests) — so a payment confirms itself within seconds and Pro unlocks immediately, with no review step for you.

**Phase 3**
Bring the purchase back inside the native app in a store-compliant way — either through Google Play Billing / Apple In-App Purchase (both of which already support UPI as a payment instrument for Indian users within their own billing systems), or through Google Play's approved alternative-billing program for India. Only once one of these is in place should any "Upgrade" button reappear inside the app itself.

## Assumptions
- You will provide the UPI ID (VPA) to collect payments into; a placeholder is used until then.
- The Pro price and what Pro unlocks stay exactly as already defined in the app today — unchanged.
- "Confirming a payment" in Phase 1 means you personally check the submitted reference number against your own UPI payment history; there is no bank-statement automation in this phase.
- The page is in English only for Phase 1, matching the app's other payment-related screens.
- No link, button, or mention of this payment page is placed anywhere inside the DHARA mobile app in Phase 1 — this keeps the live app itself clear of any in-app digital-purchase flow, which is a store-compliance requirement rather than a style choice. Sharing the link happens entirely outside the app (chat, SMS, email, your own website).
- The existing, already-paused Stripe/Razorpay Pro upgrade screens inside the app stay exactly as they are (paused, behind their flag) — this is a separate, additional path, not a replacement.
- Submitted UPI reference numbers and account emails are stored only to verify payment and grant Pro access.
