
import * as fs from "fs";
import * as pathUtils from "path";
import * as childProcess from "child_process";
import { AssemblyError } from "wheatbytecode-asm";
import { PacketType } from "./types.js";
import { projectDirectoryPath } from "./constants.js";
import { WsSocket } from "./socket.js";
import { testSuitesDirectoryPath, runTestSuite, TestResult } from "./testSuite.js";
import { runAllocationTest } from "./allocationTest.js";

const socketPath = pathUtils.join(projectDirectoryPath, "testSocket");
const launchScriptPath = pathUtils.join(projectDirectoryPath, "launchWheatSystem.bash");

const performWithWheatSystem = async (
    operation: (socket: WsSocket) => Promise<void>,
): Promise<void> => {
    const socket = new WsSocket(socketPath);
    await socket.initialize();
    console.log("Launching WheatSystem...");
    childProcess.spawn(launchScriptPath, [socketPath], { stdio: "inherit" });
    await socket.waitForClient();
    console.log("Waiting for launch packet...");
    const packet = await socket.receive();
    if (packet.type !== PacketType.ProcessLaunched) {
        throw new Error(`Unexpected packet type ${packet.type}!`);
    }
    await operation(socket);
    await socket.sendSimple(PacketType.QuitProcess);
    await socket.close();
};

const gatherTestResults = async (
    runTests: (socket: WsSocket) => Promise<TestResult[]>,
): Promise<void> => {
    let testResults: TestResult[] | null = [];
    await performWithWheatSystem(async (socket) => {
        try {
            const tempTestResults = await runTests(socket);
            tempTestResults.forEach((result) => {
                testResults.push(result);
            });
        } catch (error) {
            if (error instanceof AssemblyError) {
                console.log("Could not finish running tests because of an assembly error!");
                console.log(error.getDisplayString());
                testResults = null;
            } else {
                throw error
            }
        }
    });
    if (testResults === null) {
        return;
    }
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

const main = async (suiteName: string | null): Promise<void> => {
    if (suiteName === "allocation") {
        await performWithWheatSystem(runAllocationTest);
        return;
    }
    await gatherTestResults(async (socket) => {
        if (suiteName === null) {
            const output: TestResult[] = [];
            console.log("Running all test suites...");
            const fileNames = fs.readdirSync(testSuitesDirectoryPath);
            for (const fileName of fileNames) {
                const results = await runTestSuite(socket, fileName);
                results.forEach((result) => {
                    output.push(result);
                });
            }
            console.log("Finished running test suites.");
            return output;
        } else {
            return await runTestSuite(socket, suiteName);
        }
    });
};

let suiteName: string | null;
if (process.argv.length === 2) {
    suiteName = null;
} else if (process.argv.length === 3) {
    suiteName = process.argv[2];
} else {
    console.log("Usage: node ./dist/runTests.js (suiteFileName?)\nnode ./dist/runTests.js allocation");
    process.exit(1);
}
main(suiteName);


