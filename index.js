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

const BankAccountVerificationRequest = async () => {

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

/**
  * @param clientId Client Id = test-1e11230b-446e-4894-a23e-1ad187f87d57
  * @param clientAssertion JWT token
  * @param scopes = [ client_paymentrequest, client_bankaccountverification, client_imageupload, client_businesslookup ]
  * @returns 
  */
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

app.listen(port, () => {
  console.log(`RentEasy server listening on port ${port}`)
})
