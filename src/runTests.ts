
import * as fs from "fs";
import * as pathUtils from "path";
import { fileURLToPath } from "url";
import * as net from "net";

const currentDirectoryPath = pathUtils.dirname(fileURLToPath(import.meta.url));
const projectDirectoryPath = pathUtils.dirname(currentDirectoryPath);
const socketPath = pathUtils.join(projectDirectoryPath, "testSocket");
const packetHeaderSize = 4;

let socketClient: net.Socket;
let receivedSocketData = Buffer.alloc(0);

const handlePacket = (data: Buffer): void => {
    console.log("Received data from test socket: " + data.toString("hex"));
};

const handleSocketData = (buffer: Buffer): void => {
    receivedSocketData = Buffer.concat([receivedSocketData, buffer]);
    if (receivedSocketData.length < packetHeaderSize) {
        return;
    }
    const length = receivedSocketData.readInt32LE(0);
    let endIndex = packetHeaderSize + length;
    if (receivedSocketData.length < endIndex) {
        return;
    }
    let packetData = receivedSocketData.subarray(packetHeaderSize, endIndex);
    receivedSocketData = receivedSocketData.subarray(endIndex, receivedSocketData.length);
    handlePacket(packetData);
};

const createSocket = (): Promise<net.Server> => new Promise(async (resolve, reject) => {
    console.log("Creating test socket...");
    if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
    }
    const socketServer = net.createServer((client) => {
        socketClient = client;
        client.on("data", handleSocketData);
        resolve(socketServer);
    });
    await socketServer.listen(socketPath);
    console.log("Test socket path:");
    console.log(socketPath);
    console.log("Waiting for WheatSystem to start...");
});

const sendPacket = (data: Buffer): void => {
    const header = Buffer.alloc(packetHeaderSize);
    header.writeInt32LE(data.length, 0);
    socketClient.write(header);
    socketClient.write(data);
};

const runTest = (): Promise<void> => new Promise((resolve, reject) => {
    let count = 0;
    setInterval(() => {
        const buffer = Buffer.alloc(4);
        buffer.writeInt32LE(count, 0);
        count += 1;
        console.log("Sending data to test socket: " + buffer.toString("hex"));
        sendPacket(buffer);
    }, 1000);
});

const runTests = async (): Promise<void> => {
    const socketServer = await createSocket();
    await runTest();
    console.log("Closing test socket...");
    await socketServer.close();
    console.log("Finished running tests.");
};

runTests();


