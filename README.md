# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Investigation enhancements

- **Search & filters** (Risk Alerts): case-insensitive search over wallet, IP and TXID (matches stored transactions, so a wallet/IP search also surfaces related transactions); filters for entity type, risk band, and last-seen window (relative to the latest observation in the dataset); sorting by risk, transaction count, last seen, or name; "Showing X of Y" and Clear filters; paginated 50 rows.
- **Behavioural timeline**: chronological events with time, TXID, amount, direction, IP and counterparty; burst window uses the same 10-minute sliding window as the `burst_score` model feature, compared with the dataset average burst score. Clicking an event shows details and highlights it in the graph.
- **"Why this entity?" card**: risk score, priority, and the top evidence items taken verbatim from the Isolation Forest explanation (feature value, dataset average, z-score) — no free text, no LLM.
- Fonts are bundled locally; the UI makes no external requests.
- Tests: `bunx vitest run tests`.
