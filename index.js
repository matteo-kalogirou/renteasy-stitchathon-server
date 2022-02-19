const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const axios = require('axios').default;

const graphql = require('graphql');
const gqlTag = require('graphql-tag');

const port = 3000;
const CLIENT_ID = "test-1e11230b-446e-4894-a23e-1ad187f87d57";
const STITCH_GQL_URL = 'https://api.stitch.money/graphql';

app.set('json spaces', 2);
app.use(bodyParser.json());


/** ========== FUNCTIONS ============ */

const generateJWT = () => {
  // Client id is the second to last argument 
  const clientId = CLIENT_ID;
  // Assume filename comes last
  const filename = path.resolve('resources/certificate.pem');

  console.log('Generating private_key_jwt for certificate ', filename);

  const pemCert = fs.readFileSync(filename).toString('utf-8');

  const issuer = clientId;
  const subject = clientId;
  const audience = 'https://secure.stitch.money/connect/token';
  const keyid = 'F5D06D1AFFFDC4CE16E56E756E20EDAF84EB8ABD';
  const jwtid = crypto.randomBytes(16).toString('hex');

  const options = {
    keyid,
    jwtid,
    notBefore: '0',
    issuer,
    subject,
    audience,
    expiresIn: '5m', // For this example this value is set to 5 minutes, but for machine usage should generally be a lot shorter
    algorithm: 'RS256',
  };

  const token = jwt.sign({}, pemCert, options);
  console.log(`Token:\n${token}`);

  return token;
}

const handleError = (error, res) => {
  console.log(`Error: ${error}`);
  res.statusCode = 500;
  res.json({ error })
}

const base64UrlEncode = (byteArray) => {
  const charCodes = String.fromCharCode(...byteArray);
  return window.btoa(charCodes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const sha256 = async (verifier) => {
  const msgBuffer = new TextEncoder('utf-8').encode(verifier);
  // hash the message
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return new Uint8Array(hashBuffer);
}

const generateRandomStateOrNonce = () => {
  const randomBytes = crypto.randomBytes(32);
  return base64UrlEncode(randomBytes);
}

const generateVerifierChallengePair = async () => {
  const randomBytes = crypto.randomBytes(32);
  const verifier = base64UrlEncode(randomBytes);
  console.log('Verifier:', verifier);
  const challenge = await sha256(verifier).then(base64UrlEncode);
  console.log('Challenge:', challenge)
  return { verifier, challenge };
}

const buildAuthorizationUrl = (clientId, challenge, redirectUri, state, nonce, scopes) => {
  const search = {
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    response_type: 'code',
    nonce: nonce,
    state: state
  };
  const searchString = Object.entries(search).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://secure.stitch.money/connect/authorize?${searchString}`;
}

/** ============ GQL ================ */

/**
 * Used to generate a payment request url
 * @param {*} amount { quantity: "12.34",  currency: "ZAR"}
 * @param {*} payerReference 
 * @param {*} beneficiaryReference 
 * @param {*} externalReference 
 * @param {*} beneficiaryName 
 * @param {*} beneficiaryBankId 
 * @param {*} beneficiaryAccountNumber 
 */
const CreatePaymentRequest = async (
  token,
  amount,
  payerReference,
  beneficiaryReference,
  externalReference,
  beneficiaryName,
  beneficiaryBankId,
  beneficiaryAccountNumber
) => {

  const createPaymentRequestMutation = gqlTag`
      mutation CreatePaymentRequest(
        $amount: MoneyInput!,
        $payerReference: String!,
        $beneficiaryReference: String!,
        $externalReference: String,
        $beneficiaryName: String!,
        $beneficiaryBankId: BankBeneficiaryBankId!,
        $beneficiaryAccountNumber: String!) {
      clientPaymentInitiationRequestCreate(input: {
          amount: $amount,
          payerReference: $payerReference,
          beneficiaryReference: $beneficiaryReference,
          externalReference: $externalReference,
          beneficiary: {
              bankAccount: {
                  name: $beneficiaryName,
                  bankId: $beneficiaryBankId,
                  accountNumber: $beneficiaryAccountNumber
              }
          }
        }) {
        paymentInitiationRequest {
          id
          url
        }
      }
    }
  `;

  const response = await axios.post(STITCH_GQL_URL,
    {
      query: graphql.print(createPaymentRequestMutation),
      variables: {
        amount,
        payerReference,
        beneficiaryReference,
        externalReference: (externalReference) ? (externalReference) : undefined,
        beneficiaryName,
        beneficiaryBankId,
        beneficiaryAccountNumber
      }
    },
    { headers: { Authorization: `Bearer ${token}` } });

  console.log(response.data);
  console.log(response.error);
  return response.data;
}

const IncomeEstimation = async () => { };

const BankAccountVerificationRequest = async (
  token,
  accountNumber,
  bankId,
  branchCode,
  accountType,
  accountHolder
) => {

  const bankAccountVerificationQuery = gqlTag`
    query BankAccountVerification(
        $accountNumber: String!,
        $bankId: BankAccountVerificationBankIdInput!,
        $branchCode: String,
        $accountType: AccountType,
        $accountHolder: AccountHolderBankAccountVerificationInput!
    ) {
        client {
            verifyBankAccountDetails(input: {
                accountNumber: $accountNumber,
                bankId: $bankId,
                branchCode: $branchCode,
                accountType: $accountType
                accountHolder: $accountHolder
            }) {
                accountNumber
                bankId
                branchCode
                accountType
                accountTypeVerificationResult
                accountVerificationResult
                accountOpen
                accountOpenForMoreThanThreeMonths
            }
        }
    }`;

  const response = await axios.post(STITCH_GQL_URL,
    {
      query: graphql.print(bankAccountVerificationQuery),
      variables: {
        accountNumber,
        bankId,
        branchCode: (branchCode) ? branchCode : undefined,
        accountType: (accountType) ? accountType : undefined,
        accountHolder
      }
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (response.error) console.log(response.error);
  else console.log(JSON.stringify(response.data, null, 2));

  return response.data;
};

/** ========== ROUTING ============== */

app.get('/', (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });
  res.send('Hello World!');
});

// Generate the JWT token
app.get('/generateJWT', (req, res) => {
  console.log('Generating JWT');
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });

  try {
    const jwt = generateJWT();
    res.statusCode = 200;
    res.json(jwt);
  } catch (error) {
    handleError(error, res);
  }
});

// Get client token
app.post('/retrieveTokenUsingClientAssertion', async (req, res) => {
  console.log(`Retrieve Token Using Client Assertion, ${JSON.stringify(req.body, null, 2)}`);
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });

  const clientAssertion = generateJWT();

  const scopes = req.body.scopes
    || [
      'client_paymentrequest',
      'client_bankaccountverification',
      'client_imageupload',
      'client_businesslookup'
    ];

  try {
    const body = {
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      scope: scopes.join(' '),
      audience: 'https://secure.stitch.money/connect/token',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion
    };
    const bodyString = Object.entries(body).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

    console.log('body: ', body);

    const response = await axios({
      method: 'post',
      url: 'https://secure.stitch.money/connect/token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: bodyString
    });

    console.log(response);

    const responseData = response.data;
    console.log('Tokens: ', responseData);

    res.json(responseData);
  } catch (error) {
    handleError(error, res);
  }
});

// Create payment request url
app.post('/createPaymentRequest', async (req, res) => {
  console.log(`Create Payment Request: ${JSON.stringify(req.body, null, 2)}`);
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });

  const args = req.body;

  try {
    const result = await CreatePaymentRequest(
      args.token,
      args.amount,
      args.payerReference,
      args.beneficiaryReference,
      args?.externalReference,
      args.beneficiaryName,
      args.beneficiaryBankId,
      args.beneficiaryAccountNumber
    );

    res.json(result);
  } catch (error) { handleError(error, res); }

});

app.post('/verifyBankAccount', async (req, res) => {
  console.log(`Verify bank account, ${JSON.stringify(req.body, null, 2)}`);
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });

  const args = req.body;

  try {
    const result = await BankAccountVerificationRequest(
      args.token,
      args.accountNumber,
      args.bankId,
      args?.branchCode,
      args?.accountType,
      args.accountHolder
    );

    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.options('/*', (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });
  res.statusCode = 200;
  res.send();
});

app.get('/authCodeUrl', async (req, res) => {
  console.log('Get Auth Code Url');
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*"
  });

  const verifierCHallengePair = await generateVerifierChallengePair();
  const nonce = generateRandomStateOrNonce();
  const state = generateRandomStateOrNonce();

  const authUrl = await buildAuthorizationUrl(
    CLIENT_ID,
    verifierCHallengePair.challenge,
    'http://localhost:4200/auth',
    state,
    nonce,
    ['openid', 'accounts', 'accountholders'],
  );
  
  res.json({ authUrl });
});

app.listen(port, () => {
  console.log(`RentEasy server listening on port ${port}`)
})
