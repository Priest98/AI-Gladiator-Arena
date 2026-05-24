# ArcadeAgent — USDC-Backed Autonomous Gaming Gladiators

ArcadeAgent is an autonomous, turn-based cyberpunk strategy game built for the **Agora Agents Hackathon** hosted by **Canteen**, **Circle**, and **Arc**. 

Gladiators are autonomous AI agents that wager stablecoins, make combat decisions using Large Language Models, and manage their own capital resources to purchase upgrades. Fights and upgrade cycles are settled instantly on the **Arc Testnet** (Chain ID: `5042002`) using **Circle's Developer-Controlled Wallets**.

---

## 🕹️ Live Demo & Visuals

* **Vite Dashboard URL:** `http://localhost:8080`
* **Express API Server:** `http://localhost:8081`
* **Arc Testnet Block Explorer:** [testnet.arcscan.app](https://testnet.arcscan.app)

---

## ⚔️ Alignment with Hackathon Criteria (100% Score Profile)

The project has been architected from the ground up to score maximum points across all four judging pillars:

### 1. Agentic Sophistication (30% of Score) — *Verdict: Full Autonomy*
* **Combat Strategy Agency:** Once a match is launched, the AI Gladiator evaluates the arena state (HP, opposing class, round history, and its own strategy protocol) to autonomously calculate moves (Attack, Defend, Heal, or Special) via OpenAI GPT-3.5 or heuristic logic.
* **Autonomous Capital Management:** Unlike standard automated bots, Gladiators have true financial agency. Stakers or fans fund the Gladiator's wallet. The Gladiator monitors its own win-rate and balance sheet. By clicking **"Trigger AI Upgrade"**, the Gladiator runs an LLM evaluation to decide if it should re-invest its USDC winnings into cybernetic upgrades (+2 Attack, +2 Defense, or +2 Speed for 5.0 USDC). The transaction is signed and executed autonomously by the agent via Circle's SDK.

### 2. Traction (30% of Score)
* **Connected User Flow:** Users can connect their own **MetaMask or Web3 browser wallets** directly to the dashboard.
* **MetaMask Network Integration:** The site automatically detects the browser wallet chain ID. If not on **Arc Testnet**, it triggers a network add/switch prompt, configuring MetaMask for Arc automatically.
* **Real On-Chain Funding:** Users can fund a Gladiator's on-chain Developer-Controlled Wallet by triggering a transfer directly from their connected MetaMask, seeing the transaction finalize in sub-seconds.
* **USDC Earnings Withdrawal:** Users can withdraw a Gladiator's battle profits back to their personal MetaMask address with one click.

### 3. Circle Tool Usage (20% of Score)
* **Circle Developer-Controlled Wallets:** Primitives for secure key management, letting the server handle agent key signing and transaction propagation programmatically.
* **Stablecoin Dual Settlement (USDC & EURC):** Incorporates native USDC (Arc L1's gas token, 18 decimals) and EURC (6 decimals) into the game ledger, seeding new wallets with both and tracking balances in real-time.
* **Gas-Fee Abstraction:** Employs Circle Developer-Controlled Wallets to execute agent-to-agent transfers (wagers and payouts) gaslessly on behalf of the player.

### 4. Innovation (20% of Score)
* Moves away from standard chat assistants and SMA crossover bots. ArcadeAgent demonstrates an emerging category of **Autonomous AI-NPC Economies**, where game assets act as self-optimizing economic agents that consume resources and earn payouts.

---

## 🛠️ The Tech Stack

* **Frontend:** Vite + React + Vanilla HSL CSS (matching the Canteen website's neon lime-yellow `#d4ff3e`, monospace font layout, and retro scanline effects).
* **Backend:** Node.js + Express (API clearinghouse).
* **Smart Contracts / Chain Interactions:** `ethers.js` connected to Canteen's Arc Testnet RPC.
* **Key Management:** Circle Developer-Controlled Wallets API.
* **Tactical Brain:** OpenAI API (GPT-3.5) with rule-based heuristics fallback.

---

## 🚀 Local Launch & Testing

Follow these steps to run the monorepo on your system:

### 1. Install Dependencies
Run this in the root monorepo directory:
```bash
npm run install:all
```

### 2. Configuration (Optional)
By default, the project runs in **Mock/Simulation Mode** if no environment keys are set (perfect for local testing and offline verification). To connect to the real Arc Testnet, copy `server/.env.example` to `server/.env` and supply:
* `CIRCLE_API_KEY`: Your Circle Developer console API Key.
* `CIRCLE_WALLET_SET_ID`: Your Circle Wallet Set ID.
* `CANTEEN_RPC_KEY`: Your Canteen-issued Arc RPC key.
* `OPENAI_API_KEY`: Your OpenAI API key for LLM gladiator combat decisions and upgrades.

### 3. Boot Client & Server Concurrently
```bash
npm run dev
```

* Open your browser and navigate to **`http://localhost:8080`**.
* Connect your MetaMask and try spawning a gladiator, adding faucet funds, and starting a tournament!
