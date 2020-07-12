const {createProxyServer} = require('http-proxy');
const {spawn} = require('child_process');
const kafka = require('kafka-node');
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require( 'dotenv');


dotenv.config();


const kafkaHost = process.env.kafkaHost;
const prismMockPort = process.env.prismMockPort;
const kafkaMockPort = process.env.kafkaMockPort;
const prismMockSwaggerDoc = 'swagger-doc.json';

const mockServerUrl = `http://127.0.0.1:${prismMockPort}`;
const mockWithKafkaServerUrl = `http://127.0.0.1:${kafkaMockPort}`;

const kafkaSendRestApi = {
    "GET /PETS?LIMIT=286": {
        "code": "200",
        "message": "success"
    }
};

const successResponse = {
    "code": "200",
    "message": "success"
}


/*
* KAFKA 관련 설정
**/
const sendKafka = (topicName, messageKey, message) => {
    const client = new kafka.KafkaClient({kafkaHost});
    const producer = new kafka.Producer(client);
    const payloads = [
        {topic: topicName, key: messageKey, messages: message},
    ];
    producer.send(payloads, function (err, data) {
        if (data === undefined) {
            prismMockServer.kill('SIGHUP');
        }
    });
}

/*
* Prism 으로 기본 Mock 서버 구동 하기
* */
let prismMockServer = () => {
    prismMockServer = spawn('prism', ['mock', '--host', '0.0.0.0', '-p', prismMockPort, '-d', prismMockSwaggerDoc]);

    prismMockServer.stdout.on('data', (data) => {
        data = data.toString().replace(/\r?\n|\r/g, " ");
        console.log(`stdout: ${data}`);
    });
    prismMockServer.stderr.on('data', (data) => {
        data = data.toString().replace(/\r?\n|\r/g, " ");
        console.log(`stderr: ${data}`);
    });
    prismMockServer.on('close', (code) => {
        throw {name: 'kafkaException', message: 'kafka 서버 연결 오류가 발생하였습니다.'}
        process.exit(3);
    });
    return prismMockServer
}


/*
* MOCK Proxy Server 구성
* */
let mockProxyServer = (mockServerName, mockServerUrl, mockWithKafkaServerUrl) => {
    let prismMockPort = parseInt(mockServerUrl.split(":")[2]);
    let kafkaMockPort = parseInt(mockWithKafkaServerUrl.split(":")[2]);

    let option = {
        target: mockServerUrl,
        selfHandleResponse: true,
    };

    const proxyServer = createProxyServer({});
    proxyServer.on('proxyReq', function (proxyReq, req, res) {
        proxyReq.setHeader('Content-Type', 'application/json');
        if (req.body) {
            let bodyData = req.body;
            proxyReq.setHeader('Content-Length', Buffer.byteLength(JSON.stringify(bodyData)));
            proxyReq.write(JSON.stringify(bodyData));
        }
    });

    proxyServer.on('proxyRes', function (proxyRes, req, res) {
        let restApi = `${req.method} ${req.url}`;
        let body = [];
        res.setHeader('Content-Type', 'application/json');
        proxyRes.on('data', function (chunk) {
            body.push(chunk);
        });
        proxyRes.on('end', function () {
            body = Buffer.concat(body).toString();

            let bodyJson = JSON;
            bodyJson.status = "success";
            bodyJson.result = JSON.parse(body);

            if (kafkaSendRestApi[restApi.toUpperCase().trim()]) {
                sendKafka("topic", "messageKey", JSON.stringify(bodyJson));
                res.end(JSON.stringify(successResponse));
            } else {
                res.end(JSON.stringify(bodyJson));
            }
            // }
        });
    });


    const mockServer = express();
    mockServer.use(bodyParser.json());
    mockServer.use(bodyParser.urlencoded({extended: true}));
    mockServer.use(function (req, res) {
        proxyServer.web(req, res, option)
    });
    console.log('listening', '\x1b[31m', `${mockServerName}`, '\x1b[0m', '\x1b[36m', 'With Kafka on port,', '\x1b[31m', `${kafkaMockPort}`, '\x1b[0m', ', only Mock on port', '\x1b[31m', `${prismMockPort}`, '\x1b[0m');
    mockServer.listen(kafkaMockPort);
}


/**
 * Mock Server 구동
 */
try {
    prismMockServer();
    console.log('------------------------------------------------------------------------------------------------------');
    console.log("PRISM Mock Server Start!");
    console.log('------------------------------------------------------------------------------------------------------');
    setTimeout(() => {
        console.log('------------------------------------------------------------------------------------------------------');
        console.log("PRISM With Kafka Mock Server Start!\n");
        mockProxyServer("Proxy Mock Server", mockServerUrl, mockWithKafkaServerUrl);
        console.log('------------------------------------------------------------------------------------------------------');

    }, 2000);
} catch (err) {
    console.log("err", err.toString());
}
