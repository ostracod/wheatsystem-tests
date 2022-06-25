
import * as fs from "fs";
import * as pathUtils from "path";
import { fileURLToPath } from "url";
import * as net from "net";

enum PacketType {
    ProcessLaunched = 1,
    DataLogged = 2,
    SystemHalted = 3,
    ResetState = 4,
    CreateFile = 5,
    StartSystem = 6,
    QuitProcess = 7,
}

const currentDirectoryPath = pathUtils.dirname(fileURLToPath(import.meta.url));
const projectDirectoryPath = pathUtils.dirname(currentDirectoryPath);
const socketPath = pathUtils.join(projectDirectoryPath, "testSocket");
const packetHeaderSize = 5;

let socketClient: net.Socket;
let receivedSocketData = Buffer.alloc(0);
const packetQueue: Packet[] = [];
let handlePacket: ((packet: Packet) => void) | null = null;

class Packet {
    type: PacketType;
    body: Buffer | null;
    
    constructor(type, body: Buffer | null = null) {
        this.type = type;
        this.body = body;
    }
    
    toString() {
        const textList: string[] = ["(type = " + this.type];
        if (this.body !== null) {
            textList.push("; body = " + this.body.toString("hex"));
        }
        textList.push(")");
        return textList.join("");
    }
    
    send(): void {
        const header = Buffer.alloc(packetHeaderSize);
        header.writeInt8(this.type, 0);
        const bodyLength = (this.body === null) ? 0 : this.body.length;
        header.writeInt32LE(bodyLength, 1);
        socketClient.write(header);
        if (bodyLength > 0) {
            socketClient.write(this.body);
        }
    };
}

const handleSocketData = (buffer: Buffer): void => {
    receivedSocketData = Buffer.concat([receivedSocketData, buffer]);
    if (receivedSocketData.length < packetHeaderSize) {
        return;
    }
    const type = receivedSocketData.readInt8(0);
    const bodyLength = receivedSocketData.readInt32LE(1);
    let endIndex = packetHeaderSize + bodyLength;
    if (receivedSocketData.length < endIndex) {
        return;
    }
    let body: Buffer | null;
    if (bodyLength > 0) {
        body = receivedSocketData.subarray(packetHeaderSize, endIndex);
    } else {
        body = null;
    }
    receivedSocketData = receivedSocketData.subarray(endIndex, receivedSocketData.length);
    const packet = new Packet(type, body);
    if (handlePacket === null) {
        packetQueue.push(packet);
    } else {
        const tempHandle = handlePacket;
        handlePacket = null;
        tempHandle(packet);
    }
};

const receivePacket = (): Promise<Packet> => new Promise((resolve, reject) => {
    if (packetQueue.length > 0) {
        resolve(packetQueue.shift());
    } else {
        handlePacket = resolve;
    }
});

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

const runTest = async (): Promise<void> => {
    while (true) {
        const outputPacket = new Packet(PacketType.ResetState);
        console.log("Sending packet to test socket: " + outputPacket.toString());
        outputPacket.send();
        const inputPacket = await receivePacket();
        console.log("Received packet from test socket: " + inputPacket.toString());
        await new Promise((resolve, reject) => {
            setTimeout(resolve, 1000);
        });
    };
};

const runTests = async (): Promise<void> => {
    const socketServer = await createSocket();
    await runTest();
    console.log("Closing test socket...");
    await socketServer.close();
    console.log("Finished running tests.");
};

runTests();


