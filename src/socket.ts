
import * as fs from "fs";
import * as pathUtils from "path";
import * as net from "net";
import { PacketType } from "./types.js";
import { projectDirectoryPath } from "./constants.js";

const packetHeaderSize = 5;

export class Packet {
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
    
    createBuffer(): Buffer {
        const header = Buffer.alloc(packetHeaderSize);
        header.writeInt8(this.type, 0);
        const bodyLength = (this.body === null) ? 0 : this.body.length;
        header.writeInt32LE(bodyLength, 1);
        const buffers: Buffer[] = [header];
        if (bodyLength > 0) {
            buffers.push(this.body);
        }
        return Buffer.concat(buffers);
    };
}

export class WsSocket {
    path: string;
    server: net.Server | null;
    client: net.Socket;
    receivedData: Buffer;
    packetQueue: Packet[];
    handleConnection: (() => void) | null;
    handlePacket: ((packet: Packet) => void) | null;
    
    constructor(path: string) {
        this.path = path;
        this.server = null;
        this.receivedData = Buffer.alloc(0);
        this.packetQueue = [];
        this.handlePacket = null;
        this.handleConnection = null;
    }
    
    async initialize(): Promise<void> {
        if (fs.existsSync(this.path)) {
            fs.unlinkSync(this.path);
        }
        this.server = net.createServer((client) => {
            this.client = client;
            this.client.on("data", (buffer) => {
                this.handleSocketData(buffer);
            });
            if (this.handleConnection !== null) {
                const tempHandle = this.handleConnection;
                this.handleConnection = null;
                tempHandle();
            }
        });
        await this.server.listen(this.path);
    }
    
    async waitForClient(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.client === null) {
                this.handleConnection = resolve;
            } else {
                resolve();
            }
        });
    }
    
    handleSocketData(buffer: Buffer): void {
        this.receivedData = Buffer.concat([this.receivedData, buffer]);
        while (this.receivedData.length >= packetHeaderSize) {
            const type = this.receivedData.readInt8(0);
            const bodyLength = this.receivedData.readInt32LE(1);
            let endIndex = packetHeaderSize + bodyLength;
            if (this.receivedData.length < endIndex) {
                break;
            }
            let body: Buffer | null;
            if (bodyLength > 0) {
                body = this.receivedData.subarray(packetHeaderSize, endIndex);
            } else {
                body = null;
            }
            this.receivedData = this.receivedData.subarray(
                endIndex, this.receivedData.length,
            );
            const packet = new Packet(type, body);
            if (this.handlePacket === null) {
                this.packetQueue.push(packet);
            } else {
                const tempHandle = this.handlePacket;
                this.handlePacket = null;
                tempHandle(packet);
            }
        }
    }
    
    async receive(): Promise<Packet> {
        return new Promise((resolve, reject) => {
            if (this.packetQueue.length > 0) {
                resolve(this.packetQueue.shift());
            } else {
                this.handlePacket = resolve;
            }
        });
    }
    
    async receiveWithType(type: PacketType): Promise<Packet> {
        const packet = await this.receive();
        if (packet.type !== type) {
            throw new Error(`Unexpected packet type ${packet.type}!`);
        }
        return packet;
    }
    
    async send(packet: Packet): Promise<void> {
        const buffer = packet.createBuffer();
        await this.client.write(buffer);
    }
    
    async sendSimple(type: PacketType): Promise<void> {
        const packet = new Packet(type);
        await this.send(packet);
    }
    
    async close(): Promise<void> {
        await this.server.close();
    }
}


