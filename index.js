const Stellar = require('stellar-sdk');
const fetch = require('node-fetch');

const horizonTestnet = new Stellar.Server(
  'https://horizon-testnet.stellar.org',
);

function logError(error) {
  console.error('An error occured: ', error);
}

function logInfo(...info) {
  console.log(...info);
}

function generateKeys() {
  return Stellar.Keypair.random();
}

async function fundAccount(publicKey) {
  try {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${publicKey}`,
    );
    return response.json();
  } catch (error) {
    logError(error);
  }
}

async function accountDetail(publicKey) {
  try {
    const account = await horizonTestnet.loadAccount(publicKey);
    return account;
  } catch (error) {
    logError(error);
  }
}

function displayAccount({ sequence, balances, signers }, showSigners = false) {
  let response = {
    sequence,
    balance: balances[0].balance,
  }

  if (showSigners) {
    response['signers'] = signers;
  }

  return response;
}

async function createPreauthTx() {
  try {
    logInfo('Start script...');

    const senderKp = generateKeys();
    logInfo('Generated sender account: ', senderKp.publicKey());
    logInfo('Funding account...');
    await fundAccount(senderKp.publicKey());
    const senderAccount = await accountDetail(senderKp.publicKey());
    logInfo('Sender: ', displayAccount(senderAccount));

    const receiverKp = generateKeys();
    logInfo('Generated receiver account: ', receiverKp.publicKey());
    logInfo('Funding account...');
    await fundAccount(receiverKp.publicKey());
    let receiverAccount = await accountDetail(receiverKp.publicKey());
    logInfo('Receiver: ', displayAccount(receiverAccount));

    logInfo('Building future payment operation. Send 5000XLM to receiver...');
    const paymentOp = Stellar.Operation.payment({
      destination: receiverKp.publicKey(),
      asset: Stellar.Asset.native(),
      amount: '5000',
      source: senderKp.publicKey(),
    });

    // The goal is to increment the sequence number by 2, but we only call
    // incrementSequenceNumber() once here because the transaction builder also
    // auto increments the sequence number.
    senderAccount.incrementSequenceNumber();
    logInfo(
      'Sender sequence number incremented to: ',
      senderAccount.sequenceNumber(),
    );

    // build the future tx with incremented sequence number
    const futureTx = new Stellar.TransactionBuilder(senderAccount, {
      fee: Stellar.BASE_FEE,
      networkPassphrase: Stellar.Networks.TESTNET,
    })
      .addOperation(paymentOp)
      .setTimeout(Stellar.TimeoutInfinite)
      .build();

    logInfo('futureTx XDR: ', futureTx.toXDR());

    logInfo('Add the hash of the future tx as a signer on sender ...');
    const setOptions = Stellar.Operation.setOptions({
      signer: {
        preAuthTx: futureTx.hash(),
        weight: 1,
      },
    });

    // get the sender account with the current sequence number.
    let currentSenderDetail = await accountDetail(senderKp.publicKey());

    const addSignerTx = new Stellar.TransactionBuilder(currentSenderDetail, {
      fee: Stellar.BASE_FEE,
      networkPassphrase: Stellar.Networks.TESTNET,
    })
      .setTimeout(Stellar.TimeoutInfinite)
      .addOperation(setOptions)
      .build();

    addSignerTx.sign(Stellar.Keypair.fromSecret(senderKp.secret()));
    await horizonTestnet.submitTransaction(addSignerTx);
    logInfo('signer successfully added.');

    logInfo('Check sender for extra signer...')
    currentSenderDetail = await accountDetail(senderKp.publicKey());
    logInfo('Sender: ', displayAccount(currentSenderDetail, true));

    logInfo('Submit pre-authorized tx...');
    // Notice how we don't need to sign the transaction because it is pre-authorized.
    await horizonTestnet.submitTransaction(futureTx);
    logInfo('pre-authorized tx successful');

    logInfo('Checking sender account....')
    currentSenderDetail = await accountDetail(senderKp.publicKey());
    logInfo('Sender: ', displayAccount(currentSenderDetail, true));

    logInfo('Checking receiver account....')
    receiverAccount = await accountDetail(receiverKp.publicKey());
    logInfo('Receiver: ', displayAccount(receiverAccount));

    logInfo('End script. Visit https://oliha.dev for questions and comments.');

  } catch (error) {
    if (error.response && error.response.data) {
      logError(error.response.data);
    } else {
      logError(error);
    }
  }
}

createPreauthTx();
