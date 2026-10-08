# Money Arena Trading Marketplace

Money Arena is a marketplace starter for Expert Advisors (EAs), Deriv DBots, TradingView/MT5 indicators and trading strategies.

## Included

- Homepage
- Marketplace
- Product pages
- Login page
- Cart
- M-Pesa checkout
- M-Pesa STK Push backend structure
- Asynchronous M-Pesa callback handling
- Order/payment status tracking
- Customer dashboard
- Admin page starter
- Secure-payment gating for downloads
- Production integration checklist

## Run locally

You need Node.js 18+.

```bash
cd backend
npm install
cp .env.example .env
# add your Daraja credentials
npm start
```

Then open `http://localhost:3000`.

For live M-Pesa, use your own Daraja production credentials and a publicly reachable HTTPS callback URL. Never put M-Pesa secrets in frontend code.

The included download endpoint is a payment gate placeholder. Before selling real files, connect it to private storage with signed/expiring URLs.

Safaricom's Daraja platform provides M-Pesa APIs and requires a server-side callback for asynchronous payment results. citeturn0search0
