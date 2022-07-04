
import * as fs from "fs";
import * as pathUtils from "path";
import { PacketType, FileFlags } from "./types.js";
import { projectDirectoryPath } from "./constants.js";
import { Packet, WsSocket } from "./socket.js";
import { TestFile, BytecodeFile, HexFile } from "./testFile.js";

export const testSuitesDirectoryPath = pathUtils.join(projectDirectoryPath, "testSuites");

class Test {
    name: string;
    files: TestFile[];
    expectedValues: number[];
    
    constructor(name: string) {
        this.name = name;
        this.files = [];
        this.expectedValues = [];
    }
    
    async run(socket: WsSocket): Promise<boolean> {
        console.log(`Running test "${this.name}"...`);
        await socket.sendSimple(PacketType.ResetState);
        for (const file of this.files) {
            const packet = file.createPacket();
            await socket.send(packet);
        }
        await socket.sendSimple(PacketType.StartSystem);
        const loggedValues: number[] = [];
        while (true) {
            const packet = await socket.receive();
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

export class TestResult {
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

const getFileFlagsFromArgs = (args: string[], index: number): FileFlags => {
    const isGuarded = (parseInt(args[index], 10) !== 0);
    let hasAdminPerm: boolean;
    const adminPermIndex = index + 1;
    if (args.length > adminPermIndex) {
        hasAdminPerm = (parseInt(args[adminPermIndex], 10) !== 0);
    } else {
        hasAdminPerm = false;
    }
    return { isGuarded, hasAdminPerm };
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
                const flags = getFileFlagsFromArgs(args, 1);
                currentFile = new BytecodeFile(args[0], flags);
                currentTest.files.push(currentFile);
            } else if (command === "HEX_FILE") {
                const fileType = parseInt(args[1], 10);
                const flags = getFileFlagsFromArgs(args, 2);
                currentFile = new HexFile(args[0], fileType, flags);
                currentTest.files.push(currentFile);
            } else if (command === "EXPECT") {
                args.forEach((arg) => {
                    const value = parseInt(arg, 10);
                    currentTest.expectedValues.push(value);
                });
            } else {
                throw new Error(`Unrecognized test command "${command}".`);
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

export const runTestSuite = async (
    socket: WsSocket, fileName: string,
): Promise<TestResult[]> => {
    console.log(`Running test suite "${fileName}"...`);
    const filePath = pathUtils.join(testSuitesDirectoryPath, fileName);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const tests = parseTests(lines);
    const output: TestResult[] = [];
    for (const test of tests) {
        const testPassed = await test.run(socket);
        output.push(new TestResult(fileName, test.name, testPassed));
    }
    console.log(`Finished running test suite "${fileName}".`);
    return output;
};


