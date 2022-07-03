
import * as fs from "fs";
import * as pathUtils from "path";
import * as childProcess from "child_process";
import { AssemblyError } from "wheatbytecode-asm";
import { PacketType } from "./types.js";
import { projectDirectoryPath } from "./constants.js";
import { WsSocket } from "./socket.js";
import { testSuitesDirectoryPath, runTestSuite, TestResult } from "./testSuite.js";

const socketPath = pathUtils.join(projectDirectoryPath, "testSocket");
const launchScriptPath = pathUtils.join(projectDirectoryPath, "launchWheatSystem.bash");

const main = async (suiteFileName: string | null): Promise<void> => {
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
    let testResults: TestResult[] | null = [];
    try {
        if (suiteFileName === null) {
            console.log("Running all test suites...");
            const fileNames = fs.readdirSync(testSuitesDirectoryPath);
            for (const fileName of fileNames) {
                await runTestSuite(testResults, socket, fileName);
            }
            console.log("Finished running test suites.");
        } else {
            await runTestSuite(testResults, socket, suiteFileName);
        }
    } catch (error) {
        if (error instanceof AssemblyError) {
            console.log("Could not finish running tests because of an assembly error!");
            console.log(error.getDisplayString());
            testResults = null;
        } else {
            throw error
        }
    }
    await socket.sendSimple(PacketType.QuitProcess);
    await socket.close();
    if (testResults !== null) {
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
    }
};

let suiteFileName: string | null;
if (process.argv.length === 2) {
    suiteFileName = null;
} else if (process.argv.length === 3) {
    suiteFileName = process.argv[2];
} else {
    console.log("Usage: node ./dist/runTests.js (suiteFileName?)");
    process.exit(1);
}
main(suiteFileName);


