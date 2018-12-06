/*
// 
// 
*/

'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

// set environment variable
var http_port = process.env.HTTP_PORT || 3001;                              // > $env:HTTP_PORT=3003
var p2p_port = process.env.P2P_PORT || 6001;                                // > $env:P2P_PORT=6003
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];   // > $env:PEERS = "ws://127.0.0.1:6001, ws://127.0.0.1:6002"

// block structure
class Block {
    constructor(index, previousHash, timestamp, data, hash, difficulty, nonce) {
        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
        this.difficulty = difficulty;
        this.nonce = nonce;
    }
}

// WARNING!! if you modify any of the following data,
// you might need to obtain a new hash(SHA256) value
// Use this syntax: console.log(calculateHash(0, "", 1535165503, "Genesis block",0,0));
function getGenesisBlock() {
    return new Block(0, "", 1535165503, "Genesis block", "1c9c452672569e58c48b50ea4828ea00e4cc2df8c2431f705856b797b1bcb882", 0, 0);
}

// WARNING!! the current implementation is stored in local volatile memory.
// you may need a database to store the data permanently.
var blockchain = [getGenesisBlock()];

function getBlockchain() {
    return blockchain;
}

var sockets = [];
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
}

// REST API
function initHttpServer() {
    var app = express();
    app.use(bodyParser.json());

    app.get('/blocks', function (req, res) {
        res.send(JSON.stringify(blockchain));
    });
    app.post('/mineBlock', function (req, res) {
        var newBlock = generateNextBlock(req.body.data);
        addBlock(newBlock);
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));
        res.send();
    });
    app.get('/peers', function (req, res) {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', function (req, res) {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.post('/stop', function (req, res) {
        res.send({ 'msg': 'stopping server' });
        process.exit();
    });
    app.listen(http_port, function () { console.log('Listening http on port: ' + http_port) });
}

function initP2PServer() {
    var server = new WebSocket.Server({ port: p2p_port });
    server.on('connection', function (ws) { initConnection(ws) });
    console.log('listening websocket p2p port on: ' + p2p_port);

}

function initConnection(ws) {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg());
}

function initMessageHandler(ws) {
    ws.on('message', function (data) {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
}

function initErrorHandler(ws) {
    var closeConnection = function (ws) {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', function () { closeConnection(ws) });
    ws.on('error', function () { closeConnection(ws) });
}

//in seconds
var BLOCK_GENERATION_INTERVAL = 10;
//in blocks
var DIFFICULTY_ADJUSTMENT_INTERVAL = 10;

function getDifficulty(aBlockchain) {
    const latestBlock = aBlockchain[blockchain.length - 1];
    if (latestBlock.index % DIFFICULTY_ADJUSTMENT_INTERVAL === 0 && latestBlock.index !== 0) {
        return getAdjustedDifficulty(latestBlock, aBlockchain);
    }
    else {
        return latestBlock.difficulty;
    }
}

function getAdjustedDifficulty(latestBlock, aBlockchain) {
    const prevAdjustmentBlock = aBlockchain[blockchain.length - DIFFICULTY_ADJUSTMENT_INTERVAL];
    const timeExpected = BLOCK_GENERATION_INTERVAL * DIFFICULTY_INTERVAL;
    const timeTaken = latestBlock.timestamp - prevAdjustmentBlock.timestamp;

    if (timeTaken < timeExpected / 2) {
        return prevAdjustmentBlock.difficulty + 1;
    }
    else if (timeTaken > timeExpected * 2) {
        return prevAdjustmentBlock.difficulty - 1;
    }
    else {
        return prevAdjustmentBlock.difficulty;
    }
}

// get new block
// blockData can be anything; transactions, strings, values, etc.
function generateNextBlock(blockData) {
    var previousBlock = getLatestBlock();
    var difficulty = getDifficulty(getBlockchain());
    var nextIndex = previousBlock.index + 1;
    var nextTimestamp = new Date().getTime() / 1000;
    var newBlock = findBlock(nextIndex, previousBlock.hash, nextTimestamp, blockData, difficulty);

    return newBlock;
}

function findBlock(nextIndex, previoushash, nextTimestamp, blockData, difficulty) {
    let nonce = 0;
    while (true) {
        var hash = calculateHash(nextIndex, previoushash, nextTimestamp, blockData, difficulty, nonce);
        if (hashMatchesDifficulty(hash, difficulty)) {
            return new Block(nextIndex, previoushash, nextTimestamp, blockData, hash, difficulty, nonce);
        }
        nonce++;
    }
}

// get hash
function calculateHashForBlock(block) {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.difficulty, block.nonce);
}

function calculateHash(index, previousHash, timestamp, data, difficulty, nonce) {
    return CryptoJS.SHA256(index + previousHash + timestamp + data + difficulty + nonce).toString();
}

// add new block
// need validation test
function addBlock(newBlock) {
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        blockchain.push(newBlock);
    }
}

// validation test of new block
function isValidNewBlock(newBlock, previousBlock) {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
}

/*
function getAccumulatedDifficulty(aBlockchain) {
    return aBlockchain
        .map((block) => block.difficulty)
        .map((difficulty) => Math.pow(2, difficulty))
        .reduce((a, b) => a + b);
};
*/

function hashMatchesDifficulty(hash, difficulty) {
    var hashBinary = hexToBinary(hash);
    var requiredPrefix = '0'.repeat(difficulty);
    return hashBinary.startsWith(requiredPrefix);
};

function hexToBinary(s) {
    let ret = '';
    const lookupTable = {
        '0': '0000', '1': '0001', '2': '0010', '3': '0011',
        '4': '0100', '5': '0101', '6': '0110', '7': '0111',
        '8': '1000', '9': '1001', 'a': '1010', 'b': '1011',
        'c': '1100', 'd': '1101', 'e': '1110', 'f': '1111'
    };
    for (let i = 0; i < s.length; i = i + 1) {
        if (lookupTable[s[i]]) {
            ret += lookupTable[s[i]];
        }
        else {
            return null;
        }
    }
    return ret;

}

function connectToPeers(newPeers) {
    newPeers.forEach(function (peer) {
        var ws = new WebSocket(peer);
        ws.on('open', function () { initConnection(ws) });
        ws.on('error', function () {
            console.log('connection failed')
        });
    });
}

function handleBlockchainResponse(message) {
    var receivedBlocks = JSON.parse(message.data).sort(function (b1, b2) { (b1.index - b2.index) });
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    var latestBlockHeld = getLatestBlock();
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            blockchain.push(latestBlockReceived);
            broadcast(responseLatestMsg());
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
}

// WARNING!! you can modify the following implementaion according to your own consensus design.
// current consensus: the longest chain rule.

// longest -> heaviest
function replaceChain(newBlocks) {
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
}

// validation test of blockchain
function isValidChain(blockchainToValidate) {
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
}

// get latest block
function getLatestBlock() { return blockchain[blockchain.length - 1] };

function queryChainLengthMsg() { return ({ 'type': MessageType.QUERY_LATEST }) };
function queryAllMsg() { return ({ 'type': MessageType.QUERY_ALL }) };
function responseChainMsg() {
    return ({
        'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
    })
}
function responseLatestMsg() {
    return ({
        'type': MessageType.RESPONSE_BLOCKCHAIN,
        'data': JSON.stringify([getLatestBlock()])
    })
};

function write(ws, message) { ws.send(JSON.stringify(message)) };
function broadcast(message) { sockets.forEach(socket => write(socket, message)) };

// main
connectToPeers(initialPeers);
initHttpServer();
initP2PServer();