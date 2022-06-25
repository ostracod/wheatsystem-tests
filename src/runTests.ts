
import * as fs from "fs";
import * as pathUtils from "path";
import { fileURLToPath } from "url";
import * as childProcess from "child_process";
import * as net from "net";
import { Assembler, InstructionType } from "wheatbytecode-asm";

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
const launchScriptPath = pathUtils.join(projectDirectoryPath, "launchWheatSystem.bash");
const packetHeaderSize = 5;
const extraInstructionTypes = [
    new InstructionType("logTestData", 0xC0, 1),
    new InstructionType("haltTest", 0xC1, 0),
];

let pendingSocketClient: net.Socket | null = null;
let socketClient: net.Socket;
let receivedSocketData = Buffer.alloc(0);
const packetQueue: Packet[] = [];
let handlePacket: ((packet: Packet) => void) | null = null;
let handleSocketClient: ((client: net.Socket) => void) | null = null;

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
    
    async send(): Promise<void> {
        const header = Buffer.alloc(packetHeaderSize);
        header.writeInt8(this.type, 0);
        const bodyLength = (this.body === null) ? 0 : this.body.length;
        header.writeInt32LE(bodyLength, 1);
        await socketClient.write(header);
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
    
    async run(): Promise<boolean> {
        console.log(`Running test "${this.name}"...`);
        await sendSimplePacket(PacketType.ResetState);
        for (const file of this.files) {
            await file.send();
        }
        await sendSimplePacket(PacketType.StartSystem);
        const loggedValues: number[] = [];
        while (true) {
            const packet = await receivePacket();
            if (packet.type === PacketType.DataLogged) {
                const value = packet.body.readInt32LE(0);
                loggedValues.push(value);
            } else if (packet.type === PacketType.SystemHalted) {
                break;
            } else {
                throw new Error(`Unexpected packet type ${packet.type}!`);
            }
        }
        let testPassed = true;
        if (loggedValues.length !== this.expectedValues.length) {
            testPassed = false;
        } else {
            for (let index = 0; index < loggedValues.length; index++) {
                if (loggedValues[index] !== this.expectedValues[index]) {
                    testPassed = false;
                    break;
                }
            }
        }
        if (testPassed) {
            console.log("Test passed.");
        } else {
            console.log(`Test failed!\nExpected values:\n${this.expectedValues.join(",")}\nLogged values:\n${loggedValues.join(",")}`);
        }
        console.log(`Finished running test "${this.name}".`);
        return testPassed;
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
    
    abstract createContentBuffer(): Buffer;
    
    async send(): Promise<void> {
        const header = Buffer.from([this.name.length, this.type, this.isGuarded ? 1 : 0]);
        const body = Buffer.concat([
            header,
            Buffer.from(this.name),
            this.createContentBuffer(),
        ]);
        const packet = new Packet(PacketType.CreateFile, body);
        await packet.send();
    }
}

class BytecodeFile extends TestFile {
    
    constructor(name: string, isGuarded: boolean) {
        super(name, FileType.BytecodeApp, isGuarded);
    }
    
    createContentBuffer(): Buffer {
        const assembler = new Assembler({
            shouldPrintLog: false,
            extraInstructionTypes,
        });
        return assembler.assembleCodeLines(this.lines);
    }
}

class TestResult {
    suiteFileName: string;
    testName: string;
    testPassed: boolean;
    
    constructor(suiteFileName: string, testName: string, testPassed: boolean) {
        this.suiteFileName = suiteFileName;
        this.testName = testName;
        this.testPassed = testPassed;
    }
    
    toString(): string {
        return `Suite = "${this.suiteFileName}"; Test = "${this.testName}"; Result = ${this.testPassed ? "passed" : "failed"}`;
    }
}

const handleSocketData = (buffer: Buffer): void => {
    receivedSocketData = Buffer.concat([receivedSocketData, buffer]);
    while (receivedSocketData.length >= packetHeaderSize) {
        const type = receivedSocketData.readInt8(0);
        const bodyLength = receivedSocketData.readInt32LE(1);
        let endIndex = packetHeaderSize + bodyLength;
        if (receivedSocketData.length < endIndex) {
            break;
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
    }
};

const receivePacket = (): Promise<Packet> => new Promise((resolve, reject) => {
    if (packetQueue.length > 0) {
        resolve(packetQueue.shift());
    } else {
        handlePacket = resolve;
    }
});

const sendSimplePacket = async (type: PacketType): Promise<void> => {
    const packet = new Packet(type);
    await packet.send();
};

const createSocket = async (): Promise<net.Server> => {
    console.log("Creating test socket...");
    if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
    }
    const socketServer = net.createServer((client) => {
        if (handleSocketClient === null) {
            pendingSocketClient = client;
        } else {
            const tempHandle = handleSocketClient;
            handleSocketClient = null;
            tempHandle(client);
        }
    });
    await socketServer.listen(socketPath);
    console.log("Test socket path:");
    console.log(socketPath);
    console.log("Waiting for WheatSystem to start...");
    return socketServer;
};

const waitForSocketClient = async (): Promise<net.Socket> => new Promise(
    (resolve, reject) => {
        if (pendingSocketClient === null) {
            handleSocketClient = resolve;
        } else {
            const output = pendingSocketClient;
            pendingSocketClient = null;
            resolve(output);
        }
    },
);

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

const runTestSuite = async (fileName: string): Promise<TestResult[]> => {
    console.log(`Running test suite "${fileName}"...`);
    const output: TestResult[] = [];
    const filePath = pathUtils.join(testSuitesDirectoryPath, fileName);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const tests = parseTests(lines);
    for (const test of tests) {
        const testPassed = await test.run();
        output.push(new TestResult(fileName, test.name, testPassed));
    }
    console.log(`Finished running test suite "${fileName}".`);
    return output;
};

const runTestSuites = async (): Promise<void> => {
    const socketServer = await createSocket();
    console.log("Launching WheatSystem...");
    childProcess.spawn(launchScriptPath, [socketPath]);
    socketClient = await waitForSocketClient();
    socketClient.on("data", handleSocketData);
    console.log("Waiting for launch packet...");
    const packet = await receivePacket();
    if (packet.type !== PacketType.ProcessLaunched) {
        throw new Error(`Unexpected packet type ${packet.type}!`);
    }
    console.log("Running test suites...");
    const testResults: TestResult[] = [];
    const fileNames = fs.readdirSync(testSuitesDirectoryPath);
    for (const fileName of fileNames) {
        const suiteTestResults = await runTestSuite(fileName);
        suiteTestResults.forEach((testResult) => {
            testResults.push(testResult);
        });
    }
    console.log("Finished running test suites.");
    await sendSimplePacket(PacketType.QuitProcess);
    await socketServer.close();
    let passCount = 0;
    let failCount = 0;
    console.log("========================================");
    testResults.forEach((testResult) => {
        if (testResult.testPassed) {
            passCount += 1;
        } else {
            console.log(testResult.toString());
            failCount += 1;
        }
    });
    if (failCount <= 0) {
        console.log("No test failures!");
    }
    console.log(`Test pass rate: ${passCount} / ${testResults.length}`);
};

runTestSuites();


