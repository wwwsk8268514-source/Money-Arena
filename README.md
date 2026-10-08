# Money Arena M-Pesa backend

This backend provides the server-side payment layer for the Money Arena marketplace.

## Flow

1. Customer adds products to cart.
2. Checkout collects name, email and Kenyan M-Pesa number.
3. Frontend sends the order to `POST /api/orders`.
4. Frontend calls `POST /api/payments/mpesa/stk-push`.
5. Server requests a Daraja access token and sends an M-Pesa Express/STK Push request.
6. Customer approves the prompt on their phone.
7. Safaricom sends the asynchronous callback to `/api/payments/mpesa/callback`.
8. The order is marked `paid` only when the callback reports a successful result.
9. The customer can then use the dashboard/download endpoint.

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm start
```

For sandbox testing, create a Daraja app and use the sandbox credentials from Safaricom. For production, complete Safaricom's Go Live process and use the production credentials.

Do not put Consumer Secret, Passkey, or other M-Pesa credentials in frontend JavaScript.

## Important production hardening

This starter intentionally keeps the payment architecture clear and easy to deploy. Before taking real money, add:

- a real database (PostgreSQL/MySQL)
- real user authentication and authorization
- admin authentication with MFA
- private object storage for paid EA/DBot/indicator files
- signed, expiring download URLs
- rate limiting and request validation
- webhook idempotency and transaction reconciliation
- HTTPS
- audit logs
- proper tax/invoice handling
- M-Pesa Transaction Status reconciliation when callbacks are delayed

Safaricom documents Transaction Status as a secondary reconciliation mechanism when callbacks are not received.
