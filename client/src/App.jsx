import React, { useState, useEffect, useRef } from 'react';
import ArenaVisualizer from './ArenaVisualizer';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8081/api';

// Safe JSON fetch — never throws on non-JSON responses (e.g. Vercel HTML error pages)
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export default function App() {
  const [gladiators, setGladiators] = useState([]);
  const [battleHistory, setBattleHistory] = useState([]);
  
  // Selection
  const [selectedGladA, setSelectedGladA] = useState(null);
  const [selectedGladB, setSelectedGladB] = useState(null);
  
  // Combat Simulation
  const [isFighting, setIsFighting] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState(['[System] Awaiting Arena matches... Select two Gladiators.']);
  const [activeHpA, setActiveHpA] = useState(100);
  const [activeHpB, setActiveHpB] = useState(100);
  const [currentRoundEvents, setCurrentRoundEvents] = useState([]);
  const [probabilityHistory, setProbabilityHistory] = useState([50]);
  const [chatMessages, setChatMessages] = useState([]);
  const [roundHazard, setRoundHazard] = useState(null);
  
  // Creator Form
  const [formData, setFormData] = useState({
    name: '',
    role: 'Cyber-Dimachaerus',
    strategy: 'Balanced',
    aggression: 50,
    defense: 30,
    speed: 20,
    customPrompt: ''
  });
  const [isCreating, setIsCreating] = useState(false);
  
  // Browser Wallet Connection
  const [userWallet, setUserWallet] = useState(null);
  const [userBalance, setUserBalance] = useState(null);
  const [fundingAmount, setFundingAmount] = useState('');
  const [withdrawingAmount, setWithdrawingAmount] = useState('');
  const [isFunding, setIsFunding] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);

  // Prediction Market State
  const [predictionData, setPredictionData] = useState(null);
  const [betAmount, setBetAmount] = useState('');
  const [betToken, setBetToken] = useState('USDC');
  const [betTarget, setBetTarget] = useState(''); // 'A' or 'B'
  const [isBetting, setIsBetting] = useState(false);
  const [predictorBalance, setPredictorBalance] = useState({ usdc: 0, eurc: 0 });
  const [spectatorBalance, setSpectatorBalance] = useState({ usdc: 0, eurc: 0 });
  const [isFundingSpectator, setIsFundingSpectator] = useState(false);

  // Arc Faucet
  const [faucetToken, setFaucetToken] = useState('USDC');
  const [isClaimingFaucet, setIsClaimingFaucet] = useState(false);
  const [faucetCooldown, setFaucetCooldown] = useState(null); 
  const [faucetMode, setFaucetMode] = useState(null); 
  
  // Scroller Ref
  const consoleEndRef = useRef(null);
  
  // Simulation Interval Ref
  const battleIntervalRef = useRef(null);

  // Advanced Web3 Gaming State Variables
  const [activeTournament, setActiveTournament] = useState(null);
  const [tourBetTarget, setTourBetTarget] = useState('');
  const [tourBetAmount, setTourBetAmount] = useState('');
  const [isPlacingTourBet, setIsPlacingTourBet] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [isStaking, setIsStaking] = useState(false);
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [voiceCommentary, setVoiceCommentary] = useState(true);
  const [expandedPL, setExpandedPL] = useState({}); // gladId -> boolean
  const [rookieToSponsor, setRookieToSponsor] = useState('');
  const [isEstablishingSyndicate, setIsEstablishingSyndicate] = useState(false);
  const [isCreatingTournament, setIsCreatingTournament] = useState(false);
  const [isSteppingTournament, setIsSteppingTournament] = useState(false);

  // Policy Engine State
  const [policyStats, setPolicyStats] = useState(null);
  const [policyLog, setPolicyLog] = useState([]);

  // Initialize
  useEffect(() => {
    fetchGladiators();
    fetchHistory();
    fetchPredictorBalance();
    fetchActiveTournament();
    fetchPolicyStats();
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts && accounts.length > 0) {
            setUserWallet(accounts[0]);
            updateBrowserBalance(accounts[0]);
            fetchSpectatorBalance(accounts[0]);
          }
        }).catch(err => console.error(err));
    }
    return () => {
      if (battleIntervalRef.current) {
        clearInterval(battleIntervalRef.current);
      }
    };
  }, []);

  const fetchPolicyStats = async () => {
    try {
      const [statsResult, logResult] = await Promise.all([
        apiFetch(`${API_BASE}/policy/stats`).catch(() => null),
        apiFetch(`${API_BASE}/policy/log`).catch(() => null),
      ]);
      if (statsResult?.ok) setPolicyStats(statsResult.data);
      if (logResult?.ok) setPolicyLog(logResult.data);
    } catch (e) { /* silent */ }
  };



  const fetchPredictorBalance = async () => {
    try {
      const res = await fetch(`${API_BASE}/predictor/balance`);
      if (res.ok) {
        const data = await res.json();
        setPredictorBalance({ usdc: data.usdc, eurc: data.eurc });
      }
    } catch (err) {
      console.error("Failed to fetch predictor balance:", err);
    }
  };

  const fetchSpectatorBalance = async (address) => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/user/balance/${address}`);
      if (res.ok) {
        const data = await res.json();
        setSpectatorBalance({ usdc: data.usdc, eurc: data.eurc });
      }
    } catch (err) {
      console.error("Failed to fetch spectator balance:", err);
    }
  };

  const fetchActiveTournament = async () => {
    try {
      const res = await fetch(`${API_BASE}/tournaments/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveTournament(data);
      }
    } catch (err) {
      console.error("Failed to fetch active tournament:", err);
    }
  };

  const handleFundSpectator = async () => {
    if (!userWallet || isFundingSpectator) return;
    setIsFundingSpectator(true);
    try {
      const res = await fetch(`${API_BASE}/user/fund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: userWallet, amount: 100, token: betToken })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchSpectatorBalance(userWallet);
      } else {
        alert(`Funding failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: Cannot reach server.`);
    } finally {
      setIsFundingSpectator(false);
    }
  };

  const handleArcFaucet = async () => {
    if (!userWallet || isClaimingFaucet) return;
    setIsClaimingFaucet(true);
    setFaucetCooldown(null);
    try {
      const res = await fetch(`${API_BASE}/arc-faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: userWallet, token: faucetToken })
      });
      const data = await res.json();
      if (res.ok) {
        setFaucetMode(data.mode);
        alert(data.message);
        fetchSpectatorBalance(userWallet);
        updateBrowserBalance(userWallet);
      } else if (res.status === 429) {
        setFaucetCooldown(data.cooldownMinutes);
        alert(`⏳ ${data.error}`);
      } else {
        alert(`Faucet error: ${data.error}`);
      }
    } catch (err) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsClaimingFaucet(false);
    }
  };

  // Fetch prediction odds when gladiators are selected
  useEffect(() => {
    if (selectedGladA && selectedGladB) {
      fetchPrediction(selectedGladA.id, selectedGladB.id);
    } else {
      setPredictionData(null);
    }
  }, [selectedGladA, selectedGladB]);

  const fetchPrediction = async (gladAId, gladBId) => {
    try {
      const res = await fetch(`${API_BASE}/battles/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gladiatorAId: gladAId, gladiatorBId: gladBId })
      });
      if (res.ok) {
        const data = await res.json();
        setPredictionData(data);
      }
    } catch (err) {
      console.error("Failed to fetch predictions:", err);
    }
  };

  const fetchGladiators = async () => {
    try {
      const { ok, data } = await apiFetch(`${API_BASE}/gladiators`);
      if (ok && Array.isArray(data)) {
        setGladiators(data);
      } else {
        setGladiators([]);
      }
    } catch (err) {
      console.error('Error fetching gladiators:', err.message);
      setGladiators([]);
    }
  };

  const fetchHistory = async () => {
    try {
      const { ok, data } = await apiFetch(`${API_BASE}/battles`);
      if (ok && Array.isArray(data)) {
        setBattleHistory(data);
      } else {
        setBattleHistory([]);
      }
    } catch (err) {
      console.error('Error fetching history:', err.message);
      setBattleHistory([]);
    }
  };

  const connectBrowserWallet = async () => {
    if (!window.ethereum) {
      alert("No Ethereum browser extension detected.");
      return;
    }
    try {
      // Fetch Arc network config — fall back to defaults if API unreachable
      let configData = {
        rpcUrl: 'https://rpc.testnet.arc-node.thecanteenapp.com/v1/public',
        chainId: '0x4ce946',
        chainName: 'Arc Testnet',
        blockExplorerUrl: 'https://testnet.arcscan.app'
      };
      try {
        const { ok, data } = await apiFetch(`${API_BASE}/config`);
        if (ok && data.rpcUrl) configData = { ...configData, ...data };
      } catch (cfgErr) {
        console.warn('[Wallet] Could not fetch config from API, using defaults:', cfgErr.message);
      }
      const targetRpcUrl = configData.rpcUrl;
      const arcChainIdHex = configData.chainId || '0x4ce946';

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      
      const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      
      if (chainIdHex !== arcChainIdHex) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: arcChainIdHex }]
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: arcChainIdHex,
                chainName: configData.chainName || 'Arc Testnet',
                nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                rpcUrls: [targetRpcUrl],
                blockExplorerUrls: [configData.blockExplorerUrl || 'https://testnet.arcscan.app']
              }]
            });
          } else {
            throw switchError;
          }
        }
      }
      
      setUserWallet(address);
      updateBrowserBalance(address);
      fetchSpectatorBalance(address);
      
      window.ethereum.on('accountsChanged', (accs) => {
        if (accs.length > 0) {
          setUserWallet(accs[0]);
          updateBrowserBalance(accs[0]);
        } else {
          setUserWallet(null);
          setUserBalance(null);
        }
      });
      
      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
      
    } catch (err) {
      alert(`Wallet Connection Error: ${err.message}`);
    }
  };

  const updateBrowserBalance = async (address) => {
    if (!window.ethereum || !address) return;
    try {
      const balanceHex = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest']
      });
      const balanceWei = BigInt(balanceHex);
      const balanceDecimal = Number(balanceWei) / 1e18;
      setUserBalance(balanceDecimal.toFixed(2));
    } catch (err) {
      console.error("Error updating browser balance:", err);
    }
  };

  const handleFund = async (gladiatorAddress) => {
    if (!userWallet || !gladiatorAddress || !fundingAmount) return;
    const amountNum = parseFloat(fundingAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Invalid funding amount");
      return;
    }
    
    setIsFunding(true);
    try {
      const valueHex = '0x' + (BigInt(Math.floor(amountNum * 1e6)) * BigInt(1e12)).toString(16);
      
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: userWallet,
          to: gladiatorAddress,
          value: valueHex
        }]
      });
      
      await fetch(`${API_BASE}/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: gladiatorAddress,
          amount: amountNum,
          token: 'USDC'
        })
      });

      alert(`Funding transaction submitted! Tx Hash: ${txHash}`);
      
      setTimeout(() => {
        fetchGladiators();
        updateBrowserBalance(userWallet);
        setIsFunding(false);
        setFundingAmount('');
      }, 3000);
      
    } catch (err) {
      alert(`Funding Failed: ${err.message}`);
      setIsFunding(false);
    }
  };

  const handleWithdraw = async (gladiatorId) => {
    if (!userWallet || !gladiatorId || !withdrawingAmount) return;
    const amountNum = parseFloat(withdrawingAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Invalid withdraw amount");
      return;
    }
    
    setIsWithdrawing(true);
    try {
      const timestamp = Date.now();
      const message = `Authorize withdrawal of ${amountNum} USDC for gladiator ${gladiatorId} to ${userWallet} at timestamp ${timestamp}`;
      
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/withdraw`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-signature': signature,
          'x-message': message,
          'x-owner-address': userWallet
        },
        body: JSON.stringify({
          gladiatorId,
          destinationAddress: userWallet,
          amount: amountNum
        })
      });
      const data = await res.json();
      
      if (res.ok) {
        alert(`Withdrawal successful! Tx Hash: ${data.txHash}`);
        fetchGladiators();
        updateBrowserBalance(userWallet);
      } else {
        alert(`Withdrawal Failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Withdrawal Failed: ${err.message}`);
    } finally {
      setIsWithdrawing(false);
      setWithdrawingAmount('');
    }
  };

  const handlePlaceBet = async () => {
    if (!userWallet || !predictionData || !betAmount || !betTarget) return;
    const amountNum = parseFloat(betAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Invalid bet amount");
      return;
    }

    setIsBetting(true);
    try {
      const gladiatorId = betTarget === 'A' ? predictionData.gladiatorAId : predictionData.gladiatorBId;
      
      // Request MetaMask signature before placing bet
      const timestamp = Date.now();
      const message = `Place bet of ${amountNum} ${betToken} on Gladiator ${gladiatorId} at timestamp ${timestamp}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/bets`, {
         method: 'POST',
         headers: { 
           'Content-Type': 'application/json',
           'x-signature': signature,
           'x-message': message,
           'x-owner-address': userWallet
         },
         body: JSON.stringify({
           gladiatorId,
           amount: amountNum,
           token: betToken
         })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setBetAmount('');
        fetchGladiators();
        updateBrowserBalance(userWallet);
        fetchPredictorBalance();
        fetchSpectatorBalance(userWallet);
      } else {
        alert(`Failed to place bet: ${data.error}`);
      }
    } catch (err) {
      alert(`Betting Failed: ${err.message}`);
    } finally {
      setIsBetting(false);
    }
  };

  const handleAutonomousUpgrade = async (gladiatorId) => {
    if (!gladiatorId || isFighting || isUpgrading) return;
    
    setIsUpgrading(true);
    setConsoleLogs(prev => [
      ...prev,
      `[Upgrade] Contacting Gladiator AI brain to evaluate system stats...`,
      `[Upgrade] Analyzing wins/losses and balance sheets...`
    ]);
    
    try {
      const res = await fetch(`${API_BASE}/gladiators/${gladiatorId}/evaluate-upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      
      if (res.ok) {
        if (data.upgraded) {
          setConsoleLogs(prev => [
            ...prev,
            `=========================================`,
            `🧠 AGENT DECISION: PURCHASE STAT UPGRADE 🧠`,
            `=========================================`,
            `🤔 Thinking Trace:`,
            `  "${data.thinking}"`,
            `-----------------------------------------`,
            ` - Reasoning: "${data.reasoning}"`,
            ` - Action: Purchase +2 ${data.stat.toUpperCase()}`,
            ` - Cost: 5.0 USDC (Settled on Arc L1)`,
            ` - Transaction Hash: ${data.txHash}`,
            `=========================================`,
            `[System] Upgraded stats: Atk ${data.newStats.attack} | Def ${data.newStats.defense} | Spd ${data.newStats.speed}`,
            `[System] Balances refreshed.`
          ]);
          speakCommentaryAnnouncer(`Upgrade completed. +2 points added to system ${data.stat}.`);
        } else {
          setConsoleLogs(prev => [
            ...prev,
            `=========================================`,
            `🧠 AGENT DECISION: HOLD FUNDS 🧠`,
            `=========================================`,
            `🤔 Thinking Trace:`,
            `  "${data.thinking}"`,
            `-----------------------------------------`,
            ` - Reasoning: "${data.reasoning}"`,
            `=========================================`,
          ]);
        }
        fetchGladiators();
      } else {
        setConsoleLogs(prev => [...prev, `[Upgrade Fail] Error: ${data.error}`]);
      }
    } catch (err) {
      setConsoleLogs(prev => [...prev, `[Upgrade Fail] Connection error: ${err.message}`]);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleCreateGladiator = async (e) => {
    e.preventDefault();
    if (!formData.name) return;

    setIsCreating(true);
    try {
      const payload = {
        ...formData,
        ownerAddress: userWallet 
      };
      const res = await fetch(`${API_BASE}/gladiators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const newGlad = await res.json();
      
      if (res.ok) {
        setFormData({ name: '', role: 'Cyber-Dimachaerus', strategy: 'Balanced', aggression: 50, defense: 30, speed: 20, customPrompt: '' });
        await fetchGladiators();
      } else {
        alert(newGlad.error || 'Failed to create gladiator');
      }
    } catch (err) {
      console.error('Error creating gladiator:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleFaucet = async (address) => {
    try {
      const res = await fetch(`${API_BASE}/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      if (res.ok) {
        await fetchGladiators();
      }
    } catch (err) {
      console.error('Faucet request failed:', err);
    }
  };

  const handleDeleteGladiator = async (glad, e) => {
    e.stopPropagation();
    if (isFighting) return;
    if (!userWallet) {
      alert("Please connect browser wallet first.");
      return;
    }
    if (!window.confirm(`Retire "${glad.name}" from the arena? This cannot be undone.`)) return;

    try {
      // Signature verified gladiator retirements
      const timestamp = Date.now();
      const message = `Authorize retirement of gladiator ${glad.id} at timestamp ${timestamp}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/gladiators/${glad.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
          'x-message': message,
          'x-owner-address': userWallet
        }
      });
      const data = await res.json();

      if (res.ok) {
        if (selectedGladA?.id === glad.id) setSelectedGladA(null);
        if (selectedGladB?.id === glad.id) setSelectedGladB(null);
        await fetchGladiators();
      } else {
        alert(`Could not retire gladiator: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleMintNFT = async (glad, e) => {
    e.stopPropagation();
    if (isFighting) return;
    if (!userWallet) {
      alert("Please connect your browser wallet first.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/gladiators/${glad.id}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: userWallet })
      });
      const data = await res.json();

      if (res.ok) {
        alert(`Success! Minted Gladiator "${glad.name}" as an NFT.\nTx: ${data.nftTxHash}\nToken ID: ${data.nftTokenId}`);
        await fetchGladiators();
      } else {
        alert(`NFT Minting failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Minting error: ${err.message}`);
    }
  };

  const handleSelect = (glad) => {
    if (isFighting) return;

    if (selectedGladA?.id === glad.id) {
      setSelectedGladA(null);
      return;
    }
    if (selectedGladB?.id === glad.id) {
      setSelectedGladB(null);
      return;
    }

    if (!selectedGladA) {
      setSelectedGladA(glad);
    } else if (!selectedGladB) {
      setSelectedGladB(glad);
    }
  };

  // Text to Speech announce Commentary
  const speakCommentaryAnnouncer = (text, isFighterA = null) => {
    if (!voiceCommentary || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel(); // Stop current speech
      const utterance = new SpeechSynthesisUtterance(text);
      if (isFighterA === true) {
        utterance.pitch = 0.85; 
      } else if (isFighterA === false) {
        utterance.pitch = 1.25; 
      } else {
        utterance.pitch = 1.0; 
      }
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("SpeechSynthesis error:", err.message);
    }
  };

  const handleStartBattle = async (isSandbox = false, tournamentData = null) => {
    if (!selectedGladA || !selectedGladB || isFighting) return;

    setIsFighting(true);
    setCurrentRoundEvents([]);
    setProbabilityHistory([50]);
    setRoundHazard(null);
    
    if (isSandbox) {
      setConsoleLogs([
        `[Sandbox] Initiating free practice run...`,
        `[Sandbox] No wagers required. Simulated arena loading...`,
        `[System] Match secured! Simulated arena is live.`
      ]);
      setChatMessages([
        { user: 'sys_admin', text: '⚡ SANDBOX TRIAL STARTED. Spectators welcome. ⚡', color: '#ff2a74' },
        { user: 'canteen_bot', text: '🤖 Sandbox active: attributes sliders applied to weights.', color: 'var(--accent)' }
      ]);
      speakCommentaryAnnouncer("Practice trial starting now. Fight!");
    } else {
      const addrA = selectedGladA.walletAddress ? String(selectedGladA.walletAddress).slice(0, 10) : '0x0000000000';
      const addrB = selectedGladB.walletAddress ? String(selectedGladB.walletAddress).slice(0, 10) : '0x0000000000';
      setConsoleLogs([
        `[Arc L1] Initiating battle wagers...`,
        `[CircleSDK] Securing 5.0 USDC wagers from:`,
        ` - ${selectedGladA.name} (${addrA}...)`,
        ` - ${selectedGladB.name} (${addrB}...)`
      ]);
      setChatMessages([
        { user: 'sys_admin', text: '⚡ Welcome to the Arena Live Stream! Placing bets is closed. ⚡', color: '#ff2a74' },
        { user: 'canteen_bot', text: '🤖 Spectator channels connecting... wagers locked.', color: 'var(--accent)' }
      ]);
      speakCommentaryAnnouncer(`USDC battle initialized between ${selectedGladA.name} and ${selectedGladB.name}. Let the battle begin!`);
    }
    setActiveHpA(100);
    setActiveHpB(100);

    try {
      let battleData;
      
      // If triggered as part of tournament simulation
      if (tournamentData) {
        battleData = tournamentData.battleRecord;
      } else {
        const endpoint = isSandbox ? '/battles/sandbox' : '/battles';
        try {
          const { ok, data, status } = await apiFetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gladiatorAId: selectedGladA.id,
              gladiatorBId: selectedGladB.id
            })
          });
          battleData = data;
          if (!ok) {
            // Check if blocked by policy engine
            if (status === 403 && data.policy) {
              setConsoleLogs(prev => [...prev,
                `[PolicyEngine] ❌ BATTLE BLOCKED`,
                `[Rule ${data.policy.ruleCode}] ${data.policy.reason}`,
                `[SHA-256] ${data.policy.sha256}`,
              ]);
              fetchPolicyStats();
            } else {
              setConsoleLogs(prev => [...prev, `[FAIL] Battle setup failed: ${data.error || 'Unknown error'}`]);
            }
            setIsFighting(false);
            return;
          }
        } catch (fetchErr) {
          setConsoleLogs(prev => [...prev, `[FAIL] Could not reach server: ${fetchErr.message}`]);
          setIsFighting(false);
          return;
        }
      }

      if (!isSandbox && !tournamentData) {
        const hashA = battleData.wagerAHash ? String(battleData.wagerAHash).slice(0, 20) : 'N/A';
        const hashB = battleData.wagerBHash ? String(battleData.wagerBHash).slice(0, 20) : 'N/A';
        setConsoleLogs(prev => [
          ...prev,
          `[Arc L1] Wager Tx A: ${hashA}...`,
          `[Arc L1] Wager Tx B: ${hashB}...`,
          `[System] Match secured! Simulated arena is live.`
        ]);
      }

      let roundIdx = 0;
      const history = battleData?.history || [];

      if (battleIntervalRef.current) {
        clearInterval(battleIntervalRef.current);
      }

      // Periodically trigger autonomous Degen Chat Bot comments
      const degenPhrases = [
        "Win prob shifts are looking wild here!",
        "Kelly criterion suggests raising stakes on A!",
        "Double or nothing on this turn!",
        "A's defensive upgrades are really paying off.",
        "Look at that lunge attack! Superb calibration!"
      ];

      battleIntervalRef.current = setInterval(() => {
        if (roundIdx >= history.length) {
          if (battleIntervalRef.current) {
            clearInterval(battleIntervalRef.current);
            battleIntervalRef.current = null;
          }
          
          const isWinnerA = battleData?.winnerId === selectedGladA?.id;
          const winnerGlad = isWinnerA ? selectedGladA : selectedGladB;
          
          setProbabilityHistory(prev => [...prev, isWinnerA ? 100 : 0]);

          let payoutText = [];
          if (!isSandbox && Array.isArray(battleData?.betPayouts)) {
            const myPayouts = battleData.betPayouts.filter(p => p.userAddress && p.userAddress.toLowerCase() === userWallet?.toLowerCase() && p.won);
            if (myPayouts.length > 0) {
              myPayouts.forEach(p => {
                payoutText.push(`💰 SPECTATOR WIN: Credited ${p.amount} ${p.token} to your wallet!`);
              });
            }
          }

          const botUsers = [
            { name: 'neon_rider', color: '#00ff87' },
            { name: 'cyber_k1d', color: '#00e5ff' },
            { name: 'degen_bot', color: '#ff00ff' },
            { name: 'dex_trader', color: '#ff3f34' }
          ];
          const finalUser = botUsers[Math.floor(Math.random() * botUsers.length)];
          const nameA = selectedGladA?.name || 'Gladiator A';
          const nameB = selectedGladB?.name || 'Gladiator B';
          const finalChatMsg = isWinnerA 
            ? { user: finalUser.name, text: `GG! ${nameA} absolutely dominated.`, color: finalUser.color }
            : { user: finalUser.name, text: `GG! What an upset by ${nameB}!`, color: finalUser.color };
          
          const degenReaction = isWinnerA
            ? { user: 'degen_bot', text: `Boom! Easy gains on ${nameA}! Taping my ROI ledger now.`, color: '#ff00ff' }
            : { user: 'degen_bot', text: `No way! ${nameA} lost? My bankroll is ruined!`, color: '#ff00ff' };

          setChatMessages(prev => [...prev, finalChatMsg, degenReaction, { user: 'sys_admin', text: '🏁 Battle completed. Arena cleared. 🏁', color: '#ff2a74' }].slice(-25));

          const winnerName = winnerGlad?.name ? String(winnerGlad.name).toUpperCase() : 'UNKNOWN';
          setConsoleLogs(prev => [
            ...prev,
            `=========================================`,
            `🏆 VICTORY: ${winnerName} HAS WON THE BATTLE! 🏆`,
            `=========================================`,
            isSandbox ? `[Sandbox] Practice simulation finished. No real token payout.` : `[CircleSDK] Transferring USDC prize share to winner...`,
            isSandbox ? `[Sandbox] No txn recorded.` : `[Arc L1] Payout Tx Hash: ${battleData?.payoutHash || 'Pending/Failed'}`,
            ...payoutText,
            `[System] Battle recorded. Refreshing balances...`
          ]);

          speakCommentaryAnnouncer(`Match complete. Victory belongs to ${winnerName}!`);

          fetchGladiators();
          fetchHistory();
          fetchPredictorBalance();
          fetchActiveTournament();
          fetchPolicyStats();
          if (userWallet) fetchSpectatorBalance(userWallet);
          setIsFighting(false);
          return;
        }

        const round = history[roundIdx];
        if (!round) {
          roundIdx++;
          return;
        }

        setConsoleLogs(prev => [
          ...prev,
          `\n--- ROUND ${round.round || roundIdx + 1} ---`
        ]);

        // Hazard Alert Trigger
        if (round.hazard) {
          setRoundHazard(round.hazard);
          setConsoleLogs(prev => [
            ...prev,
            `⚠️ HAZARD ALERT: ${round.hazard.narrative}`
          ]);
          speakCommentaryAnnouncer(`Warning: ${round.hazard.narrative}`);
        } else {
          setRoundHazard(null);
        }

        const events = round.events || [];
        setCurrentRoundEvents(events);

        let hpA = 100;
        let hpB = 100;

        events.filter(Boolean).forEach(event => {
          setConsoleLogs(prev => [
            ...prev,
            `🤖 [${event.name || 'Gladiator'}] Strategy action: ${event.action || 'Unknown'}`,
            event.thinking ? ` 🧠 Thinking: "${event.thinking}"` : '',
            ` > "${event.narrative || ''}"`,
            (event.damageDealt || 0) > 0 ? ` 💥 Deals ${event.damageDealt} damage!` : '',
            (event.healingDone || 0) > 0 ? ` 💚 Restores ${event.healingDone} HP!` : ''
          ].filter(Boolean));

          // Speak combat narrative aloud
          if (event.narrative) {
            const isFighterA = event.gladiatorId === selectedGladA?.id;
            speakCommentaryAnnouncer(event.narrative, isFighterA);
          }

          if (event.gladiatorId === selectedGladA?.id) {
            hpA = event.hpAfter ?? hpA;
            hpB = event.defenderHpAfter ?? hpB;
            setActiveHpA(event.hpAfter ?? hpA);
            setActiveHpB(event.defenderHpAfter ?? hpB);
          } else {
            hpB = event.hpAfter ?? hpB;
            hpA = event.defenderHpAfter ?? hpA;
            setActiveHpB(event.hpAfter ?? hpB);
            setActiveHpA(event.defenderHpAfter ?? hpA);
          }
        });

        // Compute Live probability
        const totalHp = hpA + hpB;
        const probA = totalHp > 0 ? (hpA / totalHp) * 100 : 50;
        setProbabilityHistory(prev => [...prev, probA]);

        // Chat commentaries
        const botUsers = [
          { name: 'neon_rider', color: '#00ff87' },
          { name: 'cyber_k1d', color: '#00e5ff' },
          { name: 'bit_runner', color: '#ffd32a' },
          { name: 'dex_trader', color: '#ff3f34' },
          { name: 'canteen_fanatic', color: '#ff2a74' },
          { name: 'circle_whale', color: '#d4ff3e' }
        ];

        let newChats = [];
        events.filter(Boolean).forEach(event => {
          const user = botUsers[Math.floor(Math.random() * botUsers.length)];
          const actionWord = event.action === 'ATTACK' ? 'lands a strike' : event.action === 'SPECIAL' ? 'unloads special attack' : event.action === 'DEFEND' ? 'shields up' : 'injects repair stims';
          newChats.push({ 
            user: user.name, 
            text: `Round ${round.round}: ${event.name} ${actionWord}!`, 
            color: user.color 
          });
        });

        // Random Degen Bot trading comment
        if (Math.random() > 0.4) {
          const degenPhrase = degenPhrases[Math.floor(Math.random() * degenPhrases.length)];
          newChats.push({ user: 'degen_bot', text: degenPhrase, color: '#ff00ff' });
        }
        setChatMessages(prev => [...prev, ...newChats].slice(-25));

        roundIdx++;
      }, 1800);

    } catch (err) {
      setConsoleLogs(prev => [...prev, `[Error] Failed to connect: ${err.message}`]);
      setIsFighting(false);
    }
  };

  // Staking & DeFi helpers
  const handleStake = async (token = 'USDC') => {
    const glad = selectedGladA || selectedGladB;
    if (!glad || !stakeAmount) return;
    const amountNum = parseFloat(stakeAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Invalid stake amount.");
      return;
    }
    if (!userWallet) {
      alert("Please connect browser wallet first.");
      return;
    }

    setIsStaking(true);
    try {
      const res = await fetch(`${API_BASE}/gladiators/${glad.id}/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: userWallet,
          amount: amountNum,
          token
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setStakeAmount('');
        fetchGladiators();
        fetchSpectatorBalance(userWallet);
      } else {
        alert(`Staking failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Staking request failed: ${err.message}`);
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async (token = 'USDC') => {
    const glad = selectedGladA || selectedGladB;
    if (!glad || !unstakeAmount) return;
    const amountNum = parseFloat(unstakeAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Invalid unstake amount.");
      return;
    }
    if (!userWallet) {
      alert("Please connect browser wallet first.");
      return;
    }

    setIsUnstaking(true);
    try {
      const timestamp = Date.now();
      const message = `Authorize unstaking of ${amountNum} ${token} from Gladiator ${glad.id} at timestamp ${timestamp}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/gladiators/${glad.id}/unstake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
          'x-message': message,
          'x-owner-address': userWallet
        },
        body: JSON.stringify({
          amount: amountNum,
          token
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setUnstakeAmount('');
        fetchGladiators();
        fetchSpectatorBalance(userWallet);
      } else {
        alert(`Unstaking failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Unstaking failed: ${err.message}`);
    } finally {
      setIsUnstaking(false);
    }
  };

  const handleBuyGear = async (itemId) => {
    const glad = selectedGladA || selectedGladB;
    if (!glad) return;

    try {
      const res = await fetch(`${API_BASE}/gladiators/${glad.id}/buy-gear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchGladiators();
      } else {
        alert(`Purchase failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Gear purchase failed: ${err.message}`);
    }
  };

  const handleSyndicateSponsor = async () => {
    const sponsorGlad = selectedGladA || selectedGladB;
    if (!sponsorGlad || !rookieToSponsor || !userWallet) return;

    setIsEstablishingSyndicate(true);
    try {
      const timestamp = Date.now();
      const message = `Authorize syndicate sponsorship: Gladiator ${sponsorGlad.id} sponsors rookie ${rookieToSponsor} for 20.0 USDC at timestamp ${timestamp}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/syndicates/sponsor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
          'x-message': message,
          'x-owner-address': userWallet
        },
        body: JSON.stringify({
          sponsorGladId: sponsorGlad.id,
          rookieGladId: rookieToSponsor
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setRookieToSponsor('');
        fetchGladiators();
      } else {
        alert(`Syndicate setup failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Syndicate failed: ${err.message}`);
    } finally {
      setIsEstablishingSyndicate(false);
    }
  };

  const handleCreateTournament = async () => {
    setIsCreatingTournament(true);
    try {
      const res = await fetch(`${API_BASE}/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        alert("8-Gladiator bracket tournament spawned! Visualizing bracket details.");
        setActiveTournament(data);
        fetchGladiators();
      } else {
        alert(`Failed to create tournament: ${data.error}`);
      }
    } catch (err) {
      alert(`Tournament creation failed: ${err.message}`);
    } finally {
      setIsCreatingTournament(false);
    }
  };

  const handleStepTournament = async () => {
    if (!activeTournament || isSteppingTournament) return;
    setIsSteppingTournament(true);
    try {
      const res = await fetch(`${API_BASE}/tournaments/${activeTournament.id}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setActiveTournament(data.tournament);
        
        // Select contestants
        const matchRecord = data.battleRecord;
        const gladA = gladiators.find(g => g.id === matchRecord.gladiatorA.id);
        const gladB = gladiators.find(g => g.id === matchRecord.gladiatorB.id);
        
        if (gladA && gladB) {
          setSelectedGladA(gladA);
          setSelectedGladB(gladB);
          
          // Trigger the battle simulation visualizer
          setTimeout(() => {
            handleStartBattle(false, data);
          }, 500);
        }
      } else {
        alert(`Failed to simulate step: ${data.error}`);
      }
    } catch (err) {
      alert(`Tournament step failed: ${err.message}`);
    } finally {
      setIsSteppingTournament(false);
    }
  };

  const handlePlaceTourBet = async () => {
    if (!activeTournament || !tourBetTarget || !tourBetAmount || !userWallet) return;
    const amountNum = parseFloat(tourBetAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setIsPlacingTourBet(true);
    try {
      const timestamp = Date.now();
      const message = `Place tournament champion bet of ${amountNum} USDC on Gladiator ${tourBetTarget} at timestamp ${timestamp}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, userWallet]
      });

      const res = await fetch(`${API_BASE}/tournaments/${activeTournament.id}/bet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
          'x-message': message,
          'x-owner-address': userWallet
        },
        body: JSON.stringify({
          gladiatorId: tourBetTarget,
          amount: amountNum,
          token: 'USDC'
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Tournament wager recorded!");
        setTourBetAmount('');
        setActiveTournament(data.tournament);
        fetchSpectatorBalance(userWallet);
      } else {
        alert(`Tournament bet failed: ${data.error}`);
      }
    } catch (err) {
      alert(`Wager failed: ${err.message}`);
    } finally {
      setIsPlacingTourBet(false);
    }
  };

  const getGladiatorAvatar = (name, role) => {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('spartacus')) return '/spartacus.png';
    if (lowerName.includes('crixus')) return '/crixus.png';
    if (lowerName.includes('gannicus')) return '/gannicus.png';
    if (lowerName.includes('flamma')) return '/flamma.png';
    
    // Fallback to role-based mapping
    if (role === 'Cyber-Retiarius' || role === 'Netrunner') return '/spartacus.png';
    if (role === 'Cyber-Dimachaerus' || role === 'Cyber-Samurai') return '/crixus.png';
    if (role === 'Cyber-Thraex') return '/gannicus.png';
    if (role === 'Cyber-Murmillo' || role === 'Mech-Tank') return '/flamma.png';
    
    return '/spartacus.png'; // default fallback
  };

  const getRoleEmoji = (role) => {
    if (role === 'Cyber-Dimachaerus' || role === 'Cyber-Samurai') return '⚔️';
    if (role === 'Cyber-Retiarius' || role === 'Netrunner') return '⚡';
    if (role === 'Cyber-Thraex') return '🗡️';
    return '🛡️';
  };

  const sortedLeaderboard = Array.isArray(gladiators) ? [...gladiators].sort((a, b) => (b.wins || 0) - (a.wins || 0)) : [];

  // Calculate Gladiator ROI and Ledger Stats
  const calculatePLDetails = (glad) => {
    const ledger = glad.financialLedger || [];
    let winnings = 0;
    let spending = 0;
    
    ledger.forEach(item => {
      if (item.type === 'payout' || item.type === 'sponsorship' || item.type === 'dividend') {
        if (item.amount > 0) winnings += item.amount;
        else spending += Math.abs(item.amount);
      } else if (item.type === 'wager' || item.type === 'upgrade' || item.type === 'purchase' || item.type === 'syndicate_payout') {
        spending += Math.abs(item.amount);
      }
    });

    const net = winnings - spending;
    const roi = spending > 0 ? (net / spending) * 100 : 0;
    return { winnings, spending, net, roi };
  };

  // Render Bracket tree widget
  const renderBracket = () => {
    if (!activeTournament) {
      return (
        <div style={{ padding: '1rem', background: '#090a10', border: '1px solid var(--border-color)', borderRadius: '4px', marginTop: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.8rem' }}>🏆 NO ACTIVE TOURNAMENT BRACKET RUNNING</div>
          <button 
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0.5rem 1.5rem', fontSize: '0.7rem' }}
            disabled={isCreatingTournament || isFighting}
            onClick={handleCreateTournament}
          >
            {isCreatingTournament ? 'SPAWNING BRACKETS...' : '👑 GENERATE 8-GLADIATOR TOURNAMENT'}
          </button>
        </div>
      );
    }

    const t = activeTournament;
    const resolveGladName = (id) => {
      if (!id) return "TBD";
      const g = gladiators.find(glad => glad.id === id);
      return g ? g.name : "System Agent";
    };

    return (
      <div className="tournament-bracket" style={{ padding: '1rem', background: '#090a10', border: '1px solid var(--border-color)', borderRadius: '4px', marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '0.75rem', color: 'var(--accent)', margin: 0, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🏆 8-Gladiator Tournament Bracket (Active)
          </h3>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button 
              className="btn btn-secondary btn-small"
              style={{ width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.65rem' }}
              onClick={fetchActiveTournament}
            >
              🔄 SYNC
            </button>
            <button 
              className="btn btn-primary btn-small"
              style={{ width: 'auto', padding: '0.35rem 0.8rem', fontSize: '0.65rem', background: 'linear-gradient(135deg, #d4ff3e, #8cff3e)', color: '#000' }}
              onClick={handleStepTournament}
              disabled={isFighting || isSteppingTournament}
            >
              {isSteppingTournament ? 'SIMULATING...' : '⚔️ STEP NEXT MATCH'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
          {/* Quarterfinals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--cyan)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', textAlign: 'center', fontFamily: 'monospace' }}>QUARTERFINALS</div>
            {t.matches.round1.map((m) => (
              <div key={m.id} style={{ padding: '0.4rem', background: '#141722', border: m.winner ? '1px solid var(--border-color)' : '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', fontSize: '0.65rem', textAlign: 'left', fontFamily: 'monospace' }}>
                <div style={{ color: m.winner === m.gladA ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladA ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladA)}</span>
                  <span>{m.winner === m.gladA && '👑'}</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.15)', margin: '1px 0', fontSize: '0.55rem' }}>vs</div>
                <div style={{ color: m.winner === m.gladB ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladB ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladB)}</span>
                  <span>{m.winner === m.gladB && '👑'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Semifinals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--cyan)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', textAlign: 'center', fontFamily: 'monospace' }}>SEMIFINALS</div>
            {t.matches.round2.map((m) => (
              <div key={m.id} style={{ padding: '0.4rem', background: '#141722', border: m.winner ? '1px solid var(--border-color)' : '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', fontSize: '0.65rem', textAlign: 'left', fontFamily: 'monospace' }}>
                <div style={{ color: m.winner === m.gladA ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladA ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladA)}</span>
                  <span>{m.winner === m.gladA && '👑'}</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.15)', margin: '1px 0', fontSize: '0.55rem' }}>vs</div>
                <div style={{ color: m.winner === m.gladB ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladB ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladB)}</span>
                  <span>{m.winner === m.gladB && '👑'}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Finals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5rem' }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--cyan)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem', textAlign: 'center', fontFamily: 'monospace' }}>FINALS</div>
            {t.matches.round3.map((m) => (
              <div key={m.id} style={{ padding: '0.4rem', background: '#141722', border: m.winner ? '1px solid var(--border-color)' : '1px solid rgba(255,255,255,0.08)', borderRadius: '3px', fontSize: '0.65rem', textAlign: 'left', fontFamily: 'monospace' }}>
                <div style={{ color: m.winner === m.gladA ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladA ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladA)}</span>
                  <span>{m.winner === m.gladA && '👑'}</span>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.15)', margin: '1px 0', fontSize: '0.55rem' }}>vs</div>
                <div style={{ color: m.winner === m.gladB ? 'var(--accent)' : '#fff', fontWeight: m.winner === m.gladB ? 'bold' : 'normal', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{resolveGladName(m.gladB)}</span>
                  <span>{m.winner === m.gladB && '👑'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tournament Champion Bets */}
        {t.status === 'active' && t.round === 1 && (
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>🏆 Pool: <span style={{ color: 'var(--yellow)' }}>{t.bettingPool.totalPool} USDC</span> | Bet Champion:</span>
            {userWallet ? (
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <select 
                  className="form-select" 
                  style={{ width: 'auto', padding: '0.35rem', fontSize: '0.65rem', height: 'auto' }}
                  value={tourBetTarget}
                  onChange={e => setTourBetTarget(e.target.value)}
                  disabled={isPlacingTourBet}
                >
                  <option value="">Choose Gladiator</option>
                  {t.gladiators.map(gid => (
                    <option key={gid} value={gid}>{resolveGladName(gid)}</option>
                  ))}
                </select>
                <input 
                  type="number"
                  placeholder="USDC"
                  className="form-input"
                  style={{ width: '60px', padding: '0.35rem', fontSize: '0.65rem', height: 'auto' }}
                  value={tourBetAmount}
                  onChange={e => setTourBetAmount(e.target.value)}
                  disabled={isPlacingTourBet}
                />
                <button 
                  className="btn btn-primary btn-small"
                  style={{ width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.65rem', height: 'auto' }}
                  onClick={handlePlaceTourBet}
                  disabled={isPlacingTourBet || !tourBetTarget || !tourBetAmount}
                >
                  {isPlacingTourBet ? '...' : 'BET'}
                </button>
              </div>
            ) : (
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Connect browser wallet to place wagers</span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">ARCADE AGENT</h1>
        <p className="app-subtitle">USDC-Backed Autonomous AI Gladiator Arena | settled on <span>Arc L1</span></p>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {!userWallet ? (
            <button className="btn btn-secondary btn-small" style={{ width: 'auto', padding: '0.6rem 1.2rem' }} onClick={connectBrowserWallet}>
              🔌 CONNECT BROWSER WALLET
            </button>
          ) : (
            <div className="gladiator-role-tag role-netrunner" style={{ fontSize: '0.75rem', padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff00', display: 'inline-block' }}></span>
              WALLET: {userWallet.slice(0, 6)}...{userWallet.slice(-4)} | {userBalance} USDC (Arc L1)
            </div>
          )}
        </div>
      </header>

      {/* Grid Dashboard */}
      <main className="dashboard-grid">
        
        {/* Left Column: Creator and Roster */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Creator Panel */}
          <div className="panel">
            <h2 className="panel-title">CREATE GLADIATOR</h2>
            <form onSubmit={handleCreateGladiator}>
              <div className="form-group">
                <label className="form-label">Gladiator Alias</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Cyber-X"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={isFighting || isCreating}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Combat Class</label>
                <select
                  className="form-select"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  disabled={isFighting || isCreating}
                >
                  <option value="Cyber-Dimachaerus">⚔️ Cyber-Dimachaerus (High Atk/Spd)</option>
                  <option value="Cyber-Retiarius">⚡ Cyber-Retiarius (High Spd/Exploits)</option>
                  <option value="Cyber-Murmillo">🛡️ Cyber-Murmillo (High Def/Armor)</option>
                  <option value="Cyber-Thraex">🗡️ Cyber-Thraex (Agile/Balanced)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Aggression ({formData.aggression})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                    value={formData.aggression}
                    onChange={(e) => setFormData({ ...formData, aggression: parseInt(e.target.value) })}
                    disabled={isFighting || isCreating}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Defense ({formData.defense})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                    value={formData.defense}
                    onChange={(e) => setFormData({ ...formData, defense: parseInt(e.target.value) })}
                    disabled={isFighting || isCreating}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Speed ({formData.speed})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                    value={formData.speed}
                    onChange={(e) => setFormData({ ...formData, speed: parseInt(e.target.value) })}
                    disabled={isFighting || isCreating}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Custom AI Directive (Prompt Sandbox)</label>
                <textarea
                  className="form-input"
                  style={{ resize: 'none', height: '60px', fontSize: '0.7rem', fontFamily: 'monospace' }}
                  placeholder="e.g. Focus on defense if HP < 40, prioritize Special attacks on Netrunners..."
                  maxLength="300"
                  value={formData.customPrompt}
                  onChange={(e) => setFormData({ ...formData, customPrompt: e.target.value })}
                  disabled={isFighting || isCreating}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Combat Action Style</label>
                <select
                  className="form-select"
                  value={formData.strategy}
                  onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
                  disabled={isFighting || isCreating}
                >
                  <option value="Balanced">Balanced (Standard AI Subroutine)</option>
                  <option value="Aggressive">Aggressive Bias (Overdrive Attack/Special)</option>
                  <option value="Defensive">Defensive Bias (Priority Recovery/Shield)</option>
                </select>
              </div>

              <button className="btn btn-primary" type="submit" disabled={isFighting || isCreating}>
                {isCreating ? 'CREATING WALLET...' : 'ACTIVATE GLADIATOR'}
              </button>
            </form>
          </div>

          {/* Roster Panel */}
          <div className="panel cyan-accent" style={{ flexGrow: 1 }}>
            <h2 className="panel-title">
              GLADIATOR ROSTER 
              <span style={{ fontSize: '0.65rem', color: 'var(--cyan)' }}>
                {gladiators.length} ACTIVE
              </span>
            </h2>
            
            <div className="gladiator-list">
              {Array.isArray(gladiators) && gladiators.map((glad) => {
                const isSelectedA = selectedGladA?.id === glad.id;
                const isSelectedB = selectedGladB?.id === glad.id;
                const selectionClass = isSelectedA || isSelectedB ? 'selected' : '';
                const roleClass = glad.role === 'Cyber-Dimachaerus' || glad.role === 'Cyber-Samurai' ? 'role-dimachaerus' : glad.role === 'Cyber-Retiarius' || glad.role === 'Netrunner' ? 'role-retiarius' : glad.role === 'Cyber-Murmillo' || glad.role === 'Mech-Tank' ? 'role-murmillo' : 'role-thraex';
                
                const pl = calculatePLDetails(glad);
                const isPLExpanded = !!expandedPL[glad.id];

                return (
                  <div
                    key={glad.id}
                    className={`gladiator-card ${selectionClass}`}
                    onClick={() => handleSelect(glad)}
                    style={{ position: 'relative', display: 'flex', gap: '0.8rem', padding: '0.8rem', alignItems: 'flex-start' }}
                  >
                    <img 
                      src={getGladiatorAvatar(glad.name, glad.role)} 
                      alt={glad.name} 
                      style={{ 
                        width: '42px', 
                        height: '42px', 
                        borderRadius: '4px', 
                        border: `1px solid ${isSelectedA ? 'var(--yellow)' : isSelectedB ? 'var(--cyan)' : 'rgba(255,255,255,0.15)'}`,
                        objectFit: 'cover',
                        background: '#090a10',
                        marginTop: '2px',
                        flexShrink: 0
                      }}
                    />
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <div className="gladiator-name-row" style={{ marginTop: 0 }}>
                        <span className="gladiator-name">
                          {getRoleEmoji(glad.role)} {glad.name}
                        </span>
                        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                          {glad.nftMinted && (
                            <span className="gladiator-role-tag" style={{ background: 'rgba(212, 255, 62, 0.15)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                              💿 NFT
                            </span>
                          )}
                          <span className={`gladiator-role-tag ${roleClass}`}>{(glad.role ? glad.role.split('-')[1] : '') || glad.role || 'Gladiator'}</span>
                        </div>
                      </div>

                    <div className="gladiator-wallet">
                      {glad.walletAddress ? String(glad.walletAddress).slice(0, 14) : ''}...{glad.walletAddress ? String(glad.walletAddress).slice(-6) : ''}
                    </div>

                    <div style={{ fontSize: '0.62rem', color: 'var(--g400)', fontFamily: 'monospace', marginBottom: '0.4rem', textAlign: 'left' }}>
                      ⚙️ AGR: {glad.attributes?.aggression ?? 50} | DEF: {glad.attributes?.defense ?? 30} | SPD: {glad.attributes?.speed ?? 20}
                      <br />
                      🧠 Persona: <span style={{ color: '#ff00ff' }}>{glad.personality || "Stoic-Mech"}</span>
                      {glad.equipment && glad.equipment.length > 0 && (
                        <div style={{ color: 'var(--cyan)', marginTop: '2px' }}>
                          📦 Gear: {glad.equipment.map(e => e.toUpperCase()).join(', ')}
                        </div>
                      )}
                      {glad.syndicate?.parentSponsor && (
                        <div style={{ color: 'var(--yellow)', marginTop: '2px' }}>
                          🤝 Sponsored by: {gladiators.find(g => g.id === glad.syndicate.parentSponsor)?.name || "Unknown"}
                        </div>
                      )}
                    </div>

                    <div className="gladiator-stats">
                      <span>W:{glad.wins || 0} / L:{glad.losses || 0}</span>
                      <span className="gladiator-balance-tag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.75rem', gap: '0.1rem' }}>
                        <span>🪙 {typeof glad.balance === 'number' ? glad.balance.toFixed(1) : '0.0'} USDC</span>
                        <span>💶 {typeof glad.eurcBalance === 'number' ? glad.eurcBalance.toFixed(1) : '0.0'} EURC</span>
                      </span>
                    </div>

                    {/* Staking Total Display */}
                    {glad.stakingPool?.totalStaked > 0 && (
                      <div style={{ fontSize: '0.62rem', color: 'var(--accent)', fontFamily: 'monospace', textAlign: 'left', marginTop: '0.2rem', background: 'rgba(212,255,62,0.05)', padding: '0.2rem' }}>
                        🛡️ Sponsored Pool: {glad.stakingPool.totalStaked} USDC ({Object.keys(glad.stakingPool.stakers).length} sponsors)
                      </div>
                    )}

                    {/* Collapsible P&L Ledger Panel */}
                    <div style={{ marginTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
                      <div 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.62rem', color: 'var(--cyan)', cursor: 'pointer', padding: '0.3rem 0' }}
                        onClick={() => setExpandedPL(prev => ({ ...prev, [glad.id]: !prev[glad.id] }))}
                      >
                        <span>📊 Financial Ledger & P&L Statement</span>
                        <span>{isPLExpanded ? '▲ Close' : '▼ Expand'}</span>
                      </div>
                      
                      {isPLExpanded && (
                        <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', padding: '0.4rem', background: 'rgba(0,0,0,0.4)', borderRadius: '3px', textAlign: 'left', lineHeight: '1.4' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.25rem', marginBottom: '0.25rem' }}>
                            <div>Total Winnings:</div>
                            <div style={{ textAlign: 'right', color: '#00ff87' }}>+{pl.winnings.toFixed(2)} USDC</div>
                            <div>Total Cost:</div>
                            <div style={{ textAlign: 'right', color: '#ff5252' }}>-{pl.spending.toFixed(2)} USDC</div>
                            <div style={{ fontWeight: 'bold' }}>Net P&L:</div>
                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: pl.net >= 0 ? '#00ff87' : '#ff5252' }}>{pl.net >= 0 ? '+' : ''}{pl.net.toFixed(2)} USDC</div>
                            <div style={{ fontWeight: 'bold' }}>Est. ROI:</div>
                            <div style={{ textAlign: 'right', fontWeight: 'bold', color: pl.roi >= 0 ? '#00ff87' : '#ff5252' }}>{pl.roi >= 0 ? '+' : ''}{pl.roi.toFixed(1)}%</div>
                          </div>
                          
                          <div style={{ maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                            {glad.financialLedger && glad.financialLedger.map((record, index) => (
                              <div key={record.id || index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: '0.55rem', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{new Date(record.timestamp).toLocaleDateString()} {record.type.toUpperCase()}</span>
                                <span style={{ color: record.amount >= 0 ? '#00ff87' : '#ff5252' }}>
                                  {record.amount >= 0 ? '+' : ''}{record.amount.toFixed(1)}
                                </span>
                              </div>
                            ))}
                            {(!glad.financialLedger || glad.financialLedger.length === 0) && (
                              <div style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', fontSize: '0.55rem' }}>No transaction history found.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                      <button 
                        className="btn btn-secondary btn-small"
                        onClick={() => handleFaucet(glad.walletAddress)}
                        disabled={isFighting}
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.6rem' }}
                      >
                        + 50 USDC
                      </button>
                      
                      {userWallet && glad.ownerAddress && glad.ownerAddress.toLowerCase() === userWallet.toLowerCase() && !glad.nftMinted && (
                        <button 
                          className="btn btn-primary btn-small"
                          style={{ width: 'auto', background: 'linear-gradient(135deg, #d4ff3e, #8cff3e)', color: '#000', padding: '0.3rem 0.5rem', fontSize: '0.6rem' }}
                          onClick={(e) => handleMintNFT(glad, e)}
                          disabled={isFighting}
                        >
                          💿 MINT
                        </button>
                      )}

                      <a 
                        href={glad.nftMinted ? `https://testnet.arcscan.app/tx/${glad.nftTxHash}` : `https://testnet.arcscan.app/address/${glad.walletAddress}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary btn-small"
                        style={{ display: 'inline-flex', alignItems: 'center', textAlign: 'center', width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.6rem' }}
                      >
                        {glad.nftMinted ? 'VIEW NFT' : 'SCAN'}
                      </a>
                      
                      <button
                        className="btn btn-small"
                        style={{ width: 'auto', background: 'rgba(255,50,50,0.12)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff6b6b', cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.65rem' }}
                        onClick={(e) => handleDeleteGladiator(glad, e)}
                        disabled={isFighting}
                        title="Retire gladiator"
                      >
                        🗑️
                      </button>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Wallet Manager Panel */}
          {userWallet && (selectedGladA || selectedGladB) && (
            <div className="panel yellow-accent">
              <h2 className="panel-title">WALLET CONTROLS</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Active Gladiator: <strong style={{ color: '#fff' }}>{selectedGladA ? selectedGladA.name : selectedGladB.name}</strong>
                </div>
                
                {/* Fund Form */}
                <div className="form-group" style={{ marginBottom: '0.25rem' }}>
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Fund from MetaMask (USDC)</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      className="form-input"
                      style={{ padding: '0.5rem' }}
                      placeholder="Amount"
                      value={fundingAmount}
                      onChange={(e) => setFundingAmount(e.target.value)}
                      disabled={isFunding}
                    />
                    <button
                      className="btn btn-primary btn-small"
                      style={{ width: 'auto', whiteSpace: 'nowrap' }}
                      onClick={() => handleFund(selectedGladA ? selectedGladA.walletAddress : selectedGladB.walletAddress)}
                      disabled={isFunding || !fundingAmount}
                    >
                      {isFunding ? 'SENDING...' : 'FUND'}
                    </button>
                  </div>
                </div>

                {/* Withdraw Form */}
                <div className="form-group" style={{ marginBottom: '0.25rem' }}>
                  <label className="form-label" style={{ fontSize: '0.65rem' }}>Withdraw to MetaMask (USDC)</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      className="form-input"
                      style={{ padding: '0.5rem' }}
                      placeholder="Amount"
                      value={withdrawingAmount}
                      onChange={(e) => setWithdrawingAmount(e.target.value)}
                      disabled={isWithdrawing}
                    />
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ width: 'auto', whiteSpace: 'nowrap' }}
                      onClick={() => handleWithdraw(selectedGladA ? selectedGladA.id : selectedGladB.id)}
                      disabled={isWithdrawing || !withdrawingAmount}
                    >
                      {isWithdrawing ? 'WITHDRAWING...' : 'WITHDRAW'}
                    </button>
                  </div>
                </div>

                {/* Cybernetic Storefront Gear Marketplace */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', textAlign: 'left' }}>
                  <label className="form-label" style={{ fontSize: '0.65rem', color: 'var(--cyan)' }}>⚔️ Cybernetic Gear Store</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.3rem' }}>
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ fontSize: '0.62rem', display: 'flex', justifyContent: 'space-between', padding: '0.4rem' }}
                      onClick={() => handleBuyGear('katana')}
                      disabled={(selectedGladA || selectedGladB)?.equipment?.includes('katana')}
                    >
                      <span>Plasma Katana (+4 Attack)</span>
                      <strong>8 USDC</strong>
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ fontSize: '0.62rem', display: 'flex', justifyContent: 'space-between', padding: '0.4rem' }}
                      onClick={() => handleBuyGear('aegis')}
                      disabled={(selectedGladA || selectedGladB)?.equipment?.includes('aegis')}
                    >
                      <span>Reactive Aegis (+5 Defense)</span>
                      <strong>10 USDC</strong>
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ fontSize: '0.62rem', display: 'flex', justifyContent: 'space-between', padding: '0.4rem' }}
                      onClick={() => handleBuyGear('thrusters')}
                      disabled={(selectedGladA || selectedGladB)?.equipment?.includes('thrusters')}
                    >
                      <span>Booster Thrusters (+4 Speed)</span>
                      <strong>8 USDC</strong>
                    </button>
                  </div>
                </div>

                {/* Staking Sponsorship controls */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', textAlign: 'left' }}>
                  <label className="form-label" style={{ fontSize: '0.65rem', color: 'var(--accent)' }}>🛡️ Sponsorship Staking Pool</label>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                    <input 
                      type="number"
                      placeholder="USDC amount"
                      className="form-input"
                      style={{ fontSize: '0.65rem', padding: '0.4rem' }}
                      value={stakeAmount}
                      onChange={e => setStakeAmount(e.target.value)}
                    />
                    <button
                      className="btn btn-primary btn-small"
                      style={{ width: 'auto', fontSize: '0.65rem', padding: '0.4rem 0.8rem' }}
                      onClick={() => handleStake('USDC')}
                      disabled={isStaking || !stakeAmount}
                    >
                      STAKE
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      style={{ width: 'auto', fontSize: '0.65rem', padding: '0.4rem 0.8rem' }}
                      onClick={() => handleUnstake('USDC')}
                      disabled={isUnstaking || !stakeAmount}
                    >
                      UNSTAKE
                    </button>
                  </div>
                </div>

                {/* Syndicate Franchise Sponsoring */}
                {(selectedGladA || selectedGladB)?.wins >= 3 && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem', textAlign: 'left' }}>
                    <label className="form-label" style={{ fontSize: '0.65rem', color: 'var(--yellow)' }}>🤝 Syndicate Franchising (Agent-to-Agent)</label>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', alignItems: 'center' }}>
                      <select 
                        className="form-select"
                        style={{ fontSize: '0.65rem', padding: '0.4rem', height: 'auto' }}
                        value={rookieToSponsor}
                        onChange={e => setRookieToSponsor(e.target.value)}
                      >
                        <option value="">Choose Rookie</option>
                        {gladiators.filter(g => g.id !== (selectedGladA?.id || selectedGladB?.id) && (!g.syndicate || !g.syndicate.parentSponsor)).map(g => (
                          <option key={g.id} value={g.id}>{g.name} (W:{g.wins})</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-small"
                        style={{ width: 'auto', fontSize: '0.65rem', padding: '0.4rem 0.8rem', background: 'var(--yellow)', color: '#000' }}
                        onClick={handleSyndicateSponsor}
                        disabled={isEstablishingSyndicate || !rookieToSponsor}
                      >
                        SPONSOR (20 USDC)
                      </button>
                    </div>
                  </div>
                )}

                {/* Autonomous Upgrade Trigger */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <button
                    className="btn btn-primary"
                    style={{ background: 'var(--white)', color: '#000', fontSize: '0.65rem' }}
                    onClick={() => handleAutonomousUpgrade(selectedGladA ? selectedGladA.id : selectedGladB.id)}
                    disabled={isFighting || isUpgrading}
                  >
                    {isUpgrading ? 'EVALUATING UPGRADE...' : '🧠 TRIGGER AI UPGRADE (5 USDC)'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Center Column: Active Arena */}
        <div className="panel yellow-accent arena-panel">
          <h2 className="panel-title">
            COMBAT DOME
            {isFighting && <span style={{ color: 'var(--magenta)', animation: 'pulse 1s infinite alternate' }}>LIVE</span>}
          </h2>

          <div className="arena-box">
            {/* Stage graphics */}
            <ArenaVisualizer
              gladiatorA={selectedGladA}
              gladiatorB={selectedGladB}
              isFighting={isFighting}
              activeHpA={activeHpA}
              activeHpB={activeHpB}
              currentRoundEvents={currentRoundEvents}
              roundHazard={roundHazard}
            />

            {/* Spectator Prediction Market Widget */}
            {predictionData && !isFighting && (
              <div className="prediction-terminal" style={{ margin: '0.8rem', padding: '0.8rem', background: '#0e1017', border: '1px solid var(--border-color)', borderRadius: '4px', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--yellow)', margin: 0, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>🔮 Spectator Prediction Market</h3>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    AI Advisor Balance: <span style={{ color: '#00ff00' }}>{(predictorBalance?.usdc || 0).toFixed(2)} USDC</span> | <span style={{ color: '#00ff00' }}>{(predictorBalance?.eurc || 0).toFixed(2)} EURC</span>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.7rem', fontFamily: 'monospace', marginBottom: '0.6rem' }}>
                  <div style={{ padding: '0.4rem', background: '#141722', borderLeft: '3px solid var(--yellow)' }}>
                    <div><strong>{selectedGladA?.name || 'Gladiator A'}</strong></div>
                    <div>Win Prob: {((predictionData?.probabilityA || 0) * 100).toFixed(1)}%</div>
                    <div style={{ color: 'var(--cyan)' }}>Odds: {predictionData?.oddsA || '0'}x</div>
                    {predictionData?.kellyA > 0 && (
                      <div style={{ color: '#00ff00', marginTop: '0.2rem' }}>
                        Kelly Rec: Bet {((predictionData?.kellyA || 0) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '0.4rem', background: '#141722', borderLeft: '3px solid var(--cyan)' }}>
                    <div><strong>{selectedGladB?.name || 'Gladiator B'}</strong></div>
                    <div>Win Prob: {((predictionData?.probabilityB || 0) * 100).toFixed(1)}%</div>
                    <div style={{ color: 'var(--cyan)' }}>Odds: {predictionData?.oddsB || '0'}x</div>
                    {predictionData?.kellyB > 0 && (
                      <div style={{ color: '#00ff00', marginTop: '0.2rem' }}>
                        Kelly Rec: Bet {((predictionData?.kellyB || 0) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>

                {userWallet ? (
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        Your Balance: <span style={{ color: betToken === 'USDC' ? 'var(--yellow)' : 'var(--cyan)' }}>
                          {betToken === 'USDC' ? (spectatorBalance?.usdc || 0).toFixed(2) : (spectatorBalance?.eurc || 0).toFixed(2)} {betToken}
                        </span>
                      </span>
                      <button
                        style={{ fontSize: '0.55rem', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', borderRadius: '3px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        onClick={handleFundSpectator}
                        disabled={isFundingSpectator}
                      >
                        {isFundingSpectator ? '...' : `+ 100 ${betToken}`}
                      </button>
                    </div>
                    <select 
                      className="form-select" 
                      style={{ width: 'auto', padding: '0.35rem', fontSize: '0.65rem', height: 'auto' }}
                      value={betTarget}
                      onChange={e => setBetTarget(e.target.value)}
                    >
                      <option value="">Select Target</option>
                      <option value="A">Bet on {selectedGladA?.name || 'Gladiator A'}</option>
                      <option value="B">Bet on {selectedGladB?.name || 'Gladiator B'}</option>
                    </select>
                    
                    <select 
                      className="form-select" 
                      style={{ width: 'auto', padding: '0.35rem', fontSize: '0.65rem', height: 'auto' }}
                      value={betToken}
                      onChange={e => setBetToken(e.target.value)}
                    >
                      <option value="USDC">USDC</option>
                      <option value="EURC">EURC</option>
                    </select>

                    <input 
                      type="number" 
                      className="form-input" 
                      style={{ padding: '0.35rem', fontSize: '0.65rem', width: '80px', height: 'auto' }}
                      placeholder="Wager" 
                      value={betAmount} 
                      onChange={e => setBetAmount(e.target.value)} 
                    />

                    <button 
                      className="btn btn-primary" 
                      style={{ width: 'auto', padding: '0.35rem 0.8rem', fontSize: '0.65rem', height: 'auto' }}
                      onClick={handlePlaceBet}
                      disabled={isBetting || !betTarget || !betAmount}
                    >
                      {isBetting ? 'PLACING...' : 'PLACE WAGER'}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                    🔌 Connect your browser wallet to wager on this battle.
                  </div>
                )}
              </div>
            )}

            {/* Live Combat HUD (Odds Chart & Spectator Chat) */}
            {isFighting && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', padding: '0.8rem', background: '#090a10', borderBottom: '1px solid var(--border-color)', borderTop: '1px solid var(--border-color)' }}>
                {/* SVG Live Odds Chart */}
                <div style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border-color)', padding: '0.5rem', borderRadius: '2px', display: 'flex', flexDirection: 'column', height: '140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--g400)', fontFamily: 'monospace', marginBottom: '0.25rem' }}>
                    <span>LIVE WIN PROBABILITY (A)</span>
                    <span style={{ color: 'var(--accent)' }}>
                      {typeof probabilityHistory[probabilityHistory.length - 1] === 'number' && isFinite(probabilityHistory[probabilityHistory.length - 1])
                        ? probabilityHistory[probabilityHistory.length - 1].toFixed(0)
                        : '50'}%
                    </span>
                  </div>
                  <div style={{ flexGrow: 1, position: 'relative' }}>
                    <svg viewBox="0 0 300 70" style={{ width: '100%', height: '100%', display: 'block' }}>
                      <line x1="0" y1="35" x2="300" y2="35" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                      
                      {probabilityHistory.length > 1 && (
                        <path
                          d={`M ${probabilityHistory.map((p, idx) => {
                            const val = typeof p === 'number' && isFinite(p) ? p : 50;
                            const denom = probabilityHistory.length - 1;
                            const x = denom > 0 ? (idx / denom) * 300 : 0;
                            const y = 5 + (1 - val / 100) * 60;
                            return `${x},${y}`;
                          }).join(' L ')}`}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          style={{ filter: 'drop-shadow(0 0 4px var(--accent-glow))' }}
                        />
                      )}
                    </svg>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.5rem', color: 'var(--g600)', fontFamily: 'monospace', marginTop: '0.2rem' }}>
                    <span>A: {selectedGladA?.name ? String(selectedGladA.name).slice(0, 8) : 'A'}</span>
                    <span>NEUTRAL</span>
                    <span>B: {selectedGladB?.name ? String(selectedGladB.name).slice(0, 8) : 'B'}</span>
                  </div>
                </div>

                {/* Spectator live chat comments stream */}
                <div style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid var(--border-color)', padding: '0.5rem', borderRadius: '2px', height: '140px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.55rem', color: 'var(--g400)', fontFamily: 'monospace', marginBottom: '0.4rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2rem' }}>
                    📡 ARENA SPECTATOR STREAM (LIVE)
                  </div>
                  <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', textAlign: 'left' }}>
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} style={{ fontSize: '0.6rem', fontFamily: 'monospace', lineHeight: '1.2' }}>
                        <span style={{ color: msg.color, fontWeight: 'bold' }}>{msg.user}:</span>{' '}
                        <span style={{ color: '#fff' }}>{msg.text}</span>
                      </div>
                    ))}
                    {chatMessages.length === 0 && (
                      <div style={{ fontSize: '0.55rem', color: 'var(--g600)', fontStyle: 'italic' }}>Awaiting feed signal...</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Scrolling terminal console */}
            <div className="arena-console">
              {consoleLogs.map((line, idx) => {
                let className = 'console-line';
                if (line.startsWith('--- ROUND')) className += ' round-header';
                else if (line.startsWith('🤖') || line.startsWith(' >')) className += ' action-text';
                else if (line.startsWith('🏆') || line.includes('VICTORY')) className += ' payout-praise';
                
                return (
                  <div key={idx} className={className}>
                    {line}
                  </div>
                );
              })}
              <div ref={consoleEndRef} />
            </div>

            {/* Launch Game Button & Voice commentary checkbox */}
            <div style={{ padding: '0.8rem 1rem', background: '#090a10', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: '0.8rem', padding: '1rem', flex: 1 }}
                  disabled={!selectedGladA || !selectedGladB || isFighting}
                  onClick={() => handleStartBattle(false)}
                >
                  {isFighting ? 'BATTLE IN PROGRESS...' : selectedGladA && selectedGladB ? 'LAUNCH BATTLE (5 USDC)' : 'SELECT TWO GLADIATORS'}
                </button>
                
                {selectedGladA && selectedGladB && !isFighting && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '1rem', flex: 1, borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                    onClick={() => handleStartBattle(true)}
                  >
                    🚀 PRACTICE SANDBOX (FREE)
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                <input 
                  type="checkbox" 
                  id="voiceCommentary"
                  checked={voiceCommentary}
                  onChange={e => setVoiceCommentary(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                />
                <label htmlFor="voiceCommentary" style={{ cursor: 'pointer' }}>🎙️ DIGITIZED ROBOTIC COMMENTARY</label>
              </div>
            </div>
          </div>

          {/* Tournament Bracket Section */}
          {renderBracket()}
        </div>

        {/* Right Column: Leaderboards, Faucet and History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Arc Faucet Panel */}
          <div className="panel" style={{ border: '1px solid rgba(0,200,255,0.3)', background: 'linear-gradient(135deg, #090a10 0%, #0a0f1a 100%)' }}>
            <h2 className="panel-title" style={{ color: 'var(--cyan)' }}>
              🚰 ARC TESTNET FAUCET
              {faucetMode === 'real' && <span style={{ fontSize: '0.6rem', color: '#00ff88', marginLeft: '0.5rem', fontWeight: 'normal' }}>● LIVE</span>}
              {faucetMode === 'mock' && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontWeight: 'normal' }}>● MOCK</span>}
            </h2>

            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.8rem', lineHeight: 1.5 }}>
              Claim free testnet USDC or EURC directly to your connected wallet on Arc Testnet.
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>24h cooldown per address · 100 USDC or 50 EURC per claim</span>
            </div>

            {!userWallet ? (
              <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                🔌 Connect your browser wallet to claim testnet tokens.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  <span>Wallet:</span>
                  <span style={{ color: 'var(--cyan)' }}>{userWallet.slice(0, 10)}...{userWallet.slice(-6)}</span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    className="form-select"
                    style={{ width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.7rem', height: 'auto' }}
                    value={faucetToken}
                    onChange={e => setFaucetToken(e.target.value)}
                    disabled={isClaimingFaucet}
                  >
                    <option value="USDC">🪙 USDC (100)</option>
                    <option value="EURC">💶 EURC (50)</option>
                  </select>

                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.7rem', background: isClaimingFaucet ? undefined : 'linear-gradient(135deg, #00b4d8, #0077b6)' }}
                    onClick={handleArcFaucet}
                    disabled={isClaimingFaucet || !!faucetCooldown}
                  >
                    {isClaimingFaucet ? '⏳ Claiming...' : faucetCooldown ? `⏳ Cooldown: ${faucetCooldown}m` : `🚰 Claim ${faucetToken}`}
                  </button>
                </div>

                {faucetCooldown && (
                  <div style={{ fontSize: '0.65rem', color: '#ff9f43', fontFamily: 'monospace', textAlign: 'center' }}>
                    ⏳ You can claim again in {faucetCooldown} minutes.
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem', marginTop: '0.2rem' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Manual claim (no API key needed):</div>
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.65rem', color: 'var(--cyan)', textDecoration: 'none', fontFamily: 'monospace' }}
                  >
                    🔗 faucet.circle.com → Select Arc Testnet
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Leaderboard Panel */}
          <div className="panel cyan-accent">
            <h2 className="panel-title">LEADERBOARD</h2>
            
            <div className="leaderboard-list">
              {Array.isArray(sortedLeaderboard) && sortedLeaderboard.slice(0, 5).map((glad, idx) => (
                <div key={glad.id} className="leaderboard-row">
                  <span className="leaderboard-rank">#0{idx + 1}</span>
                  <span className="leaderboard-name">{glad.name}</span>
                  <span className="leaderboard-score">{glad.wins || 0} WINS</span>
                </div>
              ))}
              {sortedLeaderboard.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No gladiators registered yet.
                </div>
              )}
            </div>
          </div>

          {/* Historical Logs Panel */}
          <div className="panel" style={{ flexGrow: 1 }}>
            <h2 className="panel-title">BATTLE LEDGER</h2>
            
            <div className="gladiator-list" style={{ maxHeight: '400px' }}>
              {Array.isArray(battleHistory) && battleHistory.map((btl) => (
                <div key={btl.id} className="gladiator-card" style={{ cursor: 'default' }}>
                  <div className="gladiator-name-row" style={{ fontSize: '0.85rem' }}>
                    <span style={{ fontWeight: 'bold' }}>{btl.gladiatorA?.name || 'Unknown'} vs {btl.gladiatorB?.name || 'Unknown'}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Winner: <span style={{ color: 'var(--cyan)', fontWeight: 'bold' }}>{btl.winnerId === btl.gladiatorA?.id ? (btl.gladiatorA?.name || 'Unknown') : (btl.gladiatorB?.name || 'Unknown')}</span>
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                    Payout Tx:{' '}
                    {btl.payoutHash ? (
                      <a href={`https://testnet.arcscan.app/tx/${btl.payoutHash}`} target="_blank" rel="noreferrer">
                        {String(btl.payoutHash).slice(0, 16)}...
                      </a>
                    ) : (
                      'N/A'
                    )}
                  </div>
                </div>
              ))}
              {battleHistory.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No battles fought yet.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── POLICY ENGINE DASHBOARD ─────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>

          {/* Stats Counter Panel */}
          <div className="panel" style={{ flex: '0 0 340px' }}>
            <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem' }}>🛡️</span> BATTLE POLICY ENGINE
            </h2>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '1rem', fontFamily: 'monospace' }}>
              Every wager request evaluated against 8 policy rules.<br/>
              Each decision SHA-256 attested. Not theater.
            </div>

            {policyStats ? (
              <>
                {/* Big counters — mirrors Shadow's COPIED/BLOCKED display */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(0,255,136,0.08), rgba(0,255,136,0.02))',
                    border: '1px solid rgba(0,255,136,0.3)',
                    borderRadius: '8px', padding: '1rem', textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#00ff88', lineHeight: 1 }}>
                      {policyStats.approved}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', letterSpacing: '0.1em' }}>
                      APPROVED
                    </div>
                  </div>
                  <div style={{
                    background: 'linear-gradient(135deg, rgba(255,59,59,0.08), rgba(255,59,59,0.02))',
                    border: '1px solid rgba(255,59,59,0.3)',
                    borderRadius: '8px', padding: '1rem', textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, color: '#ff3b3b', lineHeight: 1 }}>
                      {policyStats.blocked}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem', letterSpacing: '0.1em' }}>
                      BLOCKED
                    </div>
                  </div>
                </div>

                {/* Approval rate bar */}
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: '0.3rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Policy Pass Rate</span>
                    <span style={{ color: 'var(--cyan)', fontWeight: 'bold' }}>{policyStats.approvalRate}</span>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: policyStats.approvalRate,
                      background: 'linear-gradient(90deg, #00ff88, #00d4ff)',
                      borderRadius: '3px',
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                </div>

                {/* Blocked by rule breakdown */}
                {Object.keys(policyStats.blockedByRule || {}).length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem', letterSpacing: '0.08em' }}>
                      BLOCKED BY RULE
                    </div>
                    {Object.entries(policyStats.blockedByRule).map(([rule, count]) => {
                      const ruleInfo = (policyStats.rules || []).find(r => r.code === rule);
                      return (
                        <div key={rule} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.3rem 0.5rem', marginBottom: '0.25rem',
                          background: 'rgba(255,59,59,0.05)', borderRadius: '4px',
                          border: '1px solid rgba(255,59,59,0.15)'
                        }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                            <span style={{ color: '#ff3b3b', fontFamily: 'monospace', marginRight: '0.4rem' }}>{rule}</span>
                            {ruleInfo?.name || rule}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ff3b3b' }}>{count}×</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>
                No policy decisions recorded yet.<br/>
                <span style={{ fontSize: '0.7rem' }}>Start a battle to trigger the engine.</span>
              </div>
            )}

            <button
              onClick={fetchPolicyStats}
              style={{
                marginTop: '0.75rem', width: '100%', padding: '0.5rem',
                background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)',
                borderRadius: '6px', color: 'var(--cyan)', fontSize: '0.72rem',
                cursor: 'pointer', letterSpacing: '0.08em'
              }}
            >
              ↺ REFRESH POLICY STATS
            </button>
          </div>

          {/* Policy Audit Log Panel */}
          <div className="panel" style={{ flex: 1, minWidth: '300px' }}>
            <h2 className="panel-title">
              📋 POLICY AUDIT LOG <span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-muted)' }}>— SHA-256 attested decisions</span>
            </h2>
            <div className="gladiator-list" style={{ maxHeight: '320px', fontFamily: 'monospace' }}>
              {policyLog.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>
                  Policy log is empty — no battles triggered yet.
                </div>
              ) : policyLog.slice(0, 20).map((entry, i) => (
                <div key={i} style={{
                  padding: '0.5rem 0.6rem', marginBottom: '0.35rem',
                  background: entry.approved
                    ? 'linear-gradient(90deg, rgba(0,255,136,0.04), transparent)'
                    : 'linear-gradient(90deg, rgba(255,59,59,0.06), transparent)',
                  border: `1px solid ${entry.approved ? 'rgba(0,255,136,0.2)' : 'rgba(255,59,59,0.2)'}`,
                  borderRadius: '5px',
                  fontSize: '0.67rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{
                      fontWeight: 'bold',
                      color: entry.approved ? '#00ff88' : '#ff3b3b',
                      letterSpacing: '0.05em'
                    }}>
                      {entry.approved ? '✅ APPROVED' : `❌ BLOCKED [${entry.ruleCode}]`}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '0.15rem' }}>
                    {entry.gladiatorAName} vs {entry.gladiatorBName}
                  </div>
                  <div style={{ color: entry.approved ? 'rgba(0,255,136,0.6)' : 'rgba(255,59,59,0.7)', fontSize: '0.63rem' }}>
                    {entry.reason}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.6rem', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    sha256: {entry.sha256}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
        {/* ── END POLICY ENGINE DASHBOARD ─────────────────────────────────── */}

      </main>
    </div>
  );
}
