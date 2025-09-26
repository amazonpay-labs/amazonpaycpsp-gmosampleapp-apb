/**
 * 注意: こちらのプログラムはJavaScriptで書かれていますが、Server側で動作します。
 * Note: The program written in this file runs on server side even it is written in JavaScript.
 */
'use strict';

// Config
const fs = require('fs');
const options = {
    key: fs.readFileSync('ssl/sample.key'),
    cert: fs.readFileSync('ssl/sample.crt')
};
const {keyinfo} = require('./keys/keyinfo');

// Web application
const express = require('express');
const app = express();
const ejs = require('ejs');
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const https = require('https');
const http = require('http');
app.set('ejs', ejs.renderFile)
app.use(bodyParser.urlencoded({extended: true}))
app.use(bodyParser.json())
app.use(cookieParser());
const tlsAppServer = https.createServer(options, app);
const appServer = http.createServer(app);

// マルペイAPI 呼出用
const axios = require('axios');
const querystring = require('querystring');
const iconv = require('iconv-lite');

// Other
const crypto = require('crypto');

// html, css, png等の静的ファイルを配置するstaticディレクトリの読み込み設定
app.use('/static', express.static('static'));

// ストレージ. ここではシンプルにするため、只のMapを利用. 実運用ではDBやCacheサーバー等を使うこと.
const storage = new Map();

// ダミーのUserSession. 本来ならアカウントを持つユーザのLogin時に生成されてDB/Cacheサーバー等に保存されるが、本サンプルではシンプルにするため、固定とする.
const userSession = {
    account: 'user@sample.com',
    sessionId: 'xxxxxxxxxx'
};

// ダミーのCart情報設定関数。本来ならユーザが商品を選択するなどしてCart情報は生成されるが、本サプルではシンプルにするため代わりに固定の値を代入する.
function setCartInfo() {
    userSession.cart = {
        // 金額データ.
        amount: {
            "paymentIntent": "Confirm",
            "totalBaseAmount": {"amount": "8000", "currencyCode": "JPY"},
            "totalTaxAmount": {"amount": "800", "currencyCode": "JPY"},
            "totalDiscountAmount": {"amount": "0", "currencyCode": "JPY"},
            "totalShippingAmount": {"amount": "0", "currencyCode": "JPY"},
            "totalOrderAmount": {"amount": "8800", "currencyCode": "JPY"},
            "chargeAmount": {"amount": "8800", "currencyCode": "JPY"}
        }
    };
}

//-------------------
// Cart Screen
//-------------------
app.get('/sample/cart', async (req, res) => {
    setCartInfo();
    const locals = {...userSession.cart, token: ''};
    if(req.query.client === 'iosApp' || req.query.client === 'androidApp') {
        const token = crypto.randomBytes(18).toString('base64').replace(/[\/+]/g, c => c === '+' ? '-' : '_');
        storage.set(token, userSession.cart);
        locals.token = token;
    }
    res.render (
        'sample/cart.ejs', 
        locals
    );
});

//--------------------------------------
// Amazon Pay実行ページ(モバイルアプリ専用)
//--------------------------------------
app.get('/doAmazonPay', async (req, res) => {
    console.log(`doAmazonPay: ${JSON.stringify(storage.get(req.query.token), null, 2)}`);
    res.render (
        'doAmazonPay.ejs', 
        storage.get(req.query.token)
    );
});

//--------------------------------------------------
// onCompleteCheckoutのパラメタの保存(モバイルアプリ専用)
//--------------------------------------------------
app.post('/sample/compData', async (req, res) => {
    console.log(`compData: ${JSON.stringify(req.body, null, 2)}`);
    const compToken = crypto.randomBytes(18).toString('base64').replace(/[\/+]/g, c => c === '+' ? '-' : '_');
    storage.set(compToken, req.body);

    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'});
    res.write(JSON.stringify({status: 'OK', compToken: compToken}));
    res.end()
});

//-------------
// 決済処理
//-------------
app.post('/sample/createCharge', async (req, res) => {
    console.log(`createCharge: ${JSON.stringify(req.body, null, 2)}`);
    let result = null;
    try {
        let params;
        if(req.body.compToken) {
            const cached = storage.get(req.body.compToken);
            if(cached.token !== req.body.token) throw new Error(`tokenが一致しません。${cached.token} != ${req.body.token}`);
            params = cached.params;
        } else {
            params = req.body;
        }
        const orderId = crypto.randomBytes(13).toString('hex');
        const access = await callAPI('EntryTranAmazonpay', {
            ...keyinfo,
            OrderID: orderId,
            JobCd: 'AUTH',
            Amount: `${userSession.cart.amount.chargeAmount.amount}`,
            AmazonpayType: '4',
        });
        save(userSession, access); // DBへの保存

        const start = await callAPI('ExecTranAmazonpay', {
            ...keyinfo,
            ...access,
            OrderID: orderId,
            RetURL: params.amazonPayMFAReturnUrl,
            AmazonChargePermissionID: params.chargePermissionId,
            ApbType: 'PayOnly',
            Description: "ご購入ありがとうございます。",
        });
        save(userSession, start); // DBへの保存

        // Security Check
        const textToHash = `${orderId}${access.AccessID}${keyinfo.ShopID}${keyinfo.ShopPass}${start.AmazonChargePermissionID}`;
        const hash = crypto.createHash('sha256').update(textToHash).digest('hex');
        console.log(`Hash: ${hash}`);
        if(hash !== start.CheckString) throw new Error('CheckStringが一致しません。');

        // 注文確定(※ 配送が必要な商品の場合には、配送手続き完了後に実行します。)
        const sales = await callAPI('AmazonpaySales', {
            ...keyinfo,
            ...access,
            OrderID: orderId,
            Amount: `${userSession.cart.amount.chargeAmount.amount}`,
        });
        save(userSession, sales); // DBへの保存
        result = {status: 'OK', message: 'ご購入ありがとうございました。'};
    } catch (err) {
        console.error(err);
        result = {status: 'NG', message: '決済に失敗しました。やり直して下さい。'};
    }

    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'});
    res.write(JSON.stringify(result));
    res.end()
});

//-------------------
// Libraries
//-------------------
async function callAPI(name, params) {
    const res = await axios.post(`https://pt01.mul-pay.jp/payment/${name}.idPass`,
        querystring.stringify(params));
    if(res.statusText !== 'OK') throw new Error(`${res.status} エラーが発生しました。再度やり直して下さい。`);
    const obj = {};
    res.data.split('&').forEach((item) => {
        const [key, value] = item.split('=');
        obj[key] = key === 'Token' ? value : decodeWin31j(value);
            // Note: Tokenという項目のみ、x-www-form-urlencodedのエンコード仕様に反して「+」がエンコードされていないため、decode対象から外す。
    });
    if(obj.ErrCode) throw new Error(`${JSON.stringify(obj)} エラーが発生しました。再度やり直して下さい。`);

    console.log(`${name}: ${JSON.stringify(obj, null, 2)}`);
    return obj;
}

function decodeWin31j(text) {
    // 1. x-www-form-urlencodedなので、空白が「+」になっており、まずはこちらをdecode。
    // なお、下記によると変換されない記号に「+」が含まれていない。∴この時点では「%2B」のはず。よってこの処理は安全。
    // https://qiita.com/sisisin/items/3efeb9420cf77a48135d#applicationx-www-form-urlencoded%E3%81%AEurl%E3%82%A8%E3%83%B3%E3%82%B3%E3%83%BC%E3%83%89%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6
    const blankDecodedString = text.replace(/\+/g, ' ');

    // 2. percent-encodingされたバイト列を取得
    //    ( decodeURIComponent は UTF-8 を前提とするため、一旦 % を取り除く)
    const escapedBytes = Buffer.from(blankDecodedString.replace(
        /%([0-9A-Fa-f]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16))), 'binary');

    // 3. そのバイト列を Shift_JIS (Windows-31J) としてデコード
    return iconv.decode(escapedBytes, 'Windows-31J');
}

function save(userSession, data) {
    // 受注情報をユーザと紐づけてDB等に保存. こちらはサンプルなので実際には何もしない、ダミー実装.
}

//---------------------
// Start App server
//---------------------
appServer.listen(3080);
tlsAppServer.listen(3443);
console.log(`App listening on port 3080(HTTP) and 3443(HTTPS).`);
