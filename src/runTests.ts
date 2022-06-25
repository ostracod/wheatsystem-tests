
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

enum FileType {
    Generic = 0,
    BytecodeApp = 1,
    SystemApp = 2,
}

const currentDirectoryPath = pathUtils.dirname(fileURLToPath(import.meta.url));
const projectDirectoryPath = pathUtils.dirname(currentDirectoryPath);
const socketPath = pathUtils.join(projectDirectoryPath, "testSocket");
const testSuitesDirectoryPath = pathUtils.join(projectDirectoryPath, "testSuites");
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

class Test {
    name: string;
    files: TestFile[];
    expectedValues: number[];
    
    constructor(name: string) {
        this.name = name;
        this.files = [];
        this.expectedValues = [];
    }
}

abstract class TestFile {
    name: string;
    type: FileType;
    isGuarded: boolean;
    lines: string[];
    
    constructor(name: string, type: FileType, isGuarded: boolean) {
        this.name = name;
        this.type = type;
        this.isGuarded = isGuarded;
        this.lines = [];
    }
}

class BytecodeFile extends TestFile {
    
    constructor(name: string, isGuarded: boolean) {
        super(name, FileType.BytecodeApp, isGuarded);
    }
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

const trimEnd = (text: string): string => {
    let endIndex = text.length;
    while (endIndex > 0) {
        if (text.charAt(endIndex - 1) !== " ") {
            break;
        }
        endIndex -= 1;
    }
    return text.substring(0, endIndex);
};

const isSeparator = (text: string): boolean => {
    if (text.length < 5) {
        return false;
    }
    for (let index = 0; index < text.length; index++) {
        if (text.charAt(index) !== "=") {
            return false;
        }
    }
    return true;
};

const parseTests = (lines: string[]): Test[] => {
    const output: Test[] = [];
    let currentTest: Test = null;
    let currentFile: TestFile = null;
    for (const untrimmedLine of lines) {
        const line = trimEnd(untrimmedLine);
        if (line.startsWith(">>> ")) {
            currentFile = null;
            const terms = line.substring(4, line.length).split(" ");
            const command = terms[0];
            const args = terms.slice(1, terms.length);
            if (command === "TEST") {
                currentTest = new Test(args[0]);
                output.push(currentTest);
            } else if (command === "BYTECODE_FILE") {
                const isGuarded = (parseInt(args[1], 10) !== 0);
                currentFile = new BytecodeFile(args[0], isGuarded);
                currentTest.files.push(currentFile);
            } else if (command === "EXPECT") {
                args.forEach((arg) => {
                    const value = parseInt(arg, 10);
                    currentTest.expectedValues.push(value);
                });
            }
        } else if (isSeparator(line)) {
            currentTest = null;
            currentFile = null;
        } else if (line.length > 0) {
            currentFile.lines.push(line);
        }
    }
    return output;
}

const runTestSuite = async (path: string): Promise<void> => {
    const lines = fs.readFileSync(path, "utf8").split("\n");
    const tests = parseTests(lines);
    // TODO: Run the tests.
    
};

const runTestSuites = async (): Promise<void> => {
    //const socketServer = await createSocket();
    const fileNames = fs.readdirSync(testSuitesDirectoryPath);
    for (const fileName of fileNames) {
        const filePath = pathUtils.join(testSuitesDirectoryPath, fileName);
        await runTestSuite(filePath);
    }
    //console.log("Closing test socket...");
    //await socketServer.close();
    console.log("Finished running tests.");
};

runTestSuites();


